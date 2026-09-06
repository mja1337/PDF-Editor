import type { PSM, Worker } from 'tesseract.js'

export type OcrMode = 'off' | 'platform' | 'tesseract'

export const OCR_ENGINE_DISCLOSURE = {
  engine: 'Tesseract OCR',
  engineOrigin:
    'Originally developed at Google and now maintained by the tesseract-ocr project',
  wrapper: 'Tesseract.js, by naptha',
  license: 'Apache License 2.0',
  filesFrom: 'this GitHub Pages site (the same origin as the editor)',
  languageData:
    'English tessdata_best, copied onto this site at build time from github.com/tesseract-ocr/tessdata_best',
  sizeLabel: 'about 15 MB the first time (engine plus English model)',
} as const

const LSTM_ONLY = 1
const SINGLE_BLOCK = '6'

type TesseractBrowser = {
  createWorker: typeof import('tesseract.js').createWorker
}

export function tesseractBrowserApi(module: unknown): TesseractBrowser {
  const seen = new Set<unknown>()
  let current: unknown = module
  while (current && (typeof current === 'object' || typeof current === 'function')) {
    if (seen.has(current)) break
    seen.add(current)
    const record = current as { createWorker?: unknown; default?: unknown }
    if (typeof record.createWorker === 'function') {
      return record as TesseractBrowser
    }
    current = record.default
  }
  throw new Error('Tesseract.js did not load in this browser.')
}

export function workerSourceLooksLikeHtml(source: string) {
  const head = source.slice(0, 200).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

export function lstmCoreFileName(simd: boolean, relaxedSimd: boolean) {
  if (relaxedSimd) return 'tesseract-core-relaxedsimd-lstm.wasm.js'
  if (simd) return 'tesseract-core-simd-lstm.wasm.js'
  return 'tesseract-core-lstm.wasm.js'
}

function publicBaseUrl() {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return base
}

export function ocrAssetDirectoryUrl() {
  return `${publicBaseUrl()}ocr`
}

function absoluteAssetUrl(path: string) {
  return new URL(path, window.location.href).href
}

const FRIENDLY_STATUS: Record<string, string> = {
  'loading tesseract core': 'Downloading OCR engine from this site',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Downloading English model from this site',
  'recognizing text': 'Reading scanned page',
}

let workerPromise: Promise<Worker> | null = null
let workerScriptObjectUrl: string | null = null

function friendlyStatus(status: string) {
  return FRIENDLY_STATUS[status] ?? status
}

export function ocrFailure(cause: unknown) {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string' && cause.trim()
        ? cause
        : 'The worker could not start.'
  return new Error(
    `The OCR engine could not be loaded from this GitHub Pages site. ${detail}`,
    { cause },
  )
}

async function detectLstmCoreFile() {
  try {
    const { relaxedSimd, simd } = await import('wasm-feature-detect')
    return lstmCoreFileName(await simd(), await relaxedSimd())
  } catch {
    return lstmCoreFileName(false, false)
  }
}

async function sameOriginWorkerScriptUrl() {
  const url = absoluteAssetUrl(`${ocrAssetDirectoryUrl()}/worker.min.js`)
  const response = await fetch(url, { cache: 'reload' })
  if (!response.ok) {
    throw ocrFailure(`Could not download the OCR worker (${response.status}).`)
  }
  const source = await response.text()
  if (workerSourceLooksLikeHtml(source)) {
    throw ocrFailure('The OCR worker was replaced by the site HTML. Hard-refresh, then try again.')
  }
  if (workerScriptObjectUrl) URL.revokeObjectURL(workerScriptObjectUrl)
  workerScriptObjectUrl = URL.createObjectURL(
    new Blob([source], { type: 'application/javascript' }),
  )
  return workerScriptObjectUrl
}

async function createSameOriginWorker(
  createWorker: TesseractBrowser['createWorker'],
  onStatus?: (status: string) => void,
) {
  const langPath = absoluteAssetUrl(`${ocrAssetDirectoryUrl()}/`)
  const workerPath = await sameOriginWorkerScriptUrl()
  const corePath = absoluteAssetUrl(`${ocrAssetDirectoryUrl()}/${await detectLstmCoreFile()}`)

  return await new Promise<Worker>((resolve, reject) => {
    let settled = false
    const fail = (cause: unknown) => {
      if (settled) return
      settled = true
      reject(ocrFailure(cause))
    }
    const timer = window.setTimeout(() => {
      fail('Timed out while downloading the OCR engine from this site.')
    }, 120_000)

    void createWorker('eng', LSTM_ONLY, {
      workerPath,
      corePath,
      langPath,
      gzip: true,
      workerBlobURL: false,
      errorHandler: fail,
      logger: (message) => {
        if (message.status) onStatus?.(friendlyStatus(message.status))
      },
    }).then(
      (worker) => {
        window.clearTimeout(timer)
        if (settled) {
          void worker.terminate()
          return
        }
        settled = true
        resolve(worker)
      },
      (error) => {
        window.clearTimeout(timer)
        fail(error)
      },
    )
  })
}

export async function ensureTesseractWorker(
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
) {
  if (typeof document === 'undefined') {
    throw new Error('The OCR engine can only run in the browser.')
  }
  if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')

  if (!workerPromise) {
    workerPromise = (async () => {
      const tess = tesseractBrowserApi(await import('tesseract.js'))
      const worker = await createSameOriginWorker(tess.createWorker, onStatus)
      await worker.setParameters({
        tessedit_pageseg_mode: SINGLE_BLOCK as PSM,
      })
      return worker
    })().catch((error) => {
      workerPromise = null
      throw error instanceof Error ? error : ocrFailure(error)
    })
  }

  const abort = new Promise<never>((_, reject) => {
    if (!signal) return
    const fail = () => reject(new DOMException('Analysis cancelled.', 'AbortError'))
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })

  try {
    return await Promise.race([workerPromise, abort])
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const pending = workerPromise
      workerPromise = null
      if (pending) {
        void pending.then((worker) => worker.terminate()).catch(() => undefined)
      }
    }
    throw error
  }
}
