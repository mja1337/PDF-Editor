import type { OverlayType, PageOverlay } from './document'
import { normalizeOverlay } from './document'
import {
  boxFromCorners,
  boxFromSegment,
  clampPoint,
  constrainDrag,
  isLinearOverlay,
  lineEndpoints,
  localPoint,
  pagePoint,
  topmostOverlayAt,
  type PagePoint,
} from '../pdf/shapeGeometry'

const SKETCH_TYPES = new Set<OverlayType>([
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'diamond',
])

export type OverlayDrawOptions = {
  id?: string
  sketchSeed?: number
  strokeWidth?: number
  fill?: boolean
}

export function isClosedDrawShape(type: OverlayType) {
  return type === 'rectangle' || type === 'ellipse' || type === 'diamond'
}

export function closedShapeFill(overlay: PageOverlay) {
  return isClosedDrawShape(overlay.type) ? overlay.backgroundColor : undefined
}

function sketchSeed() {
  return Math.floor(Math.random() * 1_000_000)
}

export function nextSketchSeed() {
  return sketchSeed()
}

export function createDefaultOverlay(
  type: OverlayType,
  x: number,
  y: number,
  color: string,
  options?: OverlayDrawOptions,
): PageOverlay {
  const sizes: Record<OverlayType, { width: number; height: number }> = {
    text: { width: 0.1, height: 0.036 },
    highlight: { width: 0.34, height: 0.055 },
    underline: { width: 0.34, height: 0.035 },
    strikeout: { width: 0.34, height: 0.045 },
    rectangle: { width: 0.27, height: 0.16 },
    ellipse: { width: 0.24, height: 0.15 },
    line: { width: 0.22, height: 0.02 },
    arrow: { width: 0.24, height: 0.02 },
    diamond: { width: 0.2, height: 0.16 },
    ink: { width: 0.3, height: 0.15 },
    image: { width: 0.3, height: 0.15 },
    redaction: { width: 0.34, height: 0.06 },
  }
  const size = sizes[type]
  const isRedaction = type === 'redaction'
  const sketch = !isRedaction && SKETCH_TYPES.has(type)
  const seed = sketch ? (options?.sketchSeed ?? sketchSeed()) : options?.sketchSeed
  const isText = type === 'text'
  const fill =
    isRedaction
      ? '#000000'
      : options?.fill && isClosedDrawShape(type)
        ? color
        : undefined
  return normalizeOverlay({
    id: options?.id ?? crypto.randomUUID(),
    type,
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
    color: isRedaction ? '#000000' : isText ? '#111111' : color,
    opacity: isRedaction ? 1 : type === 'highlight' ? 0.42 : 0.95,
    strokeWidth: isRedaction ? 0 : options?.strokeWidth ?? (sketch ? 1.25 : 2),
    backgroundColor: fill,
    text: isText ? 'Add text' : undefined,
    fontSize: isText ? 22 : undefined,
    fontRole: isText ? 'sans' : undefined,
    fontWeight: isText ? 900 : undefined,
    sketch,
    sketchSeed: seed,
    points: isLinearOverlay(type)
      ? [
          { x: 0.03, y: 0.5 },
          { x: 0.97, y: 0.5 },
        ]
      : undefined,
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
  colorSegments?: PageOverlay['colorSegments']
  scanned?: boolean
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
    fontWeight: run.fontWeight === 900 ? 900 : run.fontWeight === 700 ? 700 : 400,
    fontItalic: run.fontItalic ?? false,
    extracted: true,
    edited: false,
    scanned: Boolean(run.scanned),
    cover: false,
    backgroundColor: run.backgroundColor ?? '#ffffff',
    colorSegments: run.colorSegments,
    source: { width: run.width, height: run.height, fontSize: run.fontSize },
  })
}

export function applyLineEndpoints(
  overlay: PageOverlay,
  start: PagePoint,
  end: PagePoint,
): PageOverlay {
  const from = clampPoint(start)
  const to = clampPoint(end)
  const box = boxFromSegment(from, to)
  const localStart = localPoint(from, box)
  const localEnd = localPoint(to, box)
  const seed = overlay.sketchSeed ?? sketchSeed()
  return normalizeOverlay({
    ...overlay,
    ...box,
    sketchSeed: overlay.sketch ? seed : overlay.sketchSeed,
    points: isLinearOverlay(overlay.type)
      ? [localStart, localEnd]
      : overlay.points,
  })
}

export function createDrawnOverlay(
  type: OverlayType,
  start: PagePoint,
  end: PagePoint,
  color: string,
  options?: OverlayDrawOptions & {
    shift?: boolean
    pageAspect?: number
  },
): PageOverlay {
  const from = clampPoint(start)
  const to = constrainDrag(type, from, end, Boolean(options?.shift), options?.pageAspect ?? 1)
  if (isLinearOverlay(type)) {
    const template = createDefaultOverlay(type, from.x, from.y, color, options)
    return applyLineEndpoints(template, from, to)
  }
  const box = boxFromCorners(from, to)
  const overlay = createDefaultOverlay(type, from.x, from.y, color, options)
  return normalizeOverlay({
    ...overlay,
    ...box,
  })
}

