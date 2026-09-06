export type QuarterTurn = 0 | 90 | 180 | 270

export type OverlayType =
  | 'text'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'ink'
  | 'image'

export interface PageOverlay {
  id: string
  type: OverlayType
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
  strokeWidth: number
  text?: string
  fontSize?: number
  fontRole?: 'sans' | 'serif' | 'mono'
  fontWeight?: 400 | 700
  fontItalic?: boolean
  points?: Array<{ x: number; y: number }>
  imageData?: string
  signature?: boolean
  extracted?: boolean
  edited?: boolean
  cover?: boolean
  backgroundColor?: string
}

export interface PageRef {
  id: string
  sourceDocumentId: string
  sourcePageIndex: number
  rotationDelta: QuarterTurn
  overlays: PageOverlay[]
}

export interface SourceDocument {
  id: string
  name: string
  sizeBytes: number
  pageCount: number
}

export interface WatermarkConfig {
  text: string
  opacity: number
  rotation: number
}

export interface EditorDocument {
  id: string
  name: string
  sizeBytes: number
  sources: SourceDocument[]
  pages: PageRef[]
  watermark: WatermarkConfig | null
}

export interface DocumentHistory {
  past: EditorDocument[]
  present: EditorDocument | null
  future: EditorDocument[]
}

export type DocumentAction =
  | { type: 'load'; document: EditorDocument }
  | { type: 'rotate'; pageIds: string[]; degrees: 90 | -90 }
  | { type: 'delete'; pageIds: string[] }
  | { type: 'move'; pageId: string; targetIndex: number }
  | { type: 'moveSelection'; pageIds: string[]; direction: -1 | 1 }
  | { type: 'duplicate'; pageId: string; duplicateId: string }
  | {
      type: 'duplicateSelection'
      duplicates: Array<{ pageId: string; duplicateId: string }>
    }
  | { type: 'append'; sources: SourceDocument[]; pages: PageRef[] }
  | { type: 'setWatermark'; watermark: WatermarkConfig | null }
  | { type: 'addOverlay'; pageId: string; overlay: PageOverlay }
  | {
      type: 'updateOverlay'
      pageId: string
      overlayId: string
      changes: Partial<PageOverlay>
    }
  | { type: 'deleteOverlay'; pageId: string; overlayId: string }
  | {
      type: 'duplicateOverlay'
      pageId: string
      overlayId: string
      duplicateId: string
    }
  | {
      type: 'reorderOverlay'
      pageId: string
      overlayId: string
      position: 'front' | 'back'
    }
  | {
      type: 'replaceExtractedOverlays'
      overlays: Array<{ pageId: string; overlay: PageOverlay }>
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'close' }

export const initialHistory: DocumentHistory = {
  past: [],
  present: null,
  future: [],
}

function normaliseRotation(value: number): QuarterTurn {
  return (((value % 360) + 360) % 360) as QuarterTurn
}

function commit(
  history: DocumentHistory,
  update: (document: EditorDocument) => EditorDocument,
): DocumentHistory {
  if (!history.present) return history

  const next = update(history.present)
  if (next === history.present) return history

  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  }
}

