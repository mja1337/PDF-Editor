import { useRef, useState } from 'react'
import type { PageOverlay } from '../domain/document'
import { createDefaultOverlay, createDrawnOverlay } from '../domain/overlays'
import { CLICK_DRAG_THRESHOLD_PX, type PagePoint } from '../pdf/shapeGeometry'

interface RedactionLayerProps {
  width: number
  height: number
  overlays: PageOverlay[]
  onCreate?: (overlay: PageOverlay) => void
  onPageContextMenu?: (
    event: React.MouseEvent<HTMLDivElement>,
    point: { x: number; y: number },
  ) => void
}

interface CreateSession {
  pointerId: number
  start: PagePoint
  last: PagePoint
  id: string
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

function boxStyle(overlay: PageOverlay): React.CSSProperties {
  return {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.width * 100}%`,
    height: `${overlay.height * 100}%`,
    boxSizing: 'border-box',
  }
}

export function RedactionLayer({
  width,
  height,
  overlays,
  onCreate,
  onPageContextMenu,
}: RedactionLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<CreateSession | null>(null)
  const [createDraft, setCreateDraft] = useState<PageOverlay | null>(null)
  const redactions = overlays.filter((overlay) => overlay.type === 'redaction')

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

  const overlayFromSession = (session: CreateSession, end: PagePoint, shift: boolean) =>
    createDrawnOverlay('redaction', session.start, end, '#000000', {
      shift,
      pageAspect: pageAspect(),
      id: session.id,
      strokeWidth: 0,
    })

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

  const finishCreate = (event: React.PointerEvent) => {
    const session = createRef.current
    if (!session || session.pointerId !== event.pointerId) return false
    withPointerCapture(event.currentTarget, event.pointerId, false)
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
        ? createDefaultOverlay('redaction', session.start.x, session.start.y, '#000000', {
            id: session.id,
            strokeWidth: 0,
          })
        : overlayFromSession(session, end, event.shiftKey)
    setCreateDraft(null)
    onCreate?.(overlay)
    return true
  }

  const finishPointer = (event: React.PointerEvent) => {
    if (finishCreate(event)) return
    withPointerCapture(event.currentTarget, event.pointerId, false)
  }

  return (
    <div
      ref={layerRef}
      className="annotation-layer redaction-layer is-interactive tool-redaction"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        const point = pointerPoint(event)
        createRef.current = {
          pointerId: event.pointerId,
          start: point,
          last: point,
          id: crypto.randomUUID(),
        }
        setCreateDraft(null)
        withPointerCapture(event.currentTarget, event.pointerId, true)
      }}
      onPointerMove={(event) => {
        if (createRef.current?.pointerId !== event.pointerId) return
        updateCreateDraft(pointerPoint(event), event.shiftKey)
      }}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onContextMenu={(event) => {
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        onPageContextMenu?.(event, {
          x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        })
      }}
    >
      {redactions.map((overlay) => (
        <div
          key={overlay.id}
          className="annotation annotation-redaction"
          style={boxStyle(overlay)}
          aria-hidden="true"
        >
          <span className="annotation-redaction-fill" />
        </div>
      ))}
      {createDraft && (
        <div className="annotation annotation-redaction is-draft" style={boxStyle(createDraft)}>
          <span className="annotation-redaction-fill" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
