import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createEditorDocument, documentReducer, initialHistory } from '../src/domain/document'
import { exportPdf } from '../src/pdf/export'
import { readFileSync } from 'node:fs'

const fontBytes = new Uint8Array(readFileSync('node_modules/@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'))

async function createSourcePdf() {
  const source = await PDFDocument.create()
  source.setTitle('Export fixture')
  source.addPage([200, 300])
  source.addPage([400, 200]).setRotation(degrees(90))
  source.addPage([300, 500])
  return source.save()
}

describe('exportPdf', () => {
  it('preserves supported Unicode and rejects unsupported text instead of substituting characters', async () => {
    const sourceBytes = await createSourcePdf()
    const document = createEditorDocument('unicode.pdf', sourceBytes.length, 3, 'unicode')
    document.pages[0].overlays = [{ id: 'text', type: 'text', x: 0.1, y: 0.1,
      width: 0.6, height: 0.1, color: '#123456', opacity: 1, strokeWidth: 2,
      text: 'Renée — £100 €50', fontSize: 18 }]
    const sources = new Map([['unicode', sourceBytes]])
    expect((await exportPdf(sources, document, fontBytes)).length).toBeGreaterThan(sourceBytes.length)
    document.pages[0].overlays[0].text = 'Hello 世界'
    await expect(exportPdf(sources, document, fontBytes)).rejects.toThrow('Unsupported text: 世 界')
  })

  it('exports ink and signature images at every quarter turn', async () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const sourceBytes = await createSourcePdf()
      const document = createEditorDocument('ink.pdf', sourceBytes.length, 3, 'ink')
      document.pages[0].rotationDelta = rotation
      document.pages[0].overlays = [
        { id: 'ink', type: 'ink', x: 0.1, y: 0.2, width: 0.3, height: 0.2,
          color: '#ff0000', opacity: 1, strokeWidth: 4,
          points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0 }] },
        { id: 'signature', type: 'image', signature: true, x: 0.2, y: 0.5, width: 0.4, height: 0.1,
          color: '#000000', opacity: 1, strokeWidth: 2,
          imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
      ]
      const bytes = await exportPdf(new Map([['ink', sourceBytes]]), document)
      const output = await PDFDocument.load(bytes)
      expect(output.getPage(0).getRotation().angle).toBe(rotation)
      expect(output.getPage(0).node.Resources()?.toString()).toContain('/XObject')
    }
  })
  it('exports password-protected source PDFs opened with a password this session', async () => {
    const encrypted = new Uint8Array(readFileSync('tests/fixtures/locked.pdf'))
    const document = createEditorDocument('locked.pdf', encrypted.length, 1, 'locked')
    const passwords = new Map([['locked', 'test-secret']])
    const bytes = await exportPdf(
      new Map([['locked', encrypted]]),
      document,
      fontBytes,
      passwords,
    )
    const output = await PDFDocument.load(bytes)
    expect(output.getPageCount()).toBe(1)
  })

  it('exports the authoritative page order, deletions, and rotation deltas', async () => {
    const sourceBytes = await createSourcePdf()
    const document = createEditorDocument('fixture.pdf', sourceBytes.length, 3, 'export')
    let history = documentReducer(initialHistory, { type: 'load', document })
    history = documentReducer(history, {
      type: 'move',
      pageId: 'export:page:2',
      targetIndex: 0,
    })
    history = documentReducer(history, {
      type: 'delete',
      pageIds: ['export:page:1'],
    })
    history = documentReducer(history, {
      type: 'rotate',
      pageIds: ['export:page:2'],
      degrees: 90,
    })

    const outputBytes = await exportPdf(
      new Map([['export', new Uint8Array(sourceBytes)]]),
      history.present!,
    )
    const output = await PDFDocument.load(outputBytes)

    expect(output.getPageCount()).toBe(2)
    expect(output.getPage(0).getSize()).toEqual({ width: 300, height: 500 })
    expect(output.getPage(0).getRotation().angle).toBe(90)
    expect(output.getPage(1).getSize()).toEqual({ width: 200, height: 300 })
    expect(output.getTitle()).toBe('Export fixture')
  })

  it('adds a vector text watermark while keeping the PDF readable', async () => {
    const sourceBytes = await createSourcePdf()
    const document = createEditorDocument(
      'fixture.pdf',
      sourceBytes.length,
      3,
      'watermark',
    )
    const sourceMap = new Map([
      ['watermark', new Uint8Array(sourceBytes)],
    ])
    const plainBytes = await exportPdf(sourceMap, document)
    const watermarked = documentReducer(
      documentReducer(initialHistory, { type: 'load', document }),
      {
        type: 'setWatermark',
        watermark: { text: 'CONFIDENTIAL', opacity: 0.2, rotation: 45 },
      },
    )
    const watermarkedBytes = await exportPdf(sourceMap, watermarked.present!, fontBytes)

    expect(watermarkedBytes.length).toBeGreaterThan(plainBytes.length)
    expect((await PDFDocument.load(watermarkedBytes)).getPageCount()).toBe(3)
  })

  it('covers edited extracted text and ignores unedited extraction', async () => {
    const sourceBytes = await createSourcePdf()
    const document = createEditorDocument('extract.pdf', sourceBytes.length, 3, 'extract')
    document.pages[0].overlays = [
      {
        id: 'original',
        type: 'text',
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.08,
        color: '#111111',
        opacity: 1,
        strokeWidth: 1,
        text: 'Leave original',
        fontSize: 14,
        extracted: true,
        edited: false,
      },
      {
        id: 'edited',
        type: 'text',
        x: 0.1,
        y: 0.3,
        width: 0.5,
        height: 0.08,
        color: '#111111',
        opacity: 1,
        strokeWidth: 1,
        text: 'Replacement line',
        fontSize: 14,
        extracted: true,
        edited: true,
        cover: true,
        backgroundColor: '#ffffff',
      },
    ]
    const bytes = await exportPdf(
      new Map([['extract', sourceBytes]]),
      document,
      fontBytes,
    )
    expect(bytes.length).toBeGreaterThan(sourceBytes.length)
    const output = await PDFDocument.load(bytes)
    expect(output.getPageCount()).toBe(3)
    expect(output.getPage(0).node.Contents()).toBeTruthy()
  })
})
