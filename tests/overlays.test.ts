import { describe, expect, it } from 'vitest'
import { createDefaultOverlay, createDrawnOverlay, createInkOverlay, createLineMark, extractedLineAtPoint, hitExtractedLine } from '../src/domain/overlays'
import { lineEndpoints, overlayHitsPoint, pagePoint, topmostOverlayAt } from '../src/pdf/shapeGeometry'
import { sketchArrowPoints, sketchClosedInPixels, sketchRectPoints, sketchStrokes } from '../src/pdf/sketch'

describe('new overlays', () => {
  it('creates Arial Black text instead of red bold type', () => {
    const overlay = createDefaultOverlay('text', 0.4, 0.4, '#e05252')
    expect(overlay).toMatchObject({
      type: 'text',
      color: '#111111',
      fontWeight: 900,
      fontRole: 'sans',
    })
    expect(overlay.fontSize).toBe(22)
  })

  it('creates sketchy shapes with a seed instead of stretching unit paths', () => {
    const box = createDefaultOverlay('rectangle', 0.5, 0.5, '#e05252')
    expect(box.sketch).toBe(true)
    expect(box.sketchSeed).toBeTypeOf('number')
    expect(box.points).toBeUndefined()
    expect(sketchStrokes(sketchRectPoints(3))).toHaveLength(4)
    expect(sketchStrokes(sketchArrowPoints(4)).length).toBeGreaterThanOrEqual(3)
    const [top, right] = sketchStrokes(sketchRectPoints(11))
    const topEnd = top?.at(-1)
    const rightStart = right?.[0]
    expect(topEnd && rightStart).toBeTruthy()
    if (topEnd && rightStart) {
      const gap = Math.hypot(topEnd.x - rightStart.x, topEnd.y - rightStart.y)
      expect(gap).toBeGreaterThan(0.002)
      expect(gap).toBeLessThan(0.08)
    }
  })

  it('finds analysed lines for highlight tools from the topmost hit', () => {
    const line = createDefaultOverlay('text', 0.2, 0.4, '#111111')
    const extracted = { ...line, extracted: true, edited: true, text: 'Quarterly planning notes' }
    const box = createDrawnOverlay('rectangle', { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, '#e05252')
    const hit = extractedLineAtPoint(
      [box, extracted],
      { x: extracted.x + extracted.width / 2, y: extracted.y + extracted.height / 2 },
      800,
      1000,
    )
    expect(hit?.id).toBe(extracted.id)
  })

  it('keeps closed-shape sketch wobble in pixels when the box is resized', () => {
    const compact = sketchClosedInPixels('rectangle', 11, 120, 120, 2)
    const wide = sketchClosedInPixels('rectangle', 11, 480, 120, 2)
    expect(Math.abs((compact[0]?.x ?? 0) - (wide[0]?.x ?? 0))).toBeLessThan(10)
    expect(wide.some((point) => point.x > 350)).toBe(true)
    expect(compact.every((point) => point.x <= 130 && point.y <= 130)).toBe(true)
  })

  it('draws a line from the drag start to the drag end', () => {
    const line = createDrawnOverlay('line', { x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }, '#e05252')
    expect(line.type).toBe('line')
    expect(line.width).toBeGreaterThan(0.5)
    expect(line.height).toBeLessThan(0.05)
    const [start, end] = lineEndpoints(line)
    const from = pagePoint(start, line)
    const to = pagePoint(end, line)
    expect(from.x).toBeCloseTo(0.2, 2)
    expect(to.x).toBeCloseTo(0.8, 2)
    expect(from.y).toBeCloseTo(0.4, 2)
    expect(to.y).toBeCloseTo(0.4, 2)
  })

  it('places a horizontal line when clicked rather than a diagonal box', () => {
    const line = createDefaultOverlay('line', 0.5, 0.4, '#e05252')
    const [start, end] = lineEndpoints(line)
    expect(Math.abs(start.y - end.y)).toBeLessThan(0.05)
    expect(Math.abs(end.x - start.x)).toBeGreaterThan(0.7)
  })

  it('snaps dragged boxes to squares', () => {
    const box = createDrawnOverlay(
      'rectangle',
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.25 },
      '#e05252',
      { shift: true, pageAspect: 0.7 },
    )
    const visualWidth = box.width * 0.7
    expect(Math.abs(visualWidth - box.height)).toBeLessThan(0.02)
  })

  it('snaps dragged lines to 45 degree increments', () => {
    const line = createDrawnOverlay(
      'line',
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.21 },
      '#e05252',
      { shift: true },
    )
    const [start, end] = lineEndpoints(line)
    const from = pagePoint(start, line)
    const to = pagePoint(end, line)
    expect(Math.abs(to.y - from.y)).toBeLessThan(0.02)
  })

  it('snaps a highlight to an extracted line', () => {
    const line = createDefaultOverlay('text', 0.2, 0.2, '#111111')
    line.extracted = true
    line.x = 0.1
    line.y = 0.15
    line.width = 0.4
    line.height = 0.05
    expect(hitExtractedLine([line], 0.2, 0.17)?.id).toBe(line.id)
    const mark = createLineMark('highlight', line, '#e05252')
    expect(mark.type).toBe('highlight')
    expect(mark.color).toBe('#e05252')
    expect(mark.width).toBeGreaterThanOrEqual(line.width)
  })

  it('keeps the chosen stroke width and fill on drawn boxes', () => {
    const box = createDrawnOverlay(
      'rectangle',
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.45 },
      '#3b82f6',
      { strokeWidth: 4, fill: true, sketchSeed: 1 },
    )
    expect(box.strokeWidth).toBe(4)
    expect(box.backgroundColor).toBe('#3b82f6')
  })
})

