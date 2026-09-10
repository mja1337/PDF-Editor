import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readFile } from 'node:fs/promises'

async function resetDeviceStorage(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('pdfe')
      request.onerror = () => reject(request.error ?? new Error('Could not reset device storage.'))
      request.onblocked = () => resolve()
      request.onsuccess = () => resolve()
    })
  })
}

async function placePendingSignature(page: Page, xRatio: number, yRatio: number) {
  const layer = page.locator('.focused-page .annotation-layer')
  await expect(layer).toBeVisible()
  const box = (await layer.boundingBox())!
  await layer.click({
    position: { x: box.width * xRatio, y: box.height * yRatio },
  })
}

/** Page actions live on the right-click menu rather than a permanent panel. */
async function pageAction(page: Page, pageLabel: string, item: string | RegExp) {
  await page.getByRole('button', { name: pageLabel }).click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Page actions' })
    .getByRole('menuitem', { name: item })
    .click()
}

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
  await expect(page.getByRole('heading', { name: /open a pdf/i })).toBeVisible()

  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'workflow-fixture.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  await expect(page.getByText('3 pages ·', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Select page 2' }).click()
  await pageAction(page, 'Select page 2', 'Rotate right')
  await pageAction(page, 'Select page 2', 'Move earlier')

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
  await page.getByRole('button', { name: 'Select page 4' }).click()
  await pageAction(page, 'Select page 4', /^Duplicate/)
  await expect(page.getByText('5 pages · 2 sources', { exact: false })).toBeVisible()

  const extractPromise = page.waitForEvent('download')
  await pageAction(page, 'Select page 4', /^Extract/)
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
  await pageAction(page, 'Select page 1', 'Export focused page as PNG')
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
  await pageAction(page, 'Select page 3', 'Rotate right')

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

test('renders page text and analyses it into editable lines', async ({ page }) => {
  const missingAssets: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/pdfjs/') && response.status() >= 400) {
      missingAssets.push(`${response.status()} ${response.url()}`)
    }
  })

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'analyse.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })

  const canvas = page.locator('.focused-page canvas')
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  const painted = await canvas.evaluate((node) => {
    const target = node as HTMLCanvasElement
    const context = target.getContext('2d')
    if (!context) return 0
    const pixels = context.getImageData(0, 0, target.width, target.height).data
    let ink = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) {
        ink += 1
      }
    }
    return ink
  })
  expect(painted, missingAssets.join('\n')).toBeGreaterThan(80)
  expect(missingAssets).toEqual([])

  await page.getByRole('button', { name: 'Analyse text' }).click()
  await expect(page.getByText(/lines? found/i)).toBeVisible()
  const analysedRows = page.locator('.text-panel .extracted-text-row')
  const analysedText = analysedRows.locator('textarea')
  await expect(analysedText.first()).toHaveValue(/Cover/)
  await page.getByRole('button', { name: 'extracted text annotation' }).first().click()
  const pageEditor = page.getByRole('textbox', { name: 'Edit page text' })
  await expect(pageEditor).toBeFocused()
  await page.keyboard.type('X')
  await pageEditor.press('Enter')
  await expect(analysedRows.first()).toHaveClass(/is-edited/)
  await expect(analysedText.first()).toHaveValue(/Cover/)
  await expect(analysedText.first()).not.toHaveValue('X')

  await page.getByRole('button', { name: 'extracted text annotation' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Edit page text' })).toBeFocused()
  const beforeEdit = await page.locator('.annotation-extracted.is-editing').boundingBox()
  await page.getByRole('textbox', { name: 'Edit page text' }).fill(
    'A much longer replacement that should grow toward the page margin',
  )
  await page.getByRole('textbox', { name: 'Edit page text' }).press('Enter')
  await expect(analysedText.first()).toHaveValue(/A much longer replacement/)
  const afterEdit = await page.getByRole('button', { name: 'extracted text annotation' }).first().boundingBox()
  expect((afterEdit?.width ?? 0) - (beforeEdit?.width ?? 0)).toBeGreaterThan(8)
  const pageBox = await page.locator('.focused-page .pdf-canvas-wrap').boundingBox()
  expect((afterEdit?.x ?? 0) + (afterEdit?.width ?? 0)).toBeLessThan(
    (pageBox?.x ?? 0) + (pageBox?.width ?? 0) - 4,
  )

  const lineBox = await page.locator('.focused-page').getByRole('button', { name: 'extracted text annotation' }).first().boundingBox()
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()
  await page.mouse.click(
    (lineBox?.x ?? 0) + (lineBox?.width ?? 0) / 2,
    (lineBox?.y ?? 0) + (lineBox?.height ?? 0) / 2,
  )
  const highlight = page.locator('.focused-page').getByRole('button', { name: 'highlight annotation' })
  await expect(highlight).toBeVisible()
  const highlightBox = await highlight.boundingBox()
  expect(Math.abs((highlightBox?.width ?? 0) - (lineBox?.width ?? 0))).toBeLessThan(28)

  // The analysed list edits the same overlay the page does.
  await analysedRows.first().getByRole('button', { name: /^Show on page/ }).click()
  await expect(analysedRows.first()).toHaveClass(/is-active/)
  // Selection frames live in a 0..1 viewBox, so a scaled stroke floods the line
  // with the accent colour instead of outlining it.
  const frameStroke = await page
    .locator('.focused-page .annotation-extracted.is-selected .annotation-selection-box')
    .evaluate((node) => getComputedStyle(node).vectorEffect)
  expect(frameStroke).toBe('non-scaling-stroke')
  await analysedText.first().fill('Rewritten from the list')
  await analysedText.first().press('Tab')
  await expect(analysedText.first()).toHaveValue('Rewritten from the list')
  await expect(
    page.locator('.focused-page').getByRole('button', { name: 'extracted text annotation' }).first(),
  ).toContainText('Rewritten from the list')
})

