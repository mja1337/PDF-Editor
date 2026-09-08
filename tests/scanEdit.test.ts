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
