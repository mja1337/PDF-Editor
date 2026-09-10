import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  BringToFront,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Copy,
  Diamond,
  Download,
  Eraser,
  FilePlus2,
  FileText,
  Files,
  FolderOpen,
  Grab,
  LoaderCircle,
  ImageDown,
  Highlighter,
  Maximize2,
  Minus,
  MoveHorizontal,
  MousePointer2,
  PenLine,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Settings,
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
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import { OcrConsentDialog } from './components/OcrConsentDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SignatureDialog } from './components/SignatureDialog'
import type { AnnotationTool } from './components/AnnotationLayer'
import {
  ContextMenu,
  type ContextMenuItem,
} from './components/ContextMenu'
import { PasswordDialog } from './components/PasswordDialog'
import { PdfCanvas } from './components/PdfCanvas'
import { SearchExcerpt } from './components/SearchExcerpt'
import { ServiceWorkerStatus } from './components/ServiceWorkerStatus'
import {
  createEditorDocumentFromSources,
  createPagesForSource,
  createSourceDocument,
  documentReducer,
  initialHistory,
} from './domain/document'
import type { LogoStampConfig, OverlayType, PageOverlay } from './domain/document'
import { createDefaultOverlay, isClosedDrawShape, withSketchStyle } from './domain/overlays'
import {
  loadAppStorage,
  saveOcrConsent,
  saveSavedSignature,
  saveStamp,
} from './domain/appStorage'
import type { OcrConsent, SavedSignature } from './domain/preferences'
import { platformOcrAvailable } from './pdf/ocr'
import { openPdf, openPdfBytes, renderPageToPng, type PdfSession } from './pdf/engine'
import { downloadBlob, downloadPdf, exportPdf } from './pdf/export'
import type { OutlineEntry, SearchResult } from './pdf/navigation'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  previewTargetWidth,
  stepCustomZoom,
  zoomRatioFromPreview,
  type PageViewMode,
} from './pdf/pageView'

function userFacingError(error: unknown, fallback: string) {
  if (
    error instanceof TypeError &&
    /Failed to fetch dynamically imported module/i.test(error.message)
  ) {
    if (import.meta.env.DEV) {
      return 'The editor lost its connection to the local app. Refresh the page. If that does not help, restart npm run dev.'
    }
    return 'The editor could not load a required module. Hard-refresh the page (Ctrl+Shift+R or Cmd+Shift+R) to clear stale cache, then try again.'
  }
  return error instanceof Error ? error.message : fallback
}

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

const ANNOTATE_PALETTE: Array<
  | { id: AnnotationTool; label: string; icon: LucideIcon }
  | { id: 'signature'; label: string; icon: LucideIcon }
> = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'ink', label: 'Draw', icon: Pencil },
  { id: 'eraser', label: 'Erase', icon: Eraser },
  { id: 'signature', label: 'Signature', icon: PenLine },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strike', icon: Strikethrough },
  { id: 'rectangle', label: 'Box', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'line', label: 'Line', icon: Slash },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
]

const ANNOTATE_COLOURS = [
  '#111111',
  '#ffffff',
  '#e05252',
  '#f4d35e',
  '#f97316',
  '#22c55e',
  '#147d72',
  '#3b82f6',
  '#a855f7',
]

const STROKE_WEIGHTS = [1, 2, 4, 8] as const

function annotationUsesColour(tool: AnnotationTool) {
  return (
    tool === 'ink' ||
    tool === 'highlight' ||
    tool === 'underline' ||
    tool === 'strikeout' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'diamond'
  )
}

function annotationUsesWeight(tool: AnnotationTool) {
  return (
    tool === 'ink' ||
    tool === 'underline' ||
    tool === 'strikeout' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'diamond'
  )
}

function annotationUsesFill(tool: AnnotationTool) {
  return tool === 'rectangle' || tool === 'ellipse' || tool === 'diamond'
}