export function pageEndpoints(overlay: PageOverlay): [PagePoint, PagePoint] {
  const [start, end] = lineEndpoints(overlay)
  return [pagePoint(start, overlay), pagePoint(end, overlay)]
}

export function createInkOverlay(
  points: Array<{ x: number; y: number }>,
  color: string,
  strokeWidth: number,
  pageSize?: { width: number; height: number },
): PageOverlay {
  const left = Math.min(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y))
  const right = Math.max(...points.map((point) => point.x))
  const bottom = Math.max(...points.map((point) => point.y))
  const padX = pageSize ? Math.max(4, strokeWidth * 2) / Math.max(1, pageSize.width) : 0.004
  const padY = pageSize ? Math.max(4, strokeWidth * 2) / Math.max(1, pageSize.height) : 0.004
  let x = left - padX
  let y = top - padY
  let width = right - left + padX * 2
  let height = bottom - top + padY * 2
  if (x < 0) {
    width += x
    x = 0
  }
  if (y < 0) {
    height += y
    y = 0
  }
  width = Math.max(padX * 2, Math.min(1 - x, width))
  height = Math.max(padY * 2, Math.min(1 - y, height))
  return normalizeOverlay({
    id: crypto.randomUUID(),
    type: 'ink',
    x,
    y,
    width,
    height,
    color,
    strokeWidth,
    opacity: 1,
    points: points.map((point) => ({
      x: (point.x - x) / width,
      y: (point.y - y) / height,
    })),
  })
}

export function liveInkOverlay(
  points: Array<{ x: number; y: number }>,
  color: string,
  strokeWidth: number,
): PageOverlay {
  return {
    id: 'ink-live',
    type: 'ink',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    color,
    strokeWidth,
    opacity: 1,
    points,
  }
}

export function hitExtractedLine(
  overlays: PageOverlay[],
  x: number,
  y: number,
  padding = 0.012,
) {
  return overlays.find(
    (overlay) =>
      overlay.extracted &&
      overlay.type === 'text' &&
      x >= overlay.x - padding &&
      x <= overlay.x + overlay.width + padding &&
      y >= overlay.y - padding &&
      y <= overlay.y + overlay.height + padding,
  )
}

export function extractedLineAtPoint(
  overlays: PageOverlay[],
  point: PagePoint,
  pageWidth: number,
  pageHeight: number,
) {
  const hit = topmostOverlayAt(overlays, point, pageWidth, pageHeight, {
    includeExtracted: true,
  })
  if (hit?.extracted && hit.type === 'text') return hit
  return hitExtractedLine(overlays, point.x, point.y)
}

export function createLineMark(
  type: 'highlight' | 'underline' | 'strikeout',
  line: PageOverlay,
  color: string,
  strokeWidth = 2,
): PageOverlay {
  const pad = type === 'highlight' ? 0.004 : 0
  return normalizeOverlay({
    id: crypto.randomUUID(),
    type,
    x: Math.max(0, line.x - pad),
    y: Math.max(0, line.y - pad),
    width: Math.min(1, line.width + pad * 2),
    height: Math.min(1, line.height + pad * 2),
    color,
    opacity: type === 'highlight' ? 0.42 : 0.95,
    strokeWidth: type === 'highlight' ? 1 : strokeWidth,
  })
}

export function withSketchStyle(overlay: PageOverlay, sketch: boolean): Partial<PageOverlay> {
  const type = overlay.type
  if (
    type !== 'rectangle' &&
    type !== 'ellipse' &&
    type !== 'line' &&
    type !== 'arrow' &&
    type !== 'diamond'
  ) {
    return { sketch }
  }
  if (!sketch) {
    if (isLinearOverlay(type)) {
      const [start, end] = lineEndpoints(overlay)
      return { sketch: false, points: [start, end] }
    }
    return { sketch: false }
  }
  const seed = overlay.sketchSeed ?? sketchSeed()
  if (isLinearOverlay(type)) {
    const [start, end] = lineEndpoints(overlay)
    return {
      sketch: true,
      sketchSeed: seed,
      points: [start, end],
    }
  }
  return {
    sketch: true,
    sketchSeed: seed,
    points: undefined,
  }
}

export function matchingLineMark(
  overlays: PageOverlay[],
  type: 'highlight' | 'underline' | 'strikeout',
  line: PageOverlay,
) {
  return overlays.find(
    (overlay) =>
      overlay.type === type &&
      !overlay.extracted &&
      Math.abs(overlay.x - line.x) < 0.012 &&
      Math.abs(overlay.y - line.y) < 0.012 &&
      Math.abs(overlay.width - line.width) < 0.02 &&
      Math.abs(overlay.height - line.height) < 0.02,
  )
}
