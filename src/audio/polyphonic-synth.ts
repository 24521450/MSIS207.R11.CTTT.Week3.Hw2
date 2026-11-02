import { FIRST_MIDI_NOTE, LAST_MIDI_NOTE, frequencyForMidi } from './piano-notes.ts'

export const MAX_ACTIVE_VOICES = 8
export const DEFAULT_RELEASE_MS = 40
const SILENCE_FLOOR = 0.0001
const DEFAULT_MASTER_VOLUME = 0.5
const VOICE_LEVEL = 0.14

export type VoiceStateListener = (midi: number, isActive: boolean) => void
export type AudioContextFactory = () => AudioContext

export interface PolyphonicSynthOptions {
  createAudioContext?: AudioContextFactory
  onVoiceStateChange?: VoiceStateListener
  masterVolume?: number
}

interface Voice {
  readonly midi: number
  readonly oscillator: OscillatorNode
  readonly envelope: GainNode
  releasing: boolean
}

export class PolyphonicSynth {
  private readonly createAudioContext: AudioContextFactory
  private readonly onVoiceStateChange: VoiceStateListener
  private readonly activeVoices = new Map<number, Voice>()
  private readonly releaseTails = new Set<Voice>()
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private volume: number
  private disposed = false
  private disposePromise: Promise<void> | null = null

  constructor(options: PolyphonicSynthOptions = {}) {
    this.createAudioContext = options.createAudioContext ?? (() => new AudioContext())
    this.onVoiceStateChange = options.onVoiceStateChange ?? (() => undefined)
    this.volume = options.masterVolume ?? DEFAULT_MASTER_VOLUME
    this.validateVolume(this.volume)
  }

  get activeVoiceCount(): number {
    return this.activeVoices.size
  }

  getActiveMidis(): readonly number[] {
    return Array.from(this.activeVoices.keys())
  }

  async resume(): Promise<void> {
    const context = this.getContext()
    if (context.state !== 'running') {
      await context.resume()
    }
  }

  noteOn(midi: number, frequencyHz = frequencyForMidi(midi)): void {
    this.validateMidi(midi)
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
      throw new RangeError(`Frequency for MIDI note ${midi} must be positive.`)
    }

