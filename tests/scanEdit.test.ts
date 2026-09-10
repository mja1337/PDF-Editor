import { describe, expect, it } from 'vitest'
import { createExtractedOverlay } from '../src/domain/overlays'
import {
  canFlattenScanEdits,
  coverBox,
  isScannedTextEdit,
  pageHasScannedEdits,
} from '../src/pdf/scanEdit'

describe('scanned text edits', () => {
  it('expands the cover beyond the tight OCR box so original ink does not leak through', () => {
    const box = coverBox({ x: 0.2, y: 0.4, width: 0.3, height: 0.04 })
    expect(box.x).toBeLessThan(0.2)
    expect(box.y).toBeLessThan(0.4)
    expect(box.width).toBeGreaterThan(0.3)
    expect(box.height).toBeGreaterThan(0.04)
    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThanOrEqual(1)
  })

  it('never paints over the lines above or below in a tight block', () => {
    const row = (id: string, y: number) =>
      createExtractedOverlay({
        text: id,
        x: 0.1,
        y,
        width: 0.3,
        height: 0.028,
        fontSize: 12,
        scanned: true,
      })
    // Measured boxes that already overlap, as analysed before pitch trimming.
    const above = row('above', 0.1)
    const middle = row('middle', 0.12)
    const below = row('below', 0.14)
    const box = coverBox(middle, [above, middle, below])

    expect(box.y).toBeGreaterThanOrEqual(above.y + above.height / 2)
    expect(box.y + box.height).toBeLessThanOrEqual(below.y + below.height / 2)
    // It still covers the body of the line it belongs to. Clipping a measured
    // box that overlaps its neighbours is the safer failure: leaving a glyph
    // tip is recoverable, erasing the next line is not.
    const centre = middle.y + middle.height / 2
    expect(box.y).toBeLessThan(centre)
    expect(box.y + box.height).toBeGreaterThan(centre)
  })

  it('only flattens OCR replacements, not ordinary typed notes', () => {
    const scanned = createExtractedOverlay({
      text: 'TESCO STORES 3842',
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.03,
      fontSize: 11,
      scanned: true,
    })
    const edited = { ...scanned, edited: true, cover: true }
    const note = createExtractedOverlay({
      text: 'Leave me',
      x: 0.1,
      y: 0.3,
      width: 0.2,
      height: 0.03,
      fontSize: 11,
    })
    expect(isScannedTextEdit(edited)).toBe(true)
    expect(isScannedTextEdit(scanned)).toBe(false)
    expect(isScannedTextEdit({ ...note, edited: true })).toBe(false)
    expect(pageHasScannedEdits([edited, note])).toBe(true)
    expect(canFlattenScanEdits()).toBe(false)
  })
})
