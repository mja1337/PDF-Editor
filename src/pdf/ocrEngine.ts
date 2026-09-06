import type { Worker } from 'tesseract.js'

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

function publicBaseUrl() {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return base
}

export function ocrAssetDirectoryUrl() {
  return `${publicBaseUrl()}ocr`
}

const FRIENDLY_STATUS: Record<string, string> = {
  'loading tesseract core': 'Downloading OCR engine from this site',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Downloading English model from this site',
  'recognizing text': 'Reading scanned page',
}

let workerPromise: Promise<Worker> | null = null

function friendlyStatus(status: string) {
  return FRIENDLY_STATUS[status] ?? status
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
      const tess = await import('tesseract.js')
      const createWorker = tess.createWorker
      const oem = tess.OEM.LSTM_ONLY
      const psm = tess.PSM.SINGLE_BLOCK
      const langPath = ocrAssetDirectoryUrl()
      const worker = await createWorker('eng', oem, {
        workerPath: `${langPath}/worker.min.js`,
        corePath: `${langPath}/`,
        langPath,
        gzip: true,
        workerBlobURL: false,
        logger: (message) => {
          if (message.status) onStatus?.(friendlyStatus(message.status))
        },
      })
      await worker.setParameters({ tessedit_pageseg_mode: psm })
      return worker
    })().catch((error) => {
      workerPromise = null
      throw error
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
