import { describe, expect, it } from 'vitest'
import { createDefaultOverlay, createLineMark, hitExtractedLine } from '../src/domain/overlays'
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
    expect(mark.color).toBe('#f4d35e')
    expect(mark.width).toBeGreaterThanOrEqual(line.width)
  })
})
