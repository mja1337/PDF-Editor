import type { PageOverlay } from '../domain/document'
import { cssFontFamily } from './fontMatch'
import { pitchBand } from './textGeometry'
import {
  EXTRACTED_LINE_HEIGHT,
  layoutExtractedLines,
  normalizeExtractedText,
} from './extractedTextFit'
import {
  lineColorSegments,
  normalizeColoredText,
  segmentsToColors,
  type ColorSegment,
} from './inkSegments'

export type CoverBox = {
  x: number
  y: number
  width: number
  height: number
}

export function isScannedTextEdit(overlay: PageOverlay) {
  return overlay.type === 'text' && Boolean(overlay.extracted && overlay.edited && overlay.scanned)
}

export function pageHasScannedEdits(overlays: PageOverlay[]) {
  return overlays.some(isScannedTextEdit)
}

export function canFlattenScanEdits() {
  return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
}

/** Bleed that hides ascenders and descenders of the covered line. */
const COVER_BLEED = 0.16

/**
 * The rectangle painted over an original line before its replacement is drawn.
 * It is clipped to the band between the neighbouring baselines, so a tight
 * block such as an address never has its other rows wiped out -- including in
 * documents analysed before line boxes were trimmed to their pitch.
 */
export function coverBox(
  overlay: Pick<PageOverlay, 'x' | 'y' | 'width' | 'height'>,
  neighbours: ReadonlyArray<PageOverlay> = [],
): CoverBox {
  const band = pitchBand(
    overlay,
    neighbours.filter((other) => other.extracted && other !== overlay),
  )
  const bleed = overlay.height * COVER_BLEED
  const top = Math.max(0, band.top, overlay.y - bleed)
  const bottom = Math.min(1, band.bottom, overlay.y + overlay.height + bleed)
  const padX = Math.min(
    Math.max(overlay.height * 0.12, overlay.width * 0.01),
    overlay.x,
  )
  const x = Math.max(0, overlay.x - padX)
  return {
    x,
    y: top,
    width: Math.min(1 - x, overlay.width + padX * 2),
    height: Math.max(0, bottom - top),
  }
}

function fillPaper(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  paper: string,
) {
  context.save()
  context.fillStyle = paper
  context.fillRect(x, y, width, height)
  const stripHeight = Math.max(2, Math.min(height * 0.28, y * 0.9))
  const stripY = Math.max(0, y - stripHeight - 1)
  if (stripHeight >= 2 && width >= 2 && y > 2) {
    context.globalAlpha = 0.72
    context.drawImage(source, x, stripY, width, stripHeight, x, y, width, height)
  }
  context.restore()
}

function scanFont(overlay: PageOverlay, sizePx: number) {
  const weight = overlay.fontWeight ?? 400
  const italic = overlay.fontItalic ? 'italic' : 'normal'
  return `${italic} ${weight} ${sizePx}px ${cssFontFamily(overlay.fontRole ?? 'sans', weight)}`
}

export function paintScannedEdits(
  canvas: HTMLCanvasElement,
  overlays: PageOverlay[],
  renderScale: number,
) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return
  const width = canvas.width
  const height = canvas.height
  const source = canvas
  for (const overlay of overlays) {
    if (!isScannedTextEdit(overlay)) continue
    const box = coverBox(overlay, overlays)
    const x = box.x * width
    const y = box.y * height
    const boxWidth = box.width * width
    const boxHeight = box.height * height
    if (boxWidth < 2 || boxHeight < 2) continue
    const paper = overlay.backgroundColor ?? '#f3eee4'
    fillPaper(context, source, x, y, boxWidth, boxHeight, paper)

    const text = normalizeExtractedText(overlay.text || '')
    if (!text) continue
    const size = Math.max(5, (overlay.fontSize ?? boxHeight) * renderScale)
    const padX = Math.max(1, size * 0.08)
    const padY = Math.max(1, size * 0.14)
    const textX = overlay.x * width + padX
    context.save()
    context.beginPath()
    context.rect(x, y, boxWidth, boxHeight)
    context.clip()
    context.filter = 'blur(0.45px)'
    context.fillStyle = overlay.color || '#1a1a1a'
    context.textAlign = 'left'
    context.font = scanFont(overlay, size)
    const lines = layoutExtractedLines(
      text,
      overlay.width * width,
      size,
      (value, fontSize) => {
        context.font = scanFont(overlay, fontSize)
        return context.measureText(value).width
      },
    )
    context.font = scanFont(overlay, size)
    const inked = overlay.colorSegments
      ? normalizeColoredText(overlay.text ?? '', segmentsToColors(overlay.colorSegments))
      : null
    const inkedLines = inked ? lineColorSegments(inked.text, inked.colors, lines) : null
    const paintLine = (
      line: string,
      pieces: ColorSegment[] | undefined,
      lineY: number,
    ) => {
      if (!pieces || pieces.length === 0) {
        context.fillStyle = overlay.color || '#1a1a1a'
        context.fillText(line, textX, lineY)
        return
      }
      let offset = 0
      for (const piece of pieces) {
        context.fillStyle = piece.color
        context.fillText(piece.text, textX + offset, lineY)
        offset += context.measureText(piece.text).width
      }
    }
    if (lines.length === 1) {
      context.textBaseline = 'middle'
      paintLine(lines[0] ?? '', inkedLines?.[0], y + boxHeight / 2)
    } else {
      context.textBaseline = 'top'
      let textY = overlay.y * height + padY
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (line) paintLine(line, inkedLines?.[index], textY)
        textY += size * EXTRACTED_LINE_HEIGHT
      }
    }
    context.restore()
  }
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.78) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (file) => (file ? resolve(file) : reject(new Error('Could not encode the scanned page.'))),
      'image/jpeg',
      quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function flattenScannedPageEdits(
  sourceBytes: Uint8Array,
  sourcePageIndex: number,
  rotationDelta: number,
  overlays: PageOverlay[],
  openPassword?: string,
): Promise<Uint8Array | null> {
  if (!canFlattenScanEdits() || !pageHasScannedEdits(overlays)) return null
  const { openPdfBytes } = await import('./engine')
  const session = await openPdfBytes(sourceBytes.slice(), { password: openPassword })
  try {
    const page = await session.viewer.getPage(sourcePageIndex + 1)
    const rotation = (page.rotate + rotationDelta + 360) % 360
    const base = page.getViewport({ scale: 1, rotation })
    const scale = Math.min(2.2, 1800 / Math.max(base.width, base.height, 1))
    const viewport = page.getViewport({ scale, rotation })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return null
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: '#ffffff',
    }).promise
    paintScannedEdits(canvas, overlays, scale)
    const jpeg = await canvasToJpeg(canvas)
    canvas.width = 0
    canvas.height = 0
    return jpeg
  } finally {
    await session.viewer.loadingTask.destroy()
  }
}
