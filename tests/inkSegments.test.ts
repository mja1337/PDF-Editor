import { describe, expect, it } from 'vitest'
import {
  colorsToSegments,
  dominantColor,
  hasDistinctInk,
  inkDistance,
  lineColorSegments,
  normalizeColoredText,
  remapSegments,
  segmentsToColors,
} from '../src/pdf/inkSegments'

const BLACK = '#141414'
const RED = '#d62828'

/** "Full name *" with the asterisk printed in red. */
const label = 'Full name *'
const labelSegments = [
  { text: 'Full name ', color: BLACK },
  { text: '*', color: RED },
]

describe('ink comparison', () => {
  it('separates a red mark from black body text', () => {
    expect(inkDistance(BLACK, RED)).toBeGreaterThan(90)
    expect(inkDistance(BLACK, '#151617')).toBeLessThan(90)
    expect(hasDistinctInk([BLACK, BLACK, RED])).toBe(true)
    expect(hasDistinctInk([BLACK, '#151617'])).toBe(false)
    expect(hasDistinctInk([])).toBe(false)
  })

  it('picks the ink most characters use', () => {
    expect(dominantColor([BLACK, BLACK, BLACK, RED], '#000000')).toBe(BLACK)
    expect(dominantColor([], '#000000')).toBe('#000000')
  })
})

describe('segment round trip', () => {
  it('expands and recombines without changing the text', () => {
    const colors = segmentsToColors(labelSegments)
    expect(colors).toHaveLength(label.length)
    expect(colors[colors.length - 1]).toBe(RED)
    expect(colorsToSegments(label, colors)).toEqual(labelSegments)
  })
})

describe('remapSegments', () => {
  it('keeps the red asterisk when the words before it are rewritten', () => {
    const next = remapSegments(label, labelSegments, 'Customer name *', BLACK)
    expect(next).toEqual([
      { text: 'Customer name ', color: BLACK },
      { text: '*', color: RED },
    ])
  })

  it('keeps a leading mark when the text after it changes', () => {
    const starred = [
      { text: '*', color: RED },
      { text: ' Required field', color: BLACK },
    ]
    const next = remapSegments('* Required field', starred, '* Must be completed', BLACK)
    expect(next?.[0]).toEqual({ text: '*', color: RED })
    expect(next?.[1]?.color).toBe(BLACK)
  })

  it('gives newly typed text the dominant ink', () => {
    const next = remapSegments(label, labelSegments, 'Full name and title *', BLACK)
    expect(segmentsToColors(next ?? []).slice(0, 20).every((c) => c === BLACK)).toBe(true)
    expect(next?.[next.length - 1]).toEqual({ text: '*', color: RED })
  })

  it('drops segments when the mark is deleted', () => {
    expect(remapSegments(label, labelSegments, 'Full name', BLACK)).toBeUndefined()
    expect(remapSegments(label, labelSegments, '', BLACK)).toBeUndefined()
  })

  it('refuses to guess when the stored segments do not match the text', () => {
    expect(remapSegments('mismatched', labelSegments, 'anything', BLACK)).toBeUndefined()
  })
})

describe('lineColorSegments', () => {
  it('carries colour onto each wrapped line', () => {
    const text = 'Full name and address *'
    const colors = Array.from(text).map((_, index) =>
      index === text.length - 1 ? RED : BLACK,
    )
    const lines = ['Full name and', 'address *']
    const perLine = lineColorSegments(text, colors, lines)
    expect(perLine[0]).toEqual([{ text: 'Full name and', color: BLACK }])
    expect(perLine[1]).toEqual([
      { text: 'address ', color: BLACK },
      { text: '*', color: RED },
    ])
    expect(perLine.map((segments) => segments.map((s) => s.text).join(''))).toEqual(lines)
  })
})

describe('normalizeColoredText', () => {
  it('collapses whitespace and keeps colours on the surviving characters', () => {
    const text = '  Full   name  * '
    const colors = Array.from(text).map((character) =>
      character === '*' ? RED : BLACK,
    )
    const normalized = normalizeColoredText(text, colors)
    expect(normalized.text).toBe('Full name *')
    expect(normalized.colors).toHaveLength(normalized.text.length)
    expect(normalized.colors[normalized.text.indexOf('*')]).toBe(RED)
    expect(colorsToSegments(normalized.text, normalized.colors)).toEqual([
      { text: 'Full name ', color: BLACK },
      { text: '*', color: RED },
    ])
  })
})
