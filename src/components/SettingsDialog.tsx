import { useEffect, useRef, useState } from 'react'
import type { LogoStampConfig, StampCorner } from '../domain/document'
import { loadPreferences, savePreferences } from '../domain/preferences'

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
  onClose,
  onSaveStamp,
}: {
  stamp: LogoStampConfig | null
  onClose: () => void
  onSaveStamp: (stamp: LogoStampConfig | null) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<LogoStampConfig | null>(stamp)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  const persist = (next: LogoStampConfig | null) => {
    savePreferences({ ...loadPreferences(), stamp: next })
    onSaveStamp(next)
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
      <div className="signature-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          disabled={!draft}
          onClick={() => {
            persist(null)
            setDraft(null)
          }}
        >
          Remove logo
        </button>
        <button
          type="button"
          disabled={!draft || busy}
          onClick={() => {
            if (!draft) return
            persist(draft)
            onClose()
          }}
        >
          Save logo
        </button>
      </div>
    </dialog>
  )
}