test('covers analysed text with the sampled page colour', async ({ page }) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const leaf = pdf.addPage([300, 420])
  leaf.drawRectangle({
    x: 0,
    y: 320,
    width: 300,
    height: 100,
    color: rgb(0.82, 0.12, 0.12),
  })
  leaf.drawText('Header', {
    x: 28,
    y: 358,
    size: 26,
    font,
    color: rgb(1, 1, 1),
  })

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'header.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  await page.getByRole('button', { name: 'Analyse text' }).click()
  await expect(page.getByText(/lines? found/i)).toBeVisible()
  await page.getByRole('button', { name: 'extracted text annotation' }).first().click()
  const editor = page.getByRole('textbox', { name: 'Edit page text' })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('Header')
  await editor.fill('Headers')
  await expect(editor).toHaveValue('Headers')
  const paint = await page.locator('.annotation-extracted.is-editing').evaluate((node) => {
    const style = getComputedStyle(node)
    const color = style.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    const background = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    return {
      color: color?.slice(1, 4).map(Number) ?? [0, 0, 0],
      background: background?.slice(1, 4).map(Number) ?? [255, 255, 255],
    }
  })
  expect(paint.background[0]).toBeGreaterThan(150)
  expect(paint.background[1]).toBeLessThan(90)
  expect(paint.color[0]).toBeGreaterThan(180)
  expect(paint.color[1]).toBeGreaterThan(180)
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(
    page.locator('.text-panel .extracted-text-row.is-edited textarea'),
  ).toHaveValue(/Headers/)
  await expect(page.locator('.focused-page .annotation-extracted.is-edited')).toBeVisible()
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
  const pageEditor = page.getByRole('textbox', { name: 'Edit page text' })
  await expect(pageEditor).toBeFocused()
  await pageEditor.fill('Local review note')
  await pageEditor.press('Enter')
  const textAnnotation = page.getByRole('button', { name: 'text annotation' })
  await expect(textAnnotation).toBeVisible()
  await expect(textAnnotation).toHaveCSS('font-weight', /900|800|bold/)
  await expect(textAnnotation).not.toHaveCSS('color', 'rgb(224, 82, 82)')

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
  const boxLayer = (await layer.boundingBox())!
  await page.mouse.move(boxLayer.x + 36, boxLayer.y + 250)
  await page.mouse.down()
  await page.mouse.move(boxLayer.x + 150, boxLayer.y + 340, { steps: 8 })
  await page.mouse.up()
  const rectangle = page.locator('.focused-page').getByRole('button', { name: 'rectangle annotation' })
  await expect(rectangle).toBeVisible()
  await expect(page.getByRole('button', { name: 'Box', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const beforeBoxMove = await rectangle.boundingBox()
  expect(beforeBoxMove).toBeTruthy()
  await rectangle.hover()
  await page.mouse.down()
  await page.mouse.move(
    beforeBoxMove!.x + beforeBoxMove!.width / 2 + 50,
    beforeBoxMove!.y + beforeBoxMove!.height / 2 + 30,
    { steps: 6 },
  )
  await page.mouse.up()
  const afterBoxMove = await rectangle.boundingBox()
  expect(afterBoxMove!.x - beforeBoxMove!.x).toBeGreaterThan(8)
  await expect(page.getByRole('button', { name: 'Box', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Line', exact: true }).click()
  const layerBox = (await layer.boundingBox())!
  // The page is taller than the viewport, so draw inside the visible band.
  const viewHeight = page.viewportSize()!.height
  const drawY =
    (Math.max(layerBox.y, 0) + Math.min(layerBox.y + layerBox.height, viewHeight)) / 2
  await page.mouse.move(layerBox.x + 48, drawY)
  await page.mouse.down()
  await page.mouse.move(layerBox.x + 220, drawY + 4, { steps: 8 })
  await page.mouse.up()
  const drawnLine = page.getByRole('button', { name: 'line annotation' })
  await expect(drawnLine).toBeVisible()
  const lineBox = await drawnLine.boundingBox()
  expect(lineBox!.width).toBeGreaterThan((lineBox!.height ?? 0) * 2)

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
  await page.locator('.focused-page .annotation-rectangle.is-selected').click({ button: 'right' })
  await annotationMenu.getByRole('menuitem', { name: 'Delete annotation' }).click()
  await expect(rectangles).toHaveCount(1)
})

test('draws reversible ink and exports signatures and ink in PNG at every rotation offline', async ({ page, context }) => {
  await page.goto('./')
  await resetDeviceStorage(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'signing.pdf', mimeType: 'application/pdf', buffer: await fixtureBytes(),
  })
  await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).click()
  const layer = page.locator('.focused-page .annotation-layer')
  const bounds = (await layer.boundingBox())!
  await page.mouse.move(bounds.x + 60, bounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 160, bounds.y + 140, { steps: 15 })
  await page.mouse.up()
  await expect(page.locator('.focused-page').getByRole('button', { name: 'ink annotation' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.focused-page').getByRole('button', { name: 'ink annotation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: 'Erase', exact: true }).click()
  await page.locator('.focused-page').getByRole('button', { name: 'ink annotation' }).click()
  await expect(page.locator('.focused-page').getByRole('button', { name: 'ink annotation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()

  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Type', exact: true }).click()
  await dialog.getByLabel('Your name').fill('Renée — Smith')
  await dialog.locator('.signature-remember input').setChecked(false)
  await dialog.getByRole('button', { name: 'Apply signature' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveClass(/is-placing-signature/)
  await placePendingSignature(page, 0.5, 0.72)
  await expect(page.locator('.focused-page').getByRole('button', { name: 'signature annotation' })).toHaveCount(1)
  await page.getByRole('button', { name: 'signature annotation' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate annotation' }).click()
  await expect(page.getByRole('button', { name: 'signature annotation' })).toHaveCount(2)

  for (let rotation = 0; rotation < 4; rotation += 1) {
    const downloadPromise = page.waitForEvent('download')
    await pageAction(page, 'Select page 1', 'Export focused page as PNG')
    const bytes = await readFile((await (await downloadPromise).path())!)
    const colors = await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0; let blue = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 140 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) red++
        if (pixels[i + 2] > pixels[i] * 1.7 && pixels[i + 2] > pixels[i + 1] * 1.2) blue++
      }
      return { red, blue }
    }, bytes.toString('base64'))
    expect(colors.red).toBeGreaterThan(50)
    expect(colors.blue).toBeGreaterThan(50)
    await pageAction(page, 'Select page 1', 'Rotate right')
  }
  await context.setOffline(false)
})

test('creates drawn and uploaded signatures and reports unsupported text', async ({ page }) => {
  await page.goto('./')
  await resetDeviceStorage(page)
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'signature-modes.pdf', mimeType: 'application/pdf', buffer: await fixtureBytes(),
  })
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Type', exact: true }).click()
  await dialog.getByLabel('Your name').fill('世界')
  await dialog.getByRole('button', { name: 'Apply signature' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unsupported text')
  await dialog.getByRole('button', { name: 'Draw', exact: true }).click()
  const bounds = (await dialog.locator('canvas').boundingBox())!
  await page.mouse.move(bounds.x + 30, bounds.y + 40)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 150, bounds.y + 90, { steps: 10 })
  await page.mouse.up()
  await dialog.locator('.signature-remember input').setChecked(false)
  await dialog.getByRole('button', { name: 'Apply signature' }).click()
  await expect(dialog).toBeHidden()
  const pageWrap = page.locator('.focused-page .pdf-canvas-wrap')
  await expect(pageWrap).toHaveClass(/is-placing-signature/)
  await placePendingSignature(page, 0.45, 0.7)
  await expect(page.locator('.focused-page').getByRole('button', { name: 'signature annotation' })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(pageWrap).not.toHaveClass(/is-placing-signature/)
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'signature.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  })
  await expect(dialog.getByRole('img', { name: 'Signature preview' })).toBeVisible()
  await dialog.locator('.signature-remember input').setChecked(false)
  await expect(dialog.getByRole('button', { name: 'Apply signature' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Apply signature' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageWrap).toHaveClass(/is-placing-signature/)
  await placePendingSignature(page, 0.55, 0.75)
  await expect(page.locator('.focused-page').getByRole('button', { name: 'signature annotation' })).toHaveCount(2)
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

test('marks redactions from the annotate palette without annotation chrome', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'redact.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )

  await page.getByRole('button', { name: 'Redact', exact: true }).click()
  const layer = page.locator('.focused-page .redaction-layer')
  await expect(layer).toBeVisible()
  await expect(page.locator('.focused-page .annotation-layer:not(.redaction-layer)')).toHaveCount(0)

  const box = (await layer.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.15)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.28, { steps: 8 })
  await expect(layer.locator('.annotation-redaction.is-draft')).toHaveCount(1)
  await expect(
    layer.locator(
      '.annotation-selection-frame, .annotation-resize-handle, .annotation-hover-edge, .annotation-extracted',
    ),
  ).toHaveCount(0)
  await page.mouse.up()

  await expect(layer.locator('.annotation-redaction')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Export redacted PDF/ })).toBeVisible()

  // Leaving redact mode hands the page back to the annotation layer, marks intact.
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(page.locator('.focused-page .redaction-layer')).toHaveCount(0)
  await expect(
    page.locator('.focused-page .annotation-layer .annotation-redaction'),
  ).toHaveCount(1)
})

test('grows an edited line into free space without disturbing the block', async ({ page }) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sheet = pdf.addPage([595, 842])
  const address = ['Mr J Doe', 'Flat 4', 'Kingsmead House', 'London', 'SW1A 1AA']
  address.forEach((value, index) =>
    sheet.drawText(value, { x: 60, y: 760 - index * 22, size: 13, font }),
  )

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'address.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  await page.getByRole('button', { name: 'Analyse text' }).click()
  await expect(page.getByText(/lines? found/i)).toBeVisible()

  const lines = page.locator('.focused-page .annotation-extracted')
  const rows = page.locator('.text-panel .extracted-text-row')
  const editedBefore = (await lines.nth(2).boundingBox())!
  const belowBefore = (await lines.nth(3).boundingBox())!

  await rows.nth(2).locator('textarea').fill(
    'Kingsmead House, Apartment 12b, Riverside Walk, Battersea',
  )
  await rows.nth(2).locator('textarea').press('Tab')
  await expect(lines.nth(2)).toContainText('Riverside Walk')
  // The refit runs after the text lands, so wait for the box to settle.
  await expect
    .poll(async () => (await lines.nth(2).boundingBox())?.width ?? 0)
    .toBeGreaterThan(editedBefore.width * 2)

  const editedAfter = (await lines.nth(2).boundingBox())!
  const belowAfter = (await lines.nth(3).boundingBox())!

  // It grew sideways into the empty margin rather than clipping.
  expect(editedAfter.width).toBeGreaterThan(editedBefore.width * 2)
  // The rest of the address block is untouched, and nothing overlaps it.
  expect(belowAfter.y).toBeCloseTo(belowBefore.y, 0)
  expect(belowAfter.height).toBeCloseTo(belowBefore.height, 0)
  expect(editedAfter.y + editedAfter.height).toBeLessThanOrEqual(belowAfter.y)
  await expect(rows.nth(2)).not.toHaveClass(/is-overflowing/)
})

test('keeps a coloured mark inside a line when the words around it are edited', async ({
  page,
}) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sheet = pdf.addPage([595, 842])
  const label = 'Full name '
  sheet.drawText(label, { x: 60, y: 700, size: 18, font, color: rgb(0.08, 0.08, 0.08) })
  sheet.drawText('*', {
    x: 60 + font.widthOfTextAtSize(label, 18),
    y: 700,
    size: 18,
    font,
    color: rgb(0.84, 0.16, 0.16),
  })

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'form.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  await page.getByRole('button', { name: 'Analyse text' }).click()
  await expect(page.getByText(/lines? found/i)).toBeVisible()

  const row = page.locator('.text-panel .extracted-text-row').first()
  await expect(row.locator('textarea')).toHaveValue(/\*/)
  await row.locator('textarea').fill('Customer name *')
  await row.locator('textarea').press('Tab')

  const rendered = page.locator('.focused-page .annotation-extracted.is-edited').first()
  await expect(rendered).toContainText('Customer name')

  // The words are repainted in the body ink; the mark keeps the red it was printed in.
  const inks = await rendered.locator('.annotation-text span').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent ?? '',
      color: getComputedStyle(node).color,
    })),
  )
  expect(inks.length).toBeGreaterThan(1)
  const mark = inks.find((piece) => piece.text.includes('*'))
  const words = inks.find((piece) => piece.text.includes('Customer'))
  expect(mark, JSON.stringify(inks)).toBeDefined()
  const [markRed, markGreen] = mark!.color.match(/\d+/g)!.map(Number)
  expect(markRed, JSON.stringify(inks)).toBeGreaterThan(150)
  expect(markGreen).toBeLessThan(110)
  const [wordRed] = words!.color.match(/\d+/g)!.map(Number)
  expect(wordRed).toBeLessThan(110)

  // Round trip: the exported file must carry the red mark too, not just the screen.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export PDF/ }).click()
  const exported = await readFile((await (await download).path())!)

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'exported.pdf',
    mimeType: 'application/pdf',
    buffer: exported,
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  // Anti-aliasing softens a small glyph, so measure how red the reddest ink is
  // rather than counting fully saturated pixels.
  const ink = await page.locator('.focused-page canvas').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const pixels = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data
    let redness = 0
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]!
      const g = pixels[index + 1]!
      const b = pixels[index + 2]!
      redness = Math.max(redness, r - Math.max(g, b))
      if (r < 110 && g < 110 && b < 110) dark += 1
    }
    return { redness, dark }
  })
  expect(ink.dark, JSON.stringify(ink)).toBeGreaterThan(50)
  expect(ink.redness, JSON.stringify(ink)).toBeGreaterThan(40)
})

