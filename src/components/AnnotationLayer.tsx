import { useEffect, useRef, useState } from 'react'
import type { OverlayType, PageOverlay } from '../domain/document'
import { normalizeOverlay } from '../domain/document'
import {
  createDefaultOverlay,
  createInkOverlay,
  createLineMark,
  hitExtractedLine,
  matchingLineMark,
} from '../domain/overlays'
import { cssFontFamily } from '../pdf/fontMatch'
import { sampleOverlayPixels, type SampledAppearance } from '../pdf/pageSample'
import { sketchStrokes } from '../pdf/sketch'
import {
  caretIndexAtX,
  createCanvasMeasurer,
  fitOverlayToText,
  overlayAtPageMargin,
  overlayFontCss,
  overlayFontPx,
  overlayPadPx,
} from '../pdf/textLayout'
import { archOffset } from '../pdf/wordArt'

export type AnnotationTool = 'select' | 'eraser' | 'wordArt' | OverlayType

interface AnnotationLayerProps {
  width: number
  height: number
  renderScale: number
  overlays: PageOverlay[]
  interactive?: boolean
  tool?: AnnotationTool
  color?: string
  strokeWidth?: number
  onErase?: (overlayId: string) => void
  selectedOverlayId?: string | null
  onCreate?: (overlay: PageOverlay) => void
  onSelect?: (overlayId: string | null) => void
  onChange?: (overlayId: string, changes: Partial<PageOverlay>) => void
  sampleAppearance?: (overlay: PageOverlay) => SampledAppearance | null
  onPageContextMenu?: (
    event: React.MouseEvent<HTMLDivElement>,
    point: { x: number; y: number },
  ) => void
  onOverlayContextMenu?: (
    event: React.MouseEvent<HTMLDivElement>,
    overlayId: string,
  ) => void
}

interface Gesture {
  mode: 'move' | 'resize' | 'maybe-move'
  overlay: PageOverlay
  startX: number
  startY: number
  localX?: number
}

const DRAG_THRESHOLD = 6

function snap(value: number) {
  return Math.round(value * 200) / 200
}

