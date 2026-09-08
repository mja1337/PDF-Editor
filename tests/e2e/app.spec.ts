import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
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
  await expect(page.getByText(/text block/i)).toBeVisible()
  await page.getByRole('button', { name: 'extracted text annotation' }).first().click()
  const pageEditor = page.getByRole('textbox', { name: 'Edit page text' })
  await expect(pageEditor).toBeFocused()
  await page.keyboard.type('X')
  await pageEditor.press('Enter')
  await expect(page.getByRole('button', { name: /Edited · .*Cover/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Edited · X$/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'extracted text annotation' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Edit page text' })).toBeFocused()
  const beforeEdit = await page.locator('.annotation-extracted.is-editing').boundingBox()
  await page.getByRole('textbox', { name: 'Edit page text' }).fill(
    'A much longer replacement that should grow toward the page margin',
  )
  await page.getByRole('textbox', { name: 'Edit page text' }).press('Enter')
  await expect(page.getByRole('button', { name: /Edited · A much longer replacement/i })).toBeVisible()
  const afterEdit = await page.getByRole('button', { name: 'extracted text annotation' }).first().boundingBox()
  expect((afterEdit?.width ?? 0) - (beforeEdit?.width ?? 0)).toBeGreaterThan(8)
  const pageBox = await page.locator('.focused-page .pdf-canvas-wrap').boundingBox()
  expect((afterEdit?.x ?? 0) + (afterEdit?.width ?? 0)).toBeLessThan(
    (pageBox?.x ?? 0) + (pageBox?.width ?? 0) - 4,
  )

  const lineBox = await page.getByRole('button', { name: 'extracted text annotation' }).first().boundingBox()
  await page.getByRole('button', { name: 'Highlight', exact: true }).click()
  await page.mouse.click(
    (lineBox?.x ?? 0) + (lineBox?.width ?? 0) / 2,
    (lineBox?.y ?? 0) + (lineBox?.height ?? 0) / 2,
  )
  const highlight = page.getByRole('button', { name: 'highlight annotation' })
  await expect(highlight).toBeVisible()
  const highlightBox = await highlight.boundingBox()
  expect(Math.abs((highlightBox?.width ?? 0) - (lineBox?.width ?? 0))).toBeLessThan(28)
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
  await expect(page.getByText(/text block/i)).toBeVisible()
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
  await expect(page.getByRole('button', { name: /Edited · Headers/i })).toBeVisible()
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

test('draws reversible ink and exports signatures and ink in PNG at every rotation offline', async ({ page, context }) => {
  await page.goto('./')
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
  await expect(page.getByRole('button', { name: 'ink annotation' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'ink annotation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: 'Erase stroke', exact: true }).click()
  await page.getByRole('button', { name: 'ink annotation' }).click()
  await expect(page.getByRole('button', { name: 'ink annotation' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()

  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Your name').fill('Renée — Smith')
  await dialog.getByRole('button', { name: 'Insert signature' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'signature annotation' })).toHaveCount(1)
  await page.getByRole('button', { name: 'signature annotation' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate annotation' }).click()
  await expect(page.getByRole('button', { name: 'signature annotation' })).toHaveCount(2)

  for (let rotation = 0; rotation < 4; rotation += 1) {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Page PNG', exact: true }).click()
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
    await page.getByRole('button', { name: 'Right', exact: true }).click()
  }
  await context.setOffline(false)
})

test('creates drawn and uploaded signatures and reports unsupported text', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[aria-label="Choose a PDF"]').setInputFiles({
    name: 'signature-modes.pdf', mimeType: 'application/pdf', buffer: await fixtureBytes(),
  })
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Your name').fill('世界')
  await dialog.getByRole('button', { name: 'Insert signature' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unsupported text')
  await dialog.getByRole('button', { name: 'Draw', exact: true }).click()
  const bounds = (await dialog.locator('canvas').boundingBox())!
  await page.mouse.move(bounds.x + 30, bounds.y + 40)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 150, bounds.y + 90, { steps: 10 })
  await page.mouse.up()
  await dialog.getByRole('button', { name: 'Insert signature' }).click()
  await expect(page.getByRole('button', { name: 'signature annotation' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Signature', exact: true }).click()
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'signature.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await dialog.getByRole('button', { name: 'Insert signature' }).click()
  await expect(page.getByRole('button', { name: 'signature annotation' })).toHaveCount(2)
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
