import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const projectBasePath = '/MSIS207.R11.CTTT.Week3.Hw2/'
const remoteUrlArgument = process.argv.find((argument) => argument.startsWith('--url='))
const remoteUrl = remoteUrlArgument?.slice('--url='.length)
let siteUrl = remoteUrl ? new URL(remoteUrl).toString() : ''
const evidencePrefix = remoteUrl ? 'github-pages' : 'production-preview'
const errors = []
let previewServer = null

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

  const keys = page.locator('.piano-key')
  const whiteKeys = page.locator('.piano-key--white')
  const blackKeys = page.locator('.piano-key--black')
  assert.equal(await keys.count(), 88)
  assert.equal(await whiteKeys.count(), 52)
  assert.equal(await blackKeys.count(), 36)

  const c4 = page.getByRole('button', { name: /^C4,/ })
  const cSharp4 = page.getByRole('button', { name: /^C♯4,/ })
  const e4 = page.getByRole('button', { name: /^E4,/ })
  assert.match(await cSharp4.getAttribute('style'), /var\(--white-key-width\) \* 24/, 'C♯4 must sit after the preceding white keys.')
  await c4.click()
  await page.waitForFunction(() => window.__audioAudit?.state === 'running', { timeout: 5_000 })
  let audioAudit = await page.evaluate(() => ({ ...window.__audioAudit }))
  assert.ok(audioAudit.contexts >= 1, 'A user gesture must create a real AudioContext.')
  assert.ok(audioAudit.initialState === 'running' || audioAudit.resumeCalls >= 1, 'A suspended AudioContext must resume from the piano gesture.')
  assert.equal(audioAudit.state, 'running', 'AudioContext must be running after the piano gesture.')
  assert.ok(audioAudit.oscillatorStarts >= 1, 'Web Audio must start an oscillator after the gesture.')

  await c4.dispatchEvent('pointerdown', { pointerId: 81, pointerType: 'mouse', button: 0, isPrimary: true })
  await e4.dispatchEvent('pointerdown', { pointerId: 82, pointerType: 'mouse', button: 0, isPrimary: true })
  assert.equal(await c4.getAttribute('aria-pressed'), 'true')
  assert.equal(await e4.getAttribute('aria-pressed'), 'true')
  audioAudit = await page.evaluate(() => ({ ...window.__audioAudit }))
  assert.ok(audioAudit.oscillatorStarts >= 3, 'A two-note chord must create overlapping voices.')
  await c4.dispatchEvent('pointerup', { pointerId: 81, pointerType: 'mouse', button: 0 })
  await e4.dispatchEvent('pointerup', { pointerId: 82, pointerType: 'mouse', button: 0 })
  await page.waitForTimeout(60)

  await page.keyboard.down('q')
  assert.equal(await c4.getAttribute('aria-pressed'), 'true', 'The Q key must hold C4.')
  await page.keyboard.up('q')
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')

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
  await page.waitForTimeout(60)

  await page.getByRole('button', { name: 'Ghi âm' }).click()
  await c4.dispatchEvent('pointerdown', { pointerId: 91, pointerType: 'mouse', button: 0, isPrimary: true })
  await page.waitForTimeout(45)
  await e4.dispatchEvent('pointerdown', { pointerId: 92, pointerType: 'mouse', button: 0, isPrimary: true })
  await page.waitForTimeout(70)
  await e4.dispatchEvent('pointerup', { pointerId: 92, pointerType: 'mouse', button: 0 })
  await page.waitForTimeout(25)
  await c4.dispatchEvent('pointerup', { pointerId: 91, pointerType: 'mouse', button: 0 })
  await page.getByRole('button', { name: 'Kết thúc ghi' }).click()

  const rows = page.locator('.queue-table tbody tr')
  assert.equal(await rows.count(), 2)
  assert.match(await rows.nth(0).innerText(), /C4/)
  assert.match(await rows.nth(1).innerText(), /E4/)
  assert.match(await rows.nth(1).innerText(), /\+\d+ ms/)
  mkdirSync(path.join(projectRoot, 'evidence'), { recursive: true })
  await page.screenshot({ path: path.join(projectRoot, `evidence/${evidencePrefix}-desktop.png`), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    pianoWidth: document.querySelector('.keyboard-viewport')?.scrollWidth ?? 0,
    pianoViewport: document.querySelector('.keyboard-viewport')?.clientWidth ?? 0,
  }))
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewport, 'The page itself must not overflow horizontally on mobile.')
  assert.ok(mobileLayout.pianoWidth > mobileLayout.pianoViewport, 'The 88-key piano must remain horizontally scrollable on mobile.')
  await page.screenshot({ path: path.join(projectRoot, `evidence/${evidencePrefix}-mobile.png`), fullPage: true })

  await page.getByRole('button', { name: '0.5x' }).click()
  assert.equal(await page.getByRole('button', { name: '0.5x' }).getAttribute('aria-pressed'), 'true')
  const playButton = page.getByRole('button', { name: 'Phát' })
  await playButton.click()
  await page.waitForTimeout(105)
  assert.equal(await c4.getAttribute('aria-pressed'), 'true')
  assert.equal(await e4.getAttribute('aria-pressed'), 'true', `E4 should overlap C4 during slow replay: ${await rows.allTextContents()}`)
  await page.getByRole('button', { name: 'Dừng' }).click()
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')
  assert.equal(await e4.getAttribute('aria-pressed'), 'false')

  await page.getByRole('button', { name: 'Phát' }).click()
  await page.waitForTimeout(25)
  assert.equal(await c4.getAttribute('aria-pressed'), 'true', 'A new play must start after Stop.')
  await page.getByRole('button', { name: 'Dừng' }).click()
  await page.waitForTimeout(30)
  assert.equal(await c4.getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: 'Xóa bản thu' }).click()
  assert.equal(await rows.count(), 0)

  await page.waitForTimeout(60)
  assert.deepEqual(errors, [], 'Browser console, page, request, and HTTP error logs must be empty.')

  const report = {
    url: siteUrl,
    title: await page.title(),
    keys: { total: await keys.count(), white: await whiteKeys.count(), black: await blackKeys.count() },
    audio: audioAudit,
    mobileLayout,
    result: 'PASS',
    screenshots: [`${evidencePrefix}-desktop.png`, `${evidencePrefix}-mobile.png`],
    browserErrors: errors,
    checkedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(projectRoot, `evidence/${evidencePrefix}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
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
