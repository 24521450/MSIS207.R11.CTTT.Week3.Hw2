import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { frequencyForMidi, noteNameForMidi, PIANO_NOTES } from './audio/piano-notes.ts'
import { playRecording, type RecordedNote } from './audio/recording.ts'
import { PolyphonicSynth } from './audio/polyphonic-synth.ts'
import { PianoKey } from './components/PianoKey.tsx'

type ReplaySpeed = 0.5 | 1 | 2

interface MutableRecordedNote extends Omit<RecordedNote, 'durationMs'> {
  durationMs: number
  readonly order: number
  readonly startedAt: number
  complete: boolean
}

interface RecordingSession {
  active: boolean
  lastOnsetAt: number | null
  notes: MutableRecordedNote[]
  nextOrder: number
}

const EMPTY_RECORDING: RecordingSession = {
  active: false,
  lastOnsetAt: null,
  notes: [],
  nextOrder: 0,
}

const KEYBOARD_MAPPING = [
  { code: 'KeyZ', label: 'Z', midi: 48 },
  { code: 'KeyS', label: 'S', midi: 49 },
  { code: 'KeyX', label: 'X', midi: 50 },
  { code: 'KeyD', label: 'D', midi: 51 },
  { code: 'KeyC', label: 'C', midi: 52 },
  { code: 'KeyV', label: 'V', midi: 53 },
  { code: 'KeyG', label: 'G', midi: 54 },
  { code: 'KeyB', label: 'B', midi: 55 },
  { code: 'KeyH', label: 'H', midi: 56 },
  { code: 'KeyN', label: 'N', midi: 57 },
  { code: 'KeyJ', label: 'J', midi: 58 },
  { code: 'KeyM', label: 'M', midi: 59 },
  { code: 'KeyQ', label: 'Q', midi: 60 },
  { code: 'Digit2', label: '2', midi: 61 },
  { code: 'KeyW', label: 'W', midi: 62 },
  { code: 'Digit3', label: '3', midi: 63 },
  { code: 'KeyE', label: 'E', midi: 64 },
  { code: 'KeyR', label: 'R', midi: 65 },
  { code: 'Digit5', label: '5', midi: 66 },
  { code: 'KeyT', label: 'T', midi: 67 },
  { code: 'Digit6', label: '6', midi: 68 },
  { code: 'KeyY', label: 'Y', midi: 69 },
  { code: 'Digit7', label: '7', midi: 70 },
  { code: 'KeyU', label: 'U', midi: 71 },
] as const

const KEYBOARD_MAP_BY_CODE: ReadonlyMap<string, (typeof KEYBOARD_MAPPING)[number]> = new Map(KEYBOARD_MAPPING.map((entry) => [entry.code, entry]))

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi âm thanh không xác định.'
}

function formatDuration(milliseconds: number): string {
  return `${(Math.round(milliseconds / 10) / 100).toFixed(2)}s`
}

