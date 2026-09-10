import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorDocument, PageOverlay } from '../domain/document'
import type { PdfSession } from './engine'

export interface SearchResult {
  id: string
  pageId: string
  position: number
  excerpt: string
  overlayId?: string
}

export interface OutlineEntry {
  id: string
  pageId: string | null
  title: string
  depth: number
}

interface PdfOutlineItem {
  title?: string
  dest?: string | unknown[] | null
  items?: PdfOutlineItem[]
}

interface SearchSegment {
  text: string
  overlayId?: string
}

const textCache = new WeakMap<PDFDocumentProxy, Map<number, string>>()

async function pageText(document: PDFDocumentProxy, pageIndex: number) {
  let cache = textCache.get(document)
  if (!cache) {
    cache = new Map()
    textCache.set(document, cache)
  }
  const cached = cache.get(pageIndex)
  if (cached !== undefined) return cached

  const page = await document.getPage(pageIndex + 1)
  const content = await page.getTextContent()
  const text = content.items
    .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
  cache.set(pageIndex, text)
  return text
}

function excerpt(text: string, matchIndex: number, queryLength: number) {
  const start = Math.max(0, matchIndex - 46)
  const end = Math.min(text.length, matchIndex + queryLength + 68)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** Text from analysed lines and text-box annotations — not in the PDF text layer. */
export function overlaySearchText(overlays: PageOverlay[]) {
  return overlays
    .filter((overlay) => overlay.type === 'text' && overlay.text?.trim())
    .map((overlay) => overlay.text!.trim())
    .join('\n')
}

export function findAllMatchIndices(text: string, query: string) {
  const normalized = text.toLocaleLowerCase()
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const indices: number[] = []
  let start = 0
  while (start <= normalized.length - needle.length) {
    const index = normalized.indexOf(needle, start)
    if (index < 0) break
    indices.push(index)
    start = index + Math.max(needle.length, 1)
  }
  return indices
}

export function pageSearchSegments(nativeText: string, overlays: PageOverlay[]): SearchSegment[] {
  const segments: SearchSegment[] = []
  if (nativeText.trim()) segments.push({ text: nativeText })
  for (const overlay of overlays) {
    if (overlay.type !== 'text' || !overlay.text?.trim()) continue
    segments.push({ text: overlay.text.trim(), overlayId: overlay.id })
  }
  return segments
}

export function splitExcerptHighlight(excerpt: string, query: string) {
  const needle = query.trim()
  if (!needle) return { before: excerpt, match: '', after: '' }
  const lower = excerpt.toLocaleLowerCase()
  const index = lower.indexOf(needle.toLocaleLowerCase())
  if (index < 0) return { before: excerpt, match: '', after: '' }
  return {
    before: excerpt.slice(0, index),
    match: excerpt.slice(index, index + needle.length),
    after: excerpt.slice(index + needle.length),
  }
}

export async function documentHasOutline(
  sessions: ReadonlyMap<string, PdfSession>,
  document: EditorDocument,
) {
  for (const source of document.sources) {
    const session = sessions.get(source.id)
    if (!session) continue
    const outline = (await session.viewer.getOutline()) as PdfOutlineItem[] | null
    if (outline?.length) return true
  }
  return false
}

export async function searchEditorDocument(
  sessions: ReadonlyMap<string, PdfSession>,
  document: EditorDocument,
  query: string,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
): Promise<SearchResult[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const results: SearchResult[] = []
  let serial = 0
  for (let position = 0; position < document.pages.length; position += 1) {
    if (signal.aborted) throw new DOMException('Search cancelled.', 'AbortError')
    const reference = document.pages[position]
    const session = sessions.get(reference.sourceDocumentId)
    if (!session) continue
    const nativeText = await pageText(session.viewer, reference.sourcePageIndex)
    const segments = pageSearchSegments(nativeText, reference.overlays)
    for (const segment of segments) {
      for (const matchIndex of findAllMatchIndices(segment.text, normalizedQuery)) {
        results.push({
          id: `${reference.id}:${segment.overlayId ?? 'native'}:${matchIndex}:${serial}`,
          pageId: reference.id,
          position,
          overlayId: segment.overlayId,
          excerpt: excerpt(segment.text, matchIndex, normalizedQuery.length),
        })
        serial += 1
      }
    }
    onProgress?.(position + 1, document.pages.length)
  }
  return results
}

async function outlinePageIndex(
  viewer: PDFDocumentProxy,
  destination: PdfOutlineItem['dest'],
) {
  const resolved =
    typeof destination === 'string'
      ? await viewer.getDestination(destination)
      : destination
  if (!Array.isArray(resolved) || resolved.length === 0) return null
  const target = resolved[0]
  if (typeof target === 'number') return target
  if (!target || typeof target !== 'object') return null

  try {
    return await viewer.getPageIndex(
      target as Parameters<PDFDocumentProxy['getPageIndex']>[0],
    )
  } catch {
    return null
  }
}

export async function readEditorOutline(
  sessions: ReadonlyMap<string, PdfSession>,
  document: EditorDocument,
): Promise<OutlineEntry[]> {
  const entries: OutlineEntry[] = []

  for (const source of document.sources) {
    const session = sessions.get(source.id)
    if (!session) continue
    const viewer = session.viewer
    const outline = (await viewer.getOutline()) as PdfOutlineItem[] | null
    if (!outline?.length) continue

    async function visit(items: PdfOutlineItem[], depth: number) {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        const sourcePageIndex = await outlinePageIndex(viewer, item.dest)
        const page =
          sourcePageIndex === null
            ? null
            : document.pages.find(
                (candidate) =>
                  candidate.sourceDocumentId === source.id &&
                  candidate.sourcePageIndex === sourcePageIndex,
              )
        entries.push({
          id: `${source.id}:${depth}:${index}:${entries.length}`,
          pageId: page?.id ?? null,
          title: item.title?.trim() || 'Untitled section',
          depth,
        })
        if (item.items?.length) await visit(item.items, depth + 1)
      }
    }

    await visit(outline, 0)
  }

  return entries
}
