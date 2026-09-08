import { describe, expect, it } from 'vitest'
import { samplePatch } from '../src/pdf/pageSample'
import { groupTextRuns, type ExtractedTextRun } from '../src/pdf/textGeometry'
import {
  caretIndexAtX,
  fitOverlayToText,
  overlayAtPageMargin,
  overlayFontPx,
  PAGE_EDGE_MARGIN,
  wrapTextToWidth,
} from '../src/pdf/textLayout'

function run(
  text: string,
  x: number,
  y: number,
  width = 0.08,
  height = 0.03,
  fontSize = 12,
): ExtractedTextRun {
  return { text, x, y, width, height, fontSize }
}

describe('groupTextRuns', () => {
  it('merges adjacent glyphs on the same baseline into one editable line', () => {
    const grouped = groupTextRuns([
      run('Hello', 0.1, 0.2),
      run('world', 0.19, 0.2),
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]?.text).toBe('Hello world')
    expect(grouped[0]?.x).toBeLessThan(0.1)
    expect(grouped[0]?.width).toBeGreaterThan(0.16)
  })

  it('keeps distant same-row fragments as separate blocks', () => {
    const grouped = groupTextRuns([
      run('Left', 0.05, 0.2),
      run('Right', 0.7, 0.2),
    ])
    expect(grouped.map((item) => item.text)).toEqual(['Left', 'Right'])
  })

  it('does not merge stacked lines', () => {
    const grouped = groupTextRuns([
      run('Title', 0.1, 0.1),
      run('Body', 0.1, 0.22),
    ])
    expect(grouped.map((item) => item.text)).toEqual(['Title', 'Body'])
  })

  it('keeps the dominant font face when merging a line', () => {
    const grouped = groupTextRuns([
      {
        ...run('Hello', 0.1, 0.2, 0.12),
        fontRole: 'serif',
        fontWeight: 700,
        fontItalic: true,
      },
      {
        ...run('world', 0.23, 0.2, 0.04),
        fontRole: 'sans',
        fontWeight: 400,
        fontItalic: false,
      },
    ])
    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      fontRole: 'serif',
      fontWeight: 700,
      fontItalic: true,
    })
  })
})

const measure = (text: string) => text.length * 10

describe('text layout', () => {
  it('places the caret at the nearest glyph from a click', () => {
    expect(caretIndexAtX('Hello', 0, measure)).toBe(0)
    expect(caretIndexAtX('Hello', 15, measure)).toBe(2)
    expect(caretIndexAtX('Hello', 48, measure)).toBe(5)
  })

  it('grows extracted replacements toward the page margin, then wraps', () => {
    expect(wrapTextToWidth('one two three', 75, measure)).toEqual([
      'one two',
      'three',
    ])
    expect(wrapTextToWidth('supercalifragilistic', 50, measure)[0]?.length).toBeLessThanOrEqual(5)

    const grown = fitOverlayToText(
      { x: 0.1, y: 0.2, width: 0.2, height: 0.04, fontSize: 12, extracted: true },
      'This replacement is much longer than the original run',
      1000,
      1400,
      1,
      measure,
    )
    expect(grown.width).toBeGreaterThan(0.2)
    expect(grown.width).toBeLessThan(1 - PAGE_EDGE_MARGIN - 0.1 + 1e-6)
    expect(grown.height).toBeCloseTo(0.04)
    expect(overlayAtPageMargin({ x: 0.1, ...grown })).toBe(false)

    const wrapped = fitOverlayToText(
      { x: 0.1, y: 0.2, width: 0.2, height: 0.03, fontSize: 12, extracted: true },
      'x'.repeat(400),
      1000,
      1400,
      1,
      measure,
    )
    expect(wrapped.width).toBeCloseTo(1 - PAGE_EDGE_MARGIN - 0.1)
    expect(wrapped.height).toBeGreaterThan(0.03)
    expect(overlayAtPageMargin({ x: 0.1, ...wrapped })).toBe(true)

    const note = fitOverlayToText(
      { x: 0.1, y: 0.2, width: 0.2, height: 0.04, fontSize: 12 },
      'This new note can grow',
      1000,
      1400,
      1,
      measure,
    )
    expect(note.width).toBeGreaterThan(0.2)
    expect(note.width).toBeLessThanOrEqual(1 - PAGE_EDGE_MARGIN - 0.1 + 1e-6)
  })

  it('keeps the original box when the replacement is shorter', () => {
    const fitted = fitOverlayToText(
      { x: 0.1, y: 0.2, width: 0.4, height: 0.05, fontSize: 12, extracted: true },
      'Hi',
      1000,
      1400,
      1,
      measure,
    )
    expect(fitted.width).toBeCloseTo(0.4, 5)
    expect(fitted.height).toBeCloseTo(0.05, 5)
  })

  it('scales overlay type with the page preview instead of clamping to 8px', () => {
    expect(overlayFontPx({ fontSize: 14 }, 0.25)).toBeCloseTo(3.5, 5)
    expect(overlayFontPx({ fontSize: 14 }, 0.25)).toBeLessThan(8)
  })
})

describe('page sample', () => {
  it('reads ink and background colours from a rendered patch', () => {
    const width = 40
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4)
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 210
      data[index + 1] = 32
      data[index + 2] = 32
      data[index + 3] = 255
    }
    for (let y = 6; y < 14; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        const index = (y * width + x) * 4
        data[index] = 248
        data[index + 1] = 248
        data[index + 2] = 248
      }
    }
    const sampled = samplePatch({ data, width, height })
    expect(sampled.backgroundColor).toMatch(/^#d2/i)
    expect(Number.parseInt(sampled.color.slice(1, 3), 16)).toBeGreaterThan(180)
  })
})
