import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const evidenceDir = path.join(projectRoot, 'evidence')
const projectBasePath = '/MSIS207.R11.CTTT.Week3.Hw2/'
const remoteUrlArgument = process.argv.find((argument) => argument.startsWith('--url='))
const remoteUrl = remoteUrlArgument?.slice('--url='.length)
let siteUrl = remoteUrl ? new URL(remoteUrl).toString() : ''
const evidencePrefix = remoteUrl ? 'github-pages' : 'production-preview'
const errors = []
const axeAudits = []
const browserRegressions = []
let previewServer = null

const axeScript = path.join(projectRoot, 'node_modules', 'axe-core', 'axe.min.js')
assert.ok(existsSync(axeScript), 'Install dev dependency axe-core before running browser verification.')

async function auditAccessibility(page, viewport, state) {
  const playPresentation = await page.locator('.button--play').evaluate((button) => {
    const style = getComputedStyle(button)
    return { disabled: button.disabled, opacity: style.opacity, color: style.color, backgroundColor: style.backgroundColor, status: document.querySelector('.state-pill')?.textContent?.trim() }
  })
  const results = await page.evaluate(async () => {
    const { violations, incomplete } = await window.axe.run(document)
    return {
      violations: violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        count: violation.nodes.length,
        examples: violation.nodes.slice(0, 4).map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
      incomplete: incomplete.map((rule) => ({
        id: rule.id,
        count: rule.nodes.length,
        examples: rule.nodes.slice(0, 4).map((node) => ({
          target: node.target,
          summary: node.failureSummary,
          checks: node.any.map((check) => ({ id: check.id, message: check.message, data: check.data })),
        })),
      })),
    }
  })
  const audit = { viewport, state, playPresentation, ...results }
  axeAudits.push(audit)
  return audit
}

async function hitPointForKey(page, key, side = 'center') {
  const box = await key.boundingBox()
  assert.ok(box, 'Expected the piano key to have a browser hit box.')
  const x = side === 'left' ? box.x + 1 : side === 'right' ? box.x + box.width - 1 : box.x + box.width / 2
  const point = { x, y: box.y + box.height * 0.55 }
  const midi = await page.evaluate(({ x: px, y: py }) => {
    const hit = document.elementFromPoint(px, py)?.closest('.piano-key')
    return hit?.getAttribute('data-midi') ?? null
  }, point)
  return { ...point, midi: midi === null ? null : Number(midi), box }
}

async function pressBlackByMouse(page, blackKey, point) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  assert.equal(await blackKey.getAttribute('aria-pressed'), 'true', 'A real mouse pointer press on the black key must activate it.')
  await page.mouse.up()
  assert.equal(await blackKey.getAttribute('aria-pressed'), 'false', 'The black key must release after mouseup.')
}

async function readRecordedTimeline(rows) {
  return rows.evaluateAll((elements) => elements.map((row) => ({
    midi: Number(row.getAttribute('data-note-midi')),
    deltaMs: Number(row.getAttribute('data-delta-ms')),
    durationMs: Number(row.getAttribute('data-duration-ms')),
  })))
}

async function verifyReplayOverlap(page, speed, timeline) {
  const first = timeline[0]
  const second = timeline[1]
  assert.ok(first && second, 'The recording must contain two ordered notes.')

  const overlapStartMs = Math.max(0, second.deltaMs)
  const overlapEndMs = Math.min(first.durationMs, second.deltaMs + second.durationMs)
  assert.ok(overlapEndMs > overlapStartMs, `Recorded notes must overlap: ${JSON.stringify(timeline)}`)

  const scaledStartMs = overlapStartMs / speed
  const scaledEndMs = overlapEndMs / speed
  const overlapWindowMs = scaledEndMs - scaledStartMs
  assert.ok(overlapWindowMs > 80, `Overlap must be long enough to observe at ${speed}x: ${overlapWindowMs}ms`)

  const speedButton = page.getByRole('button', { name: `${speed}x` })
  await speedButton.click()
  assert.equal(await speedButton.getAttribute('aria-pressed'), 'true')

  const replayRequestedAt = performance.now()
  await page.getByRole('button', { name: 'Phát' }).click()
  let observedAtMs = null
  while (performance.now() - replayRequestedAt < scaledEndMs - 30) {
    const bothNotesAreActive = await page.evaluate(() =>
      ['60', '64'].every((midi) => document.querySelector(`[data-midi="${midi}"]`)?.getAttribute('aria-pressed') === 'true'))
    if (bothNotesAreActive) {
      observedAtMs = performance.now() - replayRequestedAt
      break
    }
    await page.waitForTimeout(8)
  }

  assert.notEqual(observedAtMs, null, `C4 and E4 did not overlap in the recorded window at ${speed}x: ${JSON.stringify({ timeline, scaledStartMs, scaledEndMs })}`)
  return { speed, overlapStartMs, overlapEndMs, overlapWindowMs, observedAtMs }
}

