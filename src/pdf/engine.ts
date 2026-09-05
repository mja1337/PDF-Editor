import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_FILE_SIZE = 250 * 1024 * 1024

export interface PdfSession {
  bytes: Uint8Array
  viewer: PDFDocumentProxy
}

function hasPdfSignature(bytes: Uint8Array) {
  return new TextDecoder('ascii').decode(bytes.slice(0, 5)) === '%PDF-'
}

export async function openPdf(file: File): Promise<PdfSession> {
  if (file.size === 0) throw new Error('This file is empty.')
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('This file is larger than the current 250 MB safety limit.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return openPdfBytes(bytes)
}

export async function openPdfBytes(bytes: Uint8Array): Promise<PdfSession> {
  if (!hasPdfSignature(bytes)) {
    throw new Error('This does not appear to be a valid PDF file.')
  }

  try {
    const loadingTask = getDocument({
      data: bytes.slice(),
      stopAtErrors: true,
    })
    const viewer = await loadingTask.promise
    return { bytes, viewer }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/password/i.test(message)) {
      throw new Error('Password-protected PDFs are not supported yet.', {
        cause: error,
      })
    }
    throw new Error(
      'This PDF could not be opened. It may be damaged or unsupported.',
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
  await page.render({ canvas, canvasContext: context, viewport }).promise

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('The page image could not be created.')
  return blob
}
