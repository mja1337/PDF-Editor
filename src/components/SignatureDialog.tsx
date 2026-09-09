import { useEffect, useRef, useState } from 'react'
import type { PageOverlay } from '../domain/document'
import type { SavedSignature } from '../domain/preferences'
import { embedEditorFont, validateEditorText } from '../pdf/fonts'
import { cropSignatureCanvas } from '../pdf/signatureImage'

function signatureOverlayFromImage(data: string, ratio: number): PageOverlay {
  const width = Math.min(0.45, 0.22 * ratio)
  return {
    id: crypto.randomUUID(),
    type: 'image',
    signature: true,
    x: 0.28,
    y: 0.38,
    width,
    height: width / ratio,
    color: '#172a46',
    opacity: 1,
    strokeWidth: 2,
    imageData: data,
  }
}

export function SignatureDialog({
  onClose,
  onInsert,
  savedSignature,
  onSaveSignature,
}: {
  onClose: () => void
  onInsert: (overlay: PageOverlay) => void
  savedSignature?: SavedSignature | null
  onSaveSignature?: (signature: SavedSignature | null) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef<number | null>(null)
  const [mode, setMode] = useState<'type' | 'draw' | 'upload'>('draw')
  const [name, setName] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [uploaded, setUploaded] = useState<{ data: string; ratio: number } | null>(null)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    if (mode !== 'draw') return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }, [mode])

  const persistSignature = (payload: SavedSignature) => {
    if (remember) onSaveSignature?.(payload)
  }

  const insertSaved = () => {
    if (!savedSignature) return
    onInsert(signatureOverlayFromImage(savedSignature.imageData, savedSignature.ratio))
    onClose()
  }

  const insert = async () => {
    setBusy(true)
    setError('')
    try {
      let data = uploaded?.data ?? ''
      let ratio = uploaded?.ratio ?? 3
      if (mode === 'type') {
        const { PDFDocument } = await import('pdf-lib')
        validateEditorText(await embedEditorFont(await PDFDocument.create()), name.trim())
        await document.fonts.load('700 48px "Noto Sans"')
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')!
        context.font = '700 48px "Noto Sans"'
        canvas.width = Math.ceil(context.measureText(name.trim()).width + 24)
        canvas.height = 90
        context.font = '700 48px "Noto Sans"'
        context.fillStyle = '#172a46'
        context.fillText(name.trim(), 12, 62)
        data = canvas.toDataURL('image/png')
        ratio = canvas.width / canvas.height
      } else if (mode === 'draw') {
        const cropped = cropSignatureCanvas(canvasRef.current!)
        data = cropped.data
        ratio = cropped.ratio
      }
      persistSignature({ imageData: data, ratio })
      onInsert(signatureOverlayFromImage(data, ratio))
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The signature could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="signature-dialog"
      aria-labelledby="signature-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <h2 id="signature-title">Create a signature</h2>
      <p>This adds a visual signature. It does not certify the document or verify identity.</p>

      {savedSignature && (
        <div className="signature-saved">
          <img className="signature-upload-preview" src={savedSignature.imageData} alt="Saved signature" />
          <button type="button" disabled={busy} onClick={insertSaved}>
            Insert saved signature
          </button>
        </div>
      )}

      <div className="signature-tabs" aria-label="Signature method">
        {(['draw', 'type', 'upload'] as const).map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={mode === method}
            disabled={busy}
            onClick={() => {
              setMode(method)
              setHasInk(false)
              setError('')
            }}
          >
            {method === 'type' ? 'Type' : method === 'draw' ? 'Draw' : 'Upload'}
          </button>
        ))}
      </div>

      {mode === 'type' && (
        <label>
          Your name
          <input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <span className="signature-name">{name || 'Your signature'}</span>
        </label>
      )}

      {mode === 'draw' && (
        <>
          <p className="signature-hint">Draw your handwriting with mouse, touch, or pen.</p>
          <canvas
            ref={canvasRef}
            width={900}
            height={300}
            aria-label="Draw signature"
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary || busy) return
              drawingRef.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
              const bounds = event.currentTarget.getBoundingClientRect()
              const context = event.currentTarget.getContext('2d')!
              context.beginPath()
              context.moveTo(
                ((event.clientX - bounds.left) * 900) / bounds.width,
                ((event.clientY - bounds.top) * 300) / bounds.height,
              )
              context.strokeStyle = '#172a46'
              context.lineWidth = 4
              context.lineCap = 'round'
              context.lineJoin = 'round'
            }}
            onPointerMove={(event) => {
              if (drawingRef.current !== event.pointerId) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const context = event.currentTarget.getContext('2d')!
              context.lineTo(
                ((event.clientX - bounds.left) * 900) / bounds.width,
                ((event.clientY - bounds.top) * 300) / bounds.height,
              )
              context.stroke()
              setHasInk(true)
            }}
            onPointerUp={() => {
              drawingRef.current = null
            }}
            onPointerCancel={() => {
              drawingRef.current = null
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const canvas = canvasRef.current
              const context = canvas?.getContext('2d')
              if (!canvas || !context) return
              context.fillStyle = '#ffffff'
              context.fillRect(0, 0, canvas.width, canvas.height)
              setHasInk(false)
            }}
          >
            Clear drawing
          </button>
        </>
      )}

      {mode === 'upload' && (
        <label>
          Signature image (PNG or JPEG, up to 8 MB)
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setUploaded(null)
              setError('')
              setBusy(true)
              try {
                if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
                if (!['image/png', 'image/jpeg'].includes(file.type)) {
                  throw new Error('Choose a PNG or JPEG image.')
                }
                const bitmap = await createImageBitmap(file)
                try {
                  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
                  const canvas = document.createElement('canvas')
                  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
                  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
                  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
                  const cropped = cropSignatureCanvas(canvas)
                  setUploaded({ data: cropped.data, ratio: cropped.ratio })
                } finally {
                  bitmap.close()
                }
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Cannot read this image.')
              } finally {
                setBusy(false)
              }
            }}
          />
          {uploaded && <img className="signature-upload-preview" src={uploaded.data} alt="Signature preview" />}
        </label>
      )}

      {error && <p role="alert">{error}</p>}

      <label className="signature-remember">
        <input type="checkbox" checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)} />
        Remember this signature on this device
      </label>

      <p>After inserting, drag to move or use the corner handles to resize.</p>

      <div className="signature-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || (mode === 'type' ? !name.trim() : mode === 'draw' ? !hasInk : !uploaded)}
          onClick={() => void insert()}
        >
          {busy ? 'Preparing…' : 'Insert signature'}
        </button>
      </div>
    </dialog>
  )
}
