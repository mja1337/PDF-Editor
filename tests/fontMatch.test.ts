import { describe, expect, it } from 'vitest'
import { classifyPdfFont, cssFontFamily } from '../src/pdf/fontMatch'

describe('classifyPdfFont', () => {
  it('maps Times and serif generics to regular serif', () => {
    expect(classifyPdfFont('Times-Bold')).toEqual({
      role: 'serif',
      weight: 700,
      italic: false,
    })
    expect(classifyPdfFont('Times-Italic')).toEqual({
      role: 'serif',
      weight: 400,
      italic: true,
    })
    expect(classifyPdfFont('g_d0_f1', '"Times New Roman", serif')).toMatchObject({
      role: 'serif',
    })
  })

  it('maps Helvetica and Arial to sans, Courier to mono, and keeps bold italic', () => {
    expect(classifyPdfFont('Helvetica')).toEqual({
      role: 'sans',
      weight: 400,
      italic: false,
    })
    expect(classifyPdfFont('Arial-BoldItalicMT')).toEqual({
      role: 'sans',
      weight: 700,
      italic: true,
    })
    expect(classifyPdfFont('CourierNewPS-BoldMT')).toEqual({
      role: 'mono',
      weight: 700,
      italic: false,
    })
  })

  it('does not treat sans-serif as serif', () => {
    expect(classifyPdfFont('ABCDEF+Custom', 'sans-serif')).toEqual({
      role: 'sans',
      weight: 400,
      italic: false,
    })
  })

  it('uses metric-compatible system stacks on screen', () => {
    expect(cssFontFamily('serif')).toContain('Times New Roman')
    expect(cssFontFamily('sans')).toContain('Arial')
    expect(cssFontFamily('mono')).toContain('Courier New')
  })
})
