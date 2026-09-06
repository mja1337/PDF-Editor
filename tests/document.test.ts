import { describe, expect, it } from 'vitest'
import {
  createEditorDocument,
  documentReducer,
  initialHistory,
} from '../src/domain/document'

function loadedDocument() {
  const document = createEditorDocument('fixture.pdf', 1024, 3, 'fixture')
  return documentReducer(initialHistory, { type: 'load', document })
}

describe('documentReducer', () => {
  it('moves pages by stable identity and can undo and redo the move', () => {
    const loaded = loadedDocument()
    const moved = documentReducer(loaded, {
      type: 'move',
      pageId: 'fixture:page:0',
      targetIndex: 2,
    })

    expect(moved.present?.pages.map((page) => page.sourcePageIndex)).toEqual([
      1, 2, 0,
    ])
    expect(moved.past).toHaveLength(1)

    const undone = documentReducer(moved, { type: 'undo' })
    expect(undone.present?.pages.map((page) => page.sourcePageIndex)).toEqual([
      0, 1, 2,
    ])

    const redone = documentReducer(undone, { type: 'redo' })
    expect(redone.present?.pages.map((page) => page.sourcePageIndex)).toEqual([
      1, 2, 0,
    ])
  })

  it('normalises clockwise and counter-clockwise rotation', () => {
    const loaded = loadedDocument()
    const left = documentReducer(loaded, {
      type: 'rotate',
      pageIds: ['fixture:page:1'],
      degrees: -90,
    })
    expect(left.present?.pages[1].rotationDelta).toBe(270)

    const restored = documentReducer(left, {
      type: 'rotate',
      pageIds: ['fixture:page:1'],
      degrees: 90,
    })
    expect(restored.present?.pages[1].rotationDelta).toBe(0)
  })

  it('deletes selected pages but never permits an empty document', () => {
    const loaded = loadedDocument()
    const deleted = documentReducer(loaded, {
      type: 'delete',
      pageIds: ['fixture:page:1'],
    })
    expect(deleted.present?.pages.map((page) => page.sourcePageIndex)).toEqual([
      0, 2,
    ])

    const rejected = documentReducer(loaded, {
      type: 'delete',
      pageIds: loaded.present!.pages.map((page) => page.id),
    })
    expect(rejected).toBe(loaded)
  })

  it('clears redo history after a new edit', () => {
    const loaded = loadedDocument()
    const rotated = documentReducer(loaded, {
      type: 'rotate',
      pageIds: ['fixture:page:0'],
      degrees: 90,
    })
    const undone = documentReducer(rotated, { type: 'undo' })
    const moved = documentReducer(undone, {
      type: 'move',
      pageId: 'fixture:page:0',
      targetIndex: 1,
    })
    expect(moved.future).toEqual([])
  })

  it('appends another source and duplicates a page by stable identity', () => {
    const loaded = loadedDocument()
    const appended = documentReducer(loaded, {
      type: 'append',
      sources: [
        { id: 'second', name: 'second.pdf', sizeBytes: 500, pageCount: 1 },
      ],
      pages: [
        {
          id: 'second:page:0',
          sourceDocumentId: 'second',
          sourcePageIndex: 0,
          rotationDelta: 0,
          overlays: [],
        },
      ],
    })
    const duplicated = documentReducer(appended, {
      type: 'duplicate',
      pageId: 'second:page:0',
      duplicateId: 'second:page:0:copy',
    })

    expect(duplicated.present?.sources).toHaveLength(2)
    expect(duplicated.present?.pages).toHaveLength(5)
    expect(duplicated.present?.pages.at(-1)).toMatchObject({
      id: 'second:page:0:copy',
      sourceDocumentId: 'second',
      sourcePageIndex: 0,
    })
  })

  it('applies a document watermark and can undo it', () => {
    const loaded = loadedDocument()
    const watermarked = documentReducer(loaded, {
      type: 'setWatermark',
      watermark: { text: 'DRAFT', opacity: 0.2, rotation: 45 },
    })

    expect(watermarked.present?.watermark?.text).toBe('DRAFT')
    expect(documentReducer(watermarked, { type: 'undo' }).present?.watermark).toBeNull()
  })

  it('moves a non-contiguous selection together without changing its order', () => {
    const loaded = loadedDocument()
    const moved = documentReducer(loaded, {
      type: 'moveSelection',
      pageIds: ['fixture:page:0', 'fixture:page:2'],
      direction: 1,
    })

    expect(moved.present?.pages.map((page) => page.sourcePageIndex)).toEqual([
      1, 0, 2,
    ])
    expect(documentReducer(moved, { type: 'undo' }).present).toEqual(
      loaded.present,
    )
  })

  it('adds, updates, duplicates, and removes overlays through history', () => {
    const loaded = loadedDocument()
    const added = documentReducer(loaded, {
      type: 'addOverlay',
      pageId: 'fixture:page:0',
      overlay: {
        id: 'note',
        type: 'text',
        x: 0.2,
        y: 0.3,
        width: 0.4,
        height: 0.1,
        color: '#e05252',
        opacity: 1,
        strokeWidth: 2,
        text: 'Review this',
        fontSize: 18,
      },
    })
    const updated = documentReducer(added, {
      type: 'updateOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'note',
      changes: { x: 0.95, width: 0.2, text: 'Updated' },
    })
    const duplicated = documentReducer(updated, {
      type: 'duplicateOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'note',
      duplicateId: 'note-copy',
    })
    const broughtForward = documentReducer(duplicated, {
      type: 'reorderOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'note',
      position: 'front',
    })
    const sentBackward = documentReducer(broughtForward, {
      type: 'reorderOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'note',
      position: 'back',
    })
    const removed = documentReducer(duplicated, {
      type: 'deleteOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'note',
    })

    expect(updated.present?.pages[0].overlays[0]).toMatchObject({
      x: 0.8,
      width: 0.2,
      text: 'Updated',
    })
    expect(duplicated.present?.pages[0].overlays).toHaveLength(2)
    expect(broughtForward.present?.pages[0].overlays.map(({ id }) => id)).toEqual([
      'note-copy',
      'note',
    ])
    expect(sentBackward.present?.pages[0].overlays.map(({ id }) => id)).toEqual([
      'note',
      'note-copy',
    ])
    expect(removed.present?.pages[0].overlays.map(({ id }) => id)).toEqual([
      'note-copy',
    ])
    expect(documentReducer(removed, { type: 'undo' }).present).toEqual(
      duplicated.present,
    )
  })

  it('replaces extracted text in one history step and marks edits as covered', () => {
    const loaded = loadedDocument()
    const analysed = documentReducer(loaded, {
      type: 'replaceExtractedOverlays',
      overlays: [
        {
          pageId: 'fixture:page:0',
          overlay: {
            id: 'line-1',
            type: 'text',
            x: 0.1,
            y: 0.1,
            width: 0.4,
            height: 0.05,
            color: '#1a1f1d',
            opacity: 1,
            strokeWidth: 1,
            text: 'Cover page',
            fontSize: 14,
            extracted: true,
          },
        },
      ],
    })
    expect(
      analysed.present?.pages[0].overlays.map((overlay) => overlay.id),
    ).toEqual(['line-1'])

    const withUserNote = documentReducer(analysed, {
      type: 'addOverlay',
      pageId: 'fixture:page:0',
      overlay: {
        id: 'note',
        type: 'text',
        x: 0.2,
        y: 0.4,
        width: 0.3,
        height: 0.08,
        color: '#e05252',
        opacity: 1,
        strokeWidth: 2,
        text: 'Keep me',
        fontSize: 18,
      },
    })
    const edited = documentReducer(withUserNote, {
      type: 'updateOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'line-1',
      changes: { text: 'Edited cover' },
    })
    expect(edited.present?.pages[0].overlays[0]).toMatchObject({
      text: 'Edited cover',
      extracted: true,
      edited: true,
      cover: true,
    })

    const moved = documentReducer(analysed, {
      type: 'updateOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'line-1',
      changes: { x: 0.2, y: 0.15 },
    })
    expect(moved.present?.pages[0].overlays[0]).toMatchObject({
      text: 'Cover page',
      extracted: true,
    })
    expect(moved.present?.pages[0].overlays[0]?.edited).toBeFalsy()
    expect(moved.present?.pages[0].overlays[0]?.cover).toBeFalsy()

    const sampled = documentReducer(analysed, {
      type: 'updateOverlay',
      pageId: 'fixture:page:0',
      overlayId: 'line-1',
      changes: { backgroundColor: '#c41e1e' },
    })
    expect(sampled.present?.pages[0].overlays[0]).toMatchObject({
      backgroundColor: '#c41e1e',
      extracted: true,
    })
    expect(sampled.present?.pages[0].overlays[0]?.edited).toBeFalsy()

    const reanalysed = documentReducer(edited, {
      type: 'replaceExtractedOverlays',
      overlays: [
        {
          pageId: 'fixture:page:0',
          overlay: {
            id: 'line-2',
            type: 'text',
            x: 0.1,
            y: 0.12,
            width: 0.5,
            height: 0.05,
            color: '#1a1f1d',
            opacity: 1,
            strokeWidth: 1,
            text: 'Fresh line',
            fontSize: 14,
            extracted: true,
          },
        },
      ],
    })
    expect(
      reanalysed.present?.pages[0].overlays.map((overlay) => ({
        id: overlay.id,
        text: overlay.text,
      })),
    ).toEqual([
      { id: 'note', text: 'Keep me' },
      { id: 'line-2', text: 'Fresh line' },
    ])
  })
})
