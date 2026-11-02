export const FIRST_MIDI_NOTE = 21
export const LAST_MIDI_NOTE = 108
export const PIANO_KEY_COUNT = LAST_MIDI_NOTE - FIRST_MIDI_NOTE + 1

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11])

export interface PianoNote {
  readonly midi: number
  readonly name: string
  readonly pitchClass: number
  readonly octave: number
  readonly frequencyHz: number
  readonly isBlack: boolean
  readonly whiteIndex: number
}

export function frequencyForMidi(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function createPianoNotes(): readonly PianoNote[] {
  let whiteIndex = 0
  const notes: PianoNote[] = []

  for (let midi = FIRST_MIDI_NOTE; midi <= LAST_MIDI_NOTE; midi += 1) {
    const pitchClass = midi % 12
    const isBlack = !WHITE_PITCH_CLASSES.has(pitchClass)
    const note: PianoNote = {
      midi,
      name: `${NOTE_NAMES[pitchClass]}${Math.floor(midi / 12) - 1}`,
      pitchClass,
      octave: Math.floor(midi / 12) - 1,
      frequencyHz: frequencyForMidi(midi),
      isBlack,
      whiteIndex,
    }
    notes.push(note)
    if (!isBlack) whiteIndex += 1
  }

  return Object.freeze(notes)
}

export const PIANO_NOTES = createPianoNotes()
export const WHITE_KEY_COUNT = PIANO_NOTES.filter((note) => !note.isBlack).length
export const BLACK_KEY_COUNT = PIANO_NOTES.length - WHITE_KEY_COUNT

export function noteNameForMidi(midi: number): string {
  const pitchClass = midi % 12
  const name = NOTE_NAMES[pitchClass]
  if (name === undefined) {
    throw new RangeError(`MIDI note ${midi} is invalid.`)
  }
  return `${name}${Math.floor(midi / 12) - 1}`
}
