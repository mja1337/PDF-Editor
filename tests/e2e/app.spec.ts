import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

async function fixtureBytes() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([300, 420]).drawText('Cover page', { x: 30, y: 360, font })
  pdf.addPage([500, 300]).drawText('Quarterly planning notes', {
    x: 30,
    y: 240,
    font,
  })
  pdf.addPage([360, 540]).drawText('Appendix', { x: 30, y: 480, font })
  return Buffer.from(await pdf.save())
}

test('edits and exports a PDF without contacting another origin', async ({ page }) => {
  const outsideRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      outsideRequests.push(request.url())
    }
  })

  await page.goto('./')
  await expect(page.getByRole('heading', { name: /never leaves this browser/i })).toBeVisible()

  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'workflow-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  await expect(page.getByText('3 pages ·', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Select page 2' }).click()
  await page.getByRole('button', { name: 'Right', exact: true }).click()
  await expect(page.getByText('90°', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Earlier', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Page 1', exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const download = await downloadPromise
  const outputPath = await download.path()
  expect(outputPath).toBeTruthy()

  const output = await PDFDocument.load(await readFile(outputPath!))
  expect(output.getPageCount()).toBe(3)
  expect(output.getPage(0).getRotation().angle).toBe(90)
  expect(outsideRequests).toEqual([])
})

test('merges another PDF and duplicates the selected page', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'first.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })
  await expect(page.getByText('3 pages ·', { exact: false })).toBeVisible()

  const second = await PDFDocument.create()
  second.addPage([240, 240])
  await page.locator('input[aria-label="Add PDF files"]').setInputFiles({
    name: 'second.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await second.save()),
  })

  await expect(page.getByText('4 pages · 2 sources', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByText('5 pages · 2 sources', { exact: false })).toBeVisible()

  const extractPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Extract' }).click()
  const extractedPath = await (await extractPromise).path()
  expect(extractedPath).toBeTruthy()
  const extracted = await PDFDocument.load(await readFile(extractedPath!))
  expect(extracted.getPageCount()).toBe(1)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const download = await downloadPromise
  const outputPath = await download.path()
  expect(outputPath).toBeTruthy()
  const output = await PDFDocument.load(await readFile(outputPath!))
  expect(output.getPageCount()).toBe(5)
  expect(output.getPage(3).getSize()).toEqual({ width: 240, height: 240 })
  expect(output.getPage(4).getSize()).toEqual({ width: 240, height: 240 })
})

test('turns a local PNG into a PDF page and exports the page as PNG', async ({ page }) => {
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )

  await page.goto('./')
  await page.locator('input[aria-label="Add JPEG or PNG images"]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  })
  await expect(page.getByText('1 page · 1 source', { exact: false })).toBeVisible()

  const imagePromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Page PNG' }).click()
  const imageDownload = await imagePromise
  expect(imageDownload.suggestedFilename()).toBe('images-page-1.png')
})

test('selects a range, applies a bulk rotation, and searches local text', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'selection-search.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  await page.getByRole('button', { name: 'Select page 3' }).click({
    modifiers: ['Shift'],
  })
  await expect(page.getByRole('heading', { name: '3 pages' })).toBeVisible()
  await page.getByRole('button', { name: 'Right', exact: true }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const outputPath = await (await downloadPromise).path()
  expect(outputPath).toBeTruthy()
  const output = await PDFDocument.load(await readFile(outputPath!))
  expect(output.getPages().map((pdfPage) => pdfPage.getRotation().angle)).toEqual([
    90, 90, 90,
  ])

  await page.getByRole('tab', { name: 'Search' }).click()
  await page.getByRole('searchbox', { name: 'Search document text' }).fill('quarterly')
  await page.locator('.search-form').getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: /Page 2.*Quarterly planning notes/i }).click()
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
})

