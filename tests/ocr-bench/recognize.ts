import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorker, type PSM, type Worker } from 'tesseract.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const TESSDATA_DIR = join(REPO_ROOT, '.ocr-cache')
export const TESSDATA_FILE = join(TESSDATA_DIR, 'eng.traineddata.gz')

const PRELOAD_SIMD_LSTM = join(dirname(fileURLToPath(import.meta.url)), 'force-simd-lstm.cjs')

function preferSimdLstmCore() {
  if (!process.execArgv.includes(PRELOAD_SIMD_LSTM)) {
    process.execArgv.push('--require', PRELOAD_SIMD_LSTM)
  }
}

export function tessdataAvailable() {
  return existsSync(TESSDATA_FILE)
}

export async function createFixtureOcrWorker() {
  if (!tessdataAvailable()) {
    throw new Error(`English tessdata_best was not found at ${TESSDATA_FILE}`)
  }
  preferSimdLstmCore()
  const worker = await createWorker('eng', 1, {
    langPath: TESSDATA_DIR,
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    errorHandler: (error) => {
      throw error instanceof Error ? error : new Error(String(error))
    },
  })
  await worker.setParameters({
    tessedit_pageseg_mode: '3' as PSM,
    preserve_interword_spaces: '1',
    user_defined_dpi: '180',
  })
  return worker
}

export async function recognizeWithWorker(worker: Worker, imagePath: string, dpi = 180) {
  await worker.setParameters({
    user_defined_dpi: String(dpi),
  })
  const result = await worker.recognize(await readFile(imagePath), {}, { text: true, blocks: true })
  return {
    text: result.data.text ?? '',
    confidence: result.data.confidence ?? 0,
  }
}

export async function recognizeScannedFixture(imagePath: string, dpi = 180) {
  const worker = await createFixtureOcrWorker()
  try {
    return await recognizeWithWorker(worker, imagePath, dpi)
  } finally {
    await worker.terminate()
  }
}
