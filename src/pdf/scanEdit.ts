import type { PageOverlay } from '../domain/document'
import { cssFontFamily } from './fontMatch'
import { wrapTextToWidth } from './textLayout'

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

export function coverBox(
  overlay: Pick<PageOverlay, 'x' | 'y' | 'width' | 'height'>,
): CoverBox {
  const padY = overlay.height * 0.42
  const padX = Math.max(overlay.height * 0.28, overlay.width * 0.01)
  const x = Math.max(0, overlay.x - padX)
  const y = Math.max(0, overlay.y - padY)
  return {
    x,
    y,
    width: Math.min(1 - x, overlay.width + padX * 2),
    height: Math.min(1 - y, overlay.height + padY * 2),
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
    const box = coverBox(overlay)
    const x = box.x * width
    const y = box.y * height
    const boxWidth = box.width * width
    const boxHeight = box.height * height
    if (boxWidth < 2 || boxHeight < 2) continue
    const paper = overlay.backgroundColor ?? '#f3eee4'
    fillPaper(context, source, x, y, boxWidth, boxHeight, paper)

    const text = (overlay.text || '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const size = Math.max(5, (overlay.fontSize ?? boxHeight) * renderScale)
    const padX = Math.max(1, size * 0.08)
    const padY = Math.max(1, size * 0.14)
    const textX = overlay.x * width + padX
    const maxWidth = Math.max(4, overlay.width * width - padX * 2)
    context.save()
    context.beginPath()
    context.rect(x, y, boxWidth, boxHeight)
    context.clip()
    context.filter = 'blur(0.45px)'
    context.fillStyle = overlay.color || '#1a1a1a'
    context.textAlign = 'left'
    context.font = scanFont(overlay, size)
    const fitsOnLine = context.measureText(text).width <= maxWidth
    if (fitsOnLine) {
      context.textBaseline = 'middle'
      context.fillText(text, textX, y + boxHeight / 2)
    } else {
      context.textBaseline = 'top'
      const lines = wrapTextToWidth(text, maxWidth, (value) => context.measureText(value).width)
      let textY = overlay.y * height + padY
      for (const line of lines) {
        if (line) context.fillText(line, textX, textY)
        textY += size
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
): Promise<Uint8Array | null> {
  if (!canFlattenScanEdits() || !pageHasScannedEdits(overlays)) return null
  const { openPdfBytes } = await import('./engine')
  const session = await openPdfBytes(sourceBytes.slice())
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
