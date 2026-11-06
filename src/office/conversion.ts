
export const OFFICE_ACCEPT = '.doc,.docx,.ppt,.pptx'
export const MAX_OFFICE_BYTES = 100 * 1024 * 1024
export type OfficeOptions = { name: string; quality: number; pages: string }
export const isOfficeFile = (file: Pick<File, 'name'>) => /\.(docx?|pptx?)$/i.test(file.name)
export const pdfName = (name: string) => `${name.replace(/\.[^.]+$/, '') || 'Document'}.pdf`

export function parsePages(value: string, count?: number): number[] | undefined {
  if (!value.trim()) return undefined
  const pages = new Set<number>()
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('Use page numbers such as 1-3, 5.')
    const start = Number(match[1]), end = Number(match[2] ?? match[1])
    if (start < 1 || end < start || end > (count ?? 10000)) {
      throw new Error(count ? `Choose pages between 1 and ${count}.` : 'Choose a valid page range (up to 10,000 pages).')
    }
    for (let page = start; page <= end; page++) pages.add(page - 1)
  }
  return [...pages]
}

// The pinned engine's worker protocol lets us terminate a hung conversion immediately.
let worker: Worker | undefined
let ready = false
let sequence = 0
export function stopOfficeConversion() {
  worker?.terminate()
  worker = undefined
  ready = false
}

export async function convertOffice(file: File, options: OfficeOptions, signal: AbortSignal, progress: (text: string) => void): Promise<File> {
  if (!isOfficeFile(file)) throw new Error('Choose a Word or PowerPoint file.')
  if (!file.size || file.size > MAX_OFFICE_BYTES) throw new Error('Choose a non-empty Office file smaller than 100 MB.')
  parsePages(options.pages)
  if (!globalThis.crossOriginIsolated) throw new Error('This browser could not enable local Office conversion. Try a current desktop Chrome, Edge, Firefox or Safari browser.')
  const base = new URL(`${import.meta.env.BASE_URL}office/`, location.origin).href
  const engine = worker ??= new Worker(`${base}browser.worker.global.js`)
  const request = (type: string, data: Record<string, unknown> = {}) => new Promise<Uint8Array | undefined>((resolve, reject) => {
    const id = ++sequence
    let stage = type === 'convert' ? 'reading the document' : 'preparing the conversion engine'
    const timeout = window.setTimeout(() => fail(new Error(`Local conversion timed out while ${stage}. Try again to restart the engine, or cancel and try a fresh browser window.`)), 180000)
    const cleanup = () => {
      clearTimeout(timeout)
      engine.removeEventListener('message', receive)
      engine.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    const fail = (error: Error) => { cleanup(); stopOfficeConversion(); reject(error) }
    const aborted = () => fail(new DOMException('Conversion cancelled.', 'AbortError'))
    const failed = () => fail(new Error('The conversion engine could not run. Try again in a desktop browser with more available memory.'))
    const receive = (event: MessageEvent) => {
      const message = event.data
      if (type === 'loaded' ? message.type !== 'loaded' : message.id !== id) return
      if (message.type === 'progress') {
        const update = officeProgress(type, message.progress?.percent)
        if (update) { stage = update.stage; progress(update.label) }
        return
      }
      if (!['loaded', 'ready', 'result', 'error'].includes(message.type)) return
      if (message.type === 'error') { fail(new Error('This file could not be converted. It may be damaged, password-protected or unsupported.')); return }
      cleanup()
      resolve(message.data)
    }
    engine.addEventListener('message', receive)
    engine.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) { aborted(); return }
    if (type !== 'loaded') engine.postMessage({ type, id, ...data })
  })
  try {
    if (!ready) {
      progress('Preparing the local conversion engine… First use can take a minute.')
      await request('loaded')
      await request('init', {
        sofficeJs: `${base}soffice.js`, sofficeWasm: `${base}soffice.wasm`,
        sofficeData: `${base}soffice.data`, sofficeWorkerJs: `${base}soffice.worker.js`,
      })
      ready = true
    }
    progress(`Converting ${file.name}…`)
    const inputData = new Uint8Array(await file.arrayBuffer())
    signal.throwIfAborted()
    const bytes = await request('convert', {
      inputData, inputExt: file.name.split('.').pop()!.toLowerCase(), outputFormat: 'pdf',
      filterOptions: JSON.stringify({ Quality: { type: 'long', value: options.quality }, UseLosslessCompression: { type: 'boolean', value: false } }),
    })
    if (!bytes) throw new Error('The converter returned no PDF.')
    progress('Checking your PDF…')
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.load(bytes)
    if (!pdf.getPageCount()) throw new Error('The converter returned an empty PDF.')
    const selected = parsePages(options.pages, pdf.getPageCount())
    let output = new Uint8Array(bytes)
    if (selected) {
      const subset = await PDFDocument.create()
      for (const page of await subset.copyPages(pdf, selected)) subset.addPage(page)
      output = new Uint8Array(await subset.save())
    }
    signal.throwIfAborted()
    const name = options.name.trim().replace(/[\\/:*?"<>|]/g, '-') || pdfName(file.name)
    return new File([output], /\.pdf$/i.test(name) ? name : `${name}.pdf`, { type: 'application/pdf' })
  } catch (error) {
    stopOfficeConversion()
    throw error
  }
}

// The engine reports milestones, not measured percentages of total work.
// In particular, 30% means its synchronous document import has started.
export function officeProgress(type: string, percent: unknown): { label: string; stage: string } | undefined {
  if (type !== 'convert' || typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
  if (percent >= 90) return { label: 'Reading the converted PDF…', stage: 'reading the converted PDF' }
  if (percent >= 50) return { label: 'Exporting pages / slides to PDF…', stage: 'exporting the PDF' }
  if (percent >= 30) return { label: 'Loading document pages / slides…', stage: 'loading the document pages / slides' }
  return { label: 'Reading your Office file…', stage: 'reading the Office file' }
}
