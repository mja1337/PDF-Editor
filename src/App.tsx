import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  BringToFront,
  CheckCircle2,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Copy,
  Download,
  FilePlus2,
  FileText,
  Files,
  FolderOpen,
  Grab,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  ImageDown,
  Highlighter,
  Maximize2,
  Minus,
  MoveHorizontal,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  ScanSearch,
  Scissors,
  Search,
  SendToBack,
  Slash,
  Square,
  Strikethrough,
  Trash2,
  Type,
  Undo2,
  Underline,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { LazyThumbnail } from './components/LazyThumbnail'
import { SignatureDialog } from './components/SignatureDialog'
import type { AnnotationTool } from './components/AnnotationLayer'
import {
  ContextMenu,
  type ContextMenuItem,
} from './components/ContextMenu'
import { PdfCanvas } from './components/PdfCanvas'
import { ServiceWorkerStatus } from './components/ServiceWorkerStatus'
import {
  createEditorDocumentFromSources,
  createPagesForSource,
  createSourceDocument,
  documentReducer,
  initialHistory,
} from './domain/document'
import type { OverlayType, PageOverlay } from './domain/document'
import { createDefaultOverlay } from './domain/overlays'
import { openPdf, openPdfBytes, renderPageToPng, type PdfSession } from './pdf/engine'
import { downloadBlob, downloadPdf, exportPdf } from './pdf/export'
import type { OutlineEntry, SearchResult } from './pdf/navigation'

function userFacingError(error: unknown, fallback: string) {
  if (
    error instanceof TypeError &&
    /Failed to fetch dynamically imported module/i.test(error.message)
  ) {
    return 'The editor lost its connection to the local app. Refresh the page. If that does not help, restart npm run dev.'
  }
  return error instanceof Error ? error.message : fallback
}

type ViewMode = 'width' | 'page' | 'custom'
type NavigatorMode = 'pages' | 'outline' | 'search'
type ContextTarget =
  | { kind: 'pages'; x: number; y: number; pageId: string }
  | {
      kind: 'canvas'
      x: number
      y: number
      pageId: string
      point: { x: number; y: number }
    }
  | { kind: 'overlay'; x: number; y: number; pageId: string; overlayId: string }

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function OverlayTextField({
  overlay,
  onCommit,
}: {
  overlay: PageOverlay
  onCommit: (text: string) => void
}) {
  const [draft, setDraft] = useState(overlay.text ?? '')
  const [source, setSource] = useState({ id: overlay.id, text: overlay.text ?? '' })
  if (overlay.id !== source.id || overlay.text !== source.text) {
    setSource({ id: overlay.id, text: overlay.text ?? '' })
    setDraft(overlay.text ?? '')
  }

  return (
    <textarea
      aria-label="Text"
      value={draft}
      maxLength={4000}
      rows={overlay.extracted ? 4 : 2}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = overlay.extracted ? draft : draft.trim() || 'Add text'
        if (next !== (overlay.text ?? '')) onCommit(next)
      }}
    />
  )
}

async function destroySession(session: PdfSession | null) {
  if (!session) return
  await session.viewer.loadingTask.destroy()
}