function getAxeFailures() {
  return axeAudits.flatMap((audit) => audit.violations.map((violation) => ({
    viewport: audit.viewport,
    state: audit.state,
    id: violation.id,
    impact: violation.impact,
    count: violation.count,
    examples: violation.examples,
  })))
}

const edgeCandidates = [
  process.env.EDGE_EXECUTABLE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const edgeExecutable = edgeCandidates.find((candidate) => existsSync(candidate))
const browser = await chromium.launch({
  headless: true,
  ...(edgeExecutable ? { executablePath: edgeExecutable } : {}),
})

try {
  if (!remoteUrl) {
    previewServer = await preview({ root: projectRoot, preview: { host: '127.0.0.1', port: 0, strictPort: true } })
    const address = previewServer.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Could not read the local preview address.')
    siteUrl = `http://127.0.0.1:${address.port}${projectBasePath}`
  }

  mkdirSync(evidenceDir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => {
    const NativeAudioContext = window.AudioContext
    const audit = { contexts: 0, resumeCalls: 0, oscillatorStarts: 0, initialState: 'none', state: 'none' }
    Object.defineProperty(window, '__audioAudit', { configurable: true, value: audit })
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      writable: true,
      value: class extends NativeAudioContext {
        constructor(...args) {
          super(...args)
          audit.contexts += 1
          audit.initialState = this.state
          audit.state = this.state
          this.addEventListener('statechange', () => { audit.state = this.state })
        }

        resume() {
          audit.resumeCalls += 1
          return super.resume()
        }

        createOscillator() {
          const oscillator = super.createOscillator()
          const nativeStart = oscillator.start.bind(oscillator)
          oscillator.start = (...args) => {
            audit.oscillatorStarts += 1
            return nativeStart(...args)
          }
          return oscillator
        }
      },
    })
  })

  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => errors.push(`request: ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`))
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`)
  })

  const response = await page.goto(siteUrl, { waitUntil: 'networkidle', timeout: 30_000 })
  assert.equal(response?.status(), 200, 'The page entry must load with HTTP 200.')
  assert.equal(await page.title(), 'Studio 88 — Piano đa âm')
  await page.addScriptTag({ path: axeScript })

  const keys = page.locator('.piano-key')
  const whiteKeys = page.locator('.piano-key--white')
  const blackKeys = page.locator('.piano-key--black')
  assert.equal(await keys.count(), 88)
  assert.equal(await whiteKeys.count(), 52)
  assert.equal(await blackKeys.count(), 36)

  const c4 = page.locator('[data-midi="60"]')
  const cSharp4 = page.locator('[data-midi="61"]')
  const d4 = page.locator('[data-midi="62"]')
  const e4 = page.locator('[data-midi="64"]')
  assert.match(await page.locator('[data-midi="21"]').getAttribute('aria-label'), /^A0, 27\.50 hertz$/)
  assert.match(await page.locator('[data-midi="69"]').getAttribute('aria-label'), /^A4, 440\.00 hertz$/)
  assert.match(await page.locator('[data-midi="108"]').getAttribute('aria-label'), /^C8, 4186\.01 hertz$/)
  assert.match(await cSharp4.getAttribute('style'), /var\(--white-key-width\) \* 24/, 'C♯4 must sit at its correct white-key boundary.')
  const desktopBlackBox = await cSharp4.boundingBox()
  const desktopWhiteBox = await c4.boundingBox()
  assert.ok(desktopBlackBox && desktopBlackBox.width >= 24, 'Black-key targets must be at least 24 CSS pixels wide on desktop.')
  assert.ok(desktopWhiteBox && desktopWhiteBox.width >= 40, 'Desktop white-key spacing must accommodate the 24px black-key target.')

  await auditAccessibility(page, 'desktop', 'empty')

  await c4.click()
  await page.waitForFunction(() => window.__audioAudit?.state === 'running', { timeout: 5_000 })
  let audioAudit = await page.evaluate(() => ({ ...window.__audioAudit }))
  assert.ok(audioAudit.contexts >= 1, 'A user gesture must create a real AudioContext.')
  assert.ok(audioAudit.initialState === 'running' || audioAudit.resumeCalls >= 1, 'A suspended AudioContext must resume from the piano gesture.')
  assert.equal(audioAudit.state, 'running', 'AudioContext must be running after the piano gesture.')
  assert.ok(audioAudit.oscillatorStarts >= 1, 'Web Audio must start an oscillator after the gesture.')
  await page.waitForFunction(() => document.querySelector('[data-midi="60"]')?.getAttribute('aria-pressed') === 'false')

  await page.keyboard.down('q')
  assert.equal(await c4.getAttribute('aria-pressed'), 'true', 'Q must hold C4 during the black-key pointer hit-test.')
  const blackEdgeHits = []
  for (const side of ['left', 'right']) {
    const point = await hitPointForKey(page, cSharp4, side)
    assert.equal(point.midi, 61, `The ${side} edge of C♯4 must hit MIDI 61 while C4 is held.`)
    await pressBlackByMouse(page, cSharp4, point)
    assert.equal(await c4.getAttribute('aria-pressed'), 'true', 'Releasing C♯4 must leave keyboard-held C4 active.')
    blackEdgeHits.push({ side, x: point.x, y: point.y, hitMidi: point.midi })
    if (side === 'left') {
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      assert.equal(await cSharp4.getAttribute('aria-pressed'), 'true')
      await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-black-key-hit-test.png`), fullPage: true })
      await page.mouse.up()
      assert.equal(await cSharp4.getAttribute('aria-pressed'), 'false')
    }
  }

  await page.keyboard.down('w')
  const chordPoint = await hitPointForKey(page, cSharp4, 'left')
  assert.equal(chordPoint.midi, 61)
  await page.mouse.move(chordPoint.x, chordPoint.y)
  await page.mouse.down()
  assert.equal(await c4.getAttribute('aria-pressed'), 'true')
  assert.equal(await d4.getAttribute('aria-pressed'), 'true')
  assert.equal(await cSharp4.getAttribute('aria-pressed'), 'true', 'Pointer C♯4 must join held C4 and D4.')
  await page.mouse.up()
  assert.equal(await cSharp4.getAttribute('aria-pressed'), 'false')
  assert.equal(await c4.getAttribute('aria-pressed'), 'true')
  assert.equal(await d4.getAttribute('aria-pressed'), 'true')
  await page.keyboard.up('q')
  await page.keyboard.up('w')
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')
  assert.equal(await d4.getAttribute('aria-pressed'), 'false')
  browserRegressions.push({ name: 'black-key pointer hit-test around held white keys', result: 'PASS', hits: blackEdgeHits, chord: [60, 62, 61] })

  await page.getByRole('link', { name: 'Mã nguồn' }).focus()
  await page.keyboard.press('Tab')
  for (let index = 0; index < 39; index += 1) await page.keyboard.press('Tab')
  const focusedWhiteKey = await c4.evaluate((element) => ({
    active: element === document.activeElement,
    visible: element.matches(':focus-visible'),
    zIndex: getComputedStyle(element).zIndex,
    outlineWidth: getComputedStyle(element).outlineWidth,
  }))
  assert.equal(focusedWhiteKey.active, true, 'Tab navigation must reach C4.')
  assert.equal(focusedWhiteKey.visible, true, 'Keyboard focus on C4 must have a visible indicator.')
  assert.equal(focusedWhiteKey.zIndex, '1', 'A focused white key must stay below black keys.')
  assert.equal(focusedWhiteKey.outlineWidth, '3px')
  await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-focus-visible.png`), fullPage: true })
  const focusPoint = await hitPointForKey(page, cSharp4, 'left')
  assert.equal(focusPoint.midi, 61, 'A focused white key must not intercept C♯4 hit-testing.')
  browserRegressions.push({ name: 'white-key focus-visible stacking', result: 'PASS', focusedMidi: 60, blackKeyHitMidi: focusPoint.midi, whiteZIndex: focusedWhiteKey.zIndex, outlineWidth: focusedWhiteKey.outlineWidth })

  const voiceKeys = Array.from({ length: 9 }, (_, index) => page.locator(`[data-midi="${21 + index}"]`))
  for (const [index, key] of voiceKeys.entries()) {
    await key.dispatchEvent('pointerdown', { pointerId: 120 + index, pointerType: 'mouse', button: 0, isPrimary: true })
  }
  assert.equal(await page.locator('.piano-key[aria-pressed="true"]').count(), 8, 'A ninth pitch must steal the oldest active voice.')
  assert.equal(await voiceKeys[0].getAttribute('aria-pressed'), 'false')
  assert.equal(await voiceKeys[8].getAttribute('aria-pressed'), 'true')
  for (const [index, key] of voiceKeys.entries()) {
    await key.dispatchEvent('pointerup', { pointerId: 120 + index, pointerType: 'mouse', button: 0 })
  }
  browserRegressions.push({ name: 'eight-voice FIFO stealing', result: 'PASS', activeAfterNinthOnset: 8, oldestMidi: 21, stolenMidi: 21, ninthMidi: 29 })
  await page.waitForTimeout(60)

  await page.getByRole('button', { name: 'Ghi âm' }).click()
  await auditAccessibility(page, 'desktop', 'recording')
  const c4Box = await c4.boundingBox()
  assert.ok(c4Box)
  await page.mouse.move(c4Box.x + c4Box.width / 2, c4Box.y + c4Box.height * 0.6)
  await page.mouse.down()
  await page.waitForTimeout(300)
  await page.keyboard.down('e')
  await page.waitForTimeout(800)
  await page.keyboard.up('e')
  await page.waitForTimeout(800)
  await page.mouse.up()
  await page.getByRole('button', { name: 'Kết thúc ghi' }).click()

  const rows = page.locator('.queue-table tbody tr')
  assert.equal(await rows.count(), 2)
  const timeline = await readRecordedTimeline(rows)
  assert.deepEqual(timeline.map((note) => note.midi), [60, 64])
  assert.equal(timeline[0]?.deltaMs, 0)
  assert.ok((timeline[1]?.deltaMs ?? 0) > 0)
  assert.ok(timeline.every((note) => note.durationMs > 0))
  const replayOverlaps = []
  await auditAccessibility(page, 'desktop', 'has-recording')
  await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-desktop.png`), fullPage: true })

  replayOverlaps.push(await verifyReplayOverlap(page, 0.5, timeline))
  await auditAccessibility(page, 'desktop', 'playing')
  await page.getByRole('button', { name: 'Dừng' }).click()
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')
  assert.equal(await e4.getAttribute('aria-pressed'), 'false')

  replayOverlaps.push(await verifyReplayOverlap(page, 1, timeline))
  await page.getByRole('button', { name: 'Dừng' }).click()
  replayOverlaps.push(await verifyReplayOverlap(page, 2, timeline))
  await page.getByRole('button', { name: 'Dừng' }).click()

  await page.getByRole('button', { name: '1x' }).click()
  const playButton = page.getByRole('button', { name: 'Phát' })
  await playButton.click()
  await page.waitForFunction(() => document.querySelector('[data-midi="60"]')?.getAttribute('aria-pressed') === 'true', { timeout: 1_000 })
  await page.getByRole('button', { name: 'Dừng' }).click()
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: 'Phát' }).click()
  await page.waitForFunction(() => document.querySelector('[data-midi="60"]')?.getAttribute('aria-pressed') === 'true', { timeout: 1_000 })
  await page.getByRole('button', { name: 'Dừng' }).click()
  await page.waitForFunction(() => document.querySelector('[data-midi="60"]')?.getAttribute('aria-pressed') === 'false')
  await page.waitForFunction(() => document.querySelector('.state-pill')?.textContent?.trim() === 'SẴN SÀNG')
  browserRegressions.push({ name: 'Play → Stop → Play with immediate cancellation', result: 'PASS' })

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    pianoWidth: document.querySelector('.keyboard-viewport')?.scrollWidth ?? 0,
    pianoViewport: document.querySelector('.keyboard-viewport')?.clientWidth ?? 0,
    whiteKeyWidth: document.querySelector('[data-midi="60"]')?.getBoundingClientRect().width ?? 0,
    blackKeyWidth: document.querySelector('[data-midi="61"]')?.getBoundingClientRect().width ?? 0,
  }))
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewport, 'The mobile page must not overflow horizontally.')
  assert.ok(mobileLayout.pianoWidth > mobileLayout.pianoViewport, 'The 88-key piano must remain horizontally scrollable.')
  assert.ok(mobileLayout.blackKeyWidth >= 24, 'Black-key targets must remain at least 24 CSS pixels wide on mobile.')
  assert.ok(mobileLayout.whiteKeyWidth >= 34, 'Mobile white-key spacing must preserve black-key hit targets.')
  assert.equal(await playButton.isDisabled(), false, 'Recorded playback must be ready after Stop before mobile state audits.')
  await auditAccessibility(page, 'mobile', 'has-recording')
  await page.screenshot({ path: path.join(evidenceDir, `${evidencePrefix}-mobile.png`), fullPage: true })

  replayOverlaps.push(await verifyReplayOverlap(page, 0.5, timeline))
  await auditAccessibility(page, 'mobile', 'playing')
  await page.getByRole('button', { name: 'Dừng' }).click()
  await page.getByRole('button', { name: 'Xóa bản thu' }).click()
  assert.equal(await rows.count(), 0)
  await auditAccessibility(page, 'mobile', 'empty')
  await page.getByRole('button', { name: 'Ghi âm' }).click()
  await auditAccessibility(page, 'mobile', 'recording')
  await page.getByRole('button', { name: 'Kết thúc ghi' }).click()

  audioAudit = await page.evaluate(() => ({ ...window.__audioAudit }))
  assert.ok(audioAudit.oscillatorStarts >= 3, 'Audio must start oscillators for chords, pointer keys, and replay.')
  await page.waitForTimeout(60)
  assert.deepEqual(errors, [], 'Browser console, page, request, and HTTP error logs must be empty.')

  const axeFailures = getAxeFailures()
  const allAxeIds = axeAudits.reduce((ids, audit) => ids.concat(audit.violations.map((violation) => violation.id)), [])
  const report = {
    url: siteUrl,
    title: await page.title(),
    keys: { total: await keys.count(), white: await whiteKeys.count(), black: await blackKeys.count() },
    frequencies: { A0: 27.5, A4: 440, C8: 4186.01 },
    audio: audioAudit,
    pointerHitTests: blackEdgeHits,
    keyboardFocus: { ...focusedWhiteKey, blackKeyHitMidi: focusPoint.midi },
    recording: { timeline, replayOverlaps },
    mobileLayout,
    regressions: browserRegressions,
    axe: { audits: axeAudits, failingAudits: axeAudits.filter((audit) => audit.violations.length > 0).length, violationIds: [...new Set(allAxeIds)] },
    browserErrors: errors,
    result: axeFailures.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL',
    screenshots: [`${evidencePrefix}-desktop.png`, `${evidencePrefix}-mobile.png`, `${evidencePrefix}-black-key-hit-test.png`, `${evidencePrefix}-focus-visible.png`],
    checkedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(evidenceDir, `${evidencePrefix}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(path.join(evidenceDir, `${evidencePrefix}-axe.json`), `${JSON.stringify({ audits: axeAudits, axeFailures }, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ...report, axe: { ...report.axe, audits: `${axeAudits.length} viewport/state audits`, axeFailures } }, null, 2)}\n`)

  assert.deepEqual(axeFailures, [], 'Axe must report no violations in desktop/mobile empty, recording, recorded, and playing states.')
  assert.deepEqual(errors, [], 'No browser errors are allowed.')
  await context.close()
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error))
  throw error
} finally {
  await browser.close()
  if (previewServer?.httpServer.listening) {
    await new Promise((resolve, reject) => {
      previewServer.httpServer.close((error) => error ? reject(error) : resolve())
    })
  }
}
