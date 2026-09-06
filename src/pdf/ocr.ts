import type { PDFPageProxy } from 'pdfjs-dist'
import { ensureTesseractWorker, type OcrMode } from './ocrEngine'
import { groupTextRuns, type ExtractedTextRun } from './textGeometry'

interface DetectedText {
  boundingBox: { x: number; y: number; width: number; height: number }
  rawValue?: string
}

interface TextDetectorLike {
  detect(image: CanvasImageSource): Promise<DetectedText[]>
}

type TextDetectorCtor = new () => TextDetectorLike

export interface OcrWordBox {
  text: string
  confidence?: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

function textDetectorCtor(): TextDetectorCtor | null {
  if (typeof globalThis === 'undefined') return null
  const Detector = (globalThis as { TextDetector?: TextDetectorCtor }).TextDetector
  return typeof Detector === 'function' ? Detector : null
}

export function platformOcrAvailable() {
  return textDetectorCtor() !== null
}

export function detectionsToRuns(
  detections: DetectedText[],
  canvasWidth: number,
  canvasHeight: number,
  renderScale: number,
): ExtractedTextRun[] {
  if (canvasWidth <= 0 || canvasHeight <= 0) return []
  const scale = Math.max(0.1, renderScale)
  const runs: ExtractedTextRun[] = []
  for (const detection of detections) {
    const text = detection.rawValue?.replace(/\s+/g, ' ').trim() ?? ''
    const box = detection.boundingBox
    if (!text || box.width < 2 || box.height < 2) continue
    runs.push({
      text,
      x: box.x / canvasWidth,
      y: box.y / canvasHeight,
      width: box.width / canvasWidth,
      height: box.height / canvasHeight,
      fontSize: box.height / scale,
      fontRole: 'sans',
      fontWeight: 400,
    })
  }
  return groupTextRuns(runs)
}

export function tesseractWordBoxesToRuns(
  words: OcrWordBox[],
  canvasWidth: number,
  canvasHeight: number,
  renderScale: number,
  minConfidence = 40,
): ExtractedTextRun[] {
  if (canvasWidth <= 0 || canvasHeight <= 0) return []
  const scale = Math.max(0.1, renderScale)
  const runs: ExtractedTextRun[] = []
  for (const word of words) {
    const text = word.text.replace(/\s+/g, ' ').trim()
    const width = word.bbox.x1 - word.bbox.x0
    const height = word.bbox.y1 - word.bbox.y0
    if (!text || width < 2 || height < 2) continue
    if ((word.confidence ?? 100) < minConfidence) continue
    runs.push({
      text,
      x: word.bbox.x0 / canvasWidth,
      y: word.bbox.y0 / canvasHeight,
      width: width / canvasWidth,
      height: height / canvasHeight,
      fontSize: height / scale,
      fontRole: 'sans',
      fontWeight: 400,
    })
  }
  return groupTextRuns(runs)
}

function wordsFromTesseractBlocks(
  blocks: Array<{
    paragraphs?: Array<{
      lines?: Array<{ words?: OcrWordBox[] }>
    }>
  }> | null,
) {
  const words: OcrWordBox[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) words.push(word)
      }
    }
  }
  return words
}

function enhanceForOcr(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return source
  context.drawImage(source, 0, 0)
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  let min = 255
  let max = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const luma =
      0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
    min = Math.min(min, luma)
    max = Math.max(max, luma)
  }
  const span = Math.max(1, max - min)
  for (let index = 0; index < pixels.length; index += 4) {
    const luma =
      0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
    const stretched = Math.round(((luma - min) / span) * 255)
    pixels[index] = stretched
    pixels[index + 1] = stretched
    pixels[index + 2] = stretched
  }
  context.putImageData(image, 0, 0)
  return canvas
}

async function tesseractCanvas(
  canvas: HTMLCanvasElement,
  renderScale: number,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
) {
  const worker = await ensureTesseractWorker(signal, onStatus)
  if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')
  const enhanced = enhanceForOcr(canvas)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      enhanced.toBlob(
        (file) =>
          file
            ? resolve(file)
            : reject(new Error('The scanned page could not be snapshotted for OCR.')),
        'image/png',
      )
    })
    const result = await worker.recognize(blob, {}, { text: true, blocks: true })
    return tesseractWordBoxesToRuns(
      wordsFromTesseractBlocks(result.data.blocks),
      canvas.width,
      canvas.height,
      renderScale,
    )
  } finally {
    if (enhanced !== canvas) {
      enhanced.width = 0
      enhanced.height = 0
    }
  }
}

export async function ocrRenderedPage(
  page: PDFPageProxy,
  rotation: number,
  signal?: AbortSignal,
  mode: OcrMode = 'platform',
  onStatus?: (status: string) => void,
): Promise<ExtractedTextRun[]> {
  if (mode === 'off' || typeof document === 'undefined') return []
  if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')

  const base = page.getViewport({ scale: 1, rotation })
  const scale = Math.min(2, 1100 / Math.max(base.width, base.height, 1))
  const viewport = page.getViewport({ scale, rotation })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return []
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: '#ffffff',
    }).promise
    if (signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')

    const Detector = textDetectorCtor()
    if (Detector) {
      try {
        const detections = await new Detector().detect(canvas)
        const platformRuns = detectionsToRuns(
          detections,
          canvas.width,
          canvas.height,
          scale,
        )
        if (platformRuns.length > 0) return platformRuns
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
      }
    }

    if (mode !== 'tesseract') return []
    try {
      return await tesseractCanvas(canvas, scale, signal, onStatus)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (error instanceof Error && error.message.startsWith('The OCR engine')) throw error
      const detail = error instanceof Error ? error.message : 'Check the connection, then try again.'
      throw new Error(`The OCR engine could not be loaded from this GitHub Pages site. ${detail}`, {
        cause: error,
      })
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof Error && error.message.startsWith('The OCR engine')) throw error
    return []
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
