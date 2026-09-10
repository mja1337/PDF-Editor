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
import { EXTRACTED_LINE_HEIGHT, layoutExtractedLines } from './extractedTextFit'
import {
  lineColorSegments,
  normalizeColoredText,
  segmentsToColors,
} from './inkSegments'
import { arrowHeadPolygon, arrowHeadSize, lineEndpoints, lineSketchRoughness, overlayDisplayPoint } from './shapeGeometry'
import { sketchClosedInPixels, sketchLineBetween, sketchStrokes } from './sketch'
import { closedShapeFill, isClosedDrawShape } from '../domain/overlays'
import {
  canFlattenScanEdits,
  coverBox,
  flattenScannedPageEdits,
  isScannedTextEdit,
  pageHasScannedEdits,
} from './scanEdit'

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

function diamondPdfCorners(
  overlay: PageOverlay,
  pageWidth: number,
  pageHeight: number,
  quarterTurn: QuarterTurn,
) {
  const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
  const midX = (overlay.x + overlay.width / 2) * display.width
  const midY = (overlay.y + overlay.height / 2) * display.height
  return [
    { x: midX, y: overlay.y * display.height },
    { x: (overlay.x + overlay.width) * display.width, y: midY },
    { x: midX, y: (overlay.y + overlay.height) * display.height },
    { x: overlay.x * display.width, y: midY },
  ].map((point) => displayPointToPdf(point, pageWidth, pageHeight, quarterTurn))
}

function diamondPath(corners: Array<{ x: number; y: number }>) {
  const [first, second, third, fourth] = corners
  if (!first || !second || !third || !fourth) return ''
  return `M ${first.x} ${first.y} L ${second.x} ${second.y} L ${third.x} ${third.y} L ${fourth.x} ${fourth.y} Z`
}

