import { useEffect, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle } from 'lucide-react'
import { convertOffice, MAX_OFFICE_BYTES, parsePages, pdfName, type OfficeOptions } from '../office/conversion'
import { prepareOffice } from '../office/pending'
import { downloadBlob } from '../pdf/export'
import { formatBytes } from '../app/messages'

export function OfficeConversionDialog({ file, initialOptions, resumed = false, onClose, onOpen }: {
  file: File; initialOptions?: OfficeOptions; resumed?: boolean; onClose: () => void; onOpen: (file: File) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const abort = useRef<AbortController | null>(null)
  const [options, setOptions] = useState<OfficeOptions>(initialOptions ?? { name: pdfName(file.name), quality: 90, pages: '' })
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<File | null>(null)
  const running = !!status
  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [running])
  const runRef = useRef<() => void>(() => {})
  const run = async () => {
    if (abort.current) return
    setError('')
    setElapsed(0)
    const controller = new AbortController()
    abort.current = controller
    try {
      parsePages(options.pages)
      if (!file.size || file.size > MAX_OFFICE_BYTES) throw new Error('Choose a non-empty Office file smaller than 100 MB.')
      setStatus('Preparing local conversion…')
      if (resumed && !globalThis.crossOriginIsolated) throw new Error('Your browser could not enable local conversion. Try a current desktop Chrome, Edge, Firefox or Safari browser.')
      if (!await prepareOffice({ file, options }, controller.signal)) return
      controller.signal.throwIfAborted()
      setResult(await convertOffice(file, options, controller.signal, setStatus))
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Conversion failed. Please try again.')
    } finally {
      abort.current = null
      setStatus('')
    }
  }
  useEffect(() => { runRef.current = () => { void run() } })
  useEffect(() => {
    dialog.current?.showModal()
    const timer = resumed ? setTimeout(() => runRef.current(), 0) : undefined
    return () => { clearTimeout(timer); abort.current?.abort() }
  }, [resumed])
  const close = () => { abort.current?.abort(); onClose() }
  return <dialog ref={dialog} className="settings-dialog office-dialog" aria-labelledby="office-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <div className="office-heading"><FileText size={25} /><div><h2 id="office-title">{result ? 'Your PDF is ready' : 'Convert to PDF'}</h2><p>Word & PowerPoint, straight to PDF.</p></div></div>
    <div className="office-file"><strong>{file.name}</strong><span>{formatBytes(file.size)} → PDF</span></div>
    {!result && <>
      <p className="office-description">Keep the original layout and turn every page or slide into a PDF. Your file stays on this device.</p>
      <details className="office-options"><summary>Advanced options</summary><fieldset disabled={running}>
        <label>PDF filename<input value={options.name} onChange={(event) => setOptions({ ...options, name: event.target.value })} /></label>
        <label>Image quality<select value={options.quality} onChange={(event) => setOptions({ ...options, quality: Number(event.target.value) })}><option value={90}>High quality</option><option value={75}>Balanced</option><option value={50}>Smaller file</option></select></label>
        <label>Pages / slides<input placeholder="All pages (or 1-3, 5)" value={options.pages} onChange={(event) => setOptions({ ...options, pages: event.target.value })} /></label>
        <small>Original page sizes are preserved. Unavailable fonts may be substituted.</small>
      </fieldset></details>
      <p className="office-note">First use downloads about 75 MB for the local conversion engine, then caches it for later. Larger files work best in a desktop browser.</p>
    </>}
    {error && <p className="office-error" role="alert">{error}</p>}
    {running && <p className="office-progress" role="status"><LoaderCircle className="spin" size={18} />{status}</p>}
    {running && elapsed >= 15 && <p className="office-note">{elapsed}s elapsed. Large or complex presentations can take longer. You can cancel at any time.</p>}
    {result && <p role="status">{result.name} · {formatBytes(result.size)}</p>}
    <div className="signature-actions">
      <button type="button" onClick={close}>{running ? 'Cancel' : 'Close'}</button>
      {result ? <><button type="button" onClick={() => onOpen(result)}>Open in editor</button><button type="button" className="primary-open-button" onClick={() => downloadBlob(result, result.name)}><Download size={16} /> Download PDF</button></> : <button type="button" className="primary-open-button" disabled={running} onClick={() => void run()}>Convert to PDF</button>}
    </div>
  </dialog>
}
