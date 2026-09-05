import type { PDFDocument as PdfLibDocument } from 'pdf-lib'
import type {
  EditorDocument,
  PageOverlay,
  QuarterTurn,
} from '../domain/document'
import {
  displayDimensions,
  displayPointToPdf,
  overlayLineToPdf,
  overlayToPdfRect,
} from './coordinates'

function copyMetadata(source: PdfLibDocument, output: PdfLibDocument) {
  const title = source.getTitle()
  const author = source.getAuthor()
  const subject = source.getSubject()
  const keywords = source.getKeywords()
  const creator = source.getCreator()
  const producer = source.getProducer()
  const creationDate = source.getCreationDate()
  const modificationDate = source.getModificationDate()

  if (title) output.setTitle(title)
  if (author) output.setAuthor(author)
  if (subject) output.setSubject(subject)
  if (keywords) output.setKeywords(keywords.split(/,\s*/).filter(Boolean))
  if (creator) output.setCreator(creator)
  if (producer) output.setProducer(producer)
  if (creationDate) output.setCreationDate(creationDate)
  if (modificationDate) output.setModificationDate(modificationDate)
}

function colorComponents(hex: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'e05252'
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number]
}

function winAnsiText(text: string) {
  return text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

export async function exportPdf(
  sourceBytes: ReadonlyMap<string, Uint8Array>,
  document: EditorDocument,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import('pdf-lib')
  const sourceDocuments = new Map<string, PdfLibDocument>()

  for (const source of document.sources) {
    const bytes = sourceBytes.get(source.id)
    if (!bytes) throw new Error(`Source file is unavailable: ${source.name}`)
    sourceDocuments.set(
      source.id,
      await PDFDocument.load(bytes.slice(), { updateMetadata: false }),
    )
  }

  const output = await PDFDocument.create()
  const needsFont =
    Boolean(document.watermark) ||
    document.pages.some((page) => page.overlays.some((overlay) => overlay.type === 'text'))
  const annotationFont = needsFont
    ? await output.embedFont(StandardFonts.HelveticaBold)
    : null
  const primarySource = sourceDocuments.get(document.sources[0].id)
  if (primarySource) copyMetadata(primarySource, output)

  const expectedRotations: number[] = []
  for (const pageReference of document.pages) {
    const source = sourceDocuments.get(pageReference.sourceDocumentId)
    if (!source) throw new Error('A page source is unavailable.')

    const [page] = await output.copyPages(source, [pageReference.sourcePageIndex])
    const sourceRotation = page.getRotation().angle
    const rotation = (sourceRotation + pageReference.rotationDelta + 360) % 360
    page.setRotation(degrees(rotation))
    if (document.watermark && annotationFont) {
      const size = Math.max(18, Math.min(page.getWidth(), page.getHeight()) * 0.08)
      const textWidth = annotationFont.widthOfTextAtSize(
        document.watermark.text,
        size,
      )
      page.drawText(document.watermark.text, {
        x: page.getWidth() / 2 - textWidth / 2,
        y: page.getHeight() / 2,
        size,
        font: annotationFont,
        color: rgb(0.18, 0.22, 0.2),
        opacity: document.watermark.opacity,
        rotate: degrees(document.watermark.rotation),
      })
    }


    for (const overlay of pageReference.overlays) {
      const [red, green, blue] = colorComponents(overlay.color)
      const color = rgb(red, green, blue)
      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const quarterTurn = rotation as QuarterTurn
      const rect = overlayToPdfRect(
        overlay,
        pageWidth,
        pageHeight,
        quarterTurn,
      )

      if (overlay.type === 'text' && annotationFont) {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const fontSize = overlay.fontSize ?? 18
        const anchor = displayPointToPdf(
          {
            x: overlay.x * display.width,
            y: overlay.y * display.height + fontSize,
          },
          pageWidth,
          pageHeight,
          quarterTurn,
        )
        page.drawText(winAnsiText(overlay.text || 'Add text'), {
          x: anchor.x,
          y: anchor.y,
          size: fontSize,
          font: annotationFont,
          color,
          opacity: overlay.opacity,
          rotate: degrees(rotation),
        })
      } else if (overlay.type === 'highlight') {
        page.drawRectangle({
          ...rect,
          color,
          opacity: overlay.opacity,
        })
      } else if (overlay.type === 'rectangle') {
        page.drawRectangle({
          ...rect,
          borderColor: color,
          borderWidth: overlay.strokeWidth,
          borderOpacity: overlay.opacity,
        })
      } else if (overlay.type === 'ellipse') {
        page.drawEllipse({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          xScale: rect.width / 2,
          yScale: rect.height / 2,
          borderColor: color,
          borderWidth: overlay.strokeWidth,
          borderOpacity: overlay.opacity,
        })
      } else {
        let lineOverlay: PageOverlay = overlay
        if (overlay.type === 'underline') {
          lineOverlay = { ...overlay, y: overlay.y + overlay.height, height: 0 }
        } else if (overlay.type === 'strikeout') {
          lineOverlay = {
            ...overlay,
            y: overlay.y + overlay.height / 2,
            height: 0,
          }
        }
        const line = overlayLineToPdf(
          lineOverlay,
          pageWidth,
          pageHeight,
          quarterTurn,
        )
        page.drawLine({
          start: line.start,
          end: line.end,
          thickness: overlay.strokeWidth,
          color,
          opacity: overlay.opacity,
        })
      }
    }
    output.addPage(page)
    expectedRotations.push(rotation)
  }

  const bytes = await output.save({ useObjectStreams: true })
  const verification = await PDFDocument.load(bytes, { updateMetadata: false })
  if (verification.getPageCount() !== document.pages.length) {
    throw new Error('Export verification failed: page count changed.')
  }
  verification.getPages().forEach((page, index) => {
    if (page.getRotation().angle !== expectedRotations[index]) {
      throw new Error(`Export verification failed on page ${index + 1}.`)
    }
  })

  return bytes
}

export function downloadPdf(bytes: Uint8Array, sourceName: string) {
  const baseName = sourceName.replace(/\.pdf$/i, '') || 'document'
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/pdf',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${baseName}-edited.pdf`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