function App() {
  const [pressedMidis, setPressedMidis] = useState<ReadonlySet<number>>(() => new Set())
  const [recordedNotes, setRecordedNotes] = useState<readonly RecordedNote[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<ReplaySpeed>(1)
  const [volume, setVolume] = useState(0.55)
  const [notice, setNotice] = useState('Chạm vào một phím để bật âm thanh.')
  const [audioError, setAudioError] = useState('')

  const synthRef = useRef<PolyphonicSynth | null>(null)
  const mountedRef = useRef(false)
  const ownerBySourceRef = useRef(new Map<string, number>())
  const ownersByMidiRef = useRef(new Map<number, Set<string>>())
  const recordingRef = useRef<RecordingSession>({ ...EMPTY_RECORDING, notes: [] })
  const replayControllerRef = useRef<AbortController | null>(null)
  const replaySessionRef = useRef(0)

  const publishRecording = useCallback((now = performance.now()) => {
    const notes = [...recordingRef.current.notes]
      .sort((left, right) => left.startedAt - right.startedAt || left.order - right.order)
      .map(({ midi, freqHz, durationMs, deltaMs, complete, startedAt }) => ({
        midi,
        freqHz,
        durationMs: complete ? durationMs : Math.max(0, Math.round(now - startedAt)),
        deltaMs,
      }))
    setRecordedNotes(notes)
  }, [])

  const closeRecordedNote = useCallback((midi: number, endedAt = performance.now()) => {
    const note = [...recordingRef.current.notes].reverse().find((entry) => entry.midi === midi && !entry.complete)
    if (!note) return
    note.durationMs = Math.max(1, Math.round(endedAt - note.startedAt))
    note.complete = true
    publishRecording(endedAt)
  }, [publishRecording])

  const onVoiceStateChange = useCallback((midi: number, active: boolean) => {
    if (mountedRef.current) {
      setPressedMidis((previous) => {
        if (previous.has(midi) === active) return previous
        const next = new Set(previous)
        if (active) next.add(midi)
        else next.delete(midi)
        return next
      })
    }

    if (!active) {
      const owners = ownersByMidiRef.current.get(midi)
      if (owners) {
        for (const source of owners) ownerBySourceRef.current.delete(source)
      }
      ownersByMidiRef.current.delete(midi)
      closeRecordedNote(midi)
    }
  }, [closeRecordedNote])

  const stopAllHeldNotes = useCallback((releaseMs = 40) => {
    const synth = synthRef.current
    if (synth) {
      for (const midi of synth.getActiveMidis()) {
        closeRecordedNote(midi)
      }
      synth.allNotesOff(releaseMs)
    }
    ownerBySourceRef.current.clear()
    ownersByMidiRef.current.clear()
    if (mountedRef.current) setPressedMidis(new Set())
  }, [closeRecordedNote])

  const holdSource = useCallback((source: string, midi: number, frequencyHz = frequencyForMidi(midi), isReplay = false) => {
    if ((replayControllerRef.current && !isReplay) || !synthRef.current) return
    const existingMidi = ownerBySourceRef.current.get(source)
    if (existingMidi === midi) return
    if (existingMidi !== undefined) releaseSource(source)

    const owners = ownersByMidiRef.current.get(midi) ?? new Set<string>()
    const isFirstOwner = owners.size === 0
    owners.add(source)
    ownersByMidiRef.current.set(midi, owners)
    ownerBySourceRef.current.set(source, midi)

    if (isFirstOwner && recordingRef.current.active) {
      const startedAt = performance.now()
      const previousOnset = recordingRef.current.lastOnsetAt
      const note: MutableRecordedNote = {
        midi,
        freqHz: frequencyHz,
        durationMs: 0,
        deltaMs: previousOnset === null ? 0 : Math.max(0, Math.round(startedAt - previousOnset)),
        order: recordingRef.current.nextOrder,
        startedAt,
        complete: false,
      }
      recordingRef.current.lastOnsetAt = startedAt
      recordingRef.current.nextOrder += 1
      recordingRef.current.notes.push(note)
      publishRecording(startedAt)
    }

    if (isFirstOwner) {
      try {
        synthRef.current.noteOn(midi, frequencyHz)
        setAudioError('')
        setNotice(`Đang giữ ${noteNameForMidi(midi)} · ${frequencyHz.toFixed(2)} Hz`)
      } catch (error) {
        ownerBySourceRef.current.delete(source)
        ownersByMidiRef.current.delete(midi)
        closeRecordedNote(midi)
        setAudioError(errorMessage(error))
      }
    }
  }, [closeRecordedNote, publishRecording])

  const releaseSource = useCallback((source: string) => {
    const midi = ownerBySourceRef.current.get(source)
    if (midi === undefined) return
    ownerBySourceRef.current.delete(source)
    const owners = ownersByMidiRef.current.get(midi)
    if (!owners) return
    owners.delete(source)
    if (owners.size > 0) return

    ownersByMidiRef.current.delete(midi)
    closeRecordedNote(midi)
    synthRef.current?.noteOff(midi)
    setNotice(`Đã thả ${noteNameForMidi(midi)}.`)
  }, [closeRecordedNote])

  const finishRecording = useCallback(() => {
    const recording = recordingRef.current
    if (!recording.active) return
    recording.active = false
    const sources = [...ownerBySourceRef.current.keys()]
    for (const source of sources) releaseSource(source)
    const endedAt = performance.now()
    for (const note of recording.notes) {
      if (!note.complete) {
        note.durationMs = Math.max(1, Math.round(endedAt - note.startedAt))
        note.complete = true
      }
    }
    publishRecording(endedAt)
    setIsRecording(false)
    setNotice(`Đã hoàn tất ${recording.notes.length} nốt trong bản ghi.`)
  }, [publishRecording, releaseSource])

  const stopSequence = useCallback((releaseMs = 30) => {
    const controller = replayControllerRef.current
    if (controller) {
      replayControllerRef.current = null
      replaySessionRef.current += 1
      controller.abort()
      setIsPlaying(false)
      setNotice('Đã dừng phát lại.')
    }
    stopAllHeldNotes(releaseMs)
  }, [stopAllHeldNotes])

  useEffect(() => {
    mountedRef.current = true
    const synth = new PolyphonicSynth({ onVoiceStateChange, masterVolume: volume })
    synthRef.current = synth

    return () => {
      mountedRef.current = false
      replayControllerRef.current?.abort()
      replayControllerRef.current = null
      ownerBySourceRef.current.clear()
      ownersByMidiRef.current.clear()
      synthRef.current = null
      void synth.dispose().catch(() => undefined)
    }
  }, [onVoiceStateChange])

  useEffect(() => {
    synthRef.current?.setMasterVolume(volume)
  }, [volume])

  useEffect(() => {
    if (!isRecording) return undefined
    const interval = window.setInterval(() => {
      publishRecording()
    }, 120)
    return () => window.clearInterval(interval)
  }, [isRecording, publishRecording])

  useEffect(() => {
    const releaseOnWindowBlur = () => stopAllHeldNotes()
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (replayControllerRef.current) stopSequence(20)
        else stopAllHeldNotes(20)
        setNotice('Đã dừng âm thanh khi tab ẩn.')
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const mapping = KEYBOARD_MAP_BY_CODE.get(event.code)
      if (!mapping || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      holdSource(`keyboard:${event.code}`, mapping.midi)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (KEYBOARD_MAP_BY_CODE.has(event.code)) releaseSource(`keyboard:${event.code}`)
    }

    window.addEventListener('blur', releaseOnWindowBlur)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', releaseOnWindowBlur)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [holdSource, releaseSource, stopAllHeldNotes, stopSequence])

  const beginRecording = useCallback(() => {
    if (replayControllerRef.current) return
    stopAllHeldNotes()
    recordingRef.current = { active: true, lastOnsetAt: null, notes: [], nextOrder: 0 }
    setRecordedNotes([])
    setAudioError('')
    setIsRecording(true)
    setNotice('Đang ghi. Giữ hoặc chạm nhiều phím để tạo hợp âm.')
  }, [stopAllHeldNotes])

  const clearRecording = useCallback(() => {
    if (isRecording || isPlaying) return
    recordingRef.current = { ...EMPTY_RECORDING, notes: [] }
    setRecordedNotes([])
    setNotice('Hàng đợi đã được làm trống.')
  }, [isPlaying, isRecording])

  const startReplay = useCallback(async () => {
    if (isRecording || isPlaying || recordedNotes.length === 0 || replayControllerRef.current) return
    const synth = synthRef.current
    if (!synth) return

    const controller = new AbortController()
    const session = replaySessionRef.current + 1
    replaySessionRef.current = session
    replayControllerRef.current = controller
    stopAllHeldNotes()
    setIsPlaying(true)
    setAudioError('')
    setNotice(`Đang phát FIFO · ${speed}x`)

    try {
      await synth.resume()
      if (controller.signal.aborted || replayControllerRef.current !== controller) return

      await playRecording(recordedNotes, speed, controller.signal, {
        noteOn: (note, index) => {
          if (replayControllerRef.current !== controller || controller.signal.aborted) return
          holdSource(`replay:${session}:${index}`, note.midi, note.freqHz, true)
        },
        noteOff: (_note, index) => {
          if (replayControllerRef.current !== controller || controller.signal.aborted) return
          releaseSource(`replay:${session}:${index}`)
        },
      })
      if (replayControllerRef.current === controller) setNotice('Phát lại đã hoàn tất.')
    } catch (error) {
      if (!controller.signal.aborted) setAudioError(errorMessage(error))
    } finally {
      if (replayControllerRef.current === controller) {
        replayControllerRef.current = null
        setIsPlaying(false)
        stopAllHeldNotes(30)
      }
    }
  }, [isPlaying, isRecording, recordedNotes, releaseSource, speed, stopAllHeldNotes, holdSource])

  const stableNotes = useMemo(() => PIANO_NOTES, [])
  const isBusy = isRecording || isPlaying
  const liveQueue = useMemo(() => recordedNotes.map((note) => ({ ...note, liveDurationMs: note.durationMs })), [recordedNotes])

  return (
    <main className="studio-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Studio 88, về đầu trang">
          <span className="brand-mark" aria-hidden="true">s</span>
          <span className="brand-copy"><strong>studio</strong><span>88 / keys lab</span></span>
        </a>
        <div className="topbar-meta"><span className="online-dot" /> WEB AUDIO STUDIO <span className="meta-divider">/</span> UIT · MSIS207</div>
        <a className="repo-link" href="https://github.com/24521450/MSIS207.R11.CTTT.Week3.Hw2" target="_blank" rel="noreferrer">
          Mã nguồn <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span>01</span> · NHẠC CỤ TRONG TRÌNH DUYỆT</p>
          <h1>Chạm vào<br /><em>âm thanh.</em></h1>
          <p className="hero-description">Một cây đàn 88 phím, sẵn sàng cho những hợp âm của riêng bạn. Ghi lại ý tưởng, rồi nghe chúng chuyển động theo nhịp của mình.</p>
          <div className="hero-tags">
            <span>88 phím · A0 — C8</span><span>8 voice đa âm</span><span>Không cần cài đặt</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit--outer" /><div className="orbit orbit--inner" />
          <div className="art-glow" />
          <div className="art-note art-note--one">♪</div><div className="art-note art-note--two">♫</div>
          <div className="art-core"><span>88</span><small>KEYS</small></div>
          <div className="art-caption"><span className="equalizer"><i /><i /><i /><i /><i /></span> LIVE AUDIO <b>●</b></div>
        </div>
      </section>

      <section className="instrument-card" aria-labelledby="piano-title">
        <div className="section-heading instrument-heading">
          <div><p className="eyebrow"><span>02</span> · THE INSTRUMENT</p><h2 id="piano-title">Piano <span>88</span></h2></div>
          <div className="piano-range"><strong>A0</strong><span className="range-line" /><strong>C8</strong><small>52 phím trắng · 36 phím đen</small></div>
        </div>
        <div className="piano-note"><span className="note-pulse" />{notice}</div>
        <div className="keyboard-viewport" aria-label="Vùng đàn piano, cuộn ngang để xem đủ 88 phím">
          <div className="piano-keys" role="group" aria-label="Đàn piano 88 phím từ A0 đến C8">
            {stableNotes.map((note) => (
              <PianoKey
                key={note.midi}
                isPressed={pressedMidis.has(note.midi)}
                note={note}
                onNoteEnd={releaseSource}
                onNoteStart={holdSource}
              />
            ))}
          </div>
        </div>
        <div className="piano-foot"><span>← KÉO ĐỂ KHÁM PHÁ TOÀN BỘ PHÍM →</span><span>Giữ phím để ngân · Thả để tắt</span></div>
      </section>

      <div className="workbench-grid">
        <section className="control-card" aria-labelledby="sequence-title">
          <div className="section-heading">
            <div><p className="eyebrow"><span>03</span> · SEQUENCE</p><h2 id="sequence-title">Bản thu <span>của bạn</span></h2></div>
            <span className={`state-pill${isRecording ? ' state-pill--recording' : isPlaying ? ' state-pill--playing' : ''}`}><i />{isRecording ? 'ĐANG GHI' : isPlaying ? 'ĐANG PHÁT' : recordedNotes.length ? 'SẴN SÀNG' : 'TRỐNG'}</span>
          </div>

          <div className="transport">
            {isRecording ? (
              <button className="button button--recording" onClick={finishRecording} type="button"><span className="stop-square" /> Kết thúc ghi</button>
            ) : (
              <button className="button button--record" disabled={isPlaying} onClick={beginRecording} type="button"><span className="record-dot" /> Ghi âm</button>
            )}
            <button className="button button--play" disabled={isRecording || isPlaying || recordedNotes.length === 0} onClick={() => void startReplay()} type="button"><span aria-hidden="true">▶</span> Phát</button>
            <button className="button button--stop" onClick={() => stopSequence()} type="button"><span className="stop-square" /> Dừng</button>
            <button className="button button--clear" disabled={isBusy || recordedNotes.length === 0} onClick={clearRecording} type="button">Xóa bản thu</button>
          </div>

          <div className="queue-meta"><span>FIFO NOTE QUEUE</span><strong>{recordedNotes.length.toString().padStart(2, '0')} <small>nốt</small></strong></div>
          <div className="queue-table-wrap">
            {liveQueue.length === 0 ? (
              <div className="empty-queue"><div className="empty-glyph">♪</div><strong>Giai điệu tiếp theo là của bạn.</strong><p>Bấm Ghi âm, sau đó chơi trực tiếp trên phím đàn hoặc dùng bàn phím máy tính.</p></div>
            ) : (
              <table className="queue-table">
                <thead><tr><th>#</th><th>NỐT</th><th>TẦN SỐ</th><th>Δ ONSET</th><th>ĐỘ DÀI</th></tr></thead>
                <tbody>
                  {liveQueue.map((note, index) => (
                    <tr key={`${note.midi}-${index}`}>
                      <td className="queue-index">{String(index + 1).padStart(2, '0')}</td>
                      <td><span className={`note-chip${note.midi % 12 === 1 || note.midi % 12 === 3 || note.midi % 12 === 6 || note.midi % 12 === 8 || note.midi % 12 === 10 ? ' note-chip--sharp' : ''}`}>{noteNameForMidi(note.midi)}</span></td>
                      <td>{note.freqHz.toFixed(2)} <small>Hz</small></td>
                      <td>{index === 0 ? '—' : `+${note.deltaMs}`} <small>ms</small></td>
                      <td>{formatDuration(note.liveDurationMs)}{isRecording && note.durationMs === 0 ? <span className="live-dot" /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="sequence-footer">
            <span className="speed-label">TỐC ĐỘ</span>
            <div className="speed-options" role="group" aria-label="Tốc độ phát lại">
              {([0.5, 1, 2] as const).map((value) => <button aria-pressed={speed === value} disabled={isPlaying} key={value} onClick={() => setSpeed(value)} type="button">{value}x</button>)}
            </div>
            <span className="sequence-footer-hint">Onset và trường độ cùng co giãn</span>
          </div>
          <p aria-live="polite" className="sr-only">{isRecording ? 'Đang ghi âm.' : isPlaying ? 'Đang phát lại bản thu.' : `${recordedNotes.length} nốt trong hàng đợi.`}</p>
        </section>

        <aside className="side-stack">
          <section className="volume-card" aria-labelledby="volume-title">
            <div className="side-heading"><div><p className="eyebrow"><span>04</span> · OUTPUT</p><h2 id="volume-title">Âm lượng</h2></div><span className="volume-value">{Math.round(volume * 100)}<small>%</small></span></div>
            <div className="volume-control"><span className="volume-icon" aria-hidden="true">◖</span><input aria-label="Âm lượng tổng" max="1" min="0" onChange={(event) => setVolume(Number(event.target.value))} step="0.01" type="range" value={volume} /><span className="volume-icon volume-icon--high" aria-hidden="true">◖</span></div>
            <p className="volume-caption">Gain tổng đã cân bằng headroom cho hợp âm.</p>
            {audioError ? <p className="audio-error" role="alert">{audioError}</p> : null}
          </section>

          <section className="mapping-card" aria-labelledby="mapping-title">
            <div className="side-heading"><div><p className="eyebrow"><span>05</span> · PLAY YOUR WAY</p><h2 id="mapping-title">Bàn phím máy tính</h2></div><span className="keyboard-icon" aria-hidden="true">⌨</span></div>
            <p className="mapping-description">Chơi hai quãng tám, giữ nhiều phím cùng lúc để tạo hợp âm.</p>
            <div className="mapping-octaves">
              <div className="mapping-octave"><strong>C3 — B3</strong><div className="mapping-keys">{KEYBOARD_MAPPING.slice(0, 12).map((entry) => <span className="mapping-key" key={entry.code}><kbd>{entry.label}</kbd><small>{noteNameForMidi(entry.midi)}</small></span>)}</div></div>
              <div className="mapping-octave"><strong>C4 — B4</strong><div className="mapping-keys">{KEYBOARD_MAPPING.slice(12).map((entry) => <span className="mapping-key" key={entry.code}><kbd>{entry.label}</kbd><small>{noteNameForMidi(entry.midi)}</small></span>)}</div></div>
            </div>
            <p className="mapping-footnote">Key repeat bị bỏ qua · Tab để focus từng phím đàn</p>
          </section>
        </aside>
      </div>

      <footer className="page-footer"><span>STUDIO 88 <i>·</i> WEB AUDIO</span><span>Âm thanh được tạo trực tiếp trên thiết bị của bạn.</span><a href="https://github.com/24521450/MSIS207.R11.CTTT.Week3.Hw2" target="_blank" rel="noreferrer">UIT / MSIS207 ↗</a></footer>
    </main>
  )
}

export default App
