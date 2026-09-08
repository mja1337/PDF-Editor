import { describe, expect, it } from 'vitest'
import { createDefaultOverlay, createDrawnOverlay, createLineMark, hitExtractedLine } from '../src/domain/overlays'
import { lineEndpoints, overlayHitsPoint, pagePoint } from '../src/pdf/shapeGeometry'
import { sketchArrowPoints, sketchRectPoints, sketchStrokes } from '../src/pdf/sketch'

describe('new overlays', () => {
  it('creates Arial Black text instead of red bold type', () => {
    const overlay = createDefaultOverlay('text', 0.4, 0.4, '#e05252')
    expect(overlay).toMatchObject({
      type: 'text',
      color: '#111111',
      fontWeight: 900,
      fontRole: 'sans',
      wordArt: 'plain',
    })
    expect(overlay.fontSize).toBe(22)
  })

  it('creates sketchy shapes with local path points', () => {
    const box = createDefaultOverlay('rectangle', 0.5, 0.5, '#e05252')
    expect(box.sketch).toBe(true)
    expect(box.points?.length).toBeGreaterThan(6)
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
})