export function documentReducer(
  history: DocumentHistory,
  action: DocumentAction,
): DocumentHistory {
  switch (action.type) {
    case 'load':
      return { past: [], present: action.document, future: [] }

    case 'close':
      return initialHistory

    case 'rotate': {
      const selected = new Set(action.pageIds)
      if (selected.size === 0) return history

      return commit(history, (document) => ({
        ...document,
        pages: document.pages.map((page) =>
          selected.has(page.id)
            ? {
                ...page,
                rotationDelta: normaliseRotation(
                  page.rotationDelta + action.degrees,
                ),
              }
            : page,
        ),
      }))
    }

    case 'delete': {
      const selected = new Set(action.pageIds)
      if (selected.size === 0) return history

      return commit(history, (document) => {
        const pages = document.pages.filter((page) => !selected.has(page.id))
        if (pages.length === 0 || pages.length === document.pages.length) {
          return document
        }
        return { ...document, pages }
      })
    }

    case 'move':
      return commit(history, (document) => {
        const fromIndex = document.pages.findIndex(
          (page) => page.id === action.pageId,
        )
        if (fromIndex < 0) return document

        const targetIndex = Math.max(
          0,
          Math.min(action.targetIndex, document.pages.length - 1),
        )
        if (fromIndex === targetIndex) return document

        const pages = [...document.pages]
        const [page] = pages.splice(fromIndex, 1)
        pages.splice(targetIndex, 0, page)
        return { ...document, pages }
      })

    case 'moveSelection': {
      const selected = new Set(action.pageIds)
      if (selected.size === 0) return history

      return commit(history, (document) => {
        const pages = [...document.pages]
        let changed = false
        if (action.direction === -1) {
          for (let index = 1; index < pages.length; index += 1) {
            if (selected.has(pages[index].id) && !selected.has(pages[index - 1].id)) {
              ;[pages[index - 1], pages[index]] = [pages[index], pages[index - 1]]
              changed = true
            }
          }
        } else {
          for (let index = pages.length - 2; index >= 0; index -= 1) {
            if (selected.has(pages[index].id) && !selected.has(pages[index + 1].id)) {
              ;[pages[index], pages[index + 1]] = [pages[index + 1], pages[index]]
              changed = true
            }
          }
        }
        return changed ? { ...document, pages } : document
      })
    }

    case 'duplicate':
      return commit(history, (document) => {
        const sourceIndex = document.pages.findIndex(
          (page) => page.id === action.pageId,
        )
        if (sourceIndex < 0) return document

        const pages = [...document.pages]
        pages.splice(sourceIndex + 1, 0, {
          ...pages[sourceIndex],
          id: action.duplicateId,
        })
        return { ...document, pages }
      })

    case 'duplicateSelection': {
      const duplicates = new Map(
        action.duplicates.map(({ pageId, duplicateId }) => [pageId, duplicateId]),
      )
      if (duplicates.size === 0) return history

      return commit(history, (document) => {
        let changed = false
        const pages = document.pages.flatMap((page) => {
          const duplicateId = duplicates.get(page.id)
          if (!duplicateId) return [page]
          changed = true
          return [page, { ...page, id: duplicateId }]
        })
        return changed ? { ...document, pages } : document
      })
    }

    case 'append':
      if (action.sources.length === 0 || action.pages.length === 0) return history
      return commit(history, (document) => ({
        ...document,
        sizeBytes:
          document.sizeBytes +
          action.sources.reduce((total, source) => total + source.sizeBytes, 0),
        sources: [...document.sources, ...action.sources],
        pages: [...document.pages, ...action.pages],
      }))

    case 'setWatermark':
      return commit(history, (document) => {
        if (
          document.watermark?.text === action.watermark?.text &&
          document.watermark?.opacity === action.watermark?.opacity &&
          document.watermark?.rotation === action.watermark?.rotation
        ) {
          return document
        }
        return { ...document, watermark: action.watermark }
      })

    case 'addOverlay':
      return commit(history, (document) => ({
        ...document,
        pages: document.pages.map((page) =>
          page.id === action.pageId
            ? { ...page, overlays: [...page.overlays, normalizeOverlay(action.overlay)] }
            : page,
        ),
      }))

    case 'updateOverlay':
      return commit(history, (document) => ({
        ...document,
        pages: document.pages.map((page) =>
          page.id === action.pageId
            ? {
                ...page,
                overlays: page.overlays.map((overlay) => {
                  if (overlay.id !== action.overlayId) return overlay
                  const next = { ...overlay, ...action.changes }
                  if (overlay.extracted && !overlay.edited) {
                    const textChanged =
                      'text' in action.changes && action.changes.text !== overlay.text
                    const colorChanged =
                      'color' in action.changes && action.changes.color !== overlay.color
                    const fontChanged =
                      'fontSize' in action.changes &&
                      action.changes.fontSize !== overlay.fontSize
                    if (textChanged || colorChanged || fontChanged) {
                      next.edited = true
                      next.cover = true
                    }
                  }
                  return normalizeOverlay(next)
                }),
              }
            : page,
        ),
      }))

    case 'deleteOverlay':
      return commit(history, (document) => {
        const page = document.pages.find((candidate) => candidate.id === action.pageId)
        if (!page?.overlays.some((overlay) => overlay.id === action.overlayId)) {
          return document
        }
        return {
          ...document,
          pages: document.pages.map((candidate) =>
            candidate.id === action.pageId
              ? {
                  ...candidate,
                  overlays: candidate.overlays.filter(
                    (overlay) => overlay.id !== action.overlayId,
                  ),
                }
              : candidate,
          ),
        }
      })

    case 'duplicateOverlay':
      return commit(history, (document) => {
        const page = document.pages.find((candidate) => candidate.id === action.pageId)
        const overlay = page?.overlays.find(
          (candidate) => candidate.id === action.overlayId,
        )
        if (!overlay) return document
        const duplicate = normalizeOverlay({
          ...overlay,
          id: action.duplicateId,
          x: overlay.x + 0.025,
          y: overlay.y + 0.025,
          extracted: false,
          edited: false,
        })
        return {
          ...document,
          pages: document.pages.map((candidate) =>
            candidate.id === action.pageId
              ? { ...candidate, overlays: [...candidate.overlays, duplicate] }
              : candidate,
          ),
        }
      })

    case 'reorderOverlay':
      return commit(history, (document) => {
        const page = document.pages.find((candidate) => candidate.id === action.pageId)
        const overlayIndex = page?.overlays.findIndex(
          (candidate) => candidate.id === action.overlayId,
        ) ?? -1
        if (!page || overlayIndex < 0) return document
        if (
          (action.position === 'front' && overlayIndex === page.overlays.length - 1) ||
          (action.position === 'back' && overlayIndex === 0)
        ) {
          return document
        }
        const overlays = [...page.overlays]
        const [overlay] = overlays.splice(overlayIndex, 1)
        if (action.position === 'front') overlays.push(overlay)
        else overlays.unshift(overlay)
        return {
          ...document,
          pages: document.pages.map((candidate) =>
            candidate.id === action.pageId ? { ...candidate, overlays } : candidate,
          ),
        }
      })

    case 'replaceExtractedOverlays':
      return commit(history, (document) => {
        const incoming = new Map<string, PageOverlay[]>()
        for (const { pageId, overlay } of action.overlays) {
          const list = incoming.get(pageId) ?? []
          list.push(normalizeOverlay(overlay))
          incoming.set(pageId, list)
        }
        let changed = false
        const pages = document.pages.map((page) => {
          const kept = page.overlays.filter((overlay) => !overlay.extracted)
          const added = incoming.get(page.id) ?? []
          if (
            kept.length === page.overlays.length &&
            added.length === 0
          ) {
            return page
          }
          changed = true
          return { ...page, overlays: [...kept, ...added] }
        })
        return changed ? { ...document, pages } : document
      })

    case 'undo': {
      const previous = history.past.at(-1)
      if (!previous || !history.present) return history
      return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    }

    case 'redo': {
      const [next, ...future] = history.future
      if (!next || !history.present) return history
      return {
        past: [...history.past, history.present],
        present: next,
        future,
      }
    }
  }
}

