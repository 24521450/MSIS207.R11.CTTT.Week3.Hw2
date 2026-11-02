import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_RELEASE_MS, MAX_ACTIVE_VOICES, PolyphonicSynth } from './polyphonic-synth.ts'

interface FakeParam {
  value: number
  setValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
  cancelScheduledValues: ReturnType<typeof vi.fn>
  setTargetAtTime: ReturnType<typeof vi.fn>
}

interface FakeNode {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

interface FakeGain extends FakeNode {
  gain: FakeParam
}

interface FakeOscillator extends FakeNode {
  type: OscillatorType
  frequency: FakeParam
  onended: (() => void) | null
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function fakeParam(initialValue = 0): FakeParam {
  return {
    value: initialValue,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  }
}

function fakeNode(): FakeNode {
  return { connect: vi.fn(), disconnect: vi.fn() }
}

function createAudioHarness() {
  const gains: FakeGain[] = []
  const oscillators: FakeOscillator[] = []
  let state: AudioContextState = 'suspended'

  const context = {
    get currentTime() { return 10 },
    get state() { return state },
    destination: {},
    createGain: vi.fn(() => {
      const gain = { ...fakeNode(), gain: fakeParam() }
      gains.push(gain)
      return gain as unknown as GainNode
    }),
    createOscillator: vi.fn(() => {
      const oscillator: FakeOscillator = {
        ...fakeNode(),
        type: 'sine',
        frequency: fakeParam(),
        onended: null,
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(oscillator)
      return oscillator as unknown as OscillatorNode
    }),
    resume: vi.fn(async () => { state = 'running' }),
    close: vi.fn(async () => { state = 'closed' }),
  } as unknown as AudioContext

  return { context, gains, oscillators, state: () => state }
}

describe('PolyphonicSynth', () => {
  it('creates AudioContext lazily and starts voices with a safe ADSR envelope', async () => {
    const harness = createAudioHarness()
    const createContext = vi.fn(() => harness.context)
    const synth = new PolyphonicSynth({ createAudioContext: createContext })

    expect(createContext).not.toHaveBeenCalled()
    synth.noteOn(69)
    expect(createContext).toHaveBeenCalledOnce()
    expect(harness.oscillators[0]?.frequency.setValueAtTime).toHaveBeenCalledWith(440, 10)
    expect(harness.gains[1]?.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 10)
    expect(harness.gains[1]?.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 0.14, 10.012)
    expect(harness.gains[1]?.gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.14 * 0.76, 10.087)
    await synth.resume()
    expect(harness.state()).toBe('running')
    await synth.dispose()
  })

  it('keeps at most eight voices and steals the oldest inserted voice in FIFO order', async () => {
    const harness = createAudioHarness()
    const voiceChanges: Array<[number, boolean]> = []
    const synth = new PolyphonicSynth({
      createAudioContext: () => harness.context,
      onVoiceStateChange: (midi, active) => voiceChanges.push([midi, active]),
    })

    for (let midi = 21; midi < 21 + MAX_ACTIVE_VOICES; midi += 1) synth.noteOn(midi)
    expect(synth.getActiveMidis()).toEqual([21, 22, 23, 24, 25, 26, 27, 28])
    synth.noteOn(29)

    expect(synth.activeVoiceCount).toBe(MAX_ACTIVE_VOICES)
    expect(synth.getActiveMidis()).toEqual([22, 23, 24, 25, 26, 27, 28, 29])
    expect(voiceChanges.slice(-2)).toEqual([[21, false], [29, true]])
    expect(harness.oscillators[0]?.stop).toHaveBeenCalledWith(10 + DEFAULT_RELEASE_MS / 1000)
    const releasedEnvelope = harness.gains[1]?.gain
    expect(releasedEnvelope?.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.0001, 10.04)
    expect(releasedEnvelope?.linearRampToValueAtTime.mock.calls.flat()).not.toContain(0)
    await synth.dispose()
  })

  it('releases voices promptly and disconnects oscillator and gain nodes at the tail end', async () => {
    const harness = createAudioHarness()
    const synth = new PolyphonicSynth({ createAudioContext: () => harness.context })
    synth.noteOn(60)
    synth.noteOff(60)

    expect(synth.activeVoiceCount).toBe(0)
    expect(harness.oscillators[0]?.stop).toHaveBeenCalledWith(10.04)
    harness.oscillators[0]?.onended?.()
    expect(harness.oscillators[0]?.disconnect).toHaveBeenCalledOnce()
    expect(harness.gains[1]?.disconnect).toHaveBeenCalledOnce()
    await synth.dispose()
  })

  it('ignores the old voice end callback after the same MIDI note is retriggered', async () => {
    const harness = createAudioHarness()
    const synth = new PolyphonicSynth({ createAudioContext: () => harness.context })
    synth.noteOn(60)
    const oldVoice = harness.oscillators[0]
    synth.noteOn(60)
    oldVoice?.onended?.()

    expect(synth.activeVoiceCount).toBe(1)
    expect(synth.getActiveMidis()).toEqual([60])
    expect(harness.oscillators[1]?.disconnect).not.toHaveBeenCalled()
    await synth.dispose()
  })

  it('applies master volume changes and closes all tails when disposed', async () => {
    const harness = createAudioHarness()
    const synth = new PolyphonicSynth({ createAudioContext: () => harness.context })
    synth.noteOn(60)
    synth.setMasterVolume(0.3)
    expect(harness.gains[0]?.gain.setTargetAtTime).toHaveBeenCalledWith(0.3, 10, 0.012)

    await synth.dispose()
    expect(synth.activeVoiceCount).toBe(0)
    expect(harness.gains[0]?.disconnect).toHaveBeenCalledOnce()
    expect(harness.context.close).toHaveBeenCalledOnce()
    expect(() => synth.noteOn(61)).toThrow('Synth đã được giải phóng.')
  })
})
