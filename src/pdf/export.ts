import type { PDFDocument as PdfLibDocument } from 'pdf-lib'
import { createOverlayFontLibrary, validateEditorText } from './fonts'
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
import { stampDisplayRect } from './stamp'
import { overlayPadPx, wrapTextToWidth } from './textLayout'
import { archOffset } from './wordArt'

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

export async function exportPdf(
  sourceBytes: ReadonlyMap<string, Uint8Array>,
  document: EditorDocument,
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  const { PDFDocument, degrees, rgb } = await import('pdf-lib')
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
  const textOverlays = document.pages.flatMap((page) =>
    page.overlays.filter(
      (overlay) => overlay.type === 'text' && (!overlay.extracted || overlay.edited),
    ),
  )
  const needsFont = Boolean(document.watermark) || textOverlays.length > 0
  const fonts = needsFont
    ? await createOverlayFontLibrary(output, textOverlays, fontBytes)
    : null
  if (fonts) {
    if (document.watermark) validateEditorText(fonts.defaultFont, document.watermark.text)
    for (const overlay of textOverlays) {
      validateEditorText(fonts.fontFor(overlay), overlay.text || 'Add text')
    }
  }
  const images = new Map<string, Awaited<ReturnType<typeof output.embedPng>>>()
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
    if (document.watermark && fonts) {
      const size = Math.max(18, Math.min(page.getWidth(), page.getHeight()) * 0.08)
      const textWidth = fonts.defaultFont.widthOfTextAtSize(
        document.watermark.text,
        size,
      )
      page.drawText(document.watermark.text, {
        x: page.getWidth() / 2 - textWidth / 2,
        y: page.getHeight() / 2,
        size,
        font: fonts.defaultFont,
        color: rgb(0.18, 0.22, 0.2),
        opacity: document.watermark.opacity,
        rotate: degrees(document.watermark.rotation),
      })
    }
    if (document.stamp?.imageData) {
      let stampImage = images.get(document.stamp.imageData)
      if (!stampImage) {
        stampImage = await output.embedPng(document.stamp.imageData)
        images.set(document.stamp.imageData, stampImage)
      }
      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const quarterTurn = rotation as QuarterTurn
      const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
      const box = stampDisplayRect(
        document.stamp,
        display.width,
        display.height,
        stampImage.width / Math.max(1, stampImage.height),
      )
      const anchor = displayPointToPdf(
        { x: box.x, y: box.y + box.height },
        pageWidth,
        pageHeight,
        quarterTurn,
      )
      page.drawImage(stampImage, {
        ...anchor,
        width: box.width,
        height: box.height,
        rotate: degrees(rotation),
        opacity: document.stamp.opacity,
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

      if (overlay.type === 'text' && overlay.extracted && !overlay.edited) {
        continue
      }

      if (overlay.type === 'image' && overlay.imageData) {
        let image = images.get(overlay.imageData)
        if (!image) {
          image = await output.embedPng(overlay.imageData)
          images.set(overlay.imageData, image)
        }
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const anchor = displayPointToPdf({ x: overlay.x * display.width,
          y: (overlay.y + overlay.height) * display.height }, pageWidth, pageHeight, quarterTurn)
        page.drawImage(image, { ...anchor, width: overlay.width * display.width,
          height: overlay.height * display.height, rotate: degrees(rotation), opacity: overlay.opacity })
      } else if (
        (overlay.type === 'ink' || overlay.sketch) &&
        (overlay.points?.length ?? 0) > 1
      ) {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const points = (overlay.points ?? []).map((point) => displayPointToPdf({
          x: (overlay.x + point.x * overlay.width) * display.width,
          y: (overlay.y + point.y * overlay.height) * display.height,
        }, pageWidth, pageHeight, quarterTurn))
        for (let index = 1; index < points.length; index += 1) {
          page.drawLine({ start: points[index - 1], end: points[index],
            thickness: overlay.strokeWidth, color, opacity: overlay.opacity })
        }
      } else if (overlay.type === 'text' && fonts) {
        if (overlay.cover) {
          const [fillRed, fillGreen, fillBlue] = colorComponents(
            overlay.backgroundColor ?? '#ffffff',
          )
          page.drawRectangle({
            ...rect,
            color: rgb(fillRed, fillGreen, fillBlue),
            opacity: 1,
          })
        }
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const font = fonts.fontFor(overlay)
        const text = overlay.text || 'Add text'
        let fontSize = overlay.fontSize ?? 18
        const pad = overlayPadPx(overlay, 1)
        const maxWidth = Math.max(1, overlay.width * display.width - pad.x * 2)
        const lineHeight = fontSize * (overlay.extracted ? 1 : 1.15)
        let lines: string[]
        if (overlay.extracted || text.includes('\n')) {
          lines = wrapTextToWidth(
            text,
            maxWidth,
            (value) => font.widthOfTextAtSize(value, fontSize),
          )
        } else {
          while (fontSize > 5 && font.widthOfTextAtSize(text, fontSize) > maxWidth) {
            fontSize -= 0.25
          }
          lines = [text]
        }
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (!line) continue
          const baseX = overlay.x * display.width + pad.x
          const baseY = overlay.y * display.height + pad.y + fontSize + index * lineHeight
          const drawAt = (textX: number, textY: number, fill = color, size = fontSize) => {
            const anchor = displayPointToPdf(
              { x: textX, y: textY },
              pageWidth,
              pageHeight,
              quarterTurn,
            )
            page.drawText(line, {
              x: anchor.x,
              y: anchor.y,
              size,
              font,
              color: fill,
              opacity: overlay.opacity,
              rotate: degrees(rotation),
            })
          }
          const art = overlay.wordArt ?? 'plain'
          if (art === 'shadow') {
            drawAt(baseX + fontSize * 0.08, baseY + fontSize * 0.08, rgb(0.12, 0.12, 0.12))
            drawAt(baseX, baseY)
          } else if (art === 'outline') {
            const offset = Math.max(0.6, fontSize * 0.06)
            for (const [dx, dy] of [
              [-offset, 0],
              [offset, 0],
              [0, -offset],
              [0, offset],
              [-offset, -offset],
              [offset, offset],
            ]) {
              drawAt(baseX + dx, baseY + dy)
            }
            drawAt(baseX, baseY, rgb(1, 1, 1))
          } else if (art === 'stack') {
            for (let layer = 3; layer >= 1; layer -= 1) {
              drawAt(
                baseX + layer * fontSize * 0.06,
                baseY + layer * fontSize * 0.06,
                rgb(0.12, 0.12, 0.12),
              )
            }
            drawAt(baseX, baseY)
          } else if (art === 'arch') {
            let cursor = 0
            const letters = [...line]
            for (let letterIndex = 0; letterIndex < letters.length; letterIndex += 1) {
              const letter = letters[letterIndex]
              const offset = archOffset(letterIndex, letters.length)
              const width = font.widthOfTextAtSize(letter, fontSize)
              const anchor = displayPointToPdf(
                {
                  x: baseX + cursor + width / 2,
                  y: baseY + offset.y * fontSize,
                },
                pageWidth,
                pageHeight,
                quarterTurn,
              )
              page.drawText(letter, {
                x: anchor.x,
                y: anchor.y,
                size: fontSize,
                font,
                color,
                opacity: overlay.opacity,
                rotate: degrees(rotation + offset.rotate),
              })
              cursor += width
            }
          } else {
            drawAt(baseX, baseY)
          }
        }
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
      } else if (overlay.type === 'diamond') {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const midX = (overlay.x + overlay.width / 2) * display.width
        const midY = (overlay.y + overlay.height / 2) * display.height
        const corners = [
          { x: midX, y: overlay.y * display.height },
          { x: (overlay.x + overlay.width) * display.width, y: midY },
          { x: midX, y: (overlay.y + overlay.height) * display.height },
          { x: overlay.x * display.width, y: midY },
        ].map((point) =>
          displayPointToPdf(point, pageWidth, pageHeight, quarterTurn),
        )
        for (let index = 0; index < corners.length; index += 1) {
          page.drawLine({
            start: corners[index],
            end: corners[(index + 1) % corners.length],
            thickness: overlay.strokeWidth,
            color,
            opacity: overlay.opacity,
          })
        }
      } else if (overlay.type === 'arrow') {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const start = displayPointToPdf(
          {
            x: (overlay.x + 0.08 * overlay.width) * display.width,
            y: (overlay.y + 0.82 * overlay.height) * display.height,
          },
          pageWidth,
          pageHeight,
          quarterTurn,
        )
        const end = displayPointToPdf(
          {
            x: (overlay.x + 0.92 * overlay.width) * display.width,
            y: (overlay.y + 0.18 * overlay.height) * display.height,
          },
          pageWidth,
          pageHeight,
          quarterTurn,
        )
        page.drawLine({
          start,
          end,
          thickness: overlay.strokeWidth,
          color,
          opacity: overlay.opacity,
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
