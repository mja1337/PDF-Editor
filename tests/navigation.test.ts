import { describe, expect, it } from 'vitest'
import { createEditorDocument } from '../src/domain/document'
import type { PageOverlay } from '../src/domain/document'
import {
  findAllMatchIndices,
  overlaySearchText,
  pageSearchSegments,
  splitExcerptHighlight,
} from '../src/pdf/navigation'

describe('overlaySearchText', () => {
  it('includes analysed and text-box overlay content', () => {
    const overlays: PageOverlay[] = [
      {
        id: 'a',
        type: 'text',
        extracted: true,
        scanned: true,
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.05,
        color: '#123456',
        opacity: 1,
        strokeWidth: 2,
        text: 'Invoice total £420.00',
      },
      {
        id: 'b',
        type: 'highlight',
        x: 0.1,
        y: 0.3,
        width: 0.4,
        height: 0.04,
        color: '#ffff00',
        opacity: 0.5,
        strokeWidth: 2,
      },
      {
        id: 'c',
        type: 'text',
        x: 0.2,
        y: 0.4,
        width: 0.3,
        height: 0.05,
        color: '#123456',
        opacity: 1,
        strokeWidth: 2,
        text: 'Notes from OCR',
      },
    ]
    expect(overlaySearchText(overlays)).toContain('Invoice total £420.00')
    expect(overlaySearchText(overlays)).toContain('Notes from OCR')
  })

  it('returns empty text when no searchable overlays exist', () => {
    const document = createEditorDocument('empty.pdf', 100, 1, 'empty')
    expect(overlaySearchText(document.pages[0].overlays)).toBe('')
  })
})

describe('findAllMatchIndices', () => {
  it('finds every non-overlapping match in text', () => {
    expect(findAllMatchIndices('foo bar foo baz foo', 'foo')).toEqual([0, 8, 16])
  })

  it('matches case-insensitively', () => {
    expect(findAllMatchIndices('Hello HELLO hello', 'hello')).toEqual([0, 6, 12])
  })

  it('returns an empty list for blank queries', () => {
    expect(findAllMatchIndices('anything', '   ')).toEqual([])
  })
})

describe('pageSearchSegments', () => {
  it('keeps native text and overlays as separate segments', () => {
    const overlays: PageOverlay[] = [
      {
        id: 'text-1',
        type: 'text',
        extracted: true,
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.05,
        color: '#123456',
        opacity: 1,
        strokeWidth: 2,
        text: 'Overlay copy',
      },
    ]
    const segments = pageSearchSegments('Native layer', overlays)
    expect(segments).toEqual([
      { text: 'Native layer' },
      { text: 'Overlay copy', overlayId: 'text-1' },
    ])
  })
})

describe('splitExcerptHighlight', () => {
  it('wraps the matched substring for rendering', () => {
    expect(splitExcerptHighlight('…Invoice total £420.00…', 'total')).toEqual({
      before: '…Invoice ',
      match: 'total',
      after: ' £420.00…',
    })
  })
})
