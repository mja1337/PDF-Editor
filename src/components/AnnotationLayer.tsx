import { useRef, useState } from 'react'
import type { OverlayType, PageOverlay } from '../domain/document'
import { normalizeOverlay } from '../domain/document'
import { createDefaultOverlay } from '../domain/overlays'

export type AnnotationTool = 'select' | OverlayType

interface AnnotationLayerProps {
  width: number
  height: number
  renderScale: number
  overlays: PageOverlay[]
  interactive?: boolean
  tool?: AnnotationTool
  color?: string
  selectedOverlayId?: string | null
  onCreate?: (overlay: PageOverlay) => void
  onSelect?: (overlayId: string | null) => void
  onChange?: (overlayId: string, changes: Partial<PageOverlay>) => void
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
  mode: 'move' | 'resize'
  overlay: PageOverlay
  startX: number
  startY: number
}

function snap(value: number) {
  return Math.round(value * 200) / 200
}

function overlayStyle(
  overlay: PageOverlay,
  renderScale: number,
): React.CSSProperties {
  return {
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.width * 100}%`,
    height: `${overlay.height * 100}%`,
    color: overlay.color,
    opacity: overlay.opacity,
    borderColor: overlay.color,
    borderWidth: `${Math.max(1, overlay.strokeWidth * renderScale)}px`,
    fontSize: `${Math.max(8, (overlay.fontSize ?? 18) * renderScale)}px`,
  }
}

function OverlayContent({ overlay }: { overlay: PageOverlay }) {
  switch (overlay.type) {
    case 'text':
      return <span className="annotation-text">{overlay.text || 'Add text'}</span>
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
  }
}

export function AnnotationLayer({
  width,
  height,
  renderScale,
  overlays,
  interactive = false,
  tool = 'select',
  color = '#e05252',
  selectedOverlayId,
  onCreate,
  onSelect,
  onChange,
  onPageContextMenu,
  onOverlayContextMenu,
}: AnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<PageOverlay | null>(null)

  const updateGesture = (event: React.PointerEvent) => {
    const gesture = gestureRef.current
    if (!gesture || width <= 0 || height <= 0) return
    const deltaX = snap((event.clientX - gesture.startX) / width)
    const deltaY = snap((event.clientY - gesture.startY) / height)
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

  const finishGesture = (event: React.PointerEvent) => {
    if (!gestureRef.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (draft) onChange?.(draft.id, draft)
    gestureRef.current = null
    setDraft(null)
  }

  return (
    <div
      ref={layerRef}
      className={`annotation-layer ${interactive ? 'is-interactive' : ''} tool-${tool}`}
      style={{ width, height }}
      onPointerDown={(event) => {
        if (!interactive || event.button !== 0 || event.target !== event.currentTarget) return
        if (tool === 'select') {
          onSelect?.(null)
          return
        }
        const bounds = event.currentTarget.getBoundingClientRect()
        onCreate?.(
          createDefaultOverlay(
            tool,
            (event.clientX - bounds.left) / bounds.width,
            (event.clientY - bounds.top) / bounds.height,
            color,
          ),
        )
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
        return (
          <div
            key={overlay.id}
            data-overlay-id={overlay.id}
            className={`annotation annotation-${overlay.type} ${selected ? 'is-selected' : ''}`}
            style={overlayStyle(visible, renderScale)}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${overlay.type} annotation` : undefined}
            onPointerDown={(event) => {
              if (!interactive || tool !== 'select' || event.button !== 0) return
              event.stopPropagation()
              onSelect?.(overlay.id)
              gestureRef.current = {
                mode: 'move',
                overlay,
                startX: event.clientX,
                startY: event.clientY,
              }
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
            }}
            onKeyDown={(event) => {
              if (!interactive) return
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
            <OverlayContent overlay={visible} />
            {selected && interactive && (
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
    </div>
  )
}