describe('overlay hit testing', () => {
  it('hits a horizontal line along the stroke, not the empty bounding box', () => {
    const line = createDrawnOverlay('line', { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, '#e05252')
    expect(overlayHitsPoint(line, { x: 0.5, y: 0.5 }, 800, 1000)).toBe(true)
    expect(overlayHitsPoint(line, { x: 0.5, y: 0.2 }, 800, 1000, 4)).toBe(false)
  })

  it('hits ellipses and diamonds as their geometry, not the corner of the box', () => {
    const ellipse = createDrawnOverlay('ellipse', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }, '#e05252')
    const diamond = createDrawnOverlay('diamond', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }, '#e05252')
    expect(overlayHitsPoint(ellipse, { x: 0.4, y: 0.4 }, 800, 1000)).toBe(true)
    expect(overlayHitsPoint(diamond, { x: 0.4, y: 0.4 }, 800, 1000)).toBe(true)
    expect(overlayHitsPoint(ellipse, { x: 0.21, y: 0.21 }, 800, 1000, 4)).toBe(false)
    expect(overlayHitsPoint(diamond, { x: 0.21, y: 0.21 }, 800, 1000, 4)).toBe(false)
  })

  it('hits ink along the stroke instead of the empty bounding box', () => {
    const ink = createInkOverlay(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
      ],
      '#e05252',
      2,
    )
    expect(overlayHitsPoint(ink, { x: 0.5, y: 0.5 }, 800, 1000)).toBe(true)
    expect(overlayHitsPoint(ink, { x: 0.75, y: 0.25 }, 800, 1000, 4)).toBe(false)
  })

  it('keeps a freehand stroke’s box tight instead of inflating it to a square', () => {
    const ink = createInkOverlay(
      [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      '#e05252',
      2,
      { width: 800, height: 1000 },
    )
    expect(ink.width).toBeGreaterThan(0.7)
    expect(ink.height).toBeLessThan(0.03)
  })

  it('returns the topmost overlay at a point', () => {
    const box = createDrawnOverlay('rectangle', { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, '#e05252')
    const line = createDrawnOverlay('line', { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, '#111111')
    expect(topmostOverlayAt([box, line], { x: 0.5, y: 0.5 }, 800, 1000)?.id).toBe(line.id)
    expect(topmostOverlayAt([box, line], { x: 0.5, y: 0.2 }, 800, 1000)?.id).toBe(box.id)
  })
})