    const context = this.getContext()
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }

    const retriggered = this.activeVoices.get(midi)
    if (retriggered) this.releaseActiveVoice(retriggered, DEFAULT_RELEASE_MS)

    if (this.activeVoices.size >= MAX_ACTIVE_VOICES) {
      const oldest = this.activeVoices.values().next().value as Voice | undefined
      if (oldest) this.releaseActiveVoice(oldest, DEFAULT_RELEASE_MS)
    }

    const masterGain = this.getMasterGain(context)
    const envelope = context.createGain()
    const oscillator = context.createOscillator()
    const voice: Voice = { midi, oscillator, envelope, releasing: false }
    const now = context.currentTime
    const attackSeconds = 0.012
    const decaySeconds = 0.075

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(frequencyHz, now)
    envelope.gain.setValueAtTime(SILENCE_FLOOR, now)
    envelope.gain.linearRampToValueAtTime(VOICE_LEVEL, now + attackSeconds)
    envelope.gain.linearRampToValueAtTime(VOICE_LEVEL * 0.76, now + attackSeconds + decaySeconds)

    try {
      oscillator.connect(envelope)
      envelope.connect(masterGain)
      oscillator.onended = () => this.handleVoiceEnded(voice)
      oscillator.start(now)
    } catch (error) {
      this.disconnectVoice(voice)
      throw error
    }

    this.activeVoices.set(midi, voice)
    this.onVoiceStateChange(midi, true)
  }

  noteOff(midi: number, releaseMs = DEFAULT_RELEASE_MS): void {
    const voice = this.activeVoices.get(midi)
    if (!voice) return
    this.releaseActiveVoice(voice, releaseMs)
  }

  allNotesOff(releaseMs = DEFAULT_RELEASE_MS): void {
    for (const voice of Array.from(this.activeVoices.values())) {
      this.releaseActiveVoice(voice, releaseMs)
    }
  }

  setMasterVolume(volume: number): void {
    this.validateVolume(volume)
    this.volume = volume
    if (this.context && this.masterGain) {
      const now = this.context.currentTime
      this.masterGain.gain.cancelScheduledValues(now)
      this.masterGain.gain.setTargetAtTime(volume, now, 0.012)
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.allNotesOff(12)
    this.disposed = true

    for (const voice of this.releaseTails) {
      this.disconnectVoice(voice)
    }
    this.releaseTails.clear()

    const master = this.masterGain
    this.masterGain = null
    try {
      master?.disconnect()
    } catch {
      // Closing the context also releases a partially disconnected graph.
    }

    const context = this.context
    this.context = null
    if (!context || context.state === 'closed') {
      this.disposePromise = Promise.resolve()
    } else {
      try {
        this.disposePromise = context.close()
      } catch (error) {
        this.disposePromise = Promise.reject(error)
      }
    }
    return this.disposePromise
  }

  private releaseActiveVoice(voice: Voice, releaseMs: number): void {
    if (this.activeVoices.get(voice.midi) !== voice || voice.releasing) return
    this.activeVoices.delete(voice.midi)
    this.onVoiceStateChange(voice.midi, false)
    this.releaseVoice(voice, releaseMs)
  }

  private releaseVoice(voice: Voice, releaseMs: number): void {
    if (voice.releasing) return
    voice.releasing = true
    this.releaseTails.add(voice)
    const context = this.context
    if (!context) {
      this.disconnectVoice(voice)
      return
    }

    const now = context.currentTime
    const releaseSeconds = Math.max(1, releaseMs) / 1000
    const gain = voice.envelope.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(Math.max(gain.value, SILENCE_FLOOR), now)
    gain.linearRampToValueAtTime(SILENCE_FLOOR, now + releaseSeconds)

    try {
      voice.oscillator.stop(now + releaseSeconds)
    } catch {
      this.disconnectVoice(voice)
    }
  }

  private handleVoiceEnded(voice: Voice): void {
    voice.oscillator.onended = null
    this.disconnectVoice(voice)
    if (this.activeVoices.get(voice.midi) === voice) {
      this.activeVoices.delete(voice.midi)
      this.onVoiceStateChange(voice.midi, false)
    }
  }

  private disconnectVoice(voice: Voice): void {
    voice.oscillator.onended = null
    try {
      voice.oscillator.disconnect()
    } catch {
      // Ignore repeated disconnect calls during stop and dispose races.
    }
    try {
      voice.envelope.disconnect()
    } catch {
      // Ignore repeated disconnect calls during stop and dispose races.
    }
    this.releaseTails.delete(voice)
  }

  private getContext(): AudioContext {
    if (this.disposed) {
      throw new DOMException('Synth đã được giải phóng.', 'InvalidStateError')
    }
    this.context ??= this.createAudioContext()
    return this.context
  }

  private getMasterGain(context: AudioContext): GainNode {
    if (!this.masterGain) {
      const master = context.createGain()
      master.gain.setValueAtTime(this.volume, context.currentTime)
      try {
        master.connect(context.destination)
      } catch (error) {
        try {
          master.disconnect()
        } catch {
          // Surface the original graph connection error.
        }
        throw error
      }
      this.masterGain = master
    }
    return this.masterGain
  }

  private validateMidi(midi: number): void {
    if (!Number.isInteger(midi) || midi < FIRST_MIDI_NOTE || midi > LAST_MIDI_NOTE) {
      throw new RangeError(`MIDI note must be between ${FIRST_MIDI_NOTE} and ${LAST_MIDI_NOTE}.`)
    }
  }

  private validateVolume(volume: number): void {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      throw new RangeError('Âm lượng phải nằm trong khoảng từ 0 đến 1.')
    }
  }
}
