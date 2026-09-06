import type { OverlayType, PageOverlay } from './document'
import { normalizeOverlay } from './document'

export function createDefaultOverlay(
  type: OverlayType,
  x: number,
  y: number,
  color: string,
): PageOverlay {
  const sizes: Record<OverlayType, { width: number; height: number }> = {
    text: { width: 0.34, height: 0.075 },
    highlight: { width: 0.34, height: 0.055 },
    underline: { width: 0.34, height: 0.035 },
    strikeout: { width: 0.34, height: 0.045 },
    rectangle: { width: 0.27, height: 0.16 },
    ellipse: { width: 0.24, height: 0.15 },
    line: { width: 0.27, height: 0.12 },
    ink: { width: 0.3, height: 0.15 },
    image: { width: 0.3, height: 0.15 },
  }
  const size = sizes[type]
  return normalizeOverlay({
    id: crypto.randomUUID(),
    type,
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
    color: type === 'highlight' ? '#f4d35e' : color,
    opacity: type === 'highlight' ? 0.42 : 0.95,
    strokeWidth: 2,
    text: type === 'text' ? 'Add text' : undefined,
    fontSize: type === 'text' ? 18 : undefined,
  })
}

export function createExtractedOverlay(run: {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontRole?: PageOverlay['fontRole']
  fontWeight?: PageOverlay['fontWeight']
  fontItalic?: boolean
  color?: string
  backgroundColor?: string
}): PageOverlay {
  return normalizeOverlay({
    id: crypto.randomUUID(),
    type: 'text',
    x: run.x,
    y: run.y,
    width: run.width,
    height: run.height,
    color: run.color ?? '#000000',
    opacity: 1,
    strokeWidth: 1,
    text: run.text,
    fontSize: run.fontSize,
    fontRole: run.fontRole ?? 'sans',
    fontWeight: run.fontWeight ?? 400,
    fontItalic: run.fontItalic ?? false,
    extracted: true,
    edited: false,
    cover: false,
    backgroundColor: run.backgroundColor ?? '#ffffff',
  })
}

export function createInkOverlay(
  points: Array<{ x: number; y: number }>,
  color: string,
  strokeWidth: number,
): PageOverlay {
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const width = Math.max(0.01, Math.max(...points.map((point) => point.x)) - left)
  const height = Math.max(0.01, Math.max(...points.map((point) => point.y)) - top)
  const x = Math.min(left, 1 - width)
  const y = Math.min(top, 1 - height)
  return normalizeOverlay({
    id: crypto.randomUUID(), type: 'ink', x, y, width, height,
    color, strokeWidth, opacity: 1,
    points: points.map((point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })),
  })
}