function overlayStyle(
  overlay: PageOverlay,
  renderScale: number,
  editing = false,
  appearance?: SampledAppearance | null,
): React.CSSProperties {
  const covering = Boolean(
    overlay.extracted && (overlay.edited || overlay.cover || editing),
  )
  const scanned = Boolean(overlay.extracted && overlay.scanned)
  const weight = overlay.fontWeight ?? (overlay.extracted ? 400 : 900)
  const color = appearance?.color ?? overlay.color
  const background = appearance?.backgroundColor ?? overlay.backgroundColor ?? '#ffffff'
  const pad = overlayPadPx(overlay, renderScale)
  const bleed = covering
    ? overlayFontPx(overlay, renderScale) * (scanned ? 0.45 : 0.18)
    : 0
  return {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.width * 100}%`,
    height: `${overlay.height * 100}%`,
    color,
    opacity: overlay.extracted ? 1 : overlay.opacity,
    borderColor: color,
    borderWidth: `${Math.max(0.25, overlay.strokeWidth * renderScale)}px`,
    fontSize: `${overlayFontPx(overlay, renderScale)}px`,
    fontFamily: cssFontFamily(overlay.fontRole ?? 'sans', weight),
    fontWeight: weight,
    fontStyle: overlay.fontItalic ? 'italic' : 'normal',
    lineHeight: overlay.extracted ? 1 : 1.15,
    backgroundColor: covering ? background : undefined,
    boxShadow: covering
      ? `0 0 0 ${bleed}px ${background}, 0 0 ${bleed * 0.6}px ${background}`
      : undefined,
    boxSizing: 'border-box',
    overflow: scanned && covering ? 'hidden' : undefined,
    paddingTop: overlay.extracted ? `${pad.y}px` : undefined,
    paddingBottom: overlay.extracted ? `${pad.y}px` : undefined,
    paddingLeft: overlay.extracted ? `${pad.x}px` : undefined,
    paddingRight: overlay.extracted ? `${pad.x}px` : undefined,
  }
}

function geometryOf(overlay: PageOverlay): Partial<PageOverlay> {
  return {
    x: overlay.x,
    y: overlay.y,
    width: overlay.width,
    height: overlay.height,
  }
}

function commitText(overlay: PageOverlay, value: string) {
  if (overlay.extracted) return value
  return value.trim() || 'Add text'
}

function SketchPath({ overlay, renderScale }: { overlay: PageOverlay; renderScale: number }) {
  const strokes = sketchStrokes(overlay.points ?? [])
  if (strokes.every((stroke) => stroke.length < 2)) return null
  const strokeWidth = overlay.strokeWidth * renderScale
  return (
    <svg className="annotation-line annotation-sketch" viewBox="0 0 1 1" preserveAspectRatio="none">
      {strokes.map((stroke, index) =>
        stroke.length < 2 ? null : (
          <polyline
            key={index}
            points={stroke.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={overlay.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  )
}

function WordArtLabel({ overlay }: { overlay: PageOverlay }) {
  const text = overlay.extracted && !overlay.edited ? '' : overlay.text || 'Add text'
  const style = overlay.wordArt ?? 'plain'
  if (!text) {
    return <span className="annotation-text" />
  }
  if (style === 'arch') {
    const letters = [...text]
    return (
      <span className="annotation-text wordart wordart-arch">
        {letters.map((letter, index) => {
          const offset = archOffset(index, letters.length)
          return (
            <span
              key={`${index}-${letter}`}
              style={{
                display: 'inline-block',
                transform: `translateY(${offset.y}em) rotate(${offset.rotate}deg)`,
              }}
            >
              {letter === ' ' ? '\u00a0' : letter}
            </span>
          )
        })}
      </span>
    )
  }
  if (style === 'stack') {
    return (
      <span className="annotation-text wordart wordart-stack">
        <span className="wordart-stack-back" aria-hidden="true">
          {text}
        </span>
        <span>{text}</span>
      </span>
    )
  }
  return <span className={`annotation-text wordart wordart-${style}`}>{text}</span>
}

function OverlayContent({ overlay, renderScale }: { overlay: PageOverlay; renderScale: number }) {
  if (overlay.sketch && overlay.points && overlay.points.length > 1) {
    return <SketchPath overlay={overlay} renderScale={renderScale} />
  }
  switch (overlay.type) {
    case 'image':
      return <img className="annotation-image" src={overlay.imageData} alt="" draggable={false} />
    case 'ink':
      return (
        <svg className="annotation-line" viewBox="0 0 1 1" preserveAspectRatio="none">
          <polyline points={overlay.points?.map(({ x, y }) => `${x},${y}`).join(' ')}
            fill="none" stroke={overlay.color} strokeWidth={overlay.strokeWidth * renderScale}
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )
    case 'text':
      return <WordArtLabel overlay={overlay} />
    case 'highlight':
      return <span className="annotation-highlight" style={{ background: overlay.color }} />
    case 'underline':
      return <span className="annotation-underline" style={{ borderColor: overlay.color }} />
    case 'strikeout':
      return <span className="annotation-strikeout" style={{ borderColor: overlay.color }} />
    case 'rectangle':
      return <span className="annotation-rectangle" style={{ borderColor: overlay.color }} />
    case 'ellipse':
      return <span className="annotation-ellipse" style={{ borderColor: overlay.color }} />
    case 'line':
      return (
        <svg className="annotation-line" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1="0"
            y1="0"
            x2="100"
            y2="100"
            stroke={overlay.color}
            strokeWidth={overlay.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )
    case 'arrow':
      return (
        <svg className="annotation-line" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1="8"
            y1="82"
            x2="78"
            y2="22"
            stroke={overlay.color}
            strokeWidth={overlay.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points="92,12 68,28 84,36"
            fill={overlay.color}
          />
        </svg>
      )
    case 'diamond':
      return (
        <svg className="annotation-line" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points="50,4 96,50 50,96 4,50"
            fill="none"
            stroke={overlay.color}
            strokeWidth={overlay.strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )
  }
}

function TextEditor({
  overlay,
  renderScale,
  pageWidth,
  pageHeight,
  caretIndex,
  onPreview,
  onSave,
  onCancel,
}: {
  overlay: PageOverlay
  renderScale: number
  pageWidth: number
  pageHeight: number
  caretIndex: number | null
  onPreview: (size: { width: number; height: number }) => void
  onSave: (text: string, size: { width: number; height: number }) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const valueRef = useRef(overlay.text ?? '')
  const measure = useRef(createCanvasMeasurer(overlayFontCss(overlay, renderScale)))
  const layoutRef = useRef({ width: overlay.width, height: overlay.height })
  const finished = useRef(false)
  const allowBlur = useRef(false)
  const onSaveRef = useRef(onSave)
  const [wrapAtMargin, setWrapAtMargin] = useState(
    !overlay.extracted || overlayAtPageMargin(overlay),
  )

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    measure.current = createCanvasMeasurer(overlayFontCss(overlay, renderScale))
  }, [overlay, renderScale])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      allowBlur.current = true
      const node = ref.current
      if (!node) return
      // Leave the caret alone if the editor already has focus.
      if (document.activeElement === node) return
      node.focus({ preventScroll: true })
      if (!overlay.extracted) {
        node.select()
      } else if (caretIndex != null) {
        const index = Math.max(0, Math.min(node.value.length, caretIndex))
        node.setSelectionRange(index, index)
      }
    }, 0)
    return () => {
      window.clearTimeout(timer)
      if (!finished.current) onSaveRef.current(valueRef.current, layoutRef.current)
    }
  }, [caretIndex, overlay.extracted])

  const finish = (value: string, save: boolean) => {
    if (finished.current) return
    finished.current = true
    if (save) onSave(value, layoutRef.current)
    onCancel()
  }

  return (
    <textarea
      ref={ref}
      className="annotation-text-editor"
      aria-label="Edit page text"
      defaultValue={overlay.text}
      maxLength={4000}
      onPointerDown={(event) => event.stopPropagation()}
      onInput={(event) => {
        const value = event.currentTarget.value
        valueRef.current = value
        const size = fitOverlayToText(
          overlay,
          value,
          pageWidth,
          pageHeight,
          renderScale,
          measure.current,
        )
        layoutRef.current = size
        setWrapAtMargin(!overlay.extracted || overlayAtPageMargin({ ...overlay, ...size }))
        onPreview(size)
      }}
      style={{
        whiteSpace: wrapAtMargin ? 'pre-wrap' : 'nowrap',
        overflowWrap: wrapAtMargin ? 'anywhere' : 'normal',
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          finish(event.currentTarget.value, false)
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          finish(event.currentTarget.value, true)
        }
      }}
      onBlur={(event) => {
        const value = event.currentTarget.value
        if (!allowBlur.current && value === (overlay.text ?? '')) return
        finish(value, true)
      }}
    />
  )
}

export function AnnotationLayer({
  width,
  height,
  renderScale,
  overlays,
  interactive = false,
  tool = 'select',
  color = '#e05252',
  strokeWidth = 2,
  onErase,
  selectedOverlayId,
  onCreate,
  onSelect,
  onChange,
  sampleAppearance,
  onPageContextMenu,
  onOverlayContextMenu,
}: AnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<PageOverlay | null>(null)
  const [editSession, setEditSession] = useState<{
    id: string
    caret: number | null
    appearance: SampledAppearance | null
    preview: { width: number; height: number } | null
  } | null>(null)
  const editingId = editSession?.id ?? null
  const editingCaret = editSession?.caret ?? null
  const editPreview = editSession?.preview ?? null
  const editAppearance = editSession?.appearance ?? null
  const inkRef = useRef<{ pointerId: number; points: Array<{ x: number; y: number }> } | null>(null)
  const [inkDraft, setInkDraft] = useState<PageOverlay | null>(null)
  const seenOverlayIds = useRef<Set<string> | null>(null)
  if (seenOverlayIds.current === null) {
    seenOverlayIds.current = new Set(overlays.map((overlay) => overlay.id))
  }

  useEffect(() => {
    const seen = seenOverlayIds.current
    if (!seen) return
    for (const overlay of overlays) {
      if (
        !seen.has(overlay.id) &&
        overlay.type === 'text' &&
        !overlay.extracted &&
        overlay.id === selectedOverlayId
      ) {
        setEditSession({
          id: overlay.id,
          caret: null,
          appearance: null,
          preview: null,
        })
      }
      seen.add(overlay.id)
    }
  }, [overlays, selectedOverlayId])

  if (tool !== 'select' && editSession) {
    setEditSession(null)
  }

  const beginTextEdit = (overlay: PageOverlay, caret: number | null) => {
    const canvas = layerRef.current?.parentElement?.querySelector('canvas')
    const sampled =
      overlay.extracted && canvas instanceof HTMLCanvasElement
        ? sampleOverlayPixels(canvas, overlay, width, height)
        : sampleAppearance?.(overlay) ?? null
    setEditSession({
      id: overlay.id,
      caret,
      appearance: sampled,
      preview: null,
    })
  }

  useEffect(() => {
    if (!editingId) return
    const closeIfOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('.annotation-text-editor')) return
      setEditSession(null)
    }
    window.addEventListener('pointerdown', closeIfOutside, true)
    return () => window.removeEventListener('pointerdown', closeIfOutside, true)
  }, [editingId])
  const layerSize = () => {
    const bounds = layerRef.current?.getBoundingClientRect()
    return {
      width: bounds && bounds.width > 0 ? bounds.width : width,
      height: bounds && bounds.height > 0 ? bounds.height : height,
    }
  }

  const pointerPoint = (event: React.PointerEvent) => {
    const bounds = layerRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const updateGesture = (event: React.PointerEvent) => {
    const size = layerSize()
    if (inkRef.current?.pointerId === event.pointerId) {
      const point = pointerPoint(event)
      const previous = inkRef.current.points.at(-1)!
      if (Math.hypot((point.x - previous.x) * size.width, (point.y - previous.y) * size.height) >= 1) {
        inkRef.current.points.push(point)
        setInkDraft(createInkOverlay(inkRef.current.points, color, strokeWidth))
      }
      return
    }
    const gesture = gestureRef.current
    if (!gesture || size.width <= 0 || size.height <= 0) return
    if (gesture.mode === 'maybe-move') {
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      )
      if (distance < DRAG_THRESHOLD) return
      gestureRef.current = { ...gesture, mode: 'move' }
    }
    const active = gestureRef.current
    if (!active || active.mode === 'maybe-move') return
    const deltaX = snap((event.clientX - active.startX) / size.width)
    const deltaY = snap((event.clientY - active.startY) / size.height)
    setDraft(
      normalizeOverlay(
        active.mode === 'move'
          ? {
              ...active.overlay,
              x: active.overlay.x + deltaX,
              y: active.overlay.y + deltaY,
            }
          : {
              ...active.overlay,
              width: active.overlay.width + deltaX,
              height: active.overlay.height + deltaY,
            },
      ),
    )
  }

  const finishGesture = (event: React.PointerEvent) => {
    if (inkRef.current?.pointerId === event.pointerId) {
      if (event.type !== 'pointercancel' && inkRef.current.points.length > 1) {
        onCreate?.(createInkOverlay(inkRef.current.points, color, strokeWidth))
      }
      inkRef.current = null
      setInkDraft(null)
      event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    const gesture = gestureRef.current
    if (!gesture) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (gesture.mode === 'maybe-move') {
      if (event.type !== 'pointercancel' && gesture.overlay.type === 'text') {
        let caret: number | null = null
        if (gesture.overlay.extracted) {
          const measure = createCanvasMeasurer(overlayFontCss(gesture.overlay, renderScale))
          caret = caretIndexAtX(gesture.overlay.text ?? '', gesture.localX ?? 0, measure)
        }
        beginTextEdit(gesture.overlay, caret)
      }
      gestureRef.current = null
      setDraft(null)
      return
    }
    if (draft && event.type !== 'pointercancel') onChange?.(draft.id, geometryOf(draft))
    gestureRef.current = null
    setDraft(null)
  }

  return (
    <div
      ref={layerRef}
      className={`annotation-layer ${interactive ? 'is-interactive' : ''} tool-${tool}`}
      onPointerDown={(event) => {
        if (!interactive || event.button !== 0 || event.target !== event.currentTarget) return
        if (!event.isPrimary) return
        if (tool === 'ink') {
          inkRef.current = { pointerId: event.pointerId, points: [pointerPoint(event)] }
          event.currentTarget.setPointerCapture(event.pointerId)
          onSelect?.(null)
          setEditSession(null)
          return
        }
        if (tool === 'eraser' || tool === 'image') return
        if (tool === 'select') {
          onSelect?.(null)
          setEditSession(null)
          return
        }
        const point = pointerPoint(event)
        if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
          const line = hitExtractedLine(overlays, point.x, point.y)
          if (line) {
            const existing = matchingLineMark(overlays, tool, line)
            if (existing) onSelect?.(existing.id)
            else onCreate?.(createLineMark(tool, line, color))
            return
          }
        }
        const bounds = event.currentTarget.getBoundingClientRect()
        const created =
          tool === 'wordArt'
            ? createDefaultOverlay(
                'text',
                (event.clientX - bounds.left) / bounds.width,
                (event.clientY - bounds.top) / bounds.height,
                color,
                { wordArt: 'outline' },
              )
            : createDefaultOverlay(
                tool,
                (event.clientX - bounds.left) / bounds.width,
                (event.clientY - bounds.top) / bounds.height,
                color,
              )
        onCreate?.(created)
        if (tool === 'text' || tool === 'wordArt') {
          setEditSession({
            id: created.id,
            caret: null,
            appearance: null,
            preview: null,
          })
        }
      }}
      onContextMenu={(event) => {
        if (!interactive) return
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        const point = {
          x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        }
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-overlay-id]')
          : null
        const hitOverlay = target?.dataset.overlayId ?? [...overlays]
          .reverse()
          .find(
            (overlay) =>
              point.x >= overlay.x &&
              point.x <= overlay.x + overlay.width &&
              point.y >= overlay.y &&
              point.y <= overlay.y + overlay.height,
          )?.id
        if (hitOverlay) {
          onSelect?.(hitOverlay)
          onOverlayContextMenu?.(event, hitOverlay)
        } else {
          onSelect?.(null)
          onPageContextMenu?.(event, point)
        }
      }}
      onPointerMove={updateGesture}
      onPointerUp={finishGesture}
      onPointerCancel={finishGesture}
    >
      {overlays.map((overlay) => {
        const visible = draft?.id === overlay.id ? draft : overlay
        const selected = selectedOverlayId === overlay.id
        const editing = editingId === overlay.id && overlay.type === 'text'
        const sized =
          editing && editPreview
            ? { ...visible, width: editPreview.width, height: editPreview.height }
            : visible
        return (
          <div
            key={overlay.id}
            data-overlay-id={overlay.id}
            className={`annotation annotation-${overlay.type} ${selected ? 'is-selected' : ''} ${overlay.extracted ? 'annotation-extracted' : ''} ${overlay.scanned ? 'annotation-scanned' : ''} ${overlay.edited ? 'is-edited' : ''} ${editing ? 'is-editing' : ''} ${overlay.extracted && overlayAtPageMargin(sized) ? 'is-at-margin' : ''}`}
            style={overlayStyle(sized, renderScale, editing, editing ? editAppearance : null)}
            role={interactive && !editing ? 'button' : undefined}
            tabIndex={interactive && !editing ? 0 : undefined}
            aria-label={interactive && !editing ? `${overlay.signature ? 'signature' : overlay.extracted ? 'extracted text' : overlay.type} annotation` : undefined}
            onFocus={() => { if (interactive && !editing) onSelect?.(overlay.id) }}
            onDoubleClick={(event) => {
              if (!interactive || overlay.type !== 'text' || tool !== 'select') return
              event.stopPropagation()
              onSelect?.(overlay.id)
              beginTextEdit(overlay, overlay.extracted ? (overlay.text ?? '').length : null)
            }}
            onPointerDown={(event) => {
              if (interactive && tool === 'eraser' && event.button === 0 && overlay.type === 'ink') {
                event.stopPropagation()
                onErase?.(overlay.id)
                return
              }
              if (!interactive || tool !== 'select' || event.button !== 0) return
              event.stopPropagation()
              onSelect?.(overlay.id)
              if (editing) return
              const rect = event.currentTarget.getBoundingClientRect()
              const pad = overlayPadPx(overlay, renderScale)
              gestureRef.current = {
                mode: overlay.type === 'text' && overlay.extracted ? 'maybe-move' : 'move',
                overlay,
                startX: event.clientX,
                startY: event.clientY,
                localX: event.clientX - rect.left - pad.x,
              }
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
            }}
            onKeyDown={(event) => {
              if (!interactive || editing) return
              if ((event.key === 'Enter' || event.key === 'F2') && overlay.type === 'text') {
                event.preventDefault()
                beginTextEdit(overlay, overlay.extracted ? (overlay.text ?? '').length : null)
                return
              }
              const delta = event.shiftKey ? 0.01 : 0.005
              const changes: Partial<PageOverlay> = {}
              if (event.key === 'ArrowLeft') changes.x = overlay.x - delta
              else if (event.key === 'ArrowRight') changes.x = overlay.x + delta
              else if (event.key === 'ArrowUp') changes.y = overlay.y - delta
              else if (event.key === 'ArrowDown') changes.y = overlay.y + delta
              else return
              event.preventDefault()
              onChange?.(overlay.id, changes)
            }}
          >
            {editing ? (
              <TextEditor
                overlay={overlay}
                renderScale={renderScale}
                pageWidth={width}
                pageHeight={height}
                caretIndex={editingCaret}
                onPreview={(preview) => {
                  setEditSession((session) =>
                    session?.id === overlay.id ? { ...session, preview } : session,
                  )
                }}
                onSave={(value, size) => {
                  const next = commitText(overlay, value)
                  const changes: Partial<PageOverlay> = {}
                  if (next !== (overlay.text ?? '')) {
                    changes.text = next
                    if (overlay.extracted) {
                      changes.width = size.width
                      changes.height = size.height
                      if (editAppearance) {
                        changes.color = editAppearance.color
                        changes.backgroundColor = editAppearance.backgroundColor
                      }
                    }
                  }
                  if (Object.keys(changes).length) onChange?.(overlay.id, changes)
                }}
                onCancel={() => setEditSession(null)}
              />
            ) : (
              <OverlayContent overlay={visible} renderScale={renderScale} />
            )}
            {selected && interactive && !editing && (
              <button
                type="button"
                className="annotation-resize-handle"
                aria-label="Resize annotation"
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  gestureRef.current = {
                    mode: 'resize',
                    overlay,
                    startX: event.clientX,
                    startY: event.clientY,
                  }
                  event.currentTarget.parentElement?.parentElement?.setPointerCapture(
                    event.pointerId,
                  )
                }}
              />
            )}
          </div>
        )
      })}
      {inkDraft && (
        <div className="annotation" style={overlayStyle(inkDraft, renderScale)}>
          <OverlayContent overlay={inkDraft} renderScale={renderScale} />
        </div>
      )}
    </div>
  )
}
