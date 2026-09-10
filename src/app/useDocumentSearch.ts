import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorDocument, PageRef } from '../domain/document'
import type { PdfSession } from '../pdf/engine'
import type { SearchResult } from '../pdf/navigation'
import { userFacingError } from './messages'

interface SearchOptions {
  editorDocument: EditorDocument | null
  selectedPage: PageRef | null
  sessionsRef: React.RefObject<Map<string, PdfSession>>
  focusPage: (pageId: string) => void
  onSelectOverlay: (overlayId: string | null) => void
  onError: (message: string) => void
}

export function useDocumentSearch({
  editorDocument,
  selectedPage,
  sessionsRef,
  focusPage,
  onSelectOverlay,
  onError,
}: SearchOptions) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready'>('idle')
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const focusResult = useCallback(
    (index: number, from: SearchResult[] = results) => {
      const result = from[index]
      if (!result) return
      setActiveIndex(index)
      focusPage(result.pageId)
      if (result.overlayId) {
        window.requestAnimationFrame(() => onSelectOverlay(result.overlayId!))
      }
    },
    [focusPage, onSelectOverlay, results],
  )

  const step = useCallback(
    (direction: 1 | -1) => {
      if (results.length === 0) return
      focusResult((activeIndex + direction + results.length) % results.length)
    },
    [activeIndex, focusResult, results],
  )

  // documentOverride lets analysis re-run the current query against freshly
  // extracted text before that document reaches React state.
  const run = useCallback(
    async (documentOverride?: EditorDocument) => {
      const searchable = documentOverride ?? editorDocument
      if (!searchable || !query.trim()) return
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('searching')
      setProgress(`0 / ${searchable.pages.length}`)
      setResults([])
      setActiveIndex(0)
      try {
        const { searchEditorDocument } = await import('../pdf/navigation')
        const found = await searchEditorDocument(
          sessionsRef.current,
          searchable,
          query,
          controller.signal,
          (completed, total) => setProgress(`${completed} / ${total}`),
        )
        if (!controller.signal.aborted) {
          setResults(found)
          setStatus('ready')
          if (found.length > 0) {
            setActiveIndex(0)
            focusResult(0, found)
          }
        }
      } catch (searchError) {
        if (!(searchError instanceof DOMException) || searchError.name !== 'AbortError') {
          onError(userFacingError(searchError, 'The document search could not be completed.'))
          setStatus('idle')
        }
      }
    },
    [editorDocument, focusResult, onError, query, sessionsRef],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearResults = useCallback(() => {
    setResults([])
    setActiveIndex(0)
  }, [])

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setActiveIndex(0)
  }, [])

  useEffect(() => {
    if (results.length === 0) return
    const result = results[activeIndex]
    if (!result) return
    resultRefs.current.get(result.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const highlightOverlayIds = useMemo(() => {
    if (status !== 'ready' || results.length === 0 || !selectedPage) return undefined
    const ids = results
      .filter((result) => result.pageId === selectedPage.id && result.overlayId)
      .map((result) => result.overlayId!)
    return ids.length > 0 ? new Set(ids) : undefined
  }, [results, selectedPage, status])

  const activeOverlayId = useMemo(() => {
    if (status !== 'ready' || results.length === 0 || !selectedPage) return null
    const active = results[activeIndex]
    if (!active || active.pageId !== selectedPage.id) return null
    return active.overlayId ?? null
  }, [activeIndex, results, selectedPage, status])

  return {
    query,
    setQuery,
    results,
    status,
    progress,
    activeIndex,
    inputRef,
    resultRefs,
    run,
    focusResult,
    step,
    abort,
    clearResults,
    reset,
    highlightOverlayIds,
    activeOverlayId,
  }
}