export async function exportPdf(
  sourceBytes: ReadonlyMap<string, Uint8Array>,
  document: EditorDocument,
  fontBytes?: Uint8Array,
  sourcePasswords?: ReadonlyMap<string, string>,
): Promise<Uint8Array> {
  const { PDFDocument, EncryptedPDFError, degrees, rgb, LineCapStyle } = await import('pdf-lib')
  const sourceDocuments = new Map<string, PdfLibDocument>()

  for (const source of document.sources) {
    const bytes = sourceBytes.get(source.id)
    if (!bytes) throw new Error(`Source file is unavailable: ${source.name}`)
    const wasPasswordProtected = Boolean(sourcePasswords?.get(source.id))
    try {
      sourceDocuments.set(
        source.id,
        await PDFDocument.load(bytes.slice(), {
          updateMetadata: false,
          ignoreEncryption: wasPasswordProtected,
        }),
      )
    } catch (error) {
      if (error instanceof EncryptedPDFError) {
        throw new Error(
          'This PDF is password-protected. Reopen it and enter the password before exporting.',
          { cause: error },
        )
      }
      throw error
    }
  }

  const output = await PDFDocument.create()
  const flattenable = canFlattenScanEdits()
  const textOverlays = document.pages.flatMap((page) =>
    page.overlays.filter((overlay) => {
      if (overlay.type !== 'text') return false
      if (!overlay.extracted || overlay.edited) {
        if (flattenable && isScannedTextEdit(overlay)) return false
        return true
      }
      return false
    }),
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

    let burnedScanEdits = false
    const pageBytes = sourceBytes.get(pageReference.sourceDocumentId)
    if (flattenable && pageBytes && pageHasScannedEdits(pageReference.overlays)) {
      try {
        const jpegBytes = await flattenScannedPageEdits(
          pageBytes,
          pageReference.sourcePageIndex,
          pageReference.rotationDelta,
          pageReference.overlays,
          sourcePasswords?.get(pageReference.sourceDocumentId),
        )
        if (jpegBytes) {
          const jpeg = await output.embedJpg(jpegBytes)
          const pageWidth = page.getWidth()
          const pageHeight = page.getHeight()
          const quarterTurn = rotation as QuarterTurn
          const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
          const anchor = displayPointToPdf(
            { x: 0, y: display.height },
            pageWidth,
            pageHeight,
            quarterTurn,
          )
          page.drawImage(jpeg, {
            ...anchor,
            width: display.width,
            height: display.height,
            rotate: degrees(rotation),
          })
          burnedScanEdits = true
        }
      } catch {
        burnedScanEdits = false
      }
    }

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
      if (burnedScanEdits && isScannedTextEdit(overlay)) continue
      const [red, green, blue] = colorComponents(overlay.color)
      const color = rgb(red, green, blue)
      const pageWidth = page.getWidth()
      const pageHeight = page.getHeight()
      const quarterTurn = rotation as QuarterTurn
      const covered = overlay.type === 'text' && overlay.extracted && overlay.edited
      const rect = overlayToPdfRect(
        covered ? { ...overlay, ...coverBox(overlay, pageReference.overlays) } : overlay,
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
      } else if (overlay.type === 'ink' && (overlay.points?.length ?? 0) > 1) {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const sourcePoints = overlay.points ?? []
        const points = sourcePoints.map((point) => displayPointToPdf({
          x: (overlay.x + point.x * overlay.width) * display.width,
          y: (overlay.y + point.y * overlay.height) * display.height,
        }, pageWidth, pageHeight, quarterTurn))
        for (let index = 1; index < points.length; index += 1) {
          if (sourcePoints[index]?.move) continue
          page.drawLine({ start: points[index - 1], end: points[index],
            thickness: overlay.strokeWidth, color, opacity: overlay.opacity,
            lineCap: LineCapStyle.Round })
        }
      } else if (overlay.sketch && isClosedDrawShape(overlay.type)) {
        const fillHex = closedShapeFill(overlay)
        if (fillHex) {
          const [fillRed, fillGreen, fillBlue] = colorComponents(fillHex)
          const fillColor = rgb(fillRed, fillGreen, fillBlue)
          if (overlay.type === 'rectangle') {
            page.drawRectangle({ ...rect, color: fillColor, opacity: overlay.opacity })
          } else if (overlay.type === 'ellipse') {
            page.drawEllipse({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              xScale: rect.width / 2,
              yScale: rect.height / 2,
              color: fillColor,
              opacity: overlay.opacity,
            })
          } else if (overlay.type === 'diamond') {
            const path = diamondPath(
              diamondPdfCorners(overlay, pageWidth, pageHeight, quarterTurn),
            )
            if (path) page.drawSvgPath(path, { color: fillColor, opacity: overlay.opacity })
          }
        }
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const sourcePoints = sketchClosedInPixels(
          overlay.type,
          overlay.sketchSeed ?? 1,
          overlay.width * display.width,
          overlay.height * display.height,
          overlay.strokeWidth,
        )
        const points = sourcePoints.map((point) => displayPointToPdf({
          x: overlay.x * display.width + point.x,
          y: overlay.y * display.height + point.y,
        }, pageWidth, pageHeight, quarterTurn))
        for (let index = 1; index < points.length; index += 1) {
          if (sourcePoints[index]?.move) continue
          page.drawLine({ start: points[index - 1], end: points[index],
            thickness: overlay.strokeWidth, color, opacity: overlay.opacity,
            lineCap: LineCapStyle.Round })
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
        const lineHeight = fontSize * (overlay.extracted ? EXTRACTED_LINE_HEIGHT : 1.15)
        let lines: string[]
        if (overlay.extracted) {
          // Same wrap the editor previewed, so the file matches the screen.
          lines = layoutExtractedLines(
            text,
            overlay.width * display.width,
            fontSize,
            (value, size) => font.widthOfTextAtSize(value, size),
          )
        } else if (text.includes('\n')) {
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
        // A line can carry more than one ink, such as a red mark on a black label.
        const inked =
          overlay.extracted && overlay.colorSegments
            ? normalizeColoredText(
                overlay.text ?? '',
                segmentsToColors(overlay.colorSegments),
              )
            : null
        const inkedLines = inked ? lineColorSegments(inked.text, inked.colors, lines) : null
        const drawPiece = (
          value: string,
          textX: number,
          textY: number,
          fill = color,
          size = fontSize,
        ) => {
          const anchor = displayPointToPdf(
            { x: textX, y: textY },
            pageWidth,
            pageHeight,
            quarterTurn,
          )
          page.drawText(value, {
            x: anchor.x,
            y: anchor.y,
            size,
            font,
            color: fill,
            opacity: overlay.opacity,
            rotate: degrees(rotation),
          })
        }
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (!line) continue
          const baseX = overlay.x * display.width + pad.x
          const baseY = overlay.y * display.height + pad.y + fontSize + index * lineHeight
          const pieces = inkedLines?.[index]
          if (pieces && pieces.length > 0) {
            let offset = 0
            for (const piece of pieces) {
              const [pieceRed, pieceGreen, pieceBlue] = colorComponents(piece.color)
              drawPiece(piece.text, baseX + offset, baseY, rgb(pieceRed, pieceGreen, pieceBlue))
              offset += font.widthOfTextAtSize(piece.text, fontSize)
            }
          } else {
            drawPiece(line, baseX, baseY)
          }
        }
      } else if (overlay.type === 'highlight') {
        page.drawRectangle({
          ...rect,
          color,
          opacity: overlay.opacity,
        })
      } else if (overlay.type === 'redaction') {
        page.drawRectangle({
          ...rect,
          color: rgb(0, 0, 0),
          opacity: 1,
        })
      } else if (overlay.type === 'rectangle') {
        const fillHex = closedShapeFill(overlay)
        const fillColor = fillHex
          ? rgb(...colorComponents(fillHex))
          : undefined
        page.drawRectangle({
          ...rect,
          color: fillColor,
          opacity: fillColor ? overlay.opacity : undefined,
          borderColor: color,
          borderWidth: overlay.strokeWidth,
          borderOpacity: overlay.opacity,
        })
      } else if (overlay.type === 'ellipse') {
        const fillHex = closedShapeFill(overlay)
        const fillColor = fillHex
          ? rgb(...colorComponents(fillHex))
          : undefined
        page.drawEllipse({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          xScale: rect.width / 2,
          yScale: rect.height / 2,
          color: fillColor,
          opacity: fillColor ? overlay.opacity : undefined,
          borderColor: color,
          borderWidth: overlay.strokeWidth,
          borderOpacity: overlay.opacity,
        })
      } else if (overlay.type === 'diamond') {
        const corners = diamondPdfCorners(overlay, pageWidth, pageHeight, quarterTurn)
        const fillHex = closedShapeFill(overlay)
        if (fillHex) {
          const path = diamondPath(corners)
          if (path) {
            page.drawSvgPath(path, {
              color: rgb(...colorComponents(fillHex)),
              opacity: overlay.opacity,
            })
          }
        }
        for (let index = 0; index < corners.length; index += 1) {
          page.drawLine({
            start: corners[index],
            end: corners[(index + 1) % corners.length],
            thickness: overlay.strokeWidth,
            color,
            opacity: overlay.opacity,
          })
        }
      } else if (overlay.type === 'line' || overlay.type === 'arrow') {
        const display = displayDimensions(pageWidth, pageHeight, quarterTurn)
        const [startLocal, endLocal] = lineEndpoints(overlay)
        const startDisplay = overlayDisplayPoint(
          overlay,
          startLocal,
          display.width,
          display.height,
        )
        const endDisplay = overlayDisplayPoint(
          overlay,
          endLocal,
          display.width,
          display.height,
        )
        const drawPdfLine = (
          from: { x: number; y: number },
          to: { x: number; y: number },
        ) => {
          page.drawLine({
            start: displayPointToPdf(from, pageWidth, pageHeight, quarterTurn),
            end: displayPointToPdf(to, pageWidth, pageHeight, quarterTurn),
            thickness: overlay.strokeWidth,
            color,
            opacity: overlay.opacity,
            lineCap: LineCapStyle.Round,
          })
        }
        const head =
          overlay.type === 'arrow'
            ? arrowHeadPolygon(
                startDisplay,
                endDisplay,
                arrowHeadSize(overlay.strokeWidth),
              )
            : null
        const shaftEnd = head?.neck ?? endDisplay
        if (overlay.sketch) {
          const sketched = sketchLineBetween(
            startDisplay,
            shaftEnd,
            overlay.sketchSeed ?? 1,
            lineSketchRoughness(overlay.strokeWidth),
          )
          for (const stroke of sketchStrokes(sketched)) {
            for (let index = 1; index < stroke.length; index += 1) {
              const previous = stroke[index - 1]
              const current = stroke[index]
              if (previous && current) drawPdfLine(previous, current)
            }
          }
        } else {
          drawPdfLine(startDisplay, shaftEnd)
        }
        if (head) {
          const left = displayPointToPdf(head.left, pageWidth, pageHeight, quarterTurn)
          const tip = displayPointToPdf(head.tip, pageWidth, pageHeight, quarterTurn)
          const right = displayPointToPdf(head.right, pageWidth, pageHeight, quarterTurn)
          page.drawSvgPath(
            `M ${left.x} ${left.y} L ${tip.x} ${tip.y} L ${right.x} ${right.y} Z`,
            { color, opacity: overlay.opacity },
          )
        }
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
