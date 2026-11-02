import { memo, useLayoutEffect, useRef, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react'
import type { PianoNote } from '../audio/piano-notes.ts'

export interface PianoKeyProps {
  readonly note: PianoNote
  readonly isPressed: boolean
  readonly onNoteStart: (source: string, midi: number, frequencyHz: number) => void
  readonly onNoteEnd: (source: string) => void
}

function PianoKeyView({ note, isPressed, onNoteStart, onNoteEnd }: PianoKeyProps) {
  const renderCount = useRef(0)
  const heldButtonKeys = useRef(new Set<string>())
  const buttonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    renderCount.current += 1
    if (buttonRef.current) buttonRef.current.dataset.renderCount = String(renderCount.current)
  }, [isPressed, note])

  const style: CSSProperties = {
    left: note.isBlack
      ? `calc(var(--white-key-width) * ${note.whiteIndex ?? 0} - var(--black-key-width) / 2)`
      : `calc(var(--white-key-width) * ${note.whiteIndex ?? 0})`,
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const source = `pointer:${event.pointerId}`
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some browsers and test environments do not expose pointer capture.
    }
    onNoteStart(source, note.midi, note.frequencyHz)
  }

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    onNoteEnd(`pointer:${event.pointerId}`)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.code !== 'Space' && event.code !== 'Enter') || event.repeat) return
    event.preventDefault()
    const source = `button:${note.midi}:${event.code}`
    heldButtonKeys.current.add(source)
    onNoteStart(source, note.midi, note.frequencyHz)
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.code !== 'Space' && event.code !== 'Enter') return
    const source = `button:${note.midi}:${event.code}`
    heldButtonKeys.current.delete(source)
    onNoteEnd(source)
  }

  const handleBlur = () => {
    for (const source of heldButtonKeys.current) onNoteEnd(source)
    heldButtonKeys.current.clear()
  }

  return (
    <button
      aria-label={`${note.name}, ${note.frequencyHz.toFixed(2)} hertz`}
      aria-pressed={isPressed}
      className={`piano-key ${note.isBlack ? 'piano-key--black' : 'piano-key--white'}${isPressed ? ' is-pressed' : ''}`}
      data-midi={note.midi}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onLostPointerCapture={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      ref={buttonRef}
      style={style}
      tabIndex={0}
      type="button"
    >
      <span className="piano-key__label">{note.name}</span>
    </button>
  )
}

export const PianoKey = memo(PianoKeyView)
