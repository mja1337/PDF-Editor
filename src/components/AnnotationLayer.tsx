import { useEffect, useRef, useState } from 'react'
import type { OverlayType, PageOverlay } from '../domain/document'
import type { SavedSignature } from '../domain/preferences'
import { createSignatureOverlay } from '../pdf/signatureImage'
import { normalizeOverlay } from '../domain/document'
import {
  applyLineEndpoints,
  createDefaultOverlay,
  createDrawnOverlay,
  createInkOverlay,
  liveInkOverlay,
  createLineMark,
  extractedLineAtPoint,
  isClosedDrawShape,
  matchingLineMark,
  nextSketchSeed,
  pageEndpoints,
} from '../domain/overlays'
import { cssFontFamily } from '../pdf/fontMatch'
import { sampleOverlayPixels, type SampledAppearance } from '../pdf/pageSample'
import {
  CLICK_DRAG_THRESHOLD_PX,
  arrowHeadPolygon,
  arrowHeadSize,
  constrainDrag,
  isBoxShapeOverlay,
  isLinearOverlay,
  lineEndpoints,
  lineSketchRoughness,
  overlayHitsPoint,
  resizeOverlayBox,
  topmostOverlayAt,
  type BoxHandle,
  type LineHandle,
  type PagePoint,
} from '../pdf/shapeGeometry'
import { sketchClosedInPixels, sketchLineBetween, sketchStrokes } from '../pdf/sketch'
import {
  caretIndexAtX,
  createCanvasMeasurer,
  fitOverlayToText,
  overlayAtPageMargin,
  overlayFontCss,
  overlayFontPx,
  overlayPadPx,
} from '../pdf/textLayout'

export type AnnotationTool = 'select' | 'eraser' | OverlayType

interface AnnotationLayerProps {
  width: number
  height: number
  renderScale: number
  overlays: PageOverlay[]
  interactive?: boolean
  tool?: AnnotationTool
  color?: string
  strokeWidth?: number
  fill?: boolean
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
  pendingSignature?: SavedSignature | null
  onPlaceSignature?: (overlay: PageOverlay) => void
  searchHighlightOverlayIds?: ReadonlySet<string>
  activeSearchOverlayId?: string | null
}

interface Gesture {
  mode: 'move' | 'resize' | 'maybe-move' | 'endpoint'
  overlay: PageOverlay
  startX: number
  startY: number
  localX?: number
  handle?: BoxHandle | LineHandle
  lastPoint?: PagePoint
  lastClientX?: number
  lastClientY?: number
}

interface CreateSession {
  pointerId: number
  tool: Exclude<AnnotationTool, 'select' | 'eraser' | 'image'>
  start: PagePoint
  last: PagePoint
  id: string
  sketchSeed: number
}

const DRAG_THRESHOLD = 6
type ShapeEmphasis = 'none' | 'hover' | 'selected'

const DRAW_TOOLS = new Set<AnnotationTool>([
  'text',
  'highlight',
  'underline',
  'strikeout',
  'rectangle',
  'ellipse',
  'line',
  'arrow',
  'diamond',
  'redaction',
])

function toolCanGrabMarks(tool: AnnotationTool) {
  return tool !== 'eraser' && tool !== 'image'
}

function isLineMarkTool(tool: AnnotationTool) {
  return tool === 'highlight' || tool === 'underline' || tool === 'strikeout'
}

function overlayCanStartMove(tool: AnnotationTool, overlay: PageOverlay) {
  if (tool === 'eraser') return !(overlay.extracted && !overlay.edited)
  if (isLineMarkTool(tool) && overlay.extracted) return false
  return toolCanGrabMarks(tool)
}

function snap(value: number) {
  return Math.round(value * 200) / 200
}

function withPointerCapture(node: EventTarget | null, pointerId: number, capture: boolean) {
  if (!(node instanceof Element)) return
  try {
    if (capture) node.setPointerCapture(pointerId)
    else node.releasePointerCapture(pointerId)
  } catch {
    // Capture can fail for untrusted events or after the pointer already ended.
  }
}

