import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type {
  LogoStampConfig,
  PageOverlay,
  QuarterTurn,
  WatermarkConfig,
} from '../domain/document'
import type { SavedSignature } from '../domain/preferences'
import { createSignatureOverlay } from '../pdf/signatureImage'
import { sampleOverlayPixels, type SampledAppearance } from '../pdf/pageSample'
import { AnnotationLayer, type AnnotationTool } from './AnnotationLayer'

interface PdfCanvasProps {
  document: PDFDocumentProxy
  pageIndex: number
  rotationDelta: QuarterTurn
  targetWidth: number
  targetHeight?: number
  className?: string
  label: string
  watermark?: WatermarkConfig | null
  stamp?: LogoStampConfig | null
  overlays?: PageOverlay[]
  interactiveAnnotations?: boolean
  annotationTool?: AnnotationTool
  annotationColor?: string
  annotationStrokeWidth?: number
  annotationFill?: boolean
  onEraseOverlay?: (overlayId: string) => void
  selectedOverlayId?: string | null
  onCreateOverlay?: (overlay: PageOverlay) => void
  onSelectOverlay?: (overlayId: string | null) => void
  onChangeOverlay?: (overlayId: string, changes: Partial<PageOverlay>) => void
  onDisplaySize?: (size: { width: number; height: number; scale: number }) => void
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
}

export function PdfCanvas({
  document,
  pageIndex,
  rotationDelta,
  targetWidth,
  targetHeight,
  className,
  label,
  watermark,
  stamp,
  overlays = [],
  interactiveAnnotations,
  annotationTool,
  annotationColor,
  annotationStrokeWidth,
  annotationFill,
  onEraseOverlay,
  selectedOverlayId,
  onCreateOverlay,
  onSelectOverlay,
  onChangeOverlay,
  onDisplaySize,
  onPageContextMenu,
  onOverlayContextMenu,
  pendingSignature,
  onPlaceSignature,
}: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [display, setDisplay] = useState({ width: 0, height: 0, scale: 1 })

  useEffect(() => {
    const targetCanvas = canvasRef.current
    if (!targetCanvas) return

    let disposed = false
    let renderTask: RenderTask | undefined

    async function render(canvas: HTMLCanvasElement) {
      setStatus('loading')
      try {
        const page = await document.getPage(pageIndex + 1)
        if (disposed) return

        const rotation = (page.rotate + rotationDelta + 360) % 360
        const baseViewport = page.getViewport({ scale: 1, rotation })
        const widthScale = targetWidth / baseViewport.width
        const heightScale = targetHeight
          ? targetHeight / baseViewport.height
          : Number.POSITIVE_INFINITY
        const scale = Math.max(0.1, Math.min(widthScale, heightScale))
        const viewport = page.getViewport({ scale, rotation })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Canvas rendering is unavailable.')

        canvas.width = Math.floor(viewport.width * pixelRatio)
        canvas.height = Math.floor(viewport.height * pixelRatio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        setDisplay({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
          scale,
        })

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: '#ffffff',
          transform:
            pixelRatio === 1
              ? undefined
              : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })
        await renderTask.promise
        if (watermark?.text) {
          context.save()
          context.globalAlpha = watermark.opacity
          context.fillStyle = '#2d3935'
          context.font = `800 ${Math.max(18, canvas.width * 0.065)}px sans-serif`
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.translate(canvas.width / 2, canvas.height / 2)
          context.rotate((-watermark.rotation * Math.PI) / 180)
          context.fillText(watermark.text, 0, 0, canvas.width * 0.86)
          context.restore()
        }
        if (!disposed) setStatus('ready')
      } catch (error) {
        if (
          !disposed &&
          (!(error instanceof Error) || error.name !== 'RenderingCancelledException')
        ) {
          setStatus('error')
        }
      }
    }

    void render(targetCanvas)

    return () => {
      disposed = true
      renderTask?.cancel()
      targetCanvas.width = 0
      targetCanvas.height = 0
    }
  }, [document, pageIndex, rotationDelta, targetHeight, targetWidth, watermark])

  useEffect(() => {
    if (display.width > 0 && display.height > 0) onDisplaySize?.(display)
  }, [display, onDisplaySize])

  const sampleAppearance = (overlay: PageOverlay): SampledAppearance | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return sampleOverlayPixels(canvas, overlay, display.width, display.height)
  }

  const placePendingSignature = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pendingSignature || !onPlaceSignature || !interactiveAnnotations) return
    if (event.button !== 0 || !event.isPrimary) return
    const canvas = canvasRef.current
    if (!canvas || display.width <= 0 || display.height <= 0) return
    const bounds = canvas.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      return
    }
    onPlaceSignature(
      createSignatureOverlay(
        pendingSignature.imageData,
        pendingSignature.ratio,
        {
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
        },
        display.width / display.height,
      ),
    )
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      className={`pdf-canvas-wrap ${className ?? ''}${pendingSignature ? ' is-placing-signature' : ''}`}
      data-status={status}
      onPointerDownCapture={placePendingSignature}
    >
      {status === 'loading' && <div className="canvas-skeleton" aria-hidden="true" />}
      {status === 'error' && (
        <p className="canvas-error" role="status">
          Page preview unavailable
        </p>
      )}
      <canvas ref={canvasRef} aria-label={label} role="img" />
      {stamp && display.width > 0 && (
        <img
          className={`page-stamp page-stamp-${stamp.corner}`}
          src={stamp.imageData}
          alt=""
          draggable={false}
          style={{ width: `${stamp.size * 100}%`, opacity: stamp.opacity }}
        />
      )}
      {display.width > 0 && display.height > 0 && (
        <AnnotationLayer
          width={display.width}
          height={display.height}
          renderScale={display.scale}
          overlays={overlays}
          interactive={interactiveAnnotations}
          tool={annotationTool}
          color={annotationColor}
          strokeWidth={annotationStrokeWidth}
          fill={annotationFill}
          onErase={onEraseOverlay}
          selectedOverlayId={selectedOverlayId}
          onCreate={onCreateOverlay}
          onSelect={onSelectOverlay}
          onChange={onChangeOverlay}
          sampleAppearance={sampleAppearance}
          onPageContextMenu={onPageContextMenu}
          onOverlayContextMenu={onOverlayContextMenu}
          pendingSignature={pendingSignature}
        />
      )}
    </div>
  )
}
