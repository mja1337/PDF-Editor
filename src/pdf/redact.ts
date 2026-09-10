import type { EditorDocument, PageOverlay } from '../domain/document'
import { exportPdf } from './export'

export function isRedactionOverlay(overlay: PageOverlay) {
  return overlay.type === 'redaction'
}

export function pageHasRedactions(overlays: PageOverlay[]) {
  return overlays.some(isRedactionOverlay)
}

export function documentHasRedactions(document: EditorDocument) {
  return document.pages.some((page) => pageHasRedactions(page.overlays))
}

export function redactionCount(document: EditorDocument) {
  return document.pages.reduce(
    (total, page) => total + page.overlays.filter(isRedactionOverlay).length,
    0,
  )
}

export function canSecureRedact() {
  return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined'
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.82) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (file) => (file ? resolve(file) : reject(new Error('Could not encode the redacted page.'))),
      'image/jpeg',
      quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

async function rasterizePdfPage(bytes: Uint8Array, pageIndex: number) {
  const { openPdfBytes } = await import('./engine')
  const session = await openPdfBytes(bytes.slice())
  try {
    const page = await session.viewer.getPage(pageIndex + 1)
    const rotation = page.rotate
    const base = page.getViewport({ scale: 1, rotation })
    const scale = Math.min(3, 2400 / Math.max(base.width, base.height, 1))
    const viewport = page.getViewport({ scale, rotation })
    const canvas = document.createElement('canvas')
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
    const jpeg = await canvasToJpeg(canvas)
    canvas.width = 0
    canvas.height = 0
    return jpeg
  } finally {
    await session.viewer.loadingTask.destroy()
  }
}

export async function exportRedactedPdf(
  sourceBytes: ReadonlyMap<string, Uint8Array>,
  document: EditorDocument,
  fontBytes?: Uint8Array,
  sourcePasswords?: ReadonlyMap<string, string>,
): Promise<Uint8Array> {
  if (!documentHasRedactions(document)) {
    throw new Error('Add at least one redaction mark before exporting a redacted PDF.')
  }
  if (!canSecureRedact()) {
    throw new Error('Secure redaction export requires a browser with canvas support.')
  }

  const { PDFDocument, degrees } = await import('pdf-lib')
  const preparedBytes = await exportPdf(sourceBytes, document, fontBytes, sourcePasswords)
  const prepared = await PDFDocument.load(preparedBytes, { updateMetadata: false })
  const output = await PDFDocument.create()
  const primary = prepared.getPageCount() > 0 ? prepared : null
  if (primary) copyMetadataFromPrepared(primary, output)

  for (let index = 0; index < document.pages.length; index += 1) {
    const pageReference = document.pages[index]
    const sourcePage = prepared.getPage(index)
    const rotation = sourcePage.getRotation().angle
    const width = sourcePage.getWidth()
    const height = sourcePage.getHeight()

    if (!pageHasRedactions(pageReference.overlays)) {
      const [page] = await output.copyPages(prepared, [index])
      output.addPage(page)
      continue
    }

    const singlePageDocument: EditorDocument = {
      ...document,
      pages: [pageReference],
    }
    const pageBytes = await exportPdf(
      sourceBytes,
      singlePageDocument,
      fontBytes,
      sourcePasswords,
    )
    const jpeg = await rasterizePdfPage(pageBytes, 0)
    const page = output.addPage([width, height])
    page.setRotation(degrees(rotation))
    const image = await output.embedJpg(jpeg)
    page.drawImage(image, { x: 0, y: 0, width, height })
  }

  const bytes = await output.save({ useObjectStreams: true })
  const verification = await PDFDocument.load(bytes, { updateMetadata: false })
  if (verification.getPageCount() !== document.pages.length) {
    throw new Error('Redaction export verification failed: page count changed.')
  }
  return bytes
}

function copyMetadataFromPrepared(
  source: Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.load>>,
  output: Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.create>>,
) {
  const title = source.getTitle()
  const author = source.getAuthor()
  const subject = source.getSubject()
  const keywords = source.getKeywords()
  const creator = source.getCreator()
  const producer = source.getProducer()
  const creationDate = source.getCreationDate()
  const modificationDate = source.getModificationDate()

  if (title) output.setTitle(title)
  if (author) output.setAuthor(author)
  if (subject) output.setSubject(subject)
  if (keywords) output.setKeywords(keywords.split(/,\s*/).filter(Boolean))
  if (creator) output.setCreator(creator)
  if (producer) output.setProducer(producer)
  if (creationDate) output.setCreationDate(creationDate)
  if (modificationDate) output.setModificationDate(modificationDate)
}

export function downloadRedactedPdf(bytes: Uint8Array, sourceName: string) {
  const baseName = sourceName.replace(/\.pdf$/i, '') || 'document'
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${baseName}-redacted.pdf`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
