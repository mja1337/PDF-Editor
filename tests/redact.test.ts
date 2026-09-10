import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createEditorDocument } from '../src/domain/document'
import { exportPdf } from '../src/pdf/export'
import {
  canSecureRedact,
  documentHasRedactions,
  exportRedactedPdf,
  isRedactionOverlay,
  pageHasRedactions,
  redactionCount,
} from '../src/pdf/redact'

async function createTextPdf(text: string) {
  const source = await PDFDocument.create()
  const page = source.addPage([400, 200])
  page.drawText(text, { x: 40, y: 120, size: 18 })
  return source.save()
}

describe('redaction helpers', () => {
  it('detects redaction overlays on pages and documents', () => {
    const document = createEditorDocument('sample.pdf', 100, 2, 'doc')
    document.pages[0].overlays = [
      {
        id: 'mark',
        type: 'redaction',
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.08,
        color: '#000000',
        opacity: 1,
        strokeWidth: 0,
        backgroundColor: '#000000',
      },
    ]
    expect(isRedactionOverlay(document.pages[0].overlays[0]!)).toBe(true)
    expect(pageHasRedactions(document.pages[0].overlays)).toBe(true)
    expect(pageHasRedactions(document.pages[1].overlays)).toBe(false)
    expect(documentHasRedactions(document)).toBe(true)
    expect(redactionCount(document)).toBe(1)
    expect(canSecureRedact()).toBe(false)
  })
})

describe('exportPdf redaction marks', () => {
  it('draws black cover boxes in a normal export', async () => {
    const sourceBytes = await createTextPdf('Secret phrase')
    const document = createEditorDocument('secret.pdf', sourceBytes.length, 1, 'doc')
    document.pages[0].overlays = [
      {
        id: 'mark',
        type: 'redaction',
        x: 0.05,
        y: 0.45,
        width: 0.9,
        height: 0.2,
        color: '#000000',
        opacity: 1,
        strokeWidth: 0,
        backgroundColor: '#000000',
      },
    ]
    const bytes = await exportPdf(new Map([['doc', sourceBytes]]), document)
    expect(bytes.length).toBeGreaterThan(sourceBytes.length)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})

describe('exportRedactedPdf', () => {
  it('requires canvas support in the current environment', async () => {
    const sourceBytes = await createTextPdf('Secret phrase')
    const document = createEditorDocument('secret.pdf', sourceBytes.length, 1, 'doc')
    document.pages[0].overlays = [
      {
        id: 'mark',
        type: 'redaction',
        x: 0.05,
        y: 0.45,
        width: 0.9,
        height: 0.2,
        color: '#000000',
        opacity: 1,
        strokeWidth: 0,
        backgroundColor: '#000000',
      },
    ]
    await expect(
      exportRedactedPdf(new Map([['doc', sourceBytes]]), document),
    ).rejects.toThrow(/canvas support/i)
  })
})