function annotationHint(tool: AnnotationTool, hasExtracted: boolean) {
  if (tool === 'select') return 'Drag a mark to move it. Handles resize. Click empty space to clear the selection.'
  if (tool === 'ink') return 'Draw freely like a pen. Click a stroke to move it. Escape returns to Select.'
  if (tool === 'eraser') return 'Drag over strokes, shapes, or notes. Escape returns to Select.'
  if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
    return hasExtracted
      ? 'Click a mark to move it, or an analysed line to mark. Drag empty space to draw. Escape returns to Select.'
      : 'Drag empty space to size a mark. Click an existing mark to move it.'
  }
  if (tool === 'text') return 'Click or drag empty space to place text, then type. Click a mark to move it.'
  if (tool === 'line' || tool === 'arrow') {
    return 'Drag empty space from A to B. Click a mark to move it. Shift snaps 45°. Escape returns to Select.'
  }
  if (tool === 'rectangle' || tool === 'ellipse' || tool === 'diamond') {
    return 'Drag empty space to size. Click a mark to move it. Shift constrains. Escape returns to Select.'
  }
  return 'Click the page to place the annotation.'
}

function analysingLabel(progress: string) {
  return progress.includes(' / ') ? `Analysing ${progress}` : progress || 'Analysing…'
}