async function destroySessions(sessions: ReadonlyMap<string, PdfSession>) {
  await Promise.allSettled([...sessions.values()].map(destroySession))
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
  className = '',
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function App() {
  const [history, dispatch] = useReducer(documentReducer, initialHistory)
  const [sessions, setSessions] = useState<Map<string, PdfSession>>(
    () => new Map(),
  )
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null)
  const [busy, setBusy] = useState<
    | 'opening'
    | 'adding'
    | 'exporting'
    | 'extracting'
    | 'rendering'
    | 'analysing'
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [stageWidth, setStageWidth] = useState(900)
  const [stageHeight, setStageHeight] = useState(700)
  const [zoom, setZoom] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('width')
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('pages')
  const [outlineEntries, setOutlineEntries] = useState<OutlineEntry[]>([])
  const [outlineStatus, setOutlineStatus] = useState<'idle' | 'loading' | 'ready'>(
    'idle',
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<
    'idle' | 'searching' | 'ready'
  >('idle')
  const [searchProgress, setSearchProgress] = useState('')
  const [analyseProgress, setAnalyseProgress] = useState('')
  const [analyseSummary, setAnalyseSummary] = useState<{
    blocks: number
    pagesWithText: number
    emptyPages: number
  } | null>(null)
  const [watermarkText, setWatermarkText] = useState('')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('select')
  const [annotationColor, setAnnotationColor] = useState('#e05252')
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [overlayClipboard, setOverlayClipboard] = useState<PageOverlay | null>(null)
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [inkWidth, setInkWidth] = useState(2)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addPdfInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sessionsRef = useRef<Map<string, PdfSession>>(new Map())
  const loadSequence = useRef(0)
  const selectionAnchorRef = useRef<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const analyseAbortRef = useRef<AbortController | null>(null)
  const online = useOnlineStatus()
  const editorDocument = history.present

  const requestedSelectedIndex =
    editorDocument?.pages.findIndex((page) => page.id === selectedPageId) ?? -1
  const selectedIndex =
    requestedSelectedIndex >= 0
      ? requestedSelectedIndex
      : editorDocument?.pages.length
        ? 0
        : -1
  const selectedPage = selectedIndex >= 0 ? editorDocument?.pages[selectedIndex] : null
  const visibleSelection = useMemo(() => {
    const selection = new Set(
      editorDocument?.pages
        .filter((page) => selectedPageIds.has(page.id))
        .map((page) => page.id) ?? [],
    )
    if (selection.size === 0 && selectedPage) selection.add(selectedPage.id)
    return selection
  }, [editorDocument, selectedPage, selectedPageIds])
  const selectedPages = useMemo(
    () =>
      editorDocument?.pages.filter((page) => visibleSelection.has(page.id)) ?? [],
    [editorDocument, visibleSelection],
  )
  const canMoveEarlier =
    editorDocument?.pages.some(
      (page, index, pages) =>
        visibleSelection.has(page.id) &&
        index > 0 &&
        !visibleSelection.has(pages[index - 1].id),
    ) ?? false
  const canMoveLater =
    editorDocument?.pages.some(
      (page, index, pages) =>
        visibleSelection.has(page.id) &&
        index < pages.length - 1 &&
        !visibleSelection.has(pages[index + 1].id),
    ) ?? false
  const selectedSession = selectedPage
    ? sessions.get(selectedPage.sourceDocumentId) ?? null
    : null
  const selectedOverlay =
    selectedPage?.overlays.find((overlay) => overlay.id === selectedOverlayId) ??
    null

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(Math.max(320, entry.contentRect.width))
      setStageHeight(Math.max(320, entry.contentRect.height))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [editorDocument])

  useEffect(
    () => () => {
      searchAbortRef.current?.abort()
      analyseAbortRef.current?.abort()
      void destroySessions(sessionsRef.current)
    },
    [],
  )

  const loadPdfFiles = useCallback(async (files: File[], replace: boolean) => {
    if (files.length === 0) return
    searchAbortRef.current?.abort()
    analyseAbortRef.current?.abort()
    const sequence = ++loadSequence.current
    setBusy(replace ? 'opening' : 'adding')
    setError(null)
    const imported: Array<{ sourceId: string; session: PdfSession; file: File }> = []

    try {
      for (const file of files) {
        const sourceId = crypto.randomUUID()
        imported.push({ sourceId, session: await openPdf(file), file })
      }

      if (sequence !== loadSequence.current) {
        await destroySessions(
          new Map(imported.map(({ sourceId, session }) => [sourceId, session])),
        )
        return
      }

      const sources = imported.map(({ sourceId, session, file }) =>
        createSourceDocument(
          file.name,
          file.size,
          session.viewer.numPages,
          sourceId,
        ),
      )
      const nextSessions = replace
        ? new Map<string, PdfSession>()
        : new Map(sessionsRef.current)
      imported.forEach(({ sourceId, session }) => nextSessions.set(sourceId, session))

      if (replace) {
        await destroySessions(sessionsRef.current)
        const nextDocument = createEditorDocumentFromSources(sources)
        dispatch({ type: 'load', document: nextDocument })
        const firstPageId = nextDocument.pages[0]?.id ?? null
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(firstPageId ? [firstPageId] : []))
        selectionAnchorRef.current = firstPageId
        setZoom(1)
        setViewMode('width')
        setNavigatorMode('pages')
        setOutlineEntries([])
        setOutlineStatus('idle')
        setSearchQuery('')
        setSearchResults([])
        setWatermarkText('')
        setAnnotationTool('select')
        setSelectedOverlayId(null)
        setAnalyseSummary(null)
        setAnalyseProgress('')
      } else {
        const pages = sources.flatMap(createPagesForSource)
        dispatch({ type: 'append', sources, pages })
        const firstPageId = pages[0]?.id ?? selectedPageId
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(pages.map((page) => page.id)))
        selectionAnchorRef.current = firstPageId
        setOutlineStatus('idle')
        setOutlineEntries([])
        setSearchResults([])
        setSelectedOverlayId(null)
      }

      sessionsRef.current = nextSessions
      setSessions(nextSessions)
    } catch (loadError) {
      await destroySessions(
        new Map(imported.map(({ sourceId, session }) => [sourceId, session])),
      )
      setError(userFacingError(loadError, 'The PDF could not be opened.'))
    } finally {
      if (sequence === loadSequence.current) setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (addPdfInputRef.current) addPdfInputRef.current.value = ''
    }
  }, [selectedPageId])

  const loadImageFiles = useCallback(async (files: File[], replace: boolean) => {
    if (files.length === 0) return
    searchAbortRef.current?.abort()
    analyseAbortRef.current?.abort()
    const sequence = ++loadSequence.current
    setBusy(replace ? 'opening' : 'adding')
    setError(null)
    const imported: Array<{ sourceId: string; session: PdfSession; name: string; size: number }> = []

    try {
      const { imageToPdf } = await import('./pdf/importImages')
      for (const file of files) {
        const converted = await imageToPdf(file)
        const sourceId = crypto.randomUUID()
        imported.push({
          sourceId,
          session: await openPdfBytes(converted.bytes),
          name: converted.name,
          size: file.size,
        })
      }

      if (sequence !== loadSequence.current) {
        await destroySessions(
          new Map(imported.map(({ sourceId, session }) => [sourceId, session])),
        )
        return
      }

      const sources = imported.map(({ sourceId, session, name, size }) =>
        createSourceDocument(name, size, session.viewer.numPages, sourceId),
      )
      const nextSessions = replace
        ? new Map<string, PdfSession>()
        : new Map(sessionsRef.current)
      imported.forEach(({ sourceId, session }) => nextSessions.set(sourceId, session))

      if (replace) {
        await destroySessions(sessionsRef.current)
        const nextDocument = createEditorDocumentFromSources(sources, 'images.pdf')
        dispatch({ type: 'load', document: nextDocument })
        const firstPageId = nextDocument.pages[0]?.id ?? null
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(firstPageId ? [firstPageId] : []))
        selectionAnchorRef.current = firstPageId
        setZoom(1)
        setViewMode('width')
        setNavigatorMode('pages')
        setOutlineEntries([])
        setOutlineStatus('idle')
        setSearchQuery('')
        setSearchResults([])
        setWatermarkText('')
        setAnnotationTool('select')
        setSelectedOverlayId(null)
        setAnalyseSummary(null)
        setAnalyseProgress('')
      } else {
        const pages = sources.flatMap(createPagesForSource)
        dispatch({ type: 'append', sources, pages })
        const firstPageId = pages[0]?.id ?? selectedPageId
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(pages.map((page) => page.id)))
        selectionAnchorRef.current = firstPageId
        setOutlineStatus('idle')
        setOutlineEntries([])
        setSearchResults([])
        setSelectedOverlayId(null)
      }

      sessionsRef.current = nextSessions
      setSessions(nextSessions)
    } catch (importError) {
      await destroySessions(
        new Map(imported.map(({ sourceId, session }) => [sourceId, session])),
      )
      setError(userFacingError(importError, 'The images could not be imported.'))
    } finally {
      if (sequence === loadSequence.current) setBusy(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }, [selectedPageId])

  const sourceBytes = useCallback(
    () =>
      new Map(
        [...sessionsRef.current].map(([sourceId, value]) => [
          sourceId,
          value.bytes,
        ]),
      ),
    [],
  )

  const saveDocument = useCallback(async () => {
    if (!editorDocument || sessions.size === 0 || busy) return
    setBusy('exporting')
    setError(null)
    try {
      const bytes = await exportPdf(sourceBytes(), editorDocument)
      downloadPdf(bytes, editorDocument.name)
    } catch (cause) {
      setError(userFacingError(cause, 'The edited PDF could not be exported. Your source file is unchanged.'))
    } finally {
      setBusy(null)
    }
  }, [busy, editorDocument, sessions, sourceBytes])

  const extractSelected = useCallback(async () => {
    if (selectedPages.length === 0 || !editorDocument || busy) return
    setBusy('extracting')
    setError(null)
    try {
      const sourceIds = new Set(
        selectedPages.map((page) => page.sourceDocumentId),
      )
      const sources = editorDocument.sources.filter(({ id }) => sourceIds.has(id))
      if (sources.length !== sourceIds.size) {
        throw new Error('A selected page source is unavailable.')
      }
      const outputName =
        selectedPages.length === 1
          ? `page-${selectedIndex + 1}.pdf`
          : `${selectedPages.length}-selected-pages.pdf`
      const bytes = await exportPdf(sourceBytes(), {
        ...editorDocument,
        name: outputName,
        sources,
        pages: selectedPages,
      })
      downloadPdf(bytes, outputName)
    } catch (extractError) {
      setError(
        extractError instanceof Error
          ? extractError.message
          : 'The selected page could not be extracted.',
      )
    } finally {
      setBusy(null)
    }
  }, [busy, editorDocument, selectedIndex, selectedPages, sourceBytes])

  const exportSelectedPng = useCallback(async () => {
    if (!selectedPage || !selectedSession || !editorDocument || busy) return
    setBusy('rendering')
    setError(null)
    try {
      const bytes = await exportPdf(sourceBytes(), {
        ...editorDocument,
        sources: editorDocument.sources.filter(({ id }) => id === selectedPage.sourceDocumentId),
        pages: [selectedPage],
      })
      const rendered = await openPdfBytes(bytes)
      let blob: Blob
      try { blob = await renderPageToPng(rendered.viewer, 0, 0) }
      finally { await destroySession(rendered) }
      const baseName = editorDocument.name.replace(/\.pdf$/i, '') || 'document'
      downloadBlob(blob, `${baseName}-page-${selectedIndex + 1}.png`)
    } catch (cause) {
      setError(userFacingError(cause, 'The selected page could not be rendered as a PNG image.'))
    } finally {
      setBusy(null)
    }
  }, [busy, editorDocument, selectedIndex, selectedPage, selectedSession, sourceBytes])

  const closeDocument = useCallback(async () => {
    ++loadSequence.current
    searchAbortRef.current?.abort()
    analyseAbortRef.current?.abort()
    await destroySessions(sessionsRef.current)
    sessionsRef.current = new Map()
    setSessions(new Map())
    setSelectedPageId(null)
    setSelectedPageIds(new Set())
    selectionAnchorRef.current = null
    setError(null)
    dispatch({ type: 'close' })
    setZoom(1)
    setViewMode('width')
    setNavigatorMode('pages')
    setOutlineEntries([])
    setOutlineStatus('idle')
    setSearchQuery('')
    setSearchResults([])
    setWatermarkText('')
    setAnnotationTool('select')
    setSelectedOverlayId(null)
    setOverlayClipboard(null)
    setContextTarget(null)
    setAnalyseSummary(null)
    setAnalyseProgress('')
  }, [])

  const focusPage = useCallback(
    (
      pageId: string,
      options: { extend?: boolean; toggle?: boolean } = {},
    ) => {
      if (!editorDocument) return
      const pageIndex = editorDocument.pages.findIndex((page) => page.id === pageId)
      if (pageIndex < 0) return

      setSelectedPageId(pageId)
      setSelectedOverlayId(null)
      setSelectedPageIds((current) => {
        if (options.extend) {
          const anchorId = selectionAnchorRef.current ?? selectedPageId ?? pageId
          const anchorIndex = editorDocument.pages.findIndex(
            (page) => page.id === anchorId,
          )
          const start = Math.min(anchorIndex < 0 ? pageIndex : anchorIndex, pageIndex)
          const end = Math.max(anchorIndex < 0 ? pageIndex : anchorIndex, pageIndex)
          return new Set(
            editorDocument.pages.slice(start, end + 1).map((page) => page.id),
          )
        }

        selectionAnchorRef.current = pageId
        if (options.toggle) {
          const next = new Set(current)
          if (next.has(pageId) && next.size > 1) next.delete(pageId)
          else next.add(pageId)
          return next
        }
        return new Set([pageId])
      })

      window.requestAnimationFrame(() => {
        document.getElementById(`thumbnail-${pageId}`)?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
        })
      })
    },
    [editorDocument, selectedPageId],
  )

  const jumpToPosition = useCallback(
    (position: number, extend = false) => {
      if (!editorDocument) return
      const bounded = Math.max(0, Math.min(position, editorDocument.pages.length - 1))
      const page = editorDocument.pages[bounded]
      if (page) focusPage(page.id, { extend })
    },
    [editorDocument, focusPage],
  )

  const moveSelected = useCallback(
    (direction: -1 | 1) => {
      if (!editorDocument || selectedPages.length === 0) return
      dispatch({
        type: 'moveSelection',
        pageIds: selectedPages.map((page) => page.id),
        direction,
      })
    },
    [editorDocument, selectedPages],
  )

  const deleteSelected = useCallback(() => {
    if (
      !selectedPage ||
      !editorDocument ||
      selectedPages.length === 0 ||
      editorDocument.pages.length <= selectedPages.length
    ) {
      return
    }
    const deleting = new Set(selectedPages.map((page) => page.id))
    const fallback =
      editorDocument.pages.slice(selectedIndex + 1).find((page) => !deleting.has(page.id)) ??
      [...editorDocument.pages.slice(0, selectedIndex)]
        .reverse()
        .find((page) => !deleting.has(page.id)) ??
      null
    dispatch({ type: 'delete', pageIds: [...deleting] })
    setSelectedPageId(fallback?.id ?? null)
    setSelectedPageIds(new Set(fallback ? [fallback.id] : []))
    selectionAnchorRef.current = fallback?.id ?? null
  }, [editorDocument, selectedIndex, selectedPage, selectedPages])

  const duplicateSelected = useCallback(() => {
    if (selectedPages.length === 0) return
    const duplicates = selectedPages.map((page) => ({
      pageId: page.id,
      duplicateId: `${page.id}:copy:${crypto.randomUUID()}`,
    }))
    dispatch({ type: 'duplicateSelection', duplicates })
    setSelectedPageId(duplicates[0].duplicateId)
    setSelectedPageIds(new Set(duplicates.map(({ duplicateId }) => duplicateId)))
    selectionAnchorRef.current = duplicates[0].duplicateId
  }, [selectedPages])

  const addOverlay = useCallback(
    (overlay: PageOverlay) => {
      if (!selectedPage) return
      dispatch({ type: 'addOverlay', pageId: selectedPage.id, overlay })
      setSelectedOverlayId(overlay.id)
      if (overlay.type !== 'ink') setAnnotationTool('select')
    },
    [selectedPage],
  )

  const updateSelectedOverlay = useCallback(
    (overlayId: string, changes: Partial<PageOverlay>) => {
      if (!selectedPage) return
      dispatch({
        type: 'updateOverlay',
        pageId: selectedPage.id,
        overlayId,
        changes,
      })
    },
    [selectedPage],
  )

  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedPage || !selectedOverlayId) return false
    dispatch({
      type: 'deleteOverlay',
      pageId: selectedPage.id,
      overlayId: selectedOverlayId,
    })
    setSelectedOverlayId(null)
    return true
  }, [selectedOverlayId, selectedPage])

  const copySelectedOverlay = useCallback(() => {
    if (!selectedOverlay) return
    setOverlayClipboard({ ...selectedOverlay })
  }, [selectedOverlay])

  const pasteOverlay = useCallback(() => {
    if (!selectedPage || !overlayClipboard) return
    const overlay = {
      ...overlayClipboard,
      id: crypto.randomUUID(),
      x: Math.min(1 - overlayClipboard.width, overlayClipboard.x + 0.025),
      y: Math.min(1 - overlayClipboard.height, overlayClipboard.y + 0.025),
      extracted: false,
      edited: false,
    }
    dispatch({ type: 'addOverlay', pageId: selectedPage.id, overlay })
    setSelectedOverlayId(overlay.id)
    setAnnotationTool('select')
  }, [overlayClipboard, selectedPage])

  const duplicateSelectedOverlay = useCallback(() => {
    if (!selectedPage || !selectedOverlay) return
    const duplicateId = crypto.randomUUID()
    dispatch({
      type: 'duplicateOverlay',
      pageId: selectedPage.id,
      overlayId: selectedOverlay.id,
      duplicateId,
    })
    setSelectedOverlayId(duplicateId)
  }, [selectedOverlay, selectedPage])

  const selectAllPages = useCallback(() => {
    if (!editorDocument) return
    setSelectedPageIds(new Set(editorDocument.pages.map((page) => page.id)))
    const firstPageId = editorDocument.pages[0]?.id ?? null
    setSelectedPageId(firstPageId)
    selectionAnchorRef.current = firstPageId
  }, [editorDocument])

  const closeContextMenu = useCallback(() => setContextTarget(null), [])

  const placeContextOverlay = useCallback(
    (type: OverlayType) => {
      if (contextTarget?.kind !== 'canvas') return
      const overlay = createDefaultOverlay(
        type,
        contextTarget.point.x,
        contextTarget.point.y,
        annotationColor,
      )
      dispatch({ type: 'addOverlay', pageId: contextTarget.pageId, overlay })
      setSelectedOverlayId(overlay.id)
      setAnnotationTool('select')
    },
    [annotationColor, contextTarget],
  )

  const pasteOverlayAtContext = useCallback(() => {
    if (contextTarget?.kind !== 'canvas' || !overlayClipboard) return
    const overlay = {
      ...overlayClipboard,
      id: crypto.randomUUID(),
      x: Math.max(
        0,
        Math.min(1 - overlayClipboard.width, contextTarget.point.x - overlayClipboard.width / 2),
      ),
      y: Math.max(
        0,
        Math.min(1 - overlayClipboard.height, contextTarget.point.y - overlayClipboard.height / 2),
      ),
    }
    dispatch({ type: 'addOverlay', pageId: contextTarget.pageId, overlay })
    setSelectedOverlayId(overlay.id)
    setAnnotationTool('select')
  }, [contextTarget, overlayClipboard])

  const contextMenuItems: ContextMenuItem[] = (() => {
    if (!contextTarget || !editorDocument) return []

    if (contextTarget.kind === 'pages') {
      const selectionLabel = selectedPages.length === 1 ? 'page' : 'pages'
      return [
        {
          id: 'move-earlier',
          label: 'Move earlier',
          icon: <ArrowUp size={16} />,
          disabled: !canMoveEarlier,
          onSelect: () => moveSelected(-1),
        },
        {
          id: 'move-later',
          label: 'Move later',
          icon: <ArrowDown size={16} />,
          disabled: !canMoveLater,
          onSelect: () => moveSelected(1),
        },
        {
          id: 'rotate-left',
          label: 'Rotate left',
          icon: <RotateCcw size={16} />,
          separatorBefore: true,
          onSelect: () => dispatch({
            type: 'rotate',
            pageIds: selectedPages.map((page) => page.id),
            degrees: -90,
          }),
        },
        {
          id: 'rotate-right',
          label: 'Rotate right',
          icon: <RotateCw size={16} />,
          onSelect: () => dispatch({
            type: 'rotate',
            pageIds: selectedPages.map((page) => page.id),
            degrees: 90,
          }),
        },
        {
          id: 'duplicate-pages',
          label: `Duplicate ${selectionLabel}`,
          icon: <Copy size={16} />,
          separatorBefore: true,
          onSelect: duplicateSelected,
        },
        {
          id: 'extract-pages',
          label: `Extract ${selectionLabel}`,
          icon: <Scissors size={16} />,
          onSelect: () => void extractSelected(),
        },
        {
          id: 'export-page-png',
          label: 'Export focused page as PNG',
          icon: <ImageDown size={16} />,
          disabled: busy !== null,
          onSelect: () => void exportSelectedPng(),
        },
        {
          id: 'select-all-pages',
          label: 'Select all pages',
          icon: <CheckSquare2 size={16} />,
          separatorBefore: true,
          disabled: selectedPages.length === editorDocument.pages.length,
          onSelect: selectAllPages,
        },
        {
          id: 'delete-pages',
          label: `Remove ${selectionLabel}`,
          icon: <Trash2 size={16} />,
          danger: true,
          disabled: selectedPages.length === editorDocument.pages.length,
          onSelect: deleteSelected,
        },
      ]
    }

    if (contextTarget.kind === 'canvas') {
      return [
        { id: 'draw-ink', label: 'Draw on page', onSelect: () => setAnnotationTool('ink') },
        { id: 'signature', label: 'Add signature', onSelect: () => setSignatureOpen(true) },
        {
          id: 'add-text',
          label: 'Add text here',
          icon: <Type size={16} />,
          onSelect: () => placeContextOverlay('text'),
        },
        {
          id: 'add-highlight',
          label: 'Add highlight here',
          icon: <Highlighter size={16} />,
          onSelect: () => placeContextOverlay('highlight'),
        },
        {
          id: 'add-rectangle',
          label: 'Add rectangle here',
          icon: <Square size={16} />,
          onSelect: () => placeContextOverlay('rectangle'),
        },
        {
          id: 'add-ellipse',
          label: 'Add ellipse here',
          icon: <Circle size={16} />,
          onSelect: () => placeContextOverlay('ellipse'),
        },
        {
          id: 'add-line',
          label: 'Add line here',
          icon: <Slash size={16} />,
          onSelect: () => placeContextOverlay('line'),
        },
        {
          id: 'paste-annotation',
          label: 'Paste annotation here',
          icon: <ClipboardPaste size={16} />,
          separatorBefore: true,
          disabled: !overlayClipboard,
          onSelect: pasteOverlayAtContext,
        },
        {
          id: 'rotate-page-left',
          label: 'Rotate page left',
          icon: <RotateCcw size={16} />,
          separatorBefore: true,
          onSelect: () => dispatch({
            type: 'rotate',
            pageIds: [contextTarget.pageId],
            degrees: -90,
          }),
        },
        {
          id: 'rotate-page-right',
          label: 'Rotate page right',
          icon: <RotateCw size={16} />,
          onSelect: () => dispatch({
            type: 'rotate',
            pageIds: [contextTarget.pageId],
            degrees: 90,
          }),
        },
        {
          id: 'export-canvas-png',
          label: 'Export page as PNG',
          icon: <ImageDown size={16} />,
          disabled: busy !== null,
          onSelect: () => void exportSelectedPng(),
        },
      ]
    }

    const page = editorDocument.pages.find(({ id }) => id === contextTarget.pageId)
    const overlayIndex = page?.overlays.findIndex(
      ({ id }) => id === contextTarget.overlayId,
    ) ?? -1
    const overlay = overlayIndex >= 0 ? page?.overlays[overlayIndex] : null
    return [
      {
        id: 'copy-overlay',
        label: 'Copy annotation',
        icon: <Copy size={16} />,
        disabled: !overlay,
        onSelect: () => overlay && setOverlayClipboard({ ...overlay }),
      },
      {
        id: 'duplicate-overlay',
        label: 'Duplicate annotation',
        icon: <ClipboardPaste size={16} />,
        disabled: !overlay,
        onSelect: () => {
          if (!overlay) return
          const duplicateId = crypto.randomUUID()
          dispatch({
            type: 'duplicateOverlay',
            pageId: contextTarget.pageId,
            overlayId: contextTarget.overlayId,
            duplicateId,
          })
          setSelectedOverlayId(duplicateId)
        },
      },
      {
        id: 'bring-overlay-front',
        label: 'Bring to front',
        icon: <BringToFront size={16} />,
        separatorBefore: true,
        disabled: overlayIndex < 0 || overlayIndex === (page?.overlays.length ?? 0) - 1,
        onSelect: () => dispatch({
          type: 'reorderOverlay',
          pageId: contextTarget.pageId,
          overlayId: contextTarget.overlayId,
          position: 'front',
        }),
      },
      {
        id: 'send-overlay-back',
        label: 'Send to back',
        icon: <SendToBack size={16} />,
        disabled: overlayIndex <= 0,
        onSelect: () => dispatch({
          type: 'reorderOverlay',
          pageId: contextTarget.pageId,
          overlayId: contextTarget.overlayId,
          position: 'back',
        }),
      },
      {
        id: 'delete-overlay',
        label: 'Delete annotation',
        icon: <Trash2 size={16} />,
        danger: true,
        separatorBefore: true,
        disabled: !overlay,
        onSelect: () => {
          dispatch({
            type: 'deleteOverlay',
            pageId: contextTarget.pageId,
            overlayId: contextTarget.overlayId,
          })
          setSelectedOverlayId(null)
        },
      },
    ]
  })()

  const runSearch = useCallback(async () => {
    if (!editorDocument || !searchQuery.trim()) return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchStatus('searching')
    setSearchProgress(`0 / ${editorDocument.pages.length}`)
    setSearchResults([])
    try {
      const { searchEditorDocument } = await import('./pdf/navigation')
      const results = await searchEditorDocument(
        sessionsRef.current,
        editorDocument,
        searchQuery,
        controller.signal,
        (completed, total) => setSearchProgress(`${completed} / ${total}`),
      )
      if (!controller.signal.aborted) {
        setSearchResults(results)
        setSearchStatus('ready')
      }
    } catch (searchError) {
      if (!(searchError instanceof DOMException) || searchError.name !== 'AbortError') {
        setError(userFacingError(searchError, 'The document search could not be completed.'))
        setSearchStatus('idle')
      }
    }
  }, [editorDocument, searchQuery])

  const analyseDocument = useCallback(async () => {
    if (!editorDocument || busy) return
    analyseAbortRef.current?.abort()
    const controller = new AbortController()
    analyseAbortRef.current = controller
    setBusy('analysing')
    setError(null)
    setAnalyseProgress(`0 / ${editorDocument.pages.length}`)
    try {
      const { analyseEditorDocument } = await import('./pdf/text')
      const result = await analyseEditorDocument(
        sessionsRef.current,
        editorDocument,
        controller.signal,
        (completed, total) => setAnalyseProgress(`${completed} / ${total}`),
      )
      if (controller.signal.aborted) return
      dispatch({ type: 'replaceExtractedOverlays', overlays: result.overlays })
      setAnalyseSummary({
        blocks: result.blocks,
        pagesWithText: result.pagesWithText,
        emptyPages: result.emptyPages,
      })
      setAnnotationTool('select')
      const first = result.overlays[0]
      if (first) {
        setSelectedPageId(first.pageId)
        setSelectedPageIds(new Set([first.pageId]))
        selectionAnchorRef.current = first.pageId
        setSelectedOverlayId(first.overlay.id)
      } else {
        setSelectedOverlayId(null)
      }
    } catch (analyseError) {
      if (!(analyseError instanceof DOMException) || analyseError.name !== 'AbortError') {
        setError(userFacingError(analyseError, 'The document text could not be analysed.'))
      }
    } finally {
      if (analyseAbortRef.current === controller) {
        setBusy(null)
        setAnalyseProgress('')
      }
    }
  }, [busy, editorDocument])

  const showOutline = useCallback(async () => {
    setNavigatorMode('outline')
    if (!editorDocument || outlineStatus !== 'idle') return
    setOutlineStatus('loading')
    try {
      const { readEditorOutline } = await import('./pdf/navigation')
      setOutlineEntries(
        await readEditorOutline(sessionsRef.current, editorDocument),
      )
    } catch {
      setOutlineEntries([])
    } finally {
      setOutlineStatus('ready')
    }
  }, [editorDocument, outlineStatus])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editable =
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') || target.isContentEditable)
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (event.defaultPrevented) return
      if (signatureOpen) return
      if (command && key === 'o') {
        event.preventDefault()
        fileInputRef.current?.click()
        return
      }
      if (editable) return

      if (event.key === 'Escape') {
        setAnnotationTool('select')
        setSelectedOverlayId(null)
      } else if (command && key === 'c' && selectedOverlay) {
        event.preventDefault()
        copySelectedOverlay()
      } else if (command && key === 'v' && overlayClipboard && selectedPage) {
        event.preventDefault()
        pasteOverlay()
      } else if (command && key === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      } else if (command && key === 's' && editorDocument) {
        event.preventDefault()
        void saveDocument()
      } else if (command && key === 'a' && editorDocument) {
        event.preventDefault()
        selectAllPages()
      } else if (command && key === 'f' && editorDocument) {
        event.preventDefault()
        setNavigatorMode('search')
        window.requestAnimationFrame(() => searchInputRef.current?.focus())
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        jumpToPosition(selectedIndex - 1, event.shiftKey)
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        jumpToPosition(selectedIndex + 1, event.shiftKey)
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        editorDocument
      ) {
        event.preventDefault()
        if (!deleteSelectedOverlay()) deleteSelected()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    copySelectedOverlay,
    deleteSelected,
    deleteSelectedOverlay,
    editorDocument,
    jumpToPosition,
    overlayClipboard,
    pasteOverlay,
    saveDocument,
    selectAllPages,
    selectedIndex,
    selectedOverlay,
    selectedPage,
    signatureOpen,
  ])

  const openFilePicker = () => fileInputRef.current?.click()

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        aria-label="Choose a PDF"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) void loadPdfFiles(files, true)
        }}
      />
      <input
        ref={addPdfInputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        aria-label="Add PDF files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) void loadPdfFiles(files, false)
        }}
      />
      <input
        ref={imageInputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        multiple
        aria-label="Add JPEG or PNG images"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) void loadImageFiles(files, !editorDocument)
        }}
      />

      <header className="topbar">
        <div className="brand-lockup" aria-label="PDF Editor">
          <span className="brand-mark">
            <FileText size={19} strokeWidth={2.4} />
          </span>
          <span className="brand-copy">
            <strong>PDF Editor</strong>
            <span>Local workspace</span>
          </span>
        </div>

        <div className="toolbar" aria-label="Document toolbar">
          <button
            type="button"
            className="toolbar-button"
            disabled={busy !== null}
            onClick={openFilePicker}
          >
            <FolderOpen size={17} />
            <span>{editorDocument ? 'Open another' : 'Open PDF'}</span>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <IconButton
            label="Undo"
            disabled={history.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="Redo"
            disabled={history.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Redo2 size={18} />
          </IconButton>
          {editorDocument && (
            <>
              <span className="toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="toolbar-button"
                disabled={busy !== null}
                onClick={() => addPdfInputRef.current?.click()}
              >
                <Files size={17} />
                <span>Add PDFs</span>
              </button>
              <button
                type="button"
                className="toolbar-button"
                disabled={busy !== null}
                onClick={() => void analyseDocument()}
              >
                {busy === 'analysing' ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ScanSearch size={17} />
                )}
                <span>{busy === 'analysing' ? 'Analysing…' : 'Analyse'}</span>
              </button>
            </>
          )}
        </div>

        <div className="topbar-actions">
          <span className={`network-state ${online ? '' : 'is-offline'}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? 'Online' : 'Offline'}
          </span>
          <button
            type="button"
            className="export-button"
            disabled={!editorDocument || busy !== null}
            onClick={() => void saveDocument()}
          >
            {busy === 'exporting' ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Download size={17} />
            )}
            Export PDF
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>
            <X size={17} />
          </button>
        </div>
      )}
      {busy === 'analysing' && (
        <div className="progress-banner" role="status">
          <LoaderCircle className="spin" size={16} />
          <span>Analysing page {analyseProgress || '…'}</span>
          <button
            type="button"
            onClick={() => analyseAbortRef.current?.abort()}
          >
            Cancel
          </button>
        </div>
      )}

      {!editorDocument || sessions.size === 0 ? (
        <main
          className={`empty-workspace ${isDraggingFile ? 'is-dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDraggingFile(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setIsDraggingFile(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setIsDraggingFile(false)
            const files = Array.from(event.dataTransfer.files)
            const pdfFiles = files.filter(
              (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
            )
            const imageFiles = files.filter((file) =>
              ['image/jpeg', 'image/png'].includes(file.type),
            )
            if (pdfFiles.length > 0) void loadPdfFiles(pdfFiles, true)
            else if (imageFiles.length > 0) void loadImageFiles(imageFiles, true)
          }}
        >
          <section className="welcome-panel">
            <div className="welcome-icon" aria-hidden="true">
              {busy === 'opening' ? (
                <LoaderCircle className="spin" size={32} />
              ) : (
                <FilePlus2 size={32} />
              )}
            </div>
            <p className="eyebrow">PRIVATE BY DEFAULT</p>
            <h1>Your PDF never leaves this browser.</h1>
            <p className="welcome-copy">
              Merge, reorder, rotate, extract and export pages without uploading
              anything. Drop PDFs, JPEGs or PNGs here to begin.
            </p>
            <div className="welcome-actions">
              <button
                type="button"
                className="primary-open-button"
                disabled={busy !== null}
                onClick={openFilePicker}
              >
                <FolderOpen size={19} />
                {busy === 'opening' ? 'Opening files…' : 'Choose PDF files'}
              </button>
              <button
                type="button"
                className="secondary-open-button"
                disabled={busy !== null}
                onClick={() => imageInputRef.current?.click()}
              >
                <FilePlus2 size={18} /> Images to PDF
              </button>
            </div>
            <div className="trust-row" aria-label="Privacy features">
              <span><LockKeyhole size={15} /> No uploads</span>
              <span><HardDrive size={15} /> Local processing</span>
              <span><ShieldCheck size={15} /> Offline ready</span>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="page-rail" aria-label="Document pages">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">DOCUMENT</span>
                <h2>Navigator</h2>
              </div>
              <span className="count-badge">{editorDocument.pages.length}</span>
            </div>

            <div className="navigator-tabs" role="tablist" aria-label="Navigator view">
              <button
                type="button"
                role="tab"
                aria-selected={navigatorMode === 'pages'}
                onClick={() => setNavigatorMode('pages')}
              >
                <CheckSquare2 size={14} /> Pages
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={navigatorMode === 'outline'}
                onClick={() => void showOutline()}
              >
                <BookOpen size={14} /> Outline
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={navigatorMode === 'search'}
                onClick={() => {
                  setNavigatorMode('search')
                  window.requestAnimationFrame(() => searchInputRef.current?.focus())
                }}
              >
                <Search size={14} /> Search
              </button>
            </div>

            {navigatorMode === 'pages' && (
              <ol className="thumbnail-list">
                {editorDocument.pages.map((page, position) => {
                  const pageSession = sessions.get(page.sourceDocumentId)
                  if (!pageSession) return null
                  return (
                    <LazyThumbnail
                      key={page.id}
                      document={pageSession.viewer}
                      page={page}
                      position={position}
                      selected={visibleSelection.has(page.id)}
                      dragged={page.id === draggedPageId}
                      onSelect={(event) =>
                        focusPage(page.id, {
                          extend: event.shiftKey,
                          toggle: event.metaKey || event.ctrlKey,
                        })
                      }
                      onContextMenu={(event) => {
                        event.preventDefault()
                        if (visibleSelection.has(page.id)) {
                          setSelectedPageId(page.id)
                          setSelectedOverlayId(null)
                        } else {
                          setSelectedPageId(page.id)
                          setSelectedPageIds(new Set([page.id]))
                          setSelectedOverlayId(null)
                          selectionAnchorRef.current = page.id
                        }
                        setContextTarget({
                          kind: 'pages',
                          x: event.clientX,
                          y: event.clientY,
                          pageId: page.id,
                        })
                      }}
                      onDragStart={() => {
                        setDraggedPageId(page.id)
                        if (!visibleSelection.has(page.id)) focusPage(page.id)
                      }}
                      onDragEnd={() => setDraggedPageId(null)}
                      onMove={(targetIndex) => {
                        if (!draggedPageId) return
                        dispatch({ type: 'move', pageId: draggedPageId, targetIndex })
                        focusPage(draggedPageId)
                        setDraggedPageId(null)
                      }}
                      watermark={editorDocument.watermark}
                    />
                  )
                })}
              </ol>
            )}

            {navigatorMode === 'outline' && (
              <div className="navigator-content">
                {outlineStatus === 'loading' ? (
                  <p className="navigator-empty"><LoaderCircle className="spin" size={16} /> Reading outline…</p>
                ) : outlineEntries.length === 0 ? (
                  <p className="navigator-empty">This document has no navigable outline.</p>
                ) : (
                  <ul className="navigator-results outline-results">
                    {outlineEntries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          disabled={!entry.pageId}
                          style={{ paddingLeft: `${12 + entry.depth * 14}px` }}
                          onClick={() => entry.pageId && focusPage(entry.pageId)}
                        >
                          {entry.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {navigatorMode === 'search' && (
              <div className="navigator-content search-panel">
                <form
                  className="search-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void runSearch()
                  }}
                >
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    placeholder="Search document"
                    aria-label="Search document text"
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <button type="submit" disabled={!searchQuery.trim() || searchStatus === 'searching'}>
                    {searchStatus === 'searching' ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}
                    Search
                  </button>
                </form>
                {searchStatus === 'searching' && <p className="search-status">Searching pages {searchProgress}</p>}
                {searchStatus === 'ready' && searchResults.length === 0 && (
                  <p className="navigator-empty">No matches found.</p>
                )}
                {searchResults.length > 0 && (
                  <ul className="navigator-results search-results">
                    {searchResults.map((result) => {
                      const currentPosition = editorDocument.pages.findIndex(
                        (page) => page.id === result.pageId,
                      )
                      if (currentPosition < 0) return null
                      return (
                        <li key={result.id}>
                          <button type="button" onClick={() => focusPage(result.pageId)}>
                            <strong>Page {currentPosition + 1}</strong>
                            <span>{result.excerpt}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}

            <div className="rail-hint">
              {navigatorMode === 'pages' ? (
                <><Grab size={14} /> Shift-click a range · Cmd/Ctrl-click to toggle</>
              ) : (
                <><ShieldCheck size={14} /> Processed locally</>
              )}
            </div>
          </aside>

          <section ref={stageRef} className="document-stage" aria-label="Page workspace">
            <div className="stage-grid" aria-hidden="true" />
            <div className="view-controls" aria-label="Page navigation and view controls">
              <IconButton
                label="Previous page"
                disabled={selectedIndex <= 0}
                onClick={() => jumpToPosition(selectedIndex - 1)}
              >
                <ChevronLeft size={17} />
              </IconButton>
              <label className="page-jump">
                <span className="visually-hidden">Current page</span>
                <input
                  key={selectedPage?.id}
                  type="number"
                  min={1}
                  max={editorDocument.pages.length}
                  defaultValue={selectedIndex + 1}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      jumpToPosition(Number(event.currentTarget.value) - 1)
                      event.currentTarget.blur()
                    }
                  }}
                  onBlur={(event) =>
                    jumpToPosition(Number(event.currentTarget.value) - 1)
                  }
                />
                <span>/ {editorDocument.pages.length}</span>
              </label>
              <IconButton
                label="Next page"
                disabled={selectedIndex >= editorDocument.pages.length - 1}
                onClick={() => jumpToPosition(selectedIndex + 1)}
              >
                <ChevronRight size={17} />
              </IconButton>
              <span className="view-divider" aria-hidden="true" />
              <IconButton
                label="Fit page width"
                className={viewMode === 'width' ? 'is-active' : ''}
                onClick={() => setViewMode('width')}
              >
                <MoveHorizontal size={17} />
              </IconButton>
              <IconButton
                label="Fit whole page"
                className={viewMode === 'page' ? 'is-active' : ''}
                onClick={() => setViewMode('page')}
              >
                <Maximize2 size={16} />
              </IconButton>
              <IconButton
                label="Zoom out"
                disabled={viewMode === 'custom' && zoom <= 0.5}
                onClick={() => {
                  setViewMode('custom')
                  setZoom((value) => Math.max(0.5, value - 0.25))
                }}
              >
                <Minus size={17} />
              </IconButton>
              <span className="zoom-value" aria-live="polite">
                {viewMode === 'width'
                  ? 'Width'
                  : viewMode === 'page'
                    ? 'Page'
                    : `${Math.round(zoom * 100)}%`}
              </span>
              <IconButton
                label="Zoom in"
                disabled={viewMode === 'custom' && zoom >= 2}
                onClick={() => {
                  setViewMode('custom')
                  setZoom((value) => Math.min(2, value + 0.25))
                }}
              >
                <Plus size={17} />
              </IconButton>
            </div>
            {selectedPage && selectedSession && (
              <div className="focused-page">
                <div className="page-shadow">
                  <PdfCanvas
                    document={selectedSession.viewer}
                    pageIndex={selectedPage.sourcePageIndex}
                    rotationDelta={selectedPage.rotationDelta}
                    targetWidth={
                      Math.max(stageWidth - 128, 280) *
                      (viewMode === 'custom' ? zoom : 1)
                    }
                    targetHeight={
                      viewMode === 'page' ? Math.max(stageHeight - 160, 260) : undefined
                    }
                    label={`Page ${selectedIndex + 1} of ${editorDocument.pages.length}`}
                    watermark={editorDocument.watermark}
                    overlays={selectedPage.overlays}
                    interactiveAnnotations
                    annotationTool={annotationTool}
                    annotationColor={annotationColor}
                    annotationStrokeWidth={inkWidth}
                    onEraseOverlay={(overlayId) => dispatch({ type: 'deleteOverlay', pageId: selectedPage.id, overlayId })}
                    selectedOverlayId={selectedOverlayId}
                    onCreateOverlay={addOverlay}
                    onSelectOverlay={setSelectedOverlayId}
                    onChangeOverlay={updateSelectedOverlay}
                    onPageContextMenu={(event, point) => {
                      setContextTarget({
                        kind: 'canvas',
                        x: event.clientX,
                        y: event.clientY,
                        pageId: selectedPage.id,
                        point,
                      })
                    }}
                    onOverlayContextMenu={(event, overlayId) => {
                      setAnnotationTool('select')
                      setSelectedOverlayId(overlayId)
                      setContextTarget({
                        kind: 'overlay',
                        x: event.clientX,
                        y: event.clientY,
                        pageId: selectedPage.id,
                        overlayId,
                      })
                    }}
                  />
                </div>
                <span className="page-position">
                  {selectedIndex + 1} / {editorDocument.pages.length}
                </span>
              </div>
            )}
          </section>

          <aside className="inspector" aria-label="Page tools">
            <div className="panel-heading inspector-heading">
              <div>
                <span className="panel-kicker">SELECTED</span>
                <h2>
                  {selectedPages.length === 1
                    ? `Page ${selectedIndex + 1}`
                    : `${selectedPages.length} pages`}
                </h2>
              </div>
              <CheckCircle2 size={18} />
            </div>

            <section className="tool-section text-analysis-tools">
              <h3>Document text</h3>
              <button
                type="button"
                className="analyse-button"
                disabled={busy !== null}
                onClick={() => void analyseDocument()}
              >
                {busy === 'analysing' ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ScanSearch size={16} />
                )}
                {busy === 'analysing'
                  ? `Analysing ${analyseProgress}`
                  : analyseSummary
                    ? 'Re-analyse text'
                    : 'Analyse text'}
              </button>
              {analyseSummary ? (
                <p className="tool-hint">
                  {analyseSummary.blocks === 0
                    ? 'No extractable text was found. Scanned pages stay images until OCR is added.'
                    : `${analyseSummary.blocks} text block${analyseSummary.blocks === 1 ? '' : 's'} on ${analyseSummary.pagesWithText} page${analyseSummary.pagesWithText === 1 ? '' : 's'}${analyseSummary.emptyPages ? ` · ${analyseSummary.emptyPages} without text` : ''}. Click a line on the page to type. Re-analyse replaces extracted lines.`}
                </p>
              ) : (
                <p className="tool-hint">
                  Read every page locally, then turn found lines into editable boxes. This can take a while on large files.
                </p>
              )}
              {selectedPage &&
                selectedPage.overlays.some((overlay) => overlay.extracted) && (
                  <ul className="extracted-text-list">
                    {selectedPage.overlays
                      .filter((overlay) => overlay.extracted)
                      .map((overlay) => (
                        <li key={overlay.id}>
                          <button
                            type="button"
                            className={
                              selectedOverlayId === overlay.id ? 'is-active' : ''
                            }
                            onClick={() => {
                              setAnnotationTool('select')
                              setSelectedOverlayId(overlay.id)
                            }}
                          >
                            {overlay.edited ? 'Edited · ' : ''}
                            {overlay.text || 'Empty line'}
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
            </section>

            <section className="tool-section annotation-tools">
              <h3>Annotate</h3>
              <div className="annotation-tool-grid">
                <button type="button" aria-pressed={annotationTool === 'ink'} onClick={() => setAnnotationTool('ink')}>Draw</button>
                <button type="button" aria-pressed={annotationTool === 'eraser'} onClick={() => setAnnotationTool('eraser')}>Erase stroke</button>
                <button type="button" onClick={() => setSignatureOpen(true)}>Signature</button>
                <button
                  type="button"
                  className={annotationTool === 'select' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'select'}
                  onClick={() => setAnnotationTool('select')}
                >
                  <MousePointer2 size={16} /> Select
                </button>
                <button
                  type="button"
                  className={annotationTool === 'text' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'text'}
                  onClick={() => setAnnotationTool('text')}
                >
                  <Type size={16} /> Text
                </button>
                <button
                  type="button"
                  className={annotationTool === 'highlight' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'highlight'}
                  onClick={() => setAnnotationTool('highlight')}
                >
                  <Highlighter size={16} /> Highlight
                </button>
                <button
                  type="button"
                  className={annotationTool === 'underline' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'underline'}
                  onClick={() => setAnnotationTool('underline')}
                >
                  <Underline size={16} /> Underline
                </button>
                <button
                  type="button"
                  className={annotationTool === 'strikeout' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'strikeout'}
                  onClick={() => setAnnotationTool('strikeout')}
                >
                  <Strikethrough size={16} /> Strike
                </button>
                <button
                  type="button"
                  className={annotationTool === 'rectangle' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'rectangle'}
                  onClick={() => setAnnotationTool('rectangle')}
                >
                  <Square size={16} /> Box
                </button>
                <button
                  type="button"
                  className={annotationTool === 'ellipse' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'ellipse'}
                  onClick={() => setAnnotationTool('ellipse')}
                >
                  <Circle size={16} /> Ellipse
                </button>
                <button
                  type="button"
                  className={annotationTool === 'line' ? 'is-active' : ''}
                  aria-pressed={annotationTool === 'line'}
                  onClick={() => setAnnotationTool('line')}
                >
                  <Slash size={16} /> Line
                </button>
              </div>
              {annotationTool === 'ink' && <div className="ink-controls">
                <label>Ink colour <input type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} /></label>
                <label>Ink thickness <select value={inkWidth} onChange={(event) => setInkWidth(Number(event.target.value))}>
                  {[1, 2, 4, 8].map((weight) => <option key={weight} value={weight}>{weight} pt</option>)}
                </select></label>
              </div>}
              {annotationTool !== 'select' && (
                <p className="tool-hint">{annotationTool === 'ink' ? 'Drag to draw. Each stroke can be undone separately.' : annotationTool === 'eraser' ? 'Click a drawn stroke to remove it. Undo restores it.' : 'Click the page to place the annotation.'}</p>
              )}
            </section>

            {selectedOverlay && (
              <section className="tool-section annotation-properties">
                <h3>Selected {selectedOverlay.type}</h3>
                {selectedOverlay.type === 'text' && (
                  <label>
                    <span>Text</span>
                    <OverlayTextField
                      overlay={selectedOverlay}
                      onCommit={(text) =>
                        updateSelectedOverlay(selectedOverlay.id, { text })
                      }
                    />
                  </label>
                )}
                {selectedOverlay.extracted && (
                  <p className="tool-hint">
                    {selectedOverlay.edited
                      ? 'Export covers the original line with a white box and draws this replacement. The original PDF text remains in the file.'
                      : 'Click the line on the page and type. Export covers the original visually; the source glyphs stay in the file.'}
                  </p>
                )}
                <label className="color-control">
                  <span>Colour</span>
                  <input
                    type="color"
                    value={selectedOverlay.color}
                    onChange={(event) => {
                      setAnnotationColor(event.currentTarget.value)
                      updateSelectedOverlay(selectedOverlay.id, {
                        color: event.currentTarget.value,
                      })
                    }}
                  />
                </label>
                <div className="property-row">
                  <span>Opacity</span>
                  <div className="property-options">
                    {[0.25, 0.5, 0.75, 1].map((opacity) => (
                      <button
                        key={opacity}
                        type="button"
                        className={selectedOverlay.opacity === opacity ? 'is-active' : ''}
                        onClick={() =>
                          updateSelectedOverlay(selectedOverlay.id, { opacity })
                        }
                      >
                        {opacity * 100}%
                      </button>
                    ))}
                  </div>
                </div>
                {selectedOverlay.type !== 'text' && selectedOverlay.type !== 'highlight' && (
                  <div className="property-row">
                    <span>Weight</span>
                    <div className="property-options">
                      {[1, 2, 4].map((strokeWidth) => (
                        <button
                          key={strokeWidth}
                          type="button"
                          className={selectedOverlay.strokeWidth === strokeWidth ? 'is-active' : ''}
                          onClick={() =>
                            updateSelectedOverlay(selectedOverlay.id, { strokeWidth })
                          }
                        >
                          {strokeWidth}px
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="annotation-actions">
                  <button type="button" onClick={copySelectedOverlay}>
                    <Copy size={15} /> Copy
                  </button>
                  <button type="button" onClick={duplicateSelectedOverlay}>
                    <ClipboardPaste size={15} /> Duplicate
                  </button>
                  <button type="button" className="is-danger" onClick={deleteSelectedOverlay}>
                    <Trash2 size={15} /> Delete
                  </button>
                </div>
              </section>
            )}

            {!selectedOverlay && overlayClipboard && (
              <section className="tool-section clipboard-tools">
                <button type="button" onClick={pasteOverlay}>
                  <ClipboardPaste size={16} /> Paste copied annotation
                </button>
              </section>
            )}

            <section className="tool-section">
              <h3>Arrange</h3>
              <div className="button-grid">
                <button
                  type="button"
                  disabled={!canMoveEarlier}
                  onClick={() => moveSelected(-1)}
                >
                  <ArrowUp size={17} /> Earlier
                </button>
                <button
                  type="button"
                  disabled={!canMoveLater}
                  onClick={() => moveSelected(1)}
                >
                  <ArrowDown size={17} /> Later
                </button>
              </div>
            </section>

            <section className="tool-section">
              <h3>Rotate</h3>
              <div className="button-grid">
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'rotate',
                      pageIds: selectedPages.map((page) => page.id),
                      degrees: -90,
                    })
                  }
                >
                  <RotateCcw size={17} /> Left
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'rotate',
                      pageIds: selectedPages.map((page) => page.id),
                      degrees: 90,
                    })
                  }
                >
                  <RotateCw size={17} /> Right
                </button>
              </div>
            </section>

            <section className="tool-section page-details">
              <h3>Page details</h3>
              <dl>
                <div><dt>Selected</dt><dd>{selectedPages.length}</dd></div>
                <div><dt>Position</dt><dd>{selectedIndex + 1}</dd></div>
                <div><dt>Source</dt><dd>{selectedPages.length === 1 ? editorDocument.sources.find(({ id }) => id === selectedPage?.sourceDocumentId)?.name ?? 'Unknown' : 'Multiple'}</dd></div>
                <div><dt>Source page</dt><dd>{selectedPages.length === 1 ? (selectedPage?.sourcePageIndex ?? 0) + 1 : '—'}</dd></div>
                <div><dt>Rotation</dt><dd>{selectedPages.length === 1 ? `${selectedPage?.rotationDelta ?? 0}°` : 'Mixed'}</dd></div>
              </dl>
            </section>

            <section className="tool-section">
              <h3>Create</h3>
              <div className="button-grid">
                <button type="button" onClick={duplicateSelected}>
                  <Copy size={17} /> Duplicate{selectedPages.length > 1 ? ` ${selectedPages.length}` : ''}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void extractSelected()}
                >
                  <Scissors size={17} /> Extract{selectedPages.length > 1 ? ` ${selectedPages.length}` : ''}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void exportSelectedPng()}
                >
                  <ImageDown size={17} /> Page PNG
                </button>
              </div>
            </section>

            <section className="tool-section watermark-tools">
              <h3>Watermark all pages</h3>
              <label>
                <span className="visually-hidden">Watermark text</span>
                <input
                  type="text"
                  value={watermarkText}
                  maxLength={80}
                  placeholder="Draft, confidential…"
                  onChange={(event) => setWatermarkText(event.target.value)}
                />
              </label>
              <div className="button-grid">
                <button
                  type="button"
                  disabled={watermarkText.trim().length === 0}
                  onClick={() =>
                    dispatch({
                      type: 'setWatermark',
                      watermark: {
                        text: watermarkText.trim(),
                        opacity: 0.2,
                        rotation: 45,
                      },
                    })
                  }
                >
                  <Type size={17} /> Apply
                </button>
                <button
                  type="button"
                  disabled={!editorDocument.watermark}
                  onClick={() => {
                    dispatch({ type: 'setWatermark', watermark: null })
                    setWatermarkText('')
                  }}
                >
                  <X size={17} /> Clear
                </button>
              </div>
            </section>

            <button
              type="button"
              className="delete-button"
              disabled={editorDocument.pages.length <= selectedPages.length}
              onClick={deleteSelected}
            >
              <Trash2 size={17} /> Remove {selectedPages.length > 1 ? `${selectedPages.length} pages` : 'page'}
            </button>
          </aside>
        </main>
      )}

      <footer className="statusbar">
        <span className="status-file">
          {editorDocument ? editorDocument.name : 'No document open'}
        </span>
        <span>
          {editorDocument
            ? `${editorDocument.pages.length} page${editorDocument.pages.length === 1 ? '' : 's'} · ${editorDocument.sources.length} source${editorDocument.sources.length === 1 ? '' : 's'} · ${formatBytes(editorDocument.sizeBytes)}`
            : 'PDF files up to 250 MB'}
        </span>
        <span className="privacy-status">
          <ShieldCheck size={13} /> Processed locally
        </span>
        {editorDocument && (
          <button type="button" className="close-document" onClick={() => void closeDocument()}>
            Close document
          </button>
        )}
      </footer>

      <div className="mobile-page-actions" aria-label="Mobile page tools">
        <button
          type="button"
          disabled={!selectedPage || busy !== null}
          onClick={() => void analyseDocument()}
        >
          {busy === 'analysing' ? 'Analysing…' : 'Analyse'}
        </button>
        <button type="button" disabled={!selectedPage} onClick={() => setAnnotationTool(annotationTool === 'ink' ? 'select' : 'ink')}>{annotationTool === 'ink' ? 'Select' : 'Draw'}</button>
        <button type="button" disabled={!selectedPage} onClick={() => setSignatureOpen(true)}>Sign</button>
        <IconButton label="Move selected pages earlier" disabled={!canMoveEarlier} onClick={() => moveSelected(-1)}>
          <ArrowLeft size={18} />
        </IconButton>
        <IconButton label="Rotate selected pages left" disabled={selectedPages.length === 0} onClick={() => dispatch({ type: 'rotate', pageIds: selectedPages.map((page) => page.id), degrees: -90 })}>
          <RotateCcw size={18} />
        </IconButton>
        <IconButton label="Rotate selected pages right" disabled={selectedPages.length === 0} onClick={() => dispatch({ type: 'rotate', pageIds: selectedPages.map((page) => page.id), degrees: 90 })}>
          <RotateCw size={18} />
        </IconButton>
        <IconButton label="Move selected pages later" disabled={!canMoveLater} onClick={() => moveSelected(1)}>
          <ArrowRight size={18} />
        </IconButton>
        <IconButton label="Remove selected pages" disabled={!editorDocument || editorDocument.pages.length <= selectedPages.length} onClick={deleteSelected} className="danger-icon">
          <Trash2 size={18} />
        </IconButton>
      </div>

      <ServiceWorkerStatus />
      {signatureOpen && selectedPage && <SignatureDialog
        onClose={() => setSignatureOpen(false)}
        onInsert={(overlay) => {
          const canvas = stageRef.current?.querySelector('canvas')
          const bounds = canvas?.getBoundingClientRect()
          addOverlay({ ...overlay, height: Math.min(0.8, overlay.height * (bounds ? bounds.width / bounds.height : 1)) })
        }} />}

      {contextTarget && (
        <ContextMenu
          x={contextTarget.x}
          y={contextTarget.y}
          label={
            contextTarget.kind === 'pages'
              ? 'Page actions'
              : contextTarget.kind === 'overlay'
                ? 'Annotation actions'
                : 'Page canvas actions'
          }
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
