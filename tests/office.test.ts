import { describe, expect, it } from 'vitest'
import { isOfficeFile, parsePages, pdfName, officeProgress } from '../src/office/conversion'

describe('Office import', () => {
  it('recognizes all four formats without relying on MIME types', () => {
    for (const name of ['Report.DOCX', 'Report.doc', 'Deck.PPTX', 'Deck.ppt']) expect(isOfficeFile({ name })).toBe(true)
    for (const name of ['file.pdf', 'report.docx.exe', 'deck.pptm']) expect(isOfficeFile({ name })).toBe(false)
    expect(pdfName('Quarterly.report.docx')).toBe('Quarterly.report.pdf')
  })
  it('selects pages in requested order without duplicates', () => {
    expect(parsePages(' 3, 1-2, 3 ', 4)).toEqual([2, 0, 1])
    expect(parsePages(' ', 4)).toBeUndefined()
  })
  it('rejects invalid, out of bounds and unbounded ranges', () => {
    for (const range of ['0', '3-1', '1,', 'one', '1.2', '999999999999']) expect(() => parsePages(range, 4)).toThrow()
    expect(() => parsePages('1-999999999')).toThrow()
    expect(() => parsePages('5', 4)).toThrow('between 1 and 4')
  })
})


describe('Office conversion progress', () => {
  it('distinguishes importing slides from exporting the PDF', () => {
    expect(officeProgress('convert', 30)?.stage).toBe('loading the document pages / slides')
    expect(officeProgress('convert', 70)?.stage).toBe('exporting the PDF')
    expect(officeProgress('convert', 90)?.stage).toBe('reading the converted PDF')
  })
  it('does not treat engine startup percentages as conversion progress', () => {
    expect(officeProgress('init', 70)).toBeUndefined()
    expect(officeProgress('convert', '70')).toBeUndefined()
    expect(officeProgress('convert', Number.NaN)).toBeUndefined()
  })
})
