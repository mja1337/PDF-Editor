import { describe, expect, it } from 'vitest'
import { createSignatureOverlay } from '../src/pdf/signatureImage'

describe('createSignatureOverlay', () => {
  it('centers the signature on the click point', () => {
    const overlay = createSignatureOverlay('data:image/png;base64,abc', 3, { x: 0.5, y: 0.6 }, 0.7)
    expect(overlay.signature).toBe(true)
    expect(overlay.x + overlay.width / 2).toBeCloseTo(0.5, 2)
    expect(overlay.y + overlay.height / 2).toBeCloseTo(0.6, 2)
  })

  it('keeps the signature inside the page bounds', () => {
    const overlay = createSignatureOverlay('data:image/png;base64,abc', 3, { x: 0.02, y: 0.02 }, 1)
    expect(overlay.x).toBeGreaterThanOrEqual(0)
    expect(overlay.y).toBeGreaterThanOrEqual(0)
    expect(overlay.x + overlay.width).toBeLessThanOrEqual(1)
    expect(overlay.y + overlay.height).toBeLessThanOrEqual(1)
  })
})
