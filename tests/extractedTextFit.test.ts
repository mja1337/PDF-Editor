import { describe, expect, it } from 'vitest'
import type { PageOverlay } from '../src/domain/document'
import {
  MIN_FONT_SCALE,
  extractedFitBounds,
  fitExtractedText,
  layoutExtractedLines,
  normalizeExtractedText,
} from '../src/pdf/extractedTextFit'

const PAGE = 1000

/** Every glyph is half an em wide, so widths are exact and easy to reason about. */
const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5

function line(partial: Partial<PageOverlay> & Pick<PageOverlay, 'id'>): PageOverlay {
  return {
    type: 'text',
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.04,
    color: '#000000',
    opacity: 1,
    strokeWidth: 1,
    extracted: true,
    fontSize: 20,
    ...partial,
  } as PageOverlay
}

describe('extractedFitBounds', () => {
  it('falls back to the page margin with nothing in the way', () => {
    const bounds = extractedFitBounds(line({ id: 'a' }), [])
    expect(bounds.maxRight).toBeCloseTo(0.97, 5)
    expect(bounds.maxBottom).toBeCloseTo(0.97, 5)
  })

  it('stops before the next line to the right on the same row', () => {
    const subject = line({ id: 'a' })
    const bounds = extractedFitBounds(subject, [
      subject,
      line({ id: 'b', x: 0.55, y: 0.105, width: 0.3 }),
    ])
    expect(bounds.maxRight).toBeCloseTo(0.546, 5)
    expect(bounds.maxBottom).toBeCloseTo(0.97, 5)
  })

  it('stops before the line below in an address block', () => {
    const subject = line({ id: 'a' })
    const bounds = extractedFitBounds(subject, [
      line({ id: 'above', y: 0.04 }),
      line({ id: 'below', y: 0.16 }),
    ])
    expect(bounds.maxBottom).toBeCloseTo(0.156, 5)
  })

  it('ignores annotations and lines that do not share a row or column', () => {
    const subject = line({ id: 'a' })
    const bounds = extractedFitBounds(subject, [
      line({ id: 'shape', type: 'rectangle', extracted: false, x: 0.5, y: 0.105 }),
      line({ id: 'far', x: 0.5, y: 0.6 }),
    ])
    expect(bounds.maxRight).toBeCloseTo(0.97, 5)
    expect(bounds.maxBottom).toBeCloseTo(0.97, 5)
  })
})

describe('fitExtractedText', () => {
  const bounds = { maxRight: 0.97, maxBottom: 0.97 }

  it('keeps the original box and size when the text still fits', () => {
    const overlay = line({ id: 'a', width: 0.3, fontSize: 20 })
    const fit = fitExtractedText({
      overlay,
      text: 'Short',
      bounds,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(fit.fontSize).toBe(20)
    expect(fit.lines).toEqual(['Short'])
    expect(fit.overflow).toBe(false)
    expect(fit.width).toBeCloseTo(0.3, 5)
    expect(fit.height).toBeCloseTo(0.04, 5)
  })

  it('grows to the right rather than clipping', () => {
    const overlay = line({ id: 'a', width: 0.1, fontSize: 20 })
    const fit = fitExtractedText({
      overlay,
      text: 'A considerably longer replacement',
      bounds,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(fit.lines).toHaveLength(1)
    expect(fit.fontSize).toBe(20)
    expect(fit.width).toBeGreaterThan(0.1)
    expect(overlay.x + fit.width).toBeLessThanOrEqual(bounds.maxRight + 1e-9)
  })

  it('never grows past the line below', () => {
    const overlay = line({ id: 'a', x: 0.1, y: 0.1, width: 0.3, height: 0.04 })
    const tight = { maxRight: 0.45, maxBottom: 0.16 }
    const fit = fitExtractedText({
      overlay,
      text: 'Flat 4b Kingsmead House Apartment 12 Riverside Walk',
      bounds: tight,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(overlay.y + fit.height).toBeLessThanOrEqual(tight.maxBottom + 1e-9)
    expect(overlay.x + fit.width).toBeLessThanOrEqual(tight.maxRight + 1e-9)
  })

  it('shrinks the type when the free space runs out', () => {
    const overlay = line({ id: 'a', x: 0.1, y: 0.1, width: 0.2, height: 0.03, fontSize: 20 })
    const tight = { maxRight: 0.35, maxBottom: 0.13 }
    const fit = fitExtractedText({
      overlay,
      text: 'Considerably more text than the original line ever held',
      bounds: tight,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(fit.fontSize).toBeLessThan(20)
    expect(fit.fontSize).toBeGreaterThanOrEqual(20 * MIN_FONT_SCALE - 1e-9)
  })

  it('reports overflow instead of silently dropping text', () => {
    const overlay = line({ id: 'a', x: 0.1, y: 0.1, width: 0.05, height: 0.02, fontSize: 20 })
    const tight = { maxRight: 0.15, maxBottom: 0.12 }
    const text = 'Far too much text for a box this small to hold at any size at all'
    const fit = fitExtractedText({
      overlay,
      text,
      bounds: tight,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(fit.overflow).toBe(true)
    expect(fit.fontSize).toBeCloseTo(20 * MIN_FONT_SCALE, 5)
    expect(fit.lines.join(' ')).toContain('Far too much')
  })

  it('shrinks back to the analysed box when text is deleted again', () => {
    const grown = line({
      id: 'a',
      width: 0.8,
      height: 0.12,
      fontSize: 14,
      source: { width: 0.3, height: 0.04, fontSize: 20 },
    })
    const fit = fitExtractedText({
      overlay: grown,
      text: 'Short',
      bounds,
      pageWidth: PAGE,
      pageHeight: PAGE,
      measure,
    })
    expect(fit.width).toBeCloseTo(0.3, 5)
    expect(fit.height).toBeCloseTo(0.04, 5)
    expect(fit.fontSize).toBe(20)
  })
})

describe('layoutExtractedLines', () => {
  it('collapses source whitespace and keeps one line when it fits', () => {
    expect(normalizeExtractedText('  Sort   code:  20-00-00 ')).toBe('Sort code: 20-00-00')
    expect(layoutExtractedLines('Sort   code', 400, 20, measure)).toEqual(['Sort code'])
  })

  it('breaks on words when it does not', () => {
    const lines = layoutExtractedLines('one two three four five six', 100, 20, measure)
    expect(lines.length).toBeGreaterThan(1)
    for (const value of lines) expect(measure(value, 20)).toBeLessThanOrEqual(100)
  })
})
