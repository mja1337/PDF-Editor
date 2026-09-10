import { describe, expect, it } from 'vitest'
import { samplePatch } from '../src/pdf/pageSample'
import {
  clampBoxesToPitch,
  groupTextRuns,
  pitchBand,
  type ExtractedTextRun,
} from '../src/pdf/textGeometry'
import {
  caretIndexAtX,
  fitOverlayToText,
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

  it('grows a text note toward the page margin, then wraps', () => {
    expect(wrapTextToWidth('one two three', 75, measure)).toEqual([
      'one two',
      'three',
    ])
    expect(wrapTextToWidth('supercalifragilistic', 50, measure)[0]?.length).toBeLessThanOrEqual(5)

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
    const compact = fitOverlayToText(
      { x: 0.1, y: 0.2, width: 0.38, height: 0.09, fontSize: 22 },
      'Hi',
      1000,
      1400,
      1,
      measure,
    )
    expect(compact.width).toBeLessThan(0.12)
    expect(compact.height).toBeLessThan(0.05)
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

describe('line pitch', () => {
  /** 12pt type on 14pt leading: run heights include ascenders and descenders,
   * so the measured boxes overlap their neighbours before any editing. */
  function block(pitch: number, height: number) {
    return [0, 1, 2, 3].map((row) => ({
      id: `row-${row}`,
      x: 0.1,
      y: 0.1 + row * pitch,
      width: 0.3,
      height,
    }))
  }

  it('gives each line the band halfway to its neighbours', () => {
    const rows = block(0.02, 0.028)
    // Centres sit at 0.114, 0.134, 0.154, so the middle line owns 0.124-0.144.
    const band = pitchBand(rows[1], rows)
    expect(band.top).toBeCloseTo(0.124, 5)
    expect(band.bottom).toBeCloseTo(0.144, 5)
  })

  it('trims overlapping boxes so a tight block stops colliding', () => {
    const rows = block(0.02, 0.028)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].y).toBeLessThan(rows[i - 1].y + rows[i - 1].height)
    }
    const trimmed = clampBoxesToPitch(rows)
    for (let i = 1; i < trimmed.length; i += 1) {
      expect(trimmed[i].y).toBeGreaterThanOrEqual(
        trimmed[i - 1].y + trimmed[i - 1].height - 1e-9,
      )
    }
    // The line keeps as much of its measured box as the pitch allows.
    expect(trimmed[1].height).toBeCloseTo(0.02, 5)
  })

  it('leaves generous leading untouched', () => {
    const rows = block(0.06, 0.028)
    expect(clampBoxesToPitch(rows)).toEqual(rows)
  })

  it('does not let a second column trim the first', () => {
    const left = { id: 'l', x: 0.1, y: 0.1, width: 0.3, height: 0.028 }
    const right = { id: 'r', x: 0.55, y: 0.104, width: 0.3, height: 0.028 }
    expect(clampBoxesToPitch([left, right])).toEqual([left, right])
  })

  it('keeps a box whose neighbours would collapse it', () => {
    // A tall block boxed in above and below by runs measured almost on its own
    // centre: trimming would leave almost nothing, so leave the measurement be.
    const tall = { id: 'tall', x: 0.1, y: 0.1, width: 0.3, height: 0.1 }
    const boxed = [
      { id: 'above', x: 0.1, y: 0.13, width: 0.3, height: 0.02 },
      tall,
      { id: 'below', x: 0.1, y: 0.15, width: 0.3, height: 0.02 },
    ]
    expect(clampBoxesToPitch(boxed)[1]).toEqual(tall)
  })
})