export function createEditorDocument(
  name: string,
  sizeBytes: number,
  pageCount: number,
  id: string = crypto.randomUUID(),
): EditorDocument {
  const source: SourceDocument = {
    id,
    name,
    sizeBytes,
    pageCount,
  }

  return {
    id,
    name,
    sizeBytes,
    sources: [source],
    pages: createPagesForSource(source),
    watermark: null,
  }
}

export function createSourceDocument(
  name: string,
  sizeBytes: number,
  pageCount: number,
  id: string = crypto.randomUUID(),
): SourceDocument {
  return { id, name, sizeBytes, pageCount }
}

export function createPagesForSource(source: SourceDocument): PageRef[] {
  return Array.from({ length: source.pageCount }, (_, sourcePageIndex) => ({
    id: `${source.id}:page:${sourcePageIndex}`,
    sourceDocumentId: source.id,
    sourcePageIndex,
    rotationDelta: 0,
    overlays: [],
  }))
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

export function normalizeOverlay(overlay: PageOverlay): PageOverlay {
  const width = clamp(overlay.width, 0.01, 1)
  const height = clamp(overlay.height, 0.01, 1)
  return {
    ...overlay,
    x: clamp(overlay.x, 0, 1 - width),
    y: clamp(overlay.y, 0, 1 - height),
    width,
    height,
    opacity: clamp(overlay.opacity, 0.05, 1),
    strokeWidth: clamp(overlay.strokeWidth, 0.5, 12),
    fontSize: overlay.fontSize ? clamp(overlay.fontSize, 4, 288) : undefined,
  }
}

export function createEditorDocumentFromSources(
  sources: SourceDocument[],
  name = sources.length === 1 ? sources[0]?.name : 'combined.pdf',
  id: string = crypto.randomUUID(),
): EditorDocument {
  if (sources.length === 0) {
    throw new Error('At least one source document is required.')
  }

  return {
    id,
    name: name || 'combined.pdf',
    sizeBytes: sources.reduce((total, source) => total + source.sizeBytes, 0),
    sources,
    pages: sources.flatMap(createPagesForSource),
    watermark: null,
  }
}