test('creates, edits, moves, resizes, and exports annotations', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'annotations.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  const layer = page.locator('.focused-page .annotation-layer')
  await expect(layer).toBeVisible()
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await layer.click({ position: { x: 150, y: 120 } })
  const textAnnotation = page.getByRole('button', { name: 'text annotation' })
  await expect(textAnnotation).toBeVisible()
  await page.getByLabel('Text', { exact: true }).fill('Local review note')
  await page.getByLabel('Text', { exact: true }).press('Tab')

  const beforeMove = await textAnnotation.boundingBox()
  expect(beforeMove).toBeTruthy()
  await textAnnotation.hover()
  await page.mouse.down()
  await page.mouse.move(
    beforeMove!.x + beforeMove!.width / 2 + 40,
    beforeMove!.y + beforeMove!.height / 2 + 28,
  )
  await page.mouse.up()
  const afterMove = await textAnnotation.boundingBox()
  expect(afterMove!.x).toBeGreaterThan(beforeMove!.x)

  const resizeHandle = page.getByRole('button', { name: 'Resize annotation' })
  const beforeResize = await textAnnotation.boundingBox()
  await resizeHandle.hover()
  await page.mouse.down()
  await page.mouse.move(beforeResize!.x + beforeResize!.width + 30, beforeResize!.y + beforeResize!.height + 20)
  await page.mouse.up()
  const afterResize = await textAnnotation.boundingBox()
  expect(afterResize!.width).toBeGreaterThan(beforeResize!.width)

  await page.getByRole('button', { name: 'Zoom in' }).click()
  const afterZoom = await textAnnotation.boundingBox()
  expect(afterZoom!.width).toBeGreaterThan(afterResize!.width)

  await page.getByRole('button', { name: 'Box', exact: true }).click()
  await layer.click({ position: { x: 230, y: 260 } })
  await expect(page.getByRole('button', { name: 'rectangle annotation' })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const outputPath = await (await downloadPromise).path()
  expect(outputPath).toBeTruthy()
  const output = await PDFDocument.load(await readFile(outputPath!))
  expect(output.getPageCount()).toBe(3)
  expect(output.getPage(0).node.Contents()).toBeTruthy()
})

test('shows relevant context actions for pages, canvas, and annotations', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'context-actions.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  await page.getByRole('button', { name: 'Select page 2' }).click({ button: 'right' })
  const pageMenu = page.getByRole('menu', { name: 'Page actions' })
  await expect(pageMenu).toBeVisible()
  await expect(pageMenu.getByRole('menuitem', { name: 'Rotate right' })).toBeVisible()
  await expect(pageMenu.getByRole('menuitem', { name: 'Add text here' })).toHaveCount(0)
  await page.keyboard.press('End')
  await expect(pageMenu.getByRole('menuitem', { name: 'Remove page' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(pageMenu.getByRole('menuitem', { name: 'Move earlier' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(pageMenu).toBeHidden()

  await page.getByRole('button', { name: 'Select page 2' }).click({ button: 'right' })
  await pageMenu.getByRole('menuitem', { name: 'Rotate right' }).click()
  await expect(page.getByText('90°', { exact: true }).last()).toBeVisible()

  const layer = page.locator('.focused-page .annotation-layer')
  const layerBounds = await layer.boundingBox()
  expect(layerBounds).toBeTruthy()
  await layer.click({
    button: 'right',
    position: { x: layerBounds!.width * 0.7, y: layerBounds!.height * 0.7 },
  })
  const canvasMenu = page.getByRole('menu', { name: 'Page canvas actions' })
  await expect(canvasMenu.getByRole('menuitem', { name: 'Add rectangle here' })).toBeVisible()
  await canvasMenu.getByRole('menuitem', { name: 'Add rectangle here' }).click()

  const rectangles = page.getByRole('button', { name: 'rectangle annotation' })
  await expect(rectangles).toHaveCount(1)
  await rectangles.first().click({ button: 'right' })
  const annotationMenu = page.getByRole('menu', { name: 'Annotation actions' })
  await expect(annotationMenu.getByRole('menuitem', { name: 'Duplicate annotation' })).toBeVisible()
  await expect(annotationMenu.getByRole('menuitem', { name: 'Rotate page right' })).toHaveCount(0)
  await annotationMenu.getByRole('menuitem', { name: 'Duplicate annotation' }).click()
  await expect(rectangles).toHaveCount(2)

  await rectangles.last().click({ button: 'right' })
  await annotationMenu.getByRole('menuitem', { name: 'Send to back' }).click()
  await rectangles.last().click({ button: 'right' })
  await annotationMenu.getByRole('menuitem', { name: 'Delete annotation' }).click()
  await expect(rectangles).toHaveCount(1)
})

test('keeps a 100-page document virtualized', async ({ page }) => {
  const pdf = await PDFDocument.create()
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    pdf.addPage([300, 420])
  }

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'hundred-pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.getByText('100 pages ·', { exact: false })).toBeVisible()
  expect(await page.locator('.thumbnail-list canvas').count()).toBeLessThan(20)
  await page.getByRole('button', { name: 'Fit whole page' }).click()
  await expect(page.locator('.view-controls .zoom-value')).toHaveText('Page')
})

test('reloads the application shell offline after the first visit', async ({ context, page }) => {
  await page.goto('./')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)

  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('.primary-open-button')).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
