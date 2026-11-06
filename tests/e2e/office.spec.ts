import { expect, test } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

test('converts Office files locally through the first-visit setup and cached engine', async ({ page, context }) => {
  test.setTimeout(240000)
  const outside: string[] = []
  page.on('request', (request) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) outside.push(request.url())
  })
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message))
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles('tests/fixtures/office/sample.docx')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByText('Advanced options', { exact: true }).click()
  await page.getByLabel('Pages / slides').fill('2')
  await page.getByLabel('PDF filename').fill('Selected page.pdf')
  await page.getByRole('button', { name: 'Convert to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your PDF is ready' })).toBeVisible({ timeout: 180000 })
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const pdf = await download
  expect(pdf.suggestedFilename()).toBe('Selected page.pdf')
  expect((await PDFDocument.load(await readFile((await pdf.path())!))).getPageCount()).toBe(1)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  // Produce actual legacy binary files from our own OOXML fixtures, then import them through the UI.
  for (const [modern, legacy] of [['docx', 'doc'], ['pptx', 'ppt']]) {
    const input = [...await readFile(`tests/fixtures/office/sample.${modern}`)]
    const binary = await page.evaluate(async ({ input, modern, legacy }) => {
      const base = new URL('office/', location.href).href
      const worker = new Worker(`${base}browser.worker.global.js`)
      let id = 0
      const request = (type: string, data = {}) => new Promise<number[]>((resolve, reject) => {
        const current = ++id
        const receive = (event: MessageEvent) => {
          const message = event.data
          if (message.type === 'progress') return
          if (type === 'loaded' ? message.type !== 'loaded' : message.id !== current) return
          worker.removeEventListener('message', receive)
          if (message.type === 'error') reject(new Error(message.error))
          else resolve(message.data ? Array.from(message.data) : [])
        }
        worker.addEventListener('message', receive)
        worker.onerror = () => reject(new Error('Fixture worker failed'))
        if (type !== 'loaded') worker.postMessage({ type, id: current, ...data })
      })
      try {
        await request('loaded')
        await request('init', { sofficeJs: `${base}soffice.js`, sofficeWasm: `${base}soffice.wasm`, sofficeData: `${base}soffice.data`, sofficeWorkerJs: `${base}soffice.worker.js` })
        return await request('convert', { inputData: new Uint8Array(input), inputExt: modern, outputFormat: legacy })
      } finally { worker.terminate() }
    }, { input, modern, legacy })
    expect(binary.slice(0, 8)).toEqual([208, 207, 17, 224, 161, 177, 26, 225])
    await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({ name: `sample.${legacy}`, mimeType: 'application/octet-stream', buffer: Buffer.from(binary) })
    await page.getByRole('button', { name: 'Convert to PDF', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your PDF is ready' })).toBeVisible({ timeout: 60000 })
    const legacyDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PDF' }).click()
    expect((await PDFDocument.load(await readFile((await (await legacyDownload).path())!))).getPageCount()).toBe(2)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }
  // Assets are cached: another format must also convert with the network disabled.
  await context.setOffline(true)
  await page.reload()
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles('tests/fixtures/office/sample.pptx')
  await page.getByRole('button', { name: 'Convert to PDF', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your PDF is ready' })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: 'Open in editor' }).click()
  await expect(page.getByText('2 pages ·', { exact: false })).toBeVisible()
  expect(outside).toEqual([])
})

test('validates settings and cancels without losing the opening screen', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles('tests/fixtures/office/sample.docx')
  await page.getByText('Advanced options', { exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('office-options.png') })
  await page.getByLabel('Pages / slides').fill('0')
  await page.getByRole('button', { name: 'Convert to PDF', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('valid page range')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('cancels engine startup and allows choosing the same file again', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.reload()
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles('tests/fixtures/office/sample.docx')
  await page.getByRole('button', { name: 'Convert to PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles('tests/fixtures/office/sample.docx')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Convert to PDF', exact: true })).toBeEnabled()
})


test('opens the app without a blocked inline script', async ({ page }) => {
  const cspErrors: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('violates the following Content Security Policy')) cspErrors.push(message.text())
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Every file starts here.' })).toBeVisible()
  expect(cspErrors).toEqual([])
})
