import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReplayTimeline, playRecording, type RecordedNote } from './recording.ts'

const notes: readonly RecordedNote[] = [
  { midi: 60, freqHz: 261.625565, deltaMs: 0, durationMs: 200 },
  { midi: 64, freqHz: 329.627557, deltaMs: 75, durationMs: 300 },
  { midi: 67, freqHz: 391.995436, deltaMs: 125, durationMs: 100 },
]

afterEach(() => {
  vi.useRealTimers()
})

describe('recording timeline', () => {
  it.each([
    [0.5, [0, 150, 400], [400, 750, 600]],
    [1, [0, 75, 200], [200, 375, 300]],
    [2, [0, 37.5, 100], [100, 187.5, 150]],
  ] as const)('scales both onset and duration by %sx', (speed, onsets, releases) => {
    const timeline = createReplayTimeline(notes, speed)
    expect(timeline.map((entry) => entry.onsetMs)).toEqual(onsets)
    expect(timeline.map((entry) => entry.releaseMs)).toEqual(releases)
  })

  it('dispatches FIFO note starts without awaiting earlier note durations, preserving chord overlap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const controller = new AbortController()
    const events: string[] = []
    const playback = playRecording(notes.slice(0, 2), 1, controller.signal, {
      noteOn: (note) => events.push(`on:${note.midi}:${Math.round(performance.now())}`),
      noteOff: (note) => events.push(`off:${note.midi}:${Math.round(performance.now())}`),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual(['on:60:0'])

    await vi.advanceTimersByTimeAsync(75)
    expect(events).toEqual(['on:60:0', 'on:64:75'])
    await vi.advanceTimersByTimeAsync(125)
    expect(events).toContain('off:60:200')
    expect(events).not.toContain('off:64:200')
    await vi.advanceTimersByTimeAsync(175)
    await playback
    expect(events).toEqual(['on:60:0', 'on:64:75', 'off:60:200', 'off:64:375'])
  })

  it('aborts pending onset and release timers without firing late callbacks', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const controller = new AbortController()
    const onNoteOn = vi.fn()
    const onNoteOff = vi.fn()
    const playback = playRecording(notes, 1, controller.signal, { noteOn: onNoteOn, noteOff: onNoteOff })
    const rejected = expect(playback).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(500)

    expect(onNoteOn).toHaveBeenCalledTimes(1)
    expect(onNoteOff).not.toHaveBeenCalled()
  })

  it('lets a new playback session run after stop without old-session callbacks affecting it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const oldController = new AbortController()
    const oldOff = vi.fn()
    const oldPlay = playRecording(notes, 1, oldController.signal, { noteOn: vi.fn(), noteOff: oldOff })
    const oldRejected = expect(oldPlay).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    oldController.abort()
    await oldRejected

    const newController = new AbortController()
    const newEvents: string[] = []
    const newPlay = playRecording(notes.slice(0, 1), 2, newController.signal, {
      noteOn: (note) => newEvents.push(`on:${note.midi}`),
      noteOff: (note) => newEvents.push(`off:${note.midi}`),
    })
    await vi.advanceTimersByTimeAsync(100)
    await newPlay
    await vi.advanceTimersByTimeAsync(500)

    expect(oldOff).not.toHaveBeenCalled()
    expect(newEvents).toEqual(['on:60', 'off:60'])
  })
})
