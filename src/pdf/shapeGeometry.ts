import type { OverlayType, PageOverlay } from '../domain/document'
import { sketchStrokes } from './sketch'

export type PagePoint = { x: number; y: number }
export type BoxHandle = 'nw' | 'ne' | 'sw' | 'se'
export type LineHandle = 'start' | 'end'

export const MIN_OVERLAY_SIZE = 0.01
export const CLICK_DRAG_THRESHOLD_PX = 8

const LINEAR_TYPES = new Set<OverlayType>(['line', 'arrow'])
const BOX_SHAPE_TYPES = new Set<OverlayType>([
  'rectangle',
  'ellipse',
  'diamond',
  'highlight',
  'underline',
  'strikeout',
  'image',
])

export function isLinearOverlay(type: OverlayType): type is 'line' | 'arrow' {
  return LINEAR_TYPES.has(type)
}

export function isBoxShapeOverlay(type: OverlayType) {
  return BOX_SHAPE_TYPES.has(type)
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function clampPoint(point: PagePoint): PagePoint {
  return { x: clamp01(point.x), y: clamp01(point.y) }
}

function sign(value: number) {
  return value < 0 ? -1 : 1
}

export function snapAngle(start: PagePoint, end: PagePoint): PagePoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return clampPoint(end)
  const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return clampPoint({
    x: start.x + Math.cos(snapped) * length,
    y: start.y + Math.sin(snapped) * length,
  })
}

export function snapSquare(
  start: PagePoint,
  end: PagePoint,
  pageAspect: number,
): PagePoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const aspect = pageAspect > 0 ? pageAspect : 1
  const visualX = Math.abs(dx) * aspect
  const visualY = Math.abs(dy)
  if (visualX > visualY) {
    return clampPoint({
      x: end.x,
      y: start.y + sign(dy) * visualX,
    })
  }
  return clampPoint({
    x: start.x + sign(dx) * (visualY / aspect),
    y: end.y,
  })
}

export function boxFromCorners(a: PagePoint, b: PagePoint) {
  const width = Math.max(MIN_OVERLAY_SIZE, Math.abs(b.x - a.x))
  const height = Math.max(MIN_OVERLAY_SIZE, Math.abs(b.y - a.y))
  return {
    x: clamp01(Math.min(a.x, b.x)),
    y: clamp01(Math.min(a.y, b.y)),
    width: Math.min(1, width),
    height: Math.min(1, height),
  }
}

export function boxFromSegment(a: PagePoint, b: PagePoint) {
  const rawWidth = Math.abs(b.x - a.x)
  const rawHeight = Math.abs(b.y - a.y)
  const width = Math.max(MIN_OVERLAY_SIZE, rawWidth)
  const height = Math.max(MIN_OVERLAY_SIZE, rawHeight)
  let x = Math.min(a.x, b.x)
  let y = Math.min(a.y, b.y)
  if (rawWidth < MIN_OVERLAY_SIZE) x -= (MIN_OVERLAY_SIZE - rawWidth) / 2
  if (rawHeight < MIN_OVERLAY_SIZE) y -= (MIN_OVERLAY_SIZE - rawHeight) / 2
  x = Math.max(0, Math.min(1 - width, x))
  y = Math.max(0, Math.min(1 - height, y))
  return { x, y, width, height }
}

export function localPoint(
  point: PagePoint,
  box: Pick<PageOverlay, 'height' | 'width' | 'x' | 'y'>,
): PagePoint {
  return {
    x: box.width === 0 ? 0.5 : (point.x - box.x) / box.width,
    y: box.height === 0 ? 0.5 : (point.y - box.y) / box.height,
  }
}

export function pagePoint(
  point: PagePoint,
  box: Pick<PageOverlay, 'height' | 'width' | 'x' | 'y'>,
): PagePoint {
  return {
    x: box.x + point.x * box.width,
    y: box.y + point.y * box.height,
  }
}

export function lineEndpoints(
  overlay: Pick<PageOverlay, 'points' | 'sketch' | 'type'>,
): [PagePoint, PagePoint] {
  const points = overlay.points ?? []
  if (points.length >= 2) {
    if (overlay.type === 'arrow' && overlay.sketch) {
      const shaft = sketchStrokes(points)[0]
      if (shaft && shaft.length >= 2) {
        return [shaft[0], shaft.at(-1)!]
      }
    }
    return [points[0], points.at(-1)!]
  }
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
}

