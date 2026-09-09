import { useEffect, useRef, useState } from 'react'
import type { LogoStampConfig, StampCorner } from '../domain/document'
import type { OcrConsent } from '../domain/preferences'
import { OCR_ENGINE_DISCLOSURE } from '../pdf/ocrEngine'

const CORNERS: Array<{ id: StampCorner; label: string }> = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
]

async function readLogoFile(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    throw new Error('Use a PNG, JPEG, or WebP logo.')
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('The logo must be under 4 MB.')
  }
  const bitmap = await createImageBitmap(file)
  const max = 640
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The logo could not be read.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function SettingsDialog({
  stamp,
  ocrConsent,
  onClose,
  onSaveStamp,
  onSaveOcrConsent,
}: {
  stamp: LogoStampConfig | null
  ocrConsent: OcrConsent
  onClose: () => void
  onSaveStamp: (stamp: LogoStampConfig | null) => Promise<void>
  onSaveOcrConsent: (consent: OcrConsent) => Promise<void>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<LogoStampConfig | null>(stamp)
  const [consent, setConsent] = useState<OcrConsent>(ocrConsent)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const persistStamp = async (next: LogoStampConfig | null) => {
    setBusy(true)
    setError('')
    try {
      await onSaveStamp(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The logo could not be saved.')
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const persistConsent = async (next: OcrConsent) => {
    setBusy(true)
    setError('')
    try {
      await onSaveOcrConsent(next)
      setConsent(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The OCR preference could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="settings-title">Settings</h2>
      <section>
        <h3>Page logo stamp</h3>
        <p>
          Saved on this device and applied to every page of the current document. Change the
          corner or size, then save.
        </p>
        <label className="settings-upload">
          Choose logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              setBusy(true)
              setError('')
              void readLogoFile(file)
                .then((imageData) => {
                  setDraft({
                    imageData,
                    corner: draft?.corner ?? 'top-right',
                    size: draft?.size ?? 0.14,
                    opacity: draft?.opacity ?? 1,
                  })
                })
                .catch((cause) => {
                  setError(cause instanceof Error ? cause.message : 'The logo could not be read.')
                })
                .finally(() => setBusy(false))
            }}
          />
        </label>
        {draft && (
          <div className="stamp-preview-wrap">
            <div className={`stamp-preview stamp-preview-${draft.corner}`}>
              <img src={draft.imageData} alt="" style={{ width: `${draft.size * 100}%`, opacity: draft.opacity }} />
            </div>
          </div>
        )}
        <fieldset disabled={!draft || busy}>
          <legend>Corner</legend>
          <div className="stamp-corners">
            {CORNERS.map((corner) => (
              <button
                key={corner.id}
                type="button"
                aria-pressed={draft?.corner === corner.id}
                onClick={() => draft && setDraft({ ...draft, corner: corner.id })}
              >
                {corner.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Size
          <input
            type="range"
            min={6}
            max={36}
            value={Math.round((draft?.size ?? 0.14) * 100)}
            disabled={!draft || busy}
            onChange={(event) =>
              draft && setDraft({ ...draft, size: Number(event.currentTarget.value) / 100 })
            }
          />
        </label>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section>
        <h3>Scanned-page OCR</h3>
        <p>
          Optional. After you allow it, Analyse can download {OCR_ENGINE_DISCLOSURE.engine}{' '}
          ({OCR_ENGINE_DISCLOSURE.wrapper}) from {OCR_ENGINE_DISCLOSURE.filesFrom}.{' '}
          {OCR_ENGINE_DISCLOSURE.languageData}. License: {OCR_ENGINE_DISCLOSURE.license}.
          Recognition then stays in this browser; pages are never uploaded. First
          download is {OCR_ENGINE_DISCLOSURE.sizeLabel}.
        </p>
        <p>
          {consent === 'accepted'
            ? 'OCR is allowed on this device. The engine is fetched from this site the first time a scan needs it.'
            : consent === 'declined'
              ? 'OCR is turned off on this device. Analyse still reads extractable PDF text.'
              : 'OCR is not enabled yet. Analyse will ask if it finds pages without text.'}
        </p>
        <div className="signature-actions">
          <button
            type="button"
            disabled={busy || consent === 'accepted'}
            onClick={() => void persistConsent('accepted')}
          >
            Allow OCR
          </button>
          <button
            type="button"
            disabled={busy || consent === 'declined'}
            onClick={() => void persistConsent('declined')}
          >
            Don’t use OCR
          </button>
        </div>
      </section>
      <div className="signature-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          disabled={!draft || busy}
          onClick={() => {
            void persistStamp(null).then(() => {
              setDraft(null)
            })
          }}
        >
          Remove logo
        </button>
        <button
          type="button"
          disabled={!draft || busy}
          onClick={() => {
            if (!draft) return
            void persistStamp(draft).then(() => onClose())
          }}
        >
          Save logo
        </button>
      </div>
    </dialog>
  )
}