function scannedPageHint(ocrConsent: 'unset' | 'accepted' | 'declined') {
  if (ocrConsent === 'accepted') {
    return platformOcrAvailable()
      ? 'No text was found with PDF data, this browser’s detector, or Tesseract OCR. The page is likely a photo or a language other than English.'
      : 'No text was found with PDF data or Tesseract OCR. The page is likely a photo or a language other than English.'
  }
  if (platformOcrAvailable()) {
    return 'No text was found, including with this browser’s on-device detector. You can download a local Tesseract engine from this GitHub Pages site in Settings to retry scans.'
  }
  return 'No extractable PDF text was found. You can download a local Tesseract engine from this GitHub Pages site in Settings to read scanned pages.'
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
  const [viewMode, setViewMode] = useState<PageViewMode>('width')
  const [previewWidth, setPreviewWidth] = useState(0)
  const [navigatorMode, setNavigatorMode] = useState<NavigatorMode>('pages')
  const [outlineEntries, setOutlineEntries] = useState<OutlineEntry[]>([])
  const [hasOutline, setHasOutline] = useState(false)
  const [outlineStatus, setOutlineStatus] = useState<'idle' | 'loading' | 'ready'>(
    'idle',
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchStatus, setSearchStatus] = useState<
    'idle' | 'searching' | 'ready'
  >('idle')
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const [searchProgress, setSearchProgress] = useState('')
  const [analyseProgress, setAnalyseProgress] = useState('')
  const [analyseSummary, setAnalyseSummary] = useState<{
    blocks: number
    pagesWithText: number
    emptyPages: number
    ocrPages: number
  } | null>(null)
  const [watermarkText, setWatermarkText] = useState('')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('select')
  const [annotationColor, setAnnotationColor] = useState('#e05252')
  const [annotationFill, setAnnotationFill] = useState(false)
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  const [overlayClipboard, setOverlayClipboard] = useState<PageOverlay | null>(null)
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [pendingSignature, setPendingSignature] = useState<SavedSignature | null>(null)
  const [savedSignature, setSavedSignature] = useState<SavedSignature | null>(null)
  const [savedStamp, setSavedStamp] = useState<LogoStampConfig | null>(null)
  const [ocrConsent, setOcrConsent] = useState<OcrConsent>('unset')
  const savedStampRef = useRef(savedStamp)
  const ocrConsentRef = useRef(ocrConsent)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ocrPromptOpen, setOcrPromptOpen] = useState(false)
  const [passwordPrompt, setPasswordPrompt] = useState<{
    fileName: string
    incorrect: boolean
  } | null>(null)
  const [inkWidth, setInkWidth] = useState(2)
  const [toolWeights, setToolWeights] = useState<Partial<Record<AnnotationTool, number>>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addPdfInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchResultRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const sessionsRef = useRef<Map<string, PdfSession>>(new Map())
  const loadSequence = useRef(0)
  const selectionAnchorRef = useRef<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const analyseAbortRef = useRef<AbortController | null>(null)
  const passwordPromptRef = useRef<((password: string | null) => void) | null>(null)
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
  const searchHighlightOverlayIds = useMemo(() => {
    if (searchStatus !== 'ready' || searchResults.length === 0 || !selectedPage) {
      return undefined
    }
    const ids = searchResults
      .filter((result) => result.pageId === selectedPage.id && result.overlayId)
      .map((result) => result.overlayId!)
    return ids.length > 0 ? new Set(ids) : undefined
  }, [searchResults, searchStatus, selectedPage])
  const activeSearchOverlayId = useMemo(() => {
    if (searchStatus !== 'ready' || searchResults.length === 0 || !selectedPage) {
      return null
    }
    const active = searchResults[activeSearchIndex]
    if (!active || active.pageId !== selectedPage.id) return null
    return active.overlayId ?? null
  }, [activeSearchIndex, searchResults, searchStatus, selectedPage])
  const selectedOverlay =
    selectedPage?.overlays.find((overlay) => overlay.id === selectedOverlayId) ??
    null

  const handlePreviewSize = useCallback((size: { width: number }) => {
    setPreviewWidth(size.width)
  }, [])

  useEffect(() => {
    savedStampRef.current = savedStamp
  }, [savedStamp])

  useEffect(() => {
    ocrConsentRef.current = ocrConsent
  }, [ocrConsent])

  useEffect(() => {
    void loadAppStorage().then((storage) => {
      setOcrConsent(storage.settings.ocrConsent)
      setSavedStamp(storage.stamp)
      setSavedSignature(storage.signature)
    })
  }, [])

  const changeZoom = (direction: 1 | -1) => {
    const currentRatio =
      viewMode === 'custom' ? zoom : zoomRatioFromPreview(previewWidth, stageWidth)
    setViewMode('custom')
    setZoom(stepCustomZoom(currentRatio, direction))
  }

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

  useEffect(() => {
    if (!editorDocument || sessions.size === 0) return
    let cancelled = false
    void import('./pdf/navigation').then(({ documentHasOutline }) =>
      documentHasOutline(sessionsRef.current, editorDocument).then((value) => {
        if (cancelled) return
        setHasOutline(value)
        if (!value) {
          setNavigatorMode((mode) => (mode === 'outline' ? 'pages' : mode))
        }
      }),
    )
    return () => {
      cancelled = true
    }
  }, [editorDocument, sessions])

  const promptPdfPassword = useCallback((fileName: string, incorrect: boolean) => {
    return new Promise<string | null>((resolve) => {
      passwordPromptRef.current = resolve
      setPasswordPrompt({ fileName, incorrect })
    })
  }, [])

  const finishPasswordPrompt = useCallback((password: string | null) => {
    passwordPromptRef.current?.(password)
    passwordPromptRef.current = null
    setPasswordPrompt(null)
  }, [])

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
        imported.push({
          sourceId,
          session: await openPdf(file, {
            promptPassword: ({ incorrect }) => promptPdfPassword(file.name, incorrect),
          }),
          file,
        })
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
        nextDocument.stamp = savedStampRef.current
        dispatch({ type: 'load', document: nextDocument })
        const firstPageId = nextDocument.pages[0]?.id ?? null
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(firstPageId ? [firstPageId] : []))
        selectionAnchorRef.current = firstPageId
        setZoom(1)
        setViewMode('width')
        setNavigatorMode('pages')
        setOutlineEntries([])
        setHasOutline(false)
        setOutlineStatus('idle')
        setSearchQuery('')
        setSearchResults([])
        setActiveSearchIndex(0)
        setWatermarkText('')
        setAnnotationTool('select')
        setSelectedOverlayId(null)
        setAnalyseSummary(null)
        setAnalyseProgress('')
        setOcrPromptOpen(false)
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
        setActiveSearchIndex(0)
        setSelectedOverlayId(null)
      }

      sessionsRef.current = nextSessions
      setSessions(nextSessions)
    } catch (loadError) {
      await destroySessions(
        new Map(imported.map(({ sourceId, session }) => [sourceId, session])),
      )
      setError(
        loadError instanceof Error && loadError.message === 'Password entry was cancelled.'
          ? 'Opening was cancelled.'
          : userFacingError(loadError, 'The PDF could not be opened.'),
      )
    } finally {
      if (sequence === loadSequence.current) setBusy(null)
      finishPasswordPrompt(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (addPdfInputRef.current) addPdfInputRef.current.value = ''
    }
  }, [finishPasswordPrompt, promptPdfPassword, selectedPageId])

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
        nextDocument.stamp = savedStampRef.current
        dispatch({ type: 'load', document: nextDocument })
        const firstPageId = nextDocument.pages[0]?.id ?? null
        setSelectedPageId(firstPageId)
        setSelectedPageIds(new Set(firstPageId ? [firstPageId] : []))
        selectionAnchorRef.current = firstPageId
        setZoom(1)
        setViewMode('width')
        setNavigatorMode('pages')
        setOutlineEntries([])
        setHasOutline(false)
        setOutlineStatus('idle')
        setSearchQuery('')
        setSearchResults([])
        setActiveSearchIndex(0)
        setWatermarkText('')
        setAnnotationTool('select')
        setSelectedOverlayId(null)
        setAnalyseSummary(null)
        setAnalyseProgress('')
        setOcrPromptOpen(false)
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
        setActiveSearchIndex(0)
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

  const sourcePasswords = useCallback(
    () =>
      new Map(
        [...sessionsRef.current].flatMap(([sourceId, session]) =>
          session.openPassword ? [[sourceId, session.openPassword] as const] : [],
        ),
      ),
    [],
  )

  const saveDocument = useCallback(async () => {
    if (!editorDocument || sessions.size === 0 || busy) return
    setBusy('exporting')
    setError(null)
    try {
      const bytes = await exportPdf(
        sourceBytes(),
        editorDocument,
        undefined,
        sourcePasswords(),
      )
      downloadPdf(bytes, editorDocument.name)
    } catch (cause) {
      setError(userFacingError(cause, 'The edited PDF could not be exported. Your source file is unchanged.'))
    } finally {
      setBusy(null)
    }
  }, [busy, editorDocument, sessions, sourceBytes, sourcePasswords])

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
      const bytes = await exportPdf(
        sourceBytes(),
        {
          ...editorDocument,
          name: outputName,
          sources,
          pages: selectedPages,
        },
        undefined,
        sourcePasswords(),
      )
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
  }, [busy, editorDocument, selectedIndex, selectedPages, sourceBytes, sourcePasswords])

  const exportSelectedPng = useCallback(async () => {
    if (!selectedPage || !selectedSession || !editorDocument || busy) return
    setBusy('rendering')
    setError(null)
    try {
      const bytes = await exportPdf(
        sourceBytes(),
        {
          ...editorDocument,
          sources: editorDocument.sources.filter(({ id }) => id === selectedPage.sourceDocumentId),
          pages: [selectedPage],
        },
        undefined,
        sourcePasswords(),
      )
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
  }, [busy, editorDocument, selectedIndex, selectedPage, selectedSession, sourceBytes, sourcePasswords])

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
    setHasOutline(false)
    setOutlineStatus('idle')
    setSearchQuery('')
    setSearchResults([])
    setActiveSearchIndex(0)
    setWatermarkText('')
    setAnnotationTool('select')
    setSelectedOverlayId(null)
    setOverlayClipboard(null)
    setContextTarget(null)
    setAnalyseSummary(null)
    setAnalyseProgress('')
    setOcrPromptOpen(false)
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

  const focusSearchResult = useCallback(
    (index: number, results: SearchResult[] = searchResults) => {
      const result = results[index]
      if (!result) return
      setActiveSearchIndex(index)
      focusPage(result.pageId)
      if (result.overlayId) {
        window.requestAnimationFrame(() => setSelectedOverlayId(result.overlayId!))
      }
    },
    [focusPage, searchResults],
  )

  const stepSearchMatch = useCallback(
    (direction: 1 | -1) => {
      if (searchResults.length === 0) return
      const next =
        (activeSearchIndex + direction + searchResults.length) % searchResults.length
      focusSearchResult(next)
    },
    [activeSearchIndex, focusSearchResult, searchResults],
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
      if (overlay.type === 'text' || overlay.signature) setAnnotationTool('select')
    },
    [selectedPage],
  )

  const placeSignature = useCallback(
    (overlay: PageOverlay) => {
      addOverlay(overlay)
      setPendingSignature(null)
    },
    [addOverlay],
  )

  const applySignature = useCallback((signature: SavedSignature) => {
    setPendingSignature(signature)
    setAnnotationTool('select')
    setSelectedOverlayId(null)
  }, [])

  const chooseAnnotationTool = useCallback(
    (tool: AnnotationTool) => {
      setAnnotationTool(tool)
      const remembered = toolWeights[tool]
      if (remembered != null) setInkWidth(remembered)
    },
    [toolWeights],
  )

  const setAnnotationWeight = useCallback(
    (weight: number) => {
      setInkWidth(weight)
      setToolWeights((current) => ({ ...current, [annotationTool]: weight }))
    },
    [annotationTool],
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
        {
          strokeWidth: inkWidth,
          fill: annotationFill && isClosedDrawShape(type),
        },
      )
      const placed =
        type === 'text'
          ? { ...overlay, x: contextTarget.point.x, y: contextTarget.point.y }
          : overlay
      dispatch({ type: 'addOverlay', pageId: contextTarget.pageId, overlay: placed })
      setSelectedOverlayId(placed.id)
      setAnnotationTool('select')
    },
    [annotationColor, annotationFill, contextTarget, inkWidth],
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
        { id: 'draw-ink', label: 'Draw on page', onSelect: () => chooseAnnotationTool('ink') },
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
          id: 'add-diamond',
          label: 'Add diamond here',
          icon: <Diamond size={16} />,
          onSelect: () => placeContextOverlay('diamond'),
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
          id: 'add-arrow',
          label: 'Add arrow here',
          icon: <ArrowUpRight size={16} />,
          onSelect: () => placeContextOverlay('arrow'),
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

  const runSearch = useCallback(async (documentOverride?: typeof editorDocument) => {
    const searchableDocument = documentOverride ?? editorDocument
    if (!searchableDocument || !searchQuery.trim()) return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    setSearchStatus('searching')
    setSearchProgress(`0 / ${searchableDocument.pages.length}`)
    setSearchResults([])
    setActiveSearchIndex(0)
    try {
      const { searchEditorDocument } = await import('./pdf/navigation')
      const results = await searchEditorDocument(
        sessionsRef.current,
        searchableDocument,
        searchQuery,
        controller.signal,
        (completed, total) => setSearchProgress(`${completed} / ${total}`),
      )
      if (!controller.signal.aborted) {
        setSearchResults(results)
        setSearchStatus('ready')
        if (results.length > 0) {
          setActiveSearchIndex(0)
          focusSearchResult(0, results)
        }
      }
    } catch (searchError) {
      if (!(searchError instanceof DOMException) || searchError.name !== 'AbortError') {
        setError(userFacingError(searchError, 'The document search could not be completed.'))
        setSearchStatus('idle')
      }
    }
  }, [editorDocument, focusSearchResult, searchQuery])

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
      const consent = ocrConsentRef.current
      const result = await analyseEditorDocument(
        sessionsRef.current,
        editorDocument,
        controller.signal,
        (completed, total, label) =>
          setAnalyseProgress(label ?? `${completed} / ${total}`),
        consent === 'accepted' ? 'tesseract' : 'platform',
      )
      if (controller.signal.aborted) return
      dispatch({ type: 'replaceExtractedOverlays', overlays: result.overlays })
      setAnalyseSummary({
        blocks: result.blocks,
        pagesWithText: result.pagesWithText,
        emptyPages: result.emptyPages,
        ocrPages: result.ocrPages,
      })
      setOcrPromptOpen(result.emptyPages > 0 && consent === 'unset')
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
      if (searchQuery.trim()) {
        const incoming = new Map<string, PageOverlay[]>()
        for (const { pageId, overlay } of result.overlays) {
          const list = incoming.get(pageId) ?? []
          list.push(overlay)
          incoming.set(pageId, list)
        }
        const searchableDocument = {
          ...editorDocument,
          pages: editorDocument.pages.map((page) => ({
            ...page,
            overlays: [
              ...page.overlays.filter((overlay) => !overlay.extracted),
              ...(incoming.get(page.id) ?? []),
            ],
          })),
        }
        void runSearch(searchableDocument)
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
  }, [busy, editorDocument, runSearch, searchQuery])

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
    if (searchResults.length === 0) return
    const result = searchResults[activeSearchIndex]
    if (!result) return
    searchResultRefs.current.get(result.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeSearchIndex, searchResults])

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
      if (command && key === 'g' && searchResults.length > 0) {
        event.preventDefault()
        stepSearchMatch(event.shiftKey ? -1 : 1)
        return
      }
      if (command && key === 'o') {
        event.preventDefault()
        fileInputRef.current?.click()
        return
      }
      if (editable) return

      if (event.key === 'Escape') {
        if (pendingSignature) {
          setPendingSignature(null)
          return
        }
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
    pendingSignature,
    searchResults,
    stepSearchMatch,
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
        <div className="brand-lockup" aria-label="pdfe">
          <span className="brand-mark">
            <FileText size={19} strokeWidth={2.4} />
          </span>
          <strong>pdfe</strong>
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
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
          </IconButton>
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
          <span>
            {analyseProgress.includes(' / ')
              ? `Analysing page ${analyseProgress}`
              : analyseProgress || 'Analysing…'}
          </span>
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
            <h1>Open a PDF</h1>
            <p className="welcome-copy">
              Drop a file here. It stays in this browser.
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
              {hasOutline && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={navigatorMode === 'outline'}
                  onClick={() => void showOutline()}
                >
                  <BookOpen size={14} /> Bookmarks
                </button>
              )}
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
                      stamp={editorDocument.stamp}
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
                  <p className="navigator-empty">This document has no embedded bookmarks.</p>
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
                  <>
                    <div className="search-nav" aria-live="polite">
                      <span className="search-count">
                        {activeSearchIndex + 1} of {searchResults.length}{' '}
                        {searchResults.length === 1 ? 'match' : 'matches'}
                      </span>
                      <div className="search-nav-buttons">
                        <IconButton
                          label="Previous match"
                          onClick={() => stepSearchMatch(-1)}
                        >
                          <ArrowUp size={15} />
                        </IconButton>
                        <IconButton
                          label="Next match"
                          onClick={() => stepSearchMatch(1)}
                        >
                          <ArrowDown size={15} />
                        </IconButton>
                      </div>
                    </div>
                    <ul className="navigator-results search-results">
                      {searchResults.map((result, index) => {
                        const currentPosition = editorDocument.pages.findIndex(
                          (page) => page.id === result.pageId,
                        )
                        if (currentPosition < 0) return null
                        return (
                          <li key={result.id}>
                            <button
                              type="button"
                              className={index === activeSearchIndex ? 'is-active' : ''}
                              ref={(element) => {
                                if (element) searchResultRefs.current.set(result.id, element)
                                else searchResultRefs.current.delete(result.id)
                              }}
                              onClick={() => focusSearchResult(index)}
                            >
                              <strong>Page {currentPosition + 1}</strong>
                              <SearchExcerpt excerpt={result.excerpt} query={searchQuery} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div className="rail-hint">
              {navigatorMode === 'pages' ? (
                <><Grab size={14} /> Shift-click a range · Cmd/Ctrl-click to toggle</>
              ) : null}
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
                disabled={viewMode === 'custom' && zoom <= MIN_ZOOM}
                onClick={() => changeZoom(-1)}
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
                disabled={viewMode === 'custom' && zoom >= MAX_ZOOM}
                onClick={() => changeZoom(1)}
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
                    targetWidth={previewTargetWidth(viewMode, zoom, stageWidth)}
                    targetHeight={
                      viewMode === 'page' ? Math.max(stageHeight - 160, 260) : undefined
                    }
                    label={`Page ${selectedIndex + 1} of ${editorDocument.pages.length}`}
                    watermark={editorDocument.watermark}
                    stamp={editorDocument.stamp}
                    overlays={selectedPage.overlays}
                    interactiveAnnotations
                    annotationTool={annotationTool}
                    annotationColor={annotationColor}
                    annotationStrokeWidth={inkWidth}
                    annotationFill={annotationFill}
                    onEraseOverlay={(overlayId) => dispatch({ type: 'deleteOverlay', pageId: selectedPage.id, overlayId })}
                    selectedOverlayId={selectedOverlayId}
                    onCreateOverlay={addOverlay}
                    onSelectOverlay={setSelectedOverlayId}
                    onChangeOverlay={updateSelectedOverlay}
                    onDisplaySize={handlePreviewSize}
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
                    pendingSignature={pendingSignature}
                    onPlaceSignature={placeSignature}
                    searchHighlightOverlayIds={searchHighlightOverlayIds}
                    activeSearchOverlayId={activeSearchOverlayId}
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
                  ? analysingLabel(analyseProgress)
                  : analyseSummary
                    ? 'Re-analyse text'
                    : 'Analyse text'}
              </button>
              {analyseSummary ? (
                <p className="tool-hint">
                  {analyseSummary.blocks === 0
                    ? scannedPageHint(ocrConsent)
                    : `${analyseSummary.blocks} text block${analyseSummary.blocks === 1 ? '' : 's'} on ${analyseSummary.pagesWithText} page${analyseSummary.pagesWithText === 1 ? '' : 's'}${analyseSummary.ocrPages ? ` · ${analyseSummary.ocrPages} read from scans` : ''}${analyseSummary.emptyPages ? ` · ${analyseSummary.emptyPages} without text` : ''}. Click a line on the page to type. Re-analyse replaces extracted lines.`}
                </p>
              ) : (
                <p className="tool-hint">
                  Read every page locally, then turn found lines into editable boxes. Scanned pages can use this browser’s on-device detector, or Tesseract OCR downloaded from this GitHub Pages site after you agree. Recognition stays in the browser.
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
              <div className="annotation-tool-grid" role="toolbar" aria-label="Annotation tools">
                {ANNOTATE_PALETTE.map((item) => {
                  const Icon = item.icon
                  const active = item.id !== 'signature' && annotationTool === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={active ? 'is-active' : ''}
                      aria-label={item.label}
                      aria-pressed={item.id === 'signature' ? undefined : active}
                      title={item.label}
                      onClick={() => {
                        if (item.id === 'signature') {
                          setSignatureOpen(true)
                          return
                        }
                        chooseAnnotationTool(item.id)
                      }}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
              {(annotationUsesColour(annotationTool) ||
                annotationUsesWeight(annotationTool) ||
                annotationUsesFill(annotationTool)) && (
                <div className="paint-controls">
                  {annotationUsesColour(annotationTool) && (
                    <div className="paint-colour-row">
                      <div className="paint-swatches" role="group" aria-label="Annotation colours">
                        {ANNOTATE_COLOURS.map((colour) => (
                          <button
                            key={colour}
                            type="button"
                            className={
                              annotationColor.toLowerCase() === colour
                                ? 'is-active'
                                : ''
                            }
                            style={{ background: colour }}
                            aria-label={`Colour ${colour}`}
                            aria-pressed={annotationColor.toLowerCase() === colour}
                            title={colour}
                            onClick={() => setAnnotationColor(colour)}
                          />
                        ))}
                      </div>
                      <label className="paint-colour-picker" title="Custom colour">
                        <span>Colour</span>
                        <input
                          type="color"
                          value={annotationColor}
                          onChange={(event) => setAnnotationColor(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  {annotationUsesWeight(annotationTool) && (
                    <div className="paint-size-chips" role="group" aria-label="Stroke weight">
                      {STROKE_WEIGHTS.map((weight) => (
                        <button
                          key={weight}
                          type="button"
                          className={inkWidth === weight ? 'is-active' : ''}
                          aria-label={`${weight} pixel stroke`}
                          aria-pressed={inkWidth === weight}
                          title={`${weight} px`}
                          onClick={() => setAnnotationWeight(weight)}
                        >
                          <i style={{ height: `${Math.min(10, weight)}px` }} />
                          <span>{weight}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {annotationUsesFill(annotationTool) && (
                    <div className="property-options paint-fill-toggle">
                      <button
                        type="button"
                        className={!annotationFill ? 'is-active' : ''}
                        aria-pressed={!annotationFill}
                        onClick={() => setAnnotationFill(false)}
                      >
                        Stroke
                      </button>
                      <button
                        type="button"
                        className={annotationFill ? 'is-active' : ''}
                        aria-pressed={annotationFill}
                        onClick={() => setAnnotationFill(true)}
                      >
                        Fill
                      </button>
                    </div>
                  )}
                </div>
              )}
              {pendingSignature ? (
                <p className="tool-hint">
                  Click the page to place your signature. Sign another page the same way, or press Escape to finish.
                </p>
              ) : (
                (() => {
                  const hint = annotationHint(
                    annotationTool,
                    Boolean(selectedPage?.overlays.some((overlay) => overlay.extracted)),
                  )
                  return hint ? <p className="tool-hint">{hint}</p> : null
                })()
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
                      ? selectedOverlay.scanned
                        ? 'Export paints this change onto the scan, with the same paper and ink. The line grows toward the page margin, then wraps. The replacement is flattened into the page image.'
                        : 'Export covers the original line and draws this replacement. The line grows toward the page margin, then wraps. The original PDF text remains in the file.'
                      : 'Click the line on the page and type. Extra text grows toward the page margin, then wraps onto a new line.'}
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
                      {STROKE_WEIGHTS.map((strokeWidth) => (
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
                {isClosedDrawShape(selectedOverlay.type) && (
                  <div className="property-row">
                    <span>Fill</span>
                    <div className="property-options">
                      <button
                        type="button"
                        className={!selectedOverlay.backgroundColor ? 'is-active' : ''}
                        onClick={() => {
                          setAnnotationFill(false)
                          updateSelectedOverlay(selectedOverlay.id, {
                            backgroundColor: undefined,
                          })
                        }}
                      >
                        None
                      </button>
                      <button
                        type="button"
                        className={selectedOverlay.backgroundColor ? 'is-active' : ''}
                        onClick={() => {
                          setAnnotationFill(true)
                          updateSelectedOverlay(selectedOverlay.id, {
                            backgroundColor: selectedOverlay.color,
                          })
                        }}
                      >
                        Solid
                      </button>
                    </div>
                  </div>
                )}
                {['rectangle', 'ellipse', 'line', 'arrow', 'diamond'].includes(
                  selectedOverlay.type,
                ) && (
                  <div className="property-row">
                    <span>Stroke</span>
                    <div className="property-options">
                      <button
                        type="button"
                        className={selectedOverlay.sketch !== false ? 'is-active' : ''}
                        onClick={() =>
                          updateSelectedOverlay(
                            selectedOverlay.id,
                            withSketchStyle(selectedOverlay, true),
                          )
                        }
                      >
                        Sketchy
                      </button>
                      <button
                        type="button"
                        className={selectedOverlay.sketch === false ? 'is-active' : ''}
                        onClick={() =>
                          updateSelectedOverlay(selectedOverlay.id, { sketch: false })
                        }
                      >
                        Clean
                      </button>
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
      {ocrPromptOpen && (
        <OcrConsentDialog
          onAccept={() => {
            void saveOcrConsent('accepted').then(() => {
              setOcrConsent('accepted')
              setOcrPromptOpen(false)
              void analyseDocument()
            })
          }}
          onDecline={() => {
            void saveOcrConsent('declined').then(() => {
              setOcrConsent('declined')
              setOcrPromptOpen(false)
            })
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          stamp={editorDocument?.stamp ?? savedStamp}
          ocrConsent={ocrConsent}
          onClose={() => setSettingsOpen(false)}
          onSaveStamp={async (stamp) => {
            await saveStamp(stamp)
            setSavedStamp(stamp)
            if (editorDocument) dispatch({ type: 'setStamp', stamp })
          }}
          onSaveOcrConsent={async (consent) => {
            await saveOcrConsent(consent)
            setOcrConsent(consent)
          }}
        />
      )}
      {passwordPrompt && (
        <PasswordDialog
          key={`${passwordPrompt.fileName}:${passwordPrompt.incorrect}`}
          fileName={passwordPrompt.fileName}
          incorrect={passwordPrompt.incorrect}
          onSubmit={(password) => finishPasswordPrompt(password)}
          onCancel={() => finishPasswordPrompt(null)}
        />
      )}
      {signatureOpen && selectedPage && (
        <SignatureDialog
          savedSignature={savedSignature}
          onSaveSignature={async (signature) => {
            await saveSavedSignature(signature)
            const storage = await loadAppStorage()
            setSavedSignature(storage.signature)
          }}
          onClose={() => setSignatureOpen(false)}
          onApply={applySignature}
        />
      )}

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