export function constrainDrag(
  type: OverlayType,
  start: PagePoint,
  end: PagePoint,
  shift: boolean,
  pageAspect: number,
) {
  if (!shift) return clampPoint(end)
  if (isLinearOverlay(type)) return snapAngle(start, end)
  if (type === 'rectangle' || type === 'ellipse' || type === 'diamond') {
    return snapSquare(start, end, pageAspect)
  }
  return clampPoint(end)
}

export function resizeOverlayBox(
  origin: PageOverlay,
  handle: BoxHandle,
  pointer: PagePoint,
  shift: boolean,
  pageAspect: number,
) {
  const corners = {
    nw: { x: origin.x, y: origin.y },
    ne: { x: origin.x + origin.width, y: origin.y },
    sw: { x: origin.x, y: origin.y + origin.height },
    se: { x: origin.x + origin.width, y: origin.y + origin.height },
  }
  const opposite: Record<BoxHandle, BoxHandle> = {
    nw: 'se',
    ne: 'sw',
    sw: 'ne',
    se: 'nw',
  }
  const fixed = corners[opposite[handle]]
  const moving = constrainDrag(origin.type, fixed, pointer, shift, pageAspect)
  return boxFromCorners(fixed, moving)
}

export function arrowHeadPolygon(
  from: PagePoint,
  to: PagePoint,
  size: number,
): { left: PagePoint; right: PagePoint; tip: PagePoint; neck: PagePoint } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  const spread = size * 0.55
  return {
    tip: to,
    neck: { x: to.x - ux * size * 0.62, y: to.y - uy * size * 0.62 },
    left: {
      x: to.x - ux * size + px * spread,
      y: to.y - uy * size + py * spread,
    },
    right: {
      x: to.x - ux * size - px * spread,
      y: to.y - uy * size - py * spread,
    },
  }
}

export function overlayDisplayPoint(
  overlay: Pick<PageOverlay, 'height' | 'width' | 'x' | 'y'>,
  local: PagePoint,
  displayWidth: number,
  displayHeight: number,
): PagePoint {
  return {
    x: (overlay.x + local.x * overlay.width) * displayWidth,
    y: (overlay.y + local.y * overlay.height) * displayHeight,
  }
}

export function arrowHeadSize(strokeWidth: number) {
  return Math.max(11, strokeWidth * 3.3)
}

export function lineSketchRoughness(strokeWidth: number) {
  return Math.max(2.6, strokeWidth * 0.95)
}

export function distanceToSegment(point: PagePoint, start: PagePoint, end: PagePoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2))
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t))
}

export function overlayHitsPoint(
  overlay: PageOverlay,
  point: PagePoint,
  pageWidth: number,
  pageHeight: number,
  paddingPx = 12,
): boolean {
  const pointer = { x: point.x * pageWidth, y: point.y * pageHeight }
  if (isLinearOverlay(overlay.type)) {
    const [start, end] = lineEndpoints(overlay)
    const from = overlayDisplayPoint(overlay, start, pageWidth, pageHeight)
    const to = overlayDisplayPoint(overlay, end, pageWidth, pageHeight)
    return distanceToSegment(pointer, from, to) <= paddingPx + Math.max(2, overlay.strokeWidth) * 2
  }
  if (overlay.type === 'ink' && overlay.points && overlay.points.length > 1) {
    const threshold = paddingPx + Math.max(2, overlay.strokeWidth) * 2
    for (let index = 1; index < overlay.points.length; index += 1) {
      const previous = overlay.points[index - 1]
      const current = overlay.points[index]
      if (!previous || !current || current.move) continue
      if (
        distanceToSegment(
          pointer,
          overlayDisplayPoint(overlay, previous, pageWidth, pageHeight),
          overlayDisplayPoint(overlay, current, pageWidth, pageHeight),
        ) <= threshold
      ) {
        return true
      }
    }
    return false
  }
  const padX = paddingPx / pageWidth
  const padY = paddingPx / pageHeight
  return (
    point.x >= overlay.x - padX &&
    point.x <= overlay.x + overlay.width + padX &&
    point.y >= overlay.y - padY &&
    point.y <= overlay.y + overlay.height + padY
  )
}