function LinearShape({
  overlay,
  pageWidth,
  pageHeight,
  renderScale,
  emphasis = 'none',
}: {
  overlay: PageOverlay
  pageWidth: number
  pageHeight: number
  renderScale: number
  emphasis?: ShapeEmphasis
}) {
  const [start, end] = lineEndpoints(overlay)
  const width = Math.max(1, overlay.width * pageWidth)
  const height = Math.max(1, overlay.height * pageHeight)
  const x1 = start.x * width
  const y1 = start.y * height
  const x2 = end.x * width
  const y2 = end.y * height
  const stroke = Math.max(1, overlay.strokeWidth * renderScale)
  const seed = overlay.sketchSeed ?? 1
  const sketch = overlay.sketch !== false
  const head =
    overlay.type === 'arrow'
      ? arrowHeadPolygon({ x: x1, y: y1 }, { x: x2, y: y2 }, arrowHeadSize(stroke))
      : null
  const shaftEnd = head?.neck ?? { x: x2, y: y2 }
  const sketched = sketch
    ? sketchStrokes(
        sketchLineBetween(
          { x: x1, y: y1 },
          shaftEnd,
          seed,
          lineSketchRoughness(stroke),
        ),
      )
    : []
  const hitWidth = Math.max(18, stroke * 6)
  return (
    <svg
      className="annotation-line annotation-linear-stroke"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <line
        className="annotation-hit-stroke"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinecap="round"
      />
      {sketch
        ? sketched.map((strokePoints, index) =>
            strokePoints.length < 2 ? null : (
              <polyline
                key={index}
                points={strokePoints.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={overlay.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )
        : (
          <line
            x1={x1}
            y1={y1}
            x2={shaftEnd.x}
            y2={shaftEnd.y}
            stroke={overlay.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      {emphasis !== 'none' ? (
        <line
          className={emphasis === 'selected' ? 'annotation-selection-edge' : 'annotation-hover-edge'}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {head ? (
        <polygon
          points={`${head.left.x},${head.left.y} ${head.tip.x},${head.tip.y} ${head.right.x},${head.right.y}`}
          fill={overlay.color}
        />
      ) : null}
    </svg>
  )
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
    ...(overlay.points ? { points: overlay.points } : {}),
  }
}

function commitText(overlay: PageOverlay, value: string) {
  if (overlay.extracted) return value
  return value.trim() || 'Add text'
}

function SketchPath({
  overlay,
  renderScale,
  emphasis = 'none',
}: {
  overlay: PageOverlay
  renderScale: number
  emphasis?: ShapeEmphasis
}) {
  const strokes = sketchStrokes(overlay.points ?? [])
  if (strokes.every((stroke) => stroke.length < 2)) return null
  const strokeWidth = overlay.strokeWidth * renderScale
  return (
    <svg className="annotation-line annotation-sketch" viewBox="0 0 1 1" preserveAspectRatio="none">
      {strokes.map((stroke, index) =>
        stroke.length < 2 ? null : (
          <polyline
            key={`hit-${index}`}
            className="annotation-hit-stroke"
            points={stroke.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth * 5)}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
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
      {emphasis !== 'none'
        ? strokes.map((stroke, index) =>
            stroke.length < 2 ? null : (
              <polyline
                key={`emphasis-${index}`}
                className={emphasis === 'selected' ? 'annotation-selection-edge' : 'annotation-hover-edge'}
                points={stroke.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )
        : null}
    </svg>
  )
}

function ClosedGeometry({
  overlay,
  width,
  height,
  inset,
  className,
  fill,
  stroke,
  strokeWidth,
  strokeLinejoin,
  vectorEffect,
}: {
  overlay: PageOverlay
  width: number
  height: number
  inset: number
  className?: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeLinejoin?: 'round'
  vectorEffect?: 'non-scaling-stroke'
}) {
  if (overlay.type === 'ellipse') {
    return (
      <ellipse
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(0.5, width / 2 - inset)}
        ry={Math.max(0.5, height / 2 - inset)}
        className={className}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        vectorEffect={vectorEffect}
      />
    )
  }
  if (overlay.type === 'diamond') {
    return (
      <polygon
        points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`}
        className={className}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin={strokeLinejoin}
        vectorEffect={vectorEffect}
      />
    )
  }
  return (
    <rect
      x={inset}
      y={inset}
      width={Math.max(1, width - inset * 2)}
      height={Math.max(1, height - inset * 2)}
      className={className}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect={vectorEffect}
    />
  )
}

function ClosedShape({
  overlay,
  renderScale,
  pageWidth,
  pageHeight,
  emphasis = 'none',
}: {
  overlay: PageOverlay
  renderScale: number
  pageWidth: number
  pageHeight: number
  emphasis?: ShapeEmphasis
}) {
  const width = Math.max(1, overlay.width * pageWidth)
  const height = Math.max(1, overlay.height * pageHeight)
  const stroke = Math.max(1, overlay.strokeWidth * renderScale)
  const inset = Math.max(stroke * 0.5, Math.min(width, height) * 0.045)
  const fill = overlay.backgroundColor
  const sketch = Boolean(overlay.sketch)
  const strokes = sketch
    ? sketchStrokes(
        sketchClosedInPixels(
          overlay.type as 'rectangle' | 'ellipse' | 'diamond',
          overlay.sketchSeed ?? 1,
          width,
          height,
          stroke,
        ),
      )
    : []
  const showBody = Boolean(fill) || !sketch
  const hitWidth = Math.max(16, stroke * 5)
  return (
    <svg
      className="annotation-line annotation-closed-shape"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <ClosedGeometry
        overlay={overlay}
        width={width}
        height={height}
        inset={inset}
        className="annotation-hit-shape"
        fill="transparent"
        stroke="transparent"
        strokeWidth={hitWidth}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showBody ? (
        <ClosedGeometry
          overlay={overlay}
          width={width}
          height={height}
          inset={inset}
          fill={fill ?? 'none'}
          stroke={sketch ? 'none' : overlay.color}
          strokeWidth={sketch ? 0 : stroke}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {strokes.map((strokePoints, index) =>
        strokePoints.length < 2 ? null : (
          <polyline
            key={index}
            points={strokePoints.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={overlay.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
      {emphasis !== 'none' ? (
        <ClosedGeometry
          overlay={overlay}
          width={width}
          height={height}
          inset={inset}
          className={emphasis === 'selected' ? 'annotation-selection-edge' : 'annotation-hover-edge'}
          fill="none"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}

function InkShape({
  overlay,
  renderScale,
  pageWidth,
  pageHeight,
  emphasis = 'none',
}: {
  overlay: PageOverlay
  renderScale: number
  pageWidth: number
  pageHeight: number
  emphasis?: ShapeEmphasis
}) {
  const width = Math.max(1, overlay.width * pageWidth)
  const height = Math.max(1, overlay.height * pageHeight)
  const points =
    overlay.points?.map((point) => `${point.x * width},${point.y * height}`).join(' ') ?? ''
  const stroke = Math.max(1, overlay.strokeWidth * renderScale)
  return (
    <svg
      className="annotation-line annotation-ink-stroke"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline
        className="annotation-hit-stroke"
        points={points}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(16, stroke * 5)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke={overlay.color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {emphasis !== 'none' ? (
        <polyline
          className={emphasis === 'selected' ? 'annotation-selection-edge' : 'annotation-hover-edge'}
          points={points}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}

function textLabel(overlay: PageOverlay) {
  if (overlay.extracted && !overlay.edited) return ''
  return overlay.text || 'Add text'
}

function OverlayContent({
  overlay,
  renderScale,
  pageWidth,
  pageHeight,
  emphasis = 'none',
}: {
  overlay: PageOverlay
  renderScale: number
  pageWidth: number
  pageHeight: number
  emphasis?: ShapeEmphasis
}) {
  if (isLinearOverlay(overlay.type)) {
    return (
      <LinearShape
        overlay={overlay}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        renderScale={renderScale}
        emphasis={emphasis}
      />
    )
  }
  if (overlay.type === 'redaction') {
    return (
      <>
        <span className="annotation-redaction-fill" aria-hidden="true" />
        {emphasis !== 'none' ? (
          <svg className="annotation-selection-frame" viewBox="0 0 1 1" preserveAspectRatio="none">
            <rect
              x="0.01"
              y="0.01"
              width="0.98"
              height="0.98"
              className={emphasis === 'selected' ? 'annotation-selection-box' : 'annotation-hover-edge'}
            />
          </svg>
        ) : null}
      </>
    )
  }
  if (overlay.type === 'rectangle' || overlay.type === 'ellipse' || overlay.type === 'diamond') {
    return (
      <ClosedShape
        overlay={overlay}
        renderScale={renderScale}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        emphasis={emphasis}
      />
    )
  }
  if (overlay.sketch && overlay.points && overlay.points.length > 1) {
    return <SketchPath overlay={overlay} renderScale={renderScale} emphasis={emphasis} />
  }
  switch (overlay.type) {
    case 'image':
      return (
        <>
          <img className="annotation-image" src={overlay.imageData} alt="" draggable={false} />
          {emphasis !== 'none' ? (
            <svg className="annotation-selection-frame" viewBox="0 0 1 1" preserveAspectRatio="none">
              <rect
                x="0.02"
                y="0.02"
                width="0.96"
                height="0.96"
                className={emphasis === 'selected' ? 'annotation-selection-box' : 'annotation-hover-edge'}
              />
            </svg>
          ) : null}
        </>
      )
    case 'ink':
      return (
        <InkShape
          overlay={overlay}
          renderScale={renderScale}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          emphasis={emphasis}
        />
      )
    case 'text':
      return (
        <>
          <span className="annotation-text">{textLabel(overlay)}</span>
          {emphasis !== 'none' ? (
            <svg className="annotation-selection-frame" viewBox="0 0 1 1" preserveAspectRatio="none">
              <rect
                x="0.015"
                y="0.015"
                width="0.97"
                height="0.97"
                className={emphasis === 'selected' ? 'annotation-selection-box' : 'annotation-hover-edge'}
              />
            </svg>
          ) : null}
        </>
      )
    case 'highlight':
      return (
        <>
          <span className="annotation-highlight" style={{ background: overlay.color }} />
          {emphasis !== 'none' ? (
            <svg className="annotation-selection-frame" viewBox="0 0 1 1" preserveAspectRatio="none">
              <rect
                x="0.01"
                y="0.08"
                width="0.98"
                height="0.84"
                className={emphasis === 'selected' ? 'annotation-selection-box' : 'annotation-hover-edge'}
              />
            </svg>
          ) : null}
        </>
      )
    case 'underline':
    case 'strikeout':
      return (
        <>
          <span
            className={overlay.type === 'underline' ? 'annotation-underline' : 'annotation-strikeout'}
            style={{ borderColor: overlay.color }}
          />
          {emphasis !== 'none' ? (
            <svg className="annotation-selection-frame" viewBox="0 0 1 1" preserveAspectRatio="none">
              <rect
                x="0.01"
                y="0.08"
                width="0.98"
                height="0.84"
                className={emphasis === 'selected' ? 'annotation-selection-box' : 'annotation-hover-edge'}
              />
            </svg>
          ) : null}
        </>
      )
    default:
      return null
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
    const size = fitOverlayToText(
      overlay,
      overlay.text ?? '',
      pageWidth,
      pageHeight,
      renderScale,
      measure.current,
    )
    layoutRef.current = size
    onPreview(size)
    // Fit once when this note opens so the box matches the current text.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening the editor is the moment to measure
  }, [overlay.id])

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

function OverlayItem({
  overlay,
  visible,
  selected,
  hovered,
  editing,
  editPreview,
  editAppearance,
  interactive,
  tool,
  renderScale,
  pageWidth,
  pageHeight,
  editingCaret,
  onSelect,
  onChange,
  onBeginMove,
  onBeginResize,
  onBeginEndpoint,
  onBeginTextEdit,
  onEditPreview,
  onEditSave,
  onEditCancel,
  onErase,
  searchMatch = false,
  searchActive = false,
}: {
  overlay: PageOverlay
  visible: PageOverlay
  selected: boolean
  hovered: boolean
  editing: boolean
  editPreview: { width: number; height: number } | null
  editAppearance: SampledAppearance | null
  interactive: boolean
  tool: AnnotationTool
  renderScale: number
  pageWidth: number
  pageHeight: number
  editingCaret: number | null
  onSelect?: (overlayId: string | null) => void
  onChange?: (overlayId: string, changes: Partial<PageOverlay>) => void
  onBeginMove: (event: React.PointerEvent, overlay: PageOverlay) => void
  onBeginResize: (event: React.PointerEvent, overlay: PageOverlay, handle: BoxHandle) => void
  onBeginEndpoint: (event: React.PointerEvent, overlay: PageOverlay, handle: LineHandle) => void
  onBeginTextEdit: (overlay: PageOverlay, caret: number | null) => void
  onEditPreview: (preview: { width: number; height: number }) => void
  onEditSave: (value: string, size: { width: number; height: number }) => void
  onEditCancel: () => void
  onErase?: (overlayId: string) => void
  searchMatch?: boolean
  searchActive?: boolean
}) {
  const sized =
    editing && editPreview
      ? { ...visible, width: editPreview.width, height: editPreview.height }
      : visible
  const emphasis: ShapeEmphasis = selected ? 'selected' : hovered ? 'hover' : 'none'
  const showHandles = selected && interactive && !editing && tool !== 'eraser'
  return (
    <div
      data-overlay-id={overlay.id}
      className={`annotation annotation-${overlay.type} ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} ${searchMatch ? 'is-search-match' : ''} ${searchActive ? 'is-search-active' : ''} ${isLinearOverlay(overlay.type) ? 'is-linear' : ''} ${overlay.extracted ? 'annotation-extracted' : ''} ${overlay.scanned ? 'annotation-scanned' : ''} ${overlay.edited ? 'is-edited' : ''} ${editing ? 'is-editing' : ''} ${overlay.extracted && overlayAtPageMargin(sized) ? 'is-at-margin' : ''}`}
      style={overlayStyle(sized, renderScale, editing, editing ? editAppearance : null)}
      role={interactive && !editing ? 'button' : undefined}
      tabIndex={interactive && !editing ? 0 : undefined}
      aria-label={interactive && !editing ? `${overlay.signature ? 'signature' : overlay.extracted ? 'extracted text' : overlay.type} annotation` : undefined}
      onFocus={() => { if (interactive && !editing) onSelect?.(overlay.id) }}
      onDoubleClick={(event) => {
        if (!interactive || overlay.type !== 'text' || tool !== 'select') return
        event.stopPropagation()
        onSelect?.(overlay.id)
        onBeginTextEdit(overlay, overlay.extracted ? (overlay.text ?? '').length : null)
      }}
      onPointerDown={(event) => {
        if (editing) return
        if (interactive && tool === 'eraser' && event.button === 0) {
          event.stopPropagation()
          onErase?.(overlay.id)
          return
        }
        if (!overlayCanStartMove(tool, overlay)) return
        onBeginMove(event, overlay)
      }}
      onKeyDown={(event) => {
        if (!interactive || editing) return
        if ((event.key === 'Enter' || event.key === 'F2') && overlay.type === 'text') {
          event.preventDefault()
          onBeginTextEdit(overlay, overlay.extracted ? (overlay.text ?? '').length : null)
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
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          caretIndex={editingCaret}
          onPreview={onEditPreview}
          onSave={onEditSave}
          onCancel={onEditCancel}
        />
      ) : (
        <OverlayContent
          overlay={visible}
          renderScale={renderScale}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          emphasis={emphasis}
        />
      )}
      {showHandles && isLinearOverlay(overlay.type) &&
        (['start', 'end'] as const).map((handle) => {
          const [start, end] = lineEndpoints(sized)
          const point = handle === 'start' ? start : end
          return (
            <button
              key={handle}
              type="button"
              className="annotation-vertex-handle"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              aria-label={handle === 'start' ? 'Move line start' : 'Move line end'}
              onPointerDown={(event) => onBeginEndpoint(event, visible, handle)}
            />
          )
        })}
      {showHandles && !isLinearOverlay(overlay.type) &&
        (isBoxShapeOverlay(overlay.type)
          ? (['nw', 'ne', 'sw', 'se'] as const)
          : (['se'] as const)
        ).map((handle) => (
          <button
            key={handle}
            type="button"
            className={`annotation-resize-handle is-${handle}`}
            aria-label={handle === 'se' ? 'Resize annotation' : `Resize from ${handle}`}
            onPointerDown={(event) => onBeginResize(event, visible, handle)}
          />
        ))}
    </div>
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
  fill = false,
  onErase,
  selectedOverlayId,
  onCreate,
  onSelect,
  onChange,
  sampleAppearance,
  onPageContextMenu,
  onOverlayContextMenu,
  pendingSignature = null,
  onPlaceSignature,
  searchHighlightOverlayIds,
  activeSearchOverlayId = null,
}: AnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const createRef = useRef<CreateSession | null>(null)
  const [draft, setDraft] = useState<PageOverlay | null>(null)
  const [createDraft, setCreateDraft] = useState<PageOverlay | null>(null)
  const [editSession, setEditSession] = useState<{
    id: string
    caret: number | null
    appearance: SampledAppearance | null
    preview: { width: number; height: number } | null
  } | null>(null)
  const editSessionForTool = tool === 'select' ? editSession : null
  const editingId = editSessionForTool?.id ?? null
  const editingCaret = editSessionForTool?.caret ?? null
  const editPreview = editSessionForTool?.preview ?? null
  const editAppearance = editSessionForTool?.appearance ?? null
  const inkRef = useRef<{ pointerId: number; points: Array<{ x: number; y: number }> } | null>(null)
  const [inkDraft, setInkDraft] = useState<PageOverlay | null>(null)
  const eraserRef = useRef<{ pointerId: number; erased: Set<string> } | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const [hoveredOverlayId, setHoveredOverlayId] = useState<string | null>(null)
  const [signatureCursor, setSignatureCursor] = useState<PagePoint | null>(null)
  const [seenOverlayIds] = useState(() => new Set(overlays.map((overlay) => overlay.id)))
  const signaturePageAspect = width > 0 && height > 0 ? width / height : 1
  const signatureGhost =
    pendingSignature && signatureCursor
      ? createSignatureOverlay(
          pendingSignature.imageData,
          pendingSignature.ratio,
          signatureCursor,
          signaturePageAspect,
        )
      : null

  useEffect(() => {
    for (const overlay of overlays) {
      if (
        !seenOverlayIds.has(overlay.id) &&
        overlay.type === 'text' &&
        !overlay.extracted &&
        overlay.id === selectedOverlayId
      ) {
        // Open the editor after a new typed note appears (click-to-place or context menu).
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editor to a newly created note
        setEditSession({
          id: overlay.id,
          caret: null,
          appearance: null,
          preview: null,
        })
      }
      seenOverlayIds.add(overlay.id)
    }
  }, [overlays, seenOverlayIds, selectedOverlayId])

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

  const pointerPoint = (event: { clientX: number; clientY: number }) => {
    const bounds = layerRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    }
  }

  const pageAspect = () => {
    const size = layerSize()
    return size.height > 0 ? size.width / size.height : 1
  }

  const overlayFromSession = (session: CreateSession, end: PagePoint, shift: boolean) => {
    return createDrawnOverlay(session.tool, session.start, end, color, {
      shift,
      pageAspect: pageAspect(),
      id: session.id,
      sketchSeed: session.sketchSeed,
      strokeWidth,
      fill: fill && isClosedDrawShape(session.tool),
    })
  }

  const updateCreateDraft = (end: PagePoint, shift: boolean) => {
    const session = createRef.current
    if (!session) return
    session.last = end
    const size = layerSize()
    const distance = Math.hypot(
      (end.x - session.start.x) * size.width,
      (end.y - session.start.y) * size.height,
    )
    if (distance < CLICK_DRAG_THRESHOLD_PX) {
      setCreateDraft(null)
      return
    }
    setCreateDraft(overlayFromSession(session, end, shift))
  }

  const applyActiveGesture = (point: PagePoint, shift: boolean, clientX: number, clientY: number) => {
    const size = layerSize()
    const gesture = gestureRef.current
    if (!gesture || size.width <= 0 || size.height <= 0) return
    gesture.lastPoint = point
    gesture.lastClientX = clientX
    gesture.lastClientY = clientY
    if (gesture.mode === 'maybe-move') {
      const distance = Math.hypot(clientX - gesture.startX, clientY - gesture.startY)
      if (distance < DRAG_THRESHOLD) return
      gesture.mode = 'move'
    }
    if (gesture.mode === 'endpoint' && (gesture.handle === 'start' || gesture.handle === 'end')) {
      const [start, end] = pageEndpoints(gesture.overlay)
      const fixed = gesture.handle === 'start' ? end : start
      const moving = constrainDrag(gesture.overlay.type, fixed, point, shift, pageAspect())
      setDraft(
        applyLineEndpoints(
          gesture.overlay,
          gesture.handle === 'start' ? moving : start,
          gesture.handle === 'end' ? moving : end,
        ),
      )
      return
    }
    if (gesture.mode === 'resize' && gesture.handle && gesture.handle !== 'start' && gesture.handle !== 'end') {
      setDraft(
        normalizeOverlay({
          ...gesture.overlay,
          ...resizeOverlayBox(gesture.overlay, gesture.handle, point, shift, pageAspect()),
        }),
      )
      return
    }
    const deltaX = snap((clientX - gesture.startX) / size.width)
    const deltaY = snap((clientY - gesture.startY) / size.height)
    setDraft(
      normalizeOverlay(
        gesture.mode === 'move'
          ? {
              ...gesture.overlay,
              x: gesture.overlay.x + deltaX,
              y: gesture.overlay.y + deltaY,
            }
          : {
              ...gesture.overlay,
              width: gesture.overlay.width + deltaX,
              height: gesture.overlay.height + deltaY,
            },
      ),
    )
  }

  const eraseAt = (point: PagePoint) => {
    const session = eraserRef.current
    if (!session) return
    const size = layerSize()
    for (let index = overlays.length - 1; index >= 0; index -= 1) {
      const overlay = overlays[index]
      if (!overlay || (overlay.extracted && !overlay.edited) || session.erased.has(overlay.id)) continue
      if (!overlayHitsPoint(overlay, point, size.width, size.height)) continue
      session.erased.add(overlay.id)
      onErase?.(overlay.id)
      return
    }
  }

  const cancelActivePointer = () => {
    const pointerId = activePointerIdRef.current
    if (pointerId != null) withPointerCapture(layerRef.current, pointerId, false)
    activePointerIdRef.current = null
    createRef.current = null
    inkRef.current = null
    gestureRef.current = null
    eraserRef.current = null
    setCreateDraft(null)
    setInkDraft(null)
    setDraft(null)
  }

  const updateHover = (event: React.PointerEvent) => {
    if (
      !interactive ||
      tool === 'eraser' ||
      gestureRef.current ||
      createRef.current ||
      inkRef.current ||
      eraserRef.current
    ) {
      if (hoveredOverlayId) setHoveredOverlayId(null)
      return
    }
    const size = layerSize()
    const hit = topmostOverlayAt(overlays, pointerPoint(event), size.width, size.height)
    const nextId = hit?.id ?? null
    if (nextId !== hoveredOverlayId) setHoveredOverlayId(nextId)
  }

  const updateGesture = (event: React.PointerEvent) => {
    if (interactive && pendingSignature) {
      if (event.target !== event.currentTarget) setSignatureCursor(null)
      else setSignatureCursor(pointerPoint(event))
    }
    if (createRef.current?.pointerId === event.pointerId) {
      updateCreateDraft(pointerPoint(event), event.shiftKey)
      return
    }
    if (eraserRef.current?.pointerId === event.pointerId) {
      eraseAt(pointerPoint(event))
      return
    }
    const size = layerSize()
    if (inkRef.current?.pointerId === event.pointerId) {
      const point = pointerPoint(event)
      const previous = inkRef.current.points.at(-1)!
      if (Math.hypot((point.x - previous.x) * size.width, (point.y - previous.y) * size.height) >= 0.5) {
        inkRef.current.points.push(point)
        setInkDraft(liveInkOverlay(inkRef.current.points, color, strokeWidth))
      }
      return
    }
    if (!gestureRef.current) {
      updateHover(event)
      return
    }
    applyActiveGesture(pointerPoint(event), event.shiftKey, event.clientX, event.clientY)
  }

  useEffect(() => {
    if (!interactive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (createRef.current || inkRef.current || gestureRef.current || eraserRef.current) {
          event.preventDefault()
          cancelActivePointer()
        }
        return
      }
      if (event.key !== 'Shift') return
      const shift = event.type === 'keydown'
      const session = createRef.current
      if (session) updateCreateDraft(session.last, shift)
      const gesture = gestureRef.current
      if (gesture?.lastPoint) {
        applyActiveGesture(
          gesture.lastPoint,
          shift,
          gesture.lastClientX ?? gesture.startX,
          gesture.lastClientY ?? gesture.startY,
        )
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  })

  const finishCreate = (event: React.PointerEvent) => {
    const session = createRef.current
    if (!session) return false
    if (session.pointerId !== event.pointerId && !event.isPrimary) return false
    withPointerCapture(event.currentTarget, event.pointerId, false)
    activePointerIdRef.current = null
    createRef.current = null
    if (event.type === 'pointercancel') {
      setCreateDraft(null)
      return true
    }
    const end = pointerPoint(event)
    const size = layerSize()
    const distance = Math.hypot(
      (end.x - session.start.x) * size.width,
      (end.y - session.start.y) * size.height,
    )
    const overlay =
      distance < CLICK_DRAG_THRESHOLD_PX
        ? createDefaultOverlay(
            session.tool,
            session.start.x,
            session.start.y,
            color,
            {
              id: session.id,
              sketchSeed: session.sketchSeed,
              strokeWidth,
              fill: fill && isClosedDrawShape(session.tool),
            },
          )
        : overlayFromSession(session, end, event.shiftKey)
    const placed =
      overlay.type === 'text'
        ? (() => {
            const origin =
              distance < CLICK_DRAG_THRESHOLD_PX ? session.start : { x: overlay.x, y: overlay.y }
            const fitted = fitOverlayToText(
              { ...overlay, x: origin.x, y: origin.y, width: 0.001, height: 0.001 },
              overlay.text ?? 'Add text',
              size.width,
              size.height,
              renderScale,
              createCanvasMeasurer(overlayFontCss(overlay, renderScale)),
            )
            return { ...overlay, x: origin.x, y: origin.y, ...fitted }
          })()
        : overlay
    setCreateDraft(null)
    onCreate?.(placed)
    if (session.tool === 'text') {
      setEditSession({
        id: placed.id,
        caret: null,
        appearance: null,
        preview: { width: placed.width, height: placed.height },
      })
    }
    return true
  }

  const finishGesture = (event: React.PointerEvent) => {
    const release = () => {
      withPointerCapture(event.currentTarget, event.pointerId, false)
      activePointerIdRef.current = null
    }
    if (finishCreate(event)) return
    if (inkRef.current?.pointerId === event.pointerId) {
      if (event.type !== 'pointercancel' && inkRef.current.points.length > 1) {
        onCreate?.(createInkOverlay(inkRef.current.points, color, strokeWidth, layerSize()))
      }
      inkRef.current = null
      setInkDraft(null)
      release()
      return
    }
    if (eraserRef.current?.pointerId === event.pointerId) {
      eraserRef.current = null
      release()
      return
    }
    const gesture = gestureRef.current
    if (!gesture) {
      release()
      return
    }
    release()
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

  const captureOnLayer = (event: React.PointerEvent) => {
    withPointerCapture(layerRef.current, event.pointerId, true)
    activePointerIdRef.current = event.pointerId
  }

  const beginMoveOverlay = (event: React.PointerEvent, overlay: PageOverlay) => {
    if (interactive && tool === 'eraser' && event.button === 0) {
      if (overlay.extracted && !overlay.edited) return
      event.stopPropagation()
      eraserRef.current = { pointerId: event.pointerId, erased: new Set([overlay.id]) }
      onErase?.(overlay.id)
      setHoveredOverlayId(null)
      captureOnLayer(event)
      return
    }
    if (!interactive || !toolCanGrabMarks(tool) || event.button !== 0) return
    event.stopPropagation()
    onSelect?.(overlay.id)
    setHoveredOverlayId(overlay.id)
    const node =
      event.currentTarget instanceof Element &&
      event.currentTarget.getAttribute('data-overlay-id') === overlay.id
        ? event.currentTarget
        : layerRef.current?.querySelector(`[data-overlay-id="${CSS.escape(overlay.id)}"]`)
    const rect = node?.getBoundingClientRect()
    const pad = overlayPadPx(overlay, renderScale)
    gestureRef.current = {
      mode: tool === 'select' && overlay.type === 'text' && overlay.extracted ? 'maybe-move' : 'move',
      overlay,
      startX: event.clientX,
      startY: event.clientY,
      localX: rect ? event.clientX - rect.left - pad.x : 0,
    }
    captureOnLayer(event)
  }

  const beginResizeOverlay = (
    event: React.PointerEvent,
    overlay: PageOverlay,
    handle: BoxHandle,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    gestureRef.current = {
      mode: 'resize',
      overlay,
      startX: event.clientX,
      startY: event.clientY,
      handle,
      lastPoint: pointerPoint(event),
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    }
    captureOnLayer(event)
  }

  const beginEndpointOverlay = (
    event: React.PointerEvent,
    overlay: PageOverlay,
    handle: LineHandle,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    gestureRef.current = {
      mode: 'endpoint',
      overlay,
      startX: event.clientX,
      startY: event.clientY,
      handle,
      lastPoint: pointerPoint(event),
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    }
    captureOnLayer(event)
  }

  return (
    <div
      ref={layerRef}
      className={`annotation-layer ${interactive ? 'is-interactive' : ''} tool-${tool}${hoveredOverlayId ? ' is-over-mark' : ''}${pendingSignature ? ' is-placing-signature' : ''}`}
      onPointerDown={(event) => {
        if (!interactive || event.button !== 0) return
        if (!event.isPrimary) return
        const onLayer = event.target === event.currentTarget
        const point = pointerPoint(event)
        const size = layerSize()
        if (pendingSignature && onPlaceSignature) {
          onPlaceSignature(
            createSignatureOverlay(
              pendingSignature.imageData,
              pendingSignature.ratio,
              pointerPoint(event),
              signaturePageAspect,
            ),
          )
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (tool === 'image') return
        if (tool === 'eraser') {
          eraserRef.current = { pointerId: event.pointerId, erased: new Set() }
          withPointerCapture(event.currentTarget, event.pointerId, true)
          activePointerIdRef.current = event.pointerId
          eraseAt(point)
          return
        }
        if (isLineMarkTool(tool)) {
          const line = extractedLineAtPoint(overlays, point, size.width, size.height)
          if (line) {
            const existing = matchingLineMark(overlays, tool, line)
            if (existing) onSelect?.(existing.id)
            else onCreate?.(createLineMark(tool, line, color, strokeWidth))
            return
          }
        }
        if (onLayer && toolCanGrabMarks(tool)) {
          const hit = topmostOverlayAt(overlays, point, size.width, size.height)
          if (hit && overlayCanStartMove(tool, hit)) {
            beginMoveOverlay(event, hit)
            return
          }
        }
        if (tool === 'ink') {
          if (!onLayer) return
          const start = pointerPoint(event)
          inkRef.current = { pointerId: event.pointerId, points: [start] }
          setInkDraft(liveInkOverlay([start], color, strokeWidth))
          withPointerCapture(event.currentTarget, event.pointerId, true)
          activePointerIdRef.current = event.pointerId
          onSelect?.(null)
          setEditSession(null)
          setHoveredOverlayId(null)
          return
        }
        if (tool === 'select') {
          if (!onLayer) return
          onSelect?.(null)
          setEditSession(null)
          setHoveredOverlayId(null)
          return
        }
        if (!DRAW_TOOLS.has(tool)) return
        if (!onLayer) return
        createRef.current = {
          pointerId: event.pointerId,
          tool: tool as CreateSession['tool'],
          start: point,
          last: point,
          id: crypto.randomUUID(),
          sketchSeed: nextSketchSeed(),
        }
        withPointerCapture(event.currentTarget, event.pointerId, true)
        activePointerIdRef.current = event.pointerId
        onSelect?.(null)
        setEditSession(null)
        setHoveredOverlayId(null)
      }}
      onPointerLeave={() => {
        setSignatureCursor(null)
        if (gestureRef.current || createRef.current || inkRef.current) return
        setHoveredOverlayId(null)
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
        const hitOverlay =
          target?.dataset.overlayId ??
          topmostOverlayAt(overlays, point, bounds.width, bounds.height, {
            includeExtracted: true,
          })?.id
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
        const hovered = hoveredOverlayId === overlay.id && !selected
        const editing = editingId === overlay.id && overlay.type === 'text'
        return (
          <OverlayItem
            key={overlay.id}
            overlay={overlay}
            visible={visible}
            selected={selected}
            hovered={hovered}
            editing={editing}
            editPreview={editPreview}
            editAppearance={editAppearance}
            interactive={interactive}
            tool={tool}
            renderScale={renderScale}
            pageWidth={width}
            pageHeight={height}
            editingCaret={editingCaret}
            onSelect={onSelect}
            onChange={onChange}
            onBeginMove={beginMoveOverlay}
            onBeginResize={beginResizeOverlay}
            onBeginEndpoint={beginEndpointOverlay}
            onBeginTextEdit={beginTextEdit}
            onErase={onErase}
            searchMatch={searchHighlightOverlayIds?.has(overlay.id) ?? false}
            searchActive={activeSearchOverlayId === overlay.id}
            onEditPreview={(preview) => {
              setEditSession((session) =>
                session?.id === overlay.id ? { ...session, preview } : session,
              )
            }}
            onEditSave={(value) => {
              const next = commitText(overlay, value)
              const fitted = fitOverlayToText(
                overlay,
                next,
                width,
                height,
                renderScale,
                createCanvasMeasurer(overlayFontCss(overlay, renderScale)),
              )
              const changes: Partial<PageOverlay> = {}
              if (next !== (overlay.text ?? '')) changes.text = next
              if (
                Math.abs(fitted.width - overlay.width) > 0.0005 ||
                Math.abs(fitted.height - overlay.height) > 0.0005
              ) {
                changes.width = fitted.width
                changes.height = fitted.height
              }
              if (overlay.extracted && next !== (overlay.text ?? '') && editAppearance) {
                changes.color = editAppearance.color
                changes.backgroundColor = editAppearance.backgroundColor
              }
              if (Object.keys(changes).length) onChange?.(overlay.id, changes)
            }}
            onEditCancel={() => setEditSession(null)}
          />
        )
      })}
      {createDraft && (
        <div className={`annotation annotation-${createDraft.type} is-draft`} style={overlayStyle(createDraft, renderScale)}>
          <OverlayContent
            overlay={createDraft}
            renderScale={renderScale}
            pageWidth={width}
            pageHeight={height}
          />
        </div>
      )}
      {inkDraft && (
        <div className="annotation is-draft" style={overlayStyle(inkDraft, renderScale)}>
          <OverlayContent
            overlay={inkDraft}
            renderScale={renderScale}
            pageWidth={width}
            pageHeight={height}
          />
        </div>
      )}
      {signatureGhost && (
        <div
          className="annotation annotation-image signature-ghost is-draft"
          style={overlayStyle(signatureGhost, renderScale)}
          aria-hidden="true"
        >
          <img className="annotation-image" src={signatureGhost.imageData} alt="" draggable={false} />
        </div>
      )}
    </div>
  )
}