test('keeps the view controls in place while the page scrolls', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'scroll.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )

  const island = page.locator('.view-controls')
  const before = (await island.boundingBox())!
  const stage = (await page.locator('.document-stage').boundingBox())!
  // Centred over the page area, not over the whole window.
  expect(Math.abs(before.x + before.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(4)

  await page.locator('.stage-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect
    .poll(async () => (await page.locator('.stage-scroll').evaluate((n) => n.scrollTop)) > 40)
    .toBe(true)

  const after = (await island.boundingBox())!
  expect(after.y).toBeCloseTo(before.y, 0)
  expect(after.x).toBeCloseTo(before.x, 0)
})

test('lines the top and bottom toolbars up on the same axis', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'align.pdf',
    mimeType: 'application/pdf',
    buffer: await fixtureBytes(),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )

  const tools = (await page.locator('.island-tools').boundingBox())!
  const view = (await page.locator('.view-controls').boundingBox())!
  const stage = (await page.locator('.document-stage').boundingBox())!
  const centre = (box: { x: number; width: number }) => box.x + box.width / 2

  expect(Math.abs(centre(tools) - centre(view))).toBeLessThan(2)
  expect(Math.abs(centre(tools) - centre(stage))).toBeLessThan(2)
})

test('keeps a tightly leaded block from overlapping, before and after editing', async ({
  page,
}) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const sheet = pdf.addPage([595, 842])
  // 12pt type on 14pt leading, as an address block is normally set. Run heights
  // include ascenders and descenders, so the measured boxes overlap.
  const rows = [
    'Mr Jonathan Doe',
    'Flat 4, Kingsmead House',
    '27 Riverside Walk',
    'London',
    'SW1A 1AA',
  ]
  rows.forEach((value, index) =>
    sheet.drawText(value, { x: 60, y: 740 - index * 14, size: 12, font }),
  )

  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'tight.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.focused-page .pdf-canvas-wrap')).toHaveAttribute(
    'data-status',
    'ready',
  )
  await page.getByRole('button', { name: 'Analyse text' }).click()
  await expect(page.getByText(/lines? found/i)).toBeVisible()

  const gaps = () =>
    page.locator('.focused-page').evaluate((root) => {
      const boxes = [...root.querySelectorAll('.annotation-extracted')]
        .map((node) => node.getBoundingClientRect())
        .sort((left, right) => left.top - right.top)
      return boxes
        .slice(1)
        .map((box, index) => +(box.top - boxes[index].bottom).toFixed(1))
    })

  const analysed = await gaps()
  expect(analysed).toHaveLength(rows.length - 1)
  for (const gap of analysed) expect(gap, JSON.stringify(analysed)).toBeGreaterThanOrEqual(-0.5)

  const before = (await page.locator('.focused-page .annotation-extracted').nth(3).boundingBox())!
  const list = page.locator('.text-panel .extracted-text-row')
  await list.nth(1).locator('textarea').fill(
    'Flat 4, Kingsmead House, Apartment 12b, Riverside Walk, Battersea',
  )
  await list.nth(1).locator('textarea').press('Tab')
  await expect(page.locator('.focused-page .annotation-extracted').nth(1)).toContainText(
    'Battersea',
  )

  const edited = await gaps()
  for (const gap of edited) expect(gap, JSON.stringify(edited)).toBeGreaterThanOrEqual(-0.5)
  const after = (await page.locator('.focused-page .annotation-extracted').nth(3)).boundingBox()
  expect((await after)!.y).toBeCloseTo(before.y, 0)
})
