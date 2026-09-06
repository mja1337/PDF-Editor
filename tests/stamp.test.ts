import { describe, expect, it } from 'vitest'
import { parsePreferences } from '../src/domain/preferences'
import { stampDisplayRect } from '../src/pdf/stamp'

describe('logo stamp', () => {
  it('places a top-right stamp inside the page margin', () => {
    const box = stampDisplayRect(
      { corner: 'top-right', size: 0.2 },
      200,
      300,
      2,
    )
    expect(box.width).toBeCloseTo(40)
    expect(box.height).toBeCloseTo(20)
    expect(box.x + box.width).toBeLessThan(200)
    expect(box.y).toBeGreaterThan(0)
    expect(box.x).toBeGreaterThan(100)
  })

  it('reads a saved stamp and rejects malformed storage', () => {
    const imageData = 'data:image/png;base64,aaaa'
    expect(
      parsePreferences(
        JSON.stringify({
          stamp: { imageData, corner: 'bottom-left', size: 0.2, opacity: 0.8 },
        }),
      ).stamp,
    ).toMatchObject({ corner: 'bottom-left', size: 0.2, opacity: 0.8 })
    expect(parsePreferences('{"stamp":{"corner":"top-left"}}').stamp).toBeNull()
    expect(parsePreferences('not-json').stamp).toBeNull()
  })
})
