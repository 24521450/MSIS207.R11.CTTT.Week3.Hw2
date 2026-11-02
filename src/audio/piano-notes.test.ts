import { describe, expect, it } from 'vitest'
import {
  BLACK_KEY_COUNT,
  FIRST_MIDI_NOTE,
  frequencyForMidi,
  LAST_MIDI_NOTE,
  PIANO_KEY_COUNT,
  PIANO_NOTES,
  WHITE_KEY_COUNT,
} from './piano-notes.ts'

describe('88-key piano map', () => {
  it('generates exactly 88 notes with the expected white and black key counts', () => {
    expect(PIANO_NOTES).toHaveLength(88)
    expect(PIANO_KEY_COUNT).toBe(88)
    expect(WHITE_KEY_COUNT).toBe(52)
    expect(BLACK_KEY_COUNT).toBe(36)
    expect(PIANO_NOTES.filter((note) => !note.isBlack)).toHaveLength(52)
    expect(PIANO_NOTES.filter((note) => note.isBlack)).toHaveLength(36)
    expect(PIANO_NOTES[0]?.midi).toBe(FIRST_MIDI_NOTE)
    expect(PIANO_NOTES.at(-1)?.midi).toBe(LAST_MIDI_NOTE)
  })

  it('maps A0, A4, and C8 to their names, MIDI values, and equal-tempered frequencies', () => {
    expect(PIANO_NOTES[0]).toMatchObject({ midi: 21, name: 'A0', frequencyHz: 27.5, isBlack: false })
    expect(PIANO_NOTES.find((note) => note.name === 'A4')).toMatchObject({ midi: 69, frequencyHz: 440 })
    expect(PIANO_NOTES.at(-1)).toMatchObject({ midi: 108, name: 'C8', frequencyHz: 440 * 2 ** (39 / 12) })
    expect(frequencyForMidi(21)).toBe(27.5)
    expect(frequencyForMidi(69)).toBe(440)
  })

  it('places black notes after the correct number of preceding white keys', () => {
    expect(PIANO_NOTES.find((note) => note.name === 'C♯4')?.whiteIndex).toBe(24)
    expect(PIANO_NOTES.find((note) => note.name === 'F♯4')?.whiteIndex).toBe(27)
  })
})
