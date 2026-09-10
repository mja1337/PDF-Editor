import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_FILE_SIZE = 250 * 1024 * 1024
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
const INCORRECT_PASSWORD = 2

export interface PdfSession {
  bytes: Uint8Array
  viewer: PDFDocumentProxy
  /** Password used to open the file; kept in memory for export and re-render only. */
  openPassword?: string
}

export interface PasswordPromptContext {
  incorrect: boolean
  reason: 'required' | 'incorrect'
}

export type PasswordPrompt = (context: PasswordPromptContext) => Promise<string | null>

export interface OpenPdfOptions {
  password?: string
  promptPassword?: PasswordPrompt
}

function pdfjsAssetUrl(folder: 'cmaps' | 'standard_fonts' | 'wasm' | 'iccs') {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return `${base}pdfjs/${folder}/`
}

function hasPdfSignature(bytes: Uint8Array) {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024))
  for (let index = 0; index <= head.length - PDF_MAGIC.length; index += 1) {
    if (PDF_MAGIC.every((value, offset) => head[index + offset] === value)) {
      return true
    }
  }
  return false
}

function documentLoadOptions(data: Uint8Array, password?: string) {
  return {
    data,
    password,
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    wasmUrl: pdfjsAssetUrl('wasm'),
    iccUrl: pdfjsAssetUrl('iccs'),
    useSystemFonts: true,
    enableXfa: true,
    stopAtErrors: false,
  }
}

async function loadViewer(bytes: Uint8Array, options?: OpenPdfOptions): Promise<{
  viewer: PDFDocumentProxy
  openPassword?: string
}> {
  let openPassword = options?.password

  const promptPassword = options?.promptPassword
    ? async (context: PasswordPromptContext) => {
        const password = await options.promptPassword!(context)
        if (password) openPassword = password
        return password
      }
    : undefined

  if (!promptPassword) {
    const loadingTask = getDocument(documentLoadOptions(bytes.slice(), openPassword))
    const viewer = await loadingTask.promise
    return { viewer, openPassword }
  }

  return new Promise((resolve, reject) => {
    const loadingTask = getDocument(documentLoadOptions(bytes.slice()))
    let settled = false

    loadingTask.onPassword = (
      updatePassword: (password: string) => void,
      reason: number,
    ) => {
      void promptPassword({
        incorrect: reason === INCORRECT_PASSWORD,
        reason: reason === INCORRECT_PASSWORD ? 'incorrect' : 'required',
      }).then((password) => {
        if (settled) return
        if (!password) {
          settled = true
          void loadingTask.destroy()
          reject(new Error('Password entry was cancelled.'))
          return
        }
        updatePassword(password)
      })
    }

    loadingTask.promise
      .then((viewer) => {
        if (settled) return
        settled = true
        resolve({ viewer, openPassword })
      })
      .catch((error) => {
        if (settled) return
        settled = true
        if (reasonIsPassword(error) && !openPassword) {
          reject(new Error('This PDF requires a password.', { cause: error }))
          return
        }
        reject(error)
      })
  })
}

function reasonIsPassword(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /password/i.test(message)
}

export async function openPdf(file: File, options?: OpenPdfOptions): Promise<PdfSession> {
  if (file.size === 0) throw new Error('This file is empty.')
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('This file is larger than the current 250 MB safety limit.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return openPdfBytes(bytes, options)
}

export async function openPdfBytes(bytes: Uint8Array, options?: OpenPdfOptions): Promise<PdfSession> {
  if (!hasPdfSignature(bytes)) {
    throw new Error('This does not appear to be a valid PDF file.')
  }

  try {
    const { viewer, openPassword } = await loadViewer(bytes, options)
    return { bytes, viewer, openPassword }
  } catch (error) {
    if (error instanceof Error && error.message === 'Password entry was cancelled.') {
      throw error
    }
    const message = error instanceof Error ? error.message : ''
    if (/password/i.test(message)) {
      throw new Error('This PDF requires a password.', { cause: error })
    }
    throw new Error(
      'This PDF could not be opened. It may be damaged, password-protected, or unsupported.',
      { cause: error },
    )
  }
}

export async function renderPageToPng(
  document: PDFDocumentProxy,
  pageIndex: number,
  rotationDelta: number,
  scale = 2,
): Promise<Blob> {
  const page = await document.getPage(pageIndex + 1)
  const rotation = (page.rotate + rotationDelta + 360) % 360
  const viewport = page.getViewport({ scale, rotation })
  const canvas = window.document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas rendering is unavailable.')

  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    background: '#ffffff',
  }).promise

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('The page image could not be created.')
  return blob
}
