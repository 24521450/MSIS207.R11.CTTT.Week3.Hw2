import { memo, Profiler, type ProfilerOnRenderCallback } from 'react'
import { PianoKey, type PianoKeyProps } from './PianoKey.tsx'

export interface ProfiledPianoKeyProps extends PianoKeyProps {
  readonly onRenderCommit: ProfilerOnRenderCallback | null
}

function ProfiledPianoKeyView({ onRenderCommit, ...keyProps }: ProfiledPianoKeyProps) {
  const pianoKey = <PianoKey {...keyProps} />

  if (!onRenderCommit) return pianoKey

  return (
    <Profiler id={`piano-key-${keyProps.note.midi}`} onRender={onRenderCommit}>
      {pianoKey}
    </Profiler>
  )
}

export const ProfiledPianoKey = memo(ProfiledPianoKeyView)
