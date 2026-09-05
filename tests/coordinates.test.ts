import { describe, expect, it } from 'vitest'
import type { PageOverlay, QuarterTurn } from '../src/domain/document'
import {
  displayDimensions,
  displayPointToPdf,
  overlayToPdfRect,
} from '../src/pdf/coordinates'

const overlay: PageOverlay = {
  id: 'box',
  type: 'rectangle',
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.25,
  color: '#ff0000',
  opacity: 1,
  strokeWidth: 2,
}

describe('PDF coordinate transforms', () => {
  it.each([0, 90, 180, 270] as QuarterTurn[])(
    'keeps normalized rectangles inside the page at %s degrees',
    (rotation) => {
      const rect = overlayToPdfRect(overlay, 600, 800, rotation)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(600)
      expect(rect.y + rect.height).toBeLessThanOrEqual(800)
    },
  )

  it('maps every rotated display corner back to the PDF page', () => {
    for (const rotation of [0, 90, 180, 270] as QuarterTurn[]) {
      const display = displayDimensions(600, 800, rotation)
      const corners = [
        { x: 0, y: 0 },
        { x: display.width, y: 0 },
        { x: 0, y: display.height },
        { x: display.width, y: display.height },
      ].map((point) => displayPointToPdf(point, 600, 800, rotation))
      expect(new Set(corners.map((point) => `${point.x}:${point.y}`))).toEqual(
        new Set(['0:0', '0:800', '600:0', '600:800']),
      )
    }
  })

  it('returns exact bounding boxes for each quarter turn', () => {
    expect(overlayToPdfRect(overlay, 600, 800, 0)).toEqual({
      x: 60,
      y: 440,
      width: 180,
      height: 200,
    })
    expect(overlayToPdfRect(overlay, 600, 800, 90)).toEqual({
      x: 120,
      y: 80,
      width: 150,
      height: 240,
    })
    expect(overlayToPdfRect(overlay, 600, 800, 180)).toEqual({
      x: 360,
      y: 160,
      width: 180,
      height: 200,
    })
    expect(overlayToPdfRect(overlay, 600, 800, 270)).toEqual({
      x: 330,
      y: 480,
      width: 150,
      height: 240,
    })
  })
})
