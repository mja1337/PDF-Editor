import { describe, expect, it } from 'vitest'
import { previewTargetWidth, stepCustomZoom, zoomRatioFromPreview } from '../src/pdf/pageView'

describe('page preview zoom', () => {
  it('keeps fit-width size until custom zoom is applied', () => {
    expect(previewTargetWidth('width', 1.5, 900)).toBe(772)
    expect(previewTargetWidth('custom', 1.5, 900)).toBe(Math.round(772 * 1.5))
  })

  it('steps zoom from the current preview ratio so fit-page can enlarge in place', () => {
    const ratio = zoomRatioFromPreview(400, 900)
    expect(stepCustomZoom(ratio, 1)).toBeGreaterThan(ratio)
    expect(stepCustomZoom(1, 1)).toBe(1.25)
    expect(stepCustomZoom(0.5, -1)).toBe(0.5)
  })
})
