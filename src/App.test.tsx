import { StrictMode, type ProfilerOnRenderCallback } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App.tsx'

function fakeAudioParam(initialValue = 0) {
  return {
    value: initialValue,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  state: AudioContextState = 'suspended'
  currentTime = 10
  destination = {}

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: fakeAudioParam() }
  }

  createOscillator() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      frequency: fakeAudioParam(),
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
      type: 'sine' as OscillatorType,
    }
  }

  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
}

function pianoKey(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name: new RegExp(`^${name},`) }) as HTMLButtonElement
}

function renderStudio(onPianoKeyCommit?: ProfilerOnRenderCallback) {
  const props = onPianoKeyCommit ? { onPianoKeyCommit } : {}
  return render(<StrictMode><App {...props} /></StrictMode>)
}

beforeEach(() => {
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('piano studio interactions', () => {
  it('keeps the 88 memoized keys isolated when one key is held and released', async () => {
    const updateCommits = new Map<string, number>()
    const onPianoKeyCommit: ProfilerOnRenderCallback = (id, phase) => {
      if (phase === 'mount') return
      updateCommits.set(id, (updateCommits.get(id) ?? 0) + 1)
    }
    renderStudio(onPianoKeyCommit)
    const c4 = pianoKey('C4')
    const cSharp4 = pianoKey('C♯4')
    const keyIds = Array.from(document.querySelectorAll<HTMLButtonElement>('.piano-key'), (key) => `piano-key-${key.dataset.midi}`)
    expect(keyIds).toHaveLength(88)
    const baseline = new Map(keyIds.map((id) => [id, updateCommits.get(id) ?? 0]))
    const updateCount = (id: string) => updateCommits.get(id) ?? 0

    fireEvent.pointerDown(c4, { button: 0, pointerId: 4 })
    await waitFor(() => expect(c4).toHaveAttribute('aria-pressed', 'true'))
    expect(updateCount('piano-key-60')).toBe((baseline.get('piano-key-60') ?? 0) + 1)
    for (const id of keyIds) {
      if (id !== 'piano-key-60') expect(updateCount(id)).toBe(baseline.get(id))
    }

    fireEvent.pointerUp(c4, { button: 0, pointerId: 4 })
    await waitFor(() => expect(c4).toHaveAttribute('aria-pressed', 'false'))
    expect(updateCount('piano-key-60')).toBe((baseline.get('piano-key-60') ?? 0) + 2)
    for (const id of keyIds) {
      if (id !== 'piano-key-60') expect(updateCount(id)).toBe(baseline.get(id))
    }
    expect(cSharp4).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps a MIDI note active until every pointer and keyboard source releases it', async () => {
    renderStudio()
    const c4 = pianoKey('C4')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 5 })
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q' })
    expect(c4).toHaveAttribute('aria-pressed', 'true')

    fireEvent.pointerUp(c4, { button: 0, pointerId: 5 })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'KeyQ', key: 'q' })
    await waitFor(() => expect(c4).toHaveAttribute('aria-pressed', 'false'))
  })

  it('ignores keyboard repeat and releases notes on pointer cancellation and window blur', async () => {
    renderStudio()
    const c4 = pianoKey('C4')
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q', repeat: true })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q' })
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q', repeat: true })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'KeyQ', key: 'q' })
    expect(c4).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(c4, { button: 0, pointerId: 7 })
    fireEvent.pointerCancel(c4, { pointerId: 7 })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 8 })
    fireEvent.blur(window)
    expect(c4).toHaveAttribute('aria-pressed', 'false')
  })

  it('records the FIFO order by note-on even when note-off events arrive in reverse order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: 'Ghi âm' }))
    const c4 = pianoKey('C4')
    const e4 = pianoKey('E4')

    fireEvent.pointerDown(c4, { button: 0, pointerId: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(45) })
    fireEvent.pointerDown(e4, { button: 0, pointerId: 2 })
    await act(async () => { await vi.advanceTimersByTimeAsync(20) })
    fireEvent.pointerUp(e4, { button: 0, pointerId: 2 })
    await act(async () => { await vi.advanceTimersByTimeAsync(40) })
    fireEvent.pointerUp(c4, { button: 0, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc ghi' }))

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const firstRow = rows[0]
    const secondRow = rows[1]
    if (!firstRow || !secondRow) throw new Error('Expected two recorded note rows.')
    expect(within(firstRow).getByText('C4')).toBeInTheDocument()
    expect(within(secondRow).getByText('E4')).toBeInTheDocument()
    expect(within(secondRow).getByText('+45')).toBeInTheDocument()
    expect(within(firstRow).getByText('0.11s')).toBeInTheDocument()
    expect(within(secondRow).getByText('0.02s')).toBeInTheDocument()
  })

  it('completes a held note when recording ends and releases that input source', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: 'Ghi âm' }))
    const c4 = pianoKey('C4')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 4 })
    await act(async () => { await vi.advanceTimersByTimeAsync(62) })
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc ghi' }))

    expect(c4).toHaveAttribute('aria-pressed', 'false')
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    if (!row) throw new Error('Expected the held note to be finalized in the queue.')
    expect(within(row).getByText('C4')).toBeInTheDocument()
    expect(within(row).getByText('0.06s')).toBeInTheDocument()
    fireEvent.pointerUp(c4, { pointerId: 4 })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
  })

  it('stops playback when the tab becomes hidden and cleans up held voices', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: 'Ghi âm' }))
    const c4 = pianoKey('C4')
    const e4 = pianoKey('E4')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    fireEvent.pointerUp(c4, { button: 0, pointerId: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    fireEvent.pointerDown(e4, { button: 0, pointerId: 2 })
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    fireEvent.pointerUp(e4, { button: 0, pointerId: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc ghi' }))

    const play = screen.getByRole('button', { name: 'Phát' })
    fireEvent.click(play)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(c4).toHaveAttribute('aria-pressed', 'true')

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    fireEvent(document, new Event('visibilitychange'))
    expect(c4).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Đã dừng âm thanh khi tab ẩn.')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(e4).toHaveAttribute('aria-pressed', 'false')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  it('keeps a new Play → Stop → Play session isolated from the old session release timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    renderStudio()
    fireEvent.click(screen.getByRole('button', { name: 'Ghi âm' }))
    const c4 = pianoKey('C4')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    fireEvent.pointerUp(c4, { button: 0, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc ghi' }))
    fireEvent.click(screen.getByRole('button', { name: '2x' }))
    const play = screen.getByRole('button', { name: 'Phát' })

    fireEvent.click(play)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Dừng' }))
    expect(c4).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Phát' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(8) })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { await vi.advanceTimersByTimeAsync(8) })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
  })

  it('aborts pending playback and disposes the Web Audio context on unmount', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const view = renderStudio()
    fireEvent.click(screen.getByRole('button', { name: 'Ghi âm' }))
    const c4 = pianoKey('C4')
    fireEvent.pointerDown(c4, { button: 0, pointerId: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    fireEvent.pointerUp(c4, { button: 0, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc ghi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(c4).toHaveAttribute('aria-pressed', 'true')

    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0]?.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
