import { useEffect, useRef } from 'react'
import { OCR_ENGINE_DISCLOSURE } from '../pdf/ocrEngine'

export function OcrConsentDialog({
  onAccept,
  onDecline,
}: {
  onAccept: () => void
  onDecline: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog ocr-consent-dialog"
      aria-labelledby="ocr-consent-title"
      onCancel={(event) => {
        event.preventDefault()
        onDecline()
      }}
    >
      <h2 id="ocr-consent-title">Download a local OCR engine?</h2>
      <p>
        Some pages have no extractable PDF text. You can read them with an
        on-device OCR engine. The files come from {OCR_ENGINE_DISCLOSURE.filesFrom}
        , then recognition stays in this browser. Pages are never uploaded.
      </p>
      <dl className="ocr-disclosure">
        <div>
          <dt>Engine</dt>
          <dd>
            {OCR_ENGINE_DISCLOSURE.engine}. {OCR_ENGINE_DISCLOSURE.engineOrigin}.
          </dd>
        </div>
        <div>
          <dt>Wrapper</dt>
          <dd>{OCR_ENGINE_DISCLOSURE.wrapper}.</dd>
        </div>
        <div>
          <dt>License</dt>
          <dd>{OCR_ENGINE_DISCLOSURE.license}.</dd>
        </div>
        <div>
          <dt>Language data</dt>
          <dd>{OCR_ENGINE_DISCLOSURE.languageData}.</dd>
        </div>
        <div>
          <dt>First download</dt>
          <dd>{OCR_ENGINE_DISCLOSURE.sizeLabel}.</dd>
        </div>
      </dl>
      <p>
        After that, this browser keeps a copy for later scans. GitHub Pages
        cannot enable multi-thread WASM, so recognition is single-thread and
        can be slow on large pages.
      </p>
      <div className="signature-actions">
        <button type="button" onClick={onDecline}>
          Skip OCR
        </button>
        <button type="button" onClick={onAccept}>
          Download and read scans
        </button>
      </div>
    </dialog>
  )
}
