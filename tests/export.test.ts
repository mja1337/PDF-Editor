import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { createEditorDocument, documentReducer, initialHistory } from '../src/domain/document'
import { exportPdf } from '../src/pdf/export'

async function createSourcePdf() {
  const source = await PDFDocument.create()
  source.setTitle('Export fixture')
  source.addPage([200, 300])
  source.addPage([400, 200]).setRotation(degrees(90))
  source.addPage([300, 500])
  return source.save()
}

describe('exportPdf', () => {
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
    const watermarkedBytes = await exportPdf(sourceMap, watermarked.present!)

    expect(watermarkedBytes.length).toBeGreaterThan(plainBytes.length)
    expect((await PDFDocument.load(watermarkedBytes)).getPageCount()).toBe(3)
  })
})
