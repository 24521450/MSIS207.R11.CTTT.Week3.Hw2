export interface RecordedNote {
  readonly midi: number
  readonly freqHz: number
  readonly durationMs: number
  readonly deltaMs: number
}

export interface ScheduledNote extends RecordedNote {
  readonly index: number
  readonly onsetMs: number
  readonly releaseMs: number
}

export type SequenceNoteHandler = (note: RecordedNote, index: number) => void
export type SequenceClock = () => number

export function createReplayTimeline(notes: readonly RecordedNote[], speed: number): readonly ScheduledNote[] {
  if (speed !== 0.5 && speed !== 1 && speed !== 2) {
    throw new RangeError('Tốc độ phát phải là 0.5x, 1x hoặc 2x.')
  }

  let recordedOnsetMs = 0
  return notes.map((note, index) => {
    if (!Number.isFinite(note.deltaMs) || note.deltaMs < 0) {
      throw new RangeError(`deltaMs của nốt ${index + 1} không hợp lệ.`)
    }
    if (!Number.isFinite(note.durationMs) || note.durationMs < 0) {
      throw new RangeError(`durationMs của nốt ${index + 1} không hợp lệ.`)
    }

    recordedOnsetMs += note.deltaMs
    const onsetMs = recordedOnsetMs / speed
    return {
      ...note,
      index,
      onsetMs,
      releaseMs: onsetMs + note.durationMs / speed,
    }
  })
}

export async function playRecording(
  notes: readonly RecordedNote[],
  speed: number,
  signal: AbortSignal,
  handlers: { noteOn: SequenceNoteHandler; noteOff: SequenceNoteHandler },
  now: SequenceClock = () => performance.now(),
): Promise<void> {
  const timeline = createReplayTimeline(notes, speed)
  const startedAt = now()
  const releases: Promise<void>[] = []
  let releaseError: unknown

  for (const scheduled of timeline) {
    await waitUntil(startedAt + scheduled.onsetMs, signal, now)
    throwIfAborted(signal)
    handlers.noteOn(scheduled, scheduled.index)

    const release = waitUntil(startedAt + scheduled.releaseMs, signal, now)
      .then(() => {
        if (!signal.aborted) handlers.noteOff(scheduled, scheduled.index)
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !isAbortError(error)) releaseError ??= error
      })
    releases.push(release)
  }

  await Promise.all(releases)
  throwIfAborted(signal)
  if (releaseError !== undefined) throw releaseError
}

function waitUntil(deadline: number, signal: AbortSignal, now: SequenceClock): Promise<void> {
  if (signal.aborted) return Promise.reject(getAbortError(signal))

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (callback: () => void) => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      callback()
    }
    const handleAbort = () => finish(() => reject(getAbortError(signal)))
    const checkDeadline = () => {
      if (signal.aborted) {
        handleAbort()
        return
      }
      const remainingMs = deadline - now()
      if (remainingMs <= 0) {
        finish(resolve)
      } else {
        timer = setTimeout(checkDeadline, Math.min(remainingMs, 2_147_000_000))
      }
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    checkDeadline()
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw getAbortError(signal)
}

function getAbortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Phát lại đã dừng.', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
