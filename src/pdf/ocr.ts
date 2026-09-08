import type { PDFPageProxy } from 'pdfjs-dist'
import { cssFontFamily, type EditorFontRole } from './fontMatch'
import { recognizeScannedImage, type OcrMode } from './ocrEngine'
import { sampleNormalizedRect, type PixelBuffer } from './pageSample'
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
  return tesseractLinesToRuns(
    [{ words }],
    canvasWidth,
    canvasHeight,
    renderScale,
    minConfidence,
  )
}

export function cleanupOcrText(value: string) {
  return Array.from(value.normalize('NFC'))
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 10 || code === 13 || code >= 32
    })
    .join('')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
}

export function fittedOcrFontSize(
  text: string,
  boxWidthPx: number,
  boxHeightPx: number,
  renderScale: number,
  measure?: (fontPx: number, sample: string) => number,
) {
  const scale = Math.max(0.1, renderScale)
  const byHeight = (boxHeightPx * 0.76) / scale
  if (!text || boxWidthPx < 4 || boxHeightPx < 4 || !measure) return byHeight
  const unit = measure(12, text) / 12
  if (!(unit > 0)) return byHeight
  const byWidth = (boxWidthPx * 0.98) / unit / scale
  return Math.max(byHeight * 0.78, Math.min(byHeight, byWidth))
}

export function guessOcrFace(
  words: Array<{ text: string; width: number; height: number }>,
  inkRatio: number,
): Pick<ExtractedTextRun, 'fontRole' | 'fontWeight' | 'fontItalic'> {
  const samples = words
    .map((word) => {
      const letters = word.text.replace(/\s+/g, '')
      if (letters.length < 2 || word.height < 4) return null
      return word.width / letters.length / word.height
    })
    .filter((value): value is number => value != null && Number.isFinite(value))
  const mean =
    samples.reduce((total, value) => total + value, 0) / Math.max(1, samples.length)
  const variance =
    samples.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, samples.length)
  const uniform = samples.length >= 3 && Math.sqrt(variance) / Math.max(0.01, mean) < 0.14
  return {
    fontRole: uniform ? 'mono' : 'sans',
    fontWeight: inkRatio > 0.36 ? 700 : 400,
    fontItalic: false,
  }
}

interface TesseractLine {
  text?: string
  bbox?: { x0: number; y0: number; x1: number; y1: number }
  words?: OcrWordBox[]
}

function linesFromTesseractBlocks(
  blocks: Array<{
    paragraphs?: Array<{ lines?: TesseractLine[] }>
  }> | null,
) {
  const lines: TesseractLine[] = []
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) lines.push(line)
    }
  }
  return lines
}

function joinOcrWords(words: OcrWordBox[]) {
  if (words.length === 0) return ''
  const ordered = [...words].sort((left, right) => left.bbox.x0 - right.bbox.x0)
  let text = ordered[0]?.text ?? ''
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const gap = current.bbox.x0 - previous.bbox.x1
    const height = Math.max(
      previous.bbox.y1 - previous.bbox.y0,
      current.bbox.y1 - current.bbox.y0,
    )
    text += `${gap > height * 0.12 ? ' ' : ''}${current.text}`
  }
  return cleanupOcrText(text)
}

export function tesseractLinesToRuns(
  lines: TesseractLine[],
  canvasWidth: number,
  canvasHeight: number,
  renderScale: number,
  minConfidence = 35,
  measure?: (fontPx: number, sample: string) => number,
): ExtractedTextRun[] {
  if (canvasWidth <= 0 || canvasHeight <= 0) return []
  const scale = Math.max(0.1, renderScale)
  const runs: ExtractedTextRun[] = []
  for (const line of lines) {
    const words = (line.words ?? []).filter((word) => {
      const text = cleanupOcrText(word.text)
      const width = word.bbox.x1 - word.bbox.x0
      const height = word.bbox.y1 - word.bbox.y0
      return text.length > 0 && width >= 2 && height >= 2 && (word.confidence ?? 100) >= minConfidence
    })
    const text = words.length > 0 ? joinOcrWords(words) : cleanupOcrText(line.text ?? '')
    if (!text) continue
    const box =
      words.length > 0
        ? {
            x0: Math.min(...words.map((word) => word.bbox.x0)),
            y0: Math.min(...words.map((word) => word.bbox.y0)),
            x1: Math.max(...words.map((word) => word.bbox.x1)),
            y1: Math.max(...words.map((word) => word.bbox.y1)),
          }
        : line.bbox
    if (!box) continue
    const width = box.x1 - box.x0
    const height = box.y1 - box.y0
    if (width < 2 || height < 2) continue
    const face = guessOcrFace(
      words.map((word) => ({
        text: cleanupOcrText(word.text),
        width: word.bbox.x1 - word.bbox.x0,
        height: word.bbox.y1 - word.bbox.y0,
      })),
      0,
    )
    runs.push({
      text,
      x: box.x0 / canvasWidth,
      y: box.y0 / canvasHeight,
      width: width / canvasWidth,
      height: height / canvasHeight,
      fontSize: fittedOcrFontSize(text, width, height, scale, measure),
      fontRole: face.fontRole,
      fontWeight: face.fontWeight,
      fontItalic: face.fontItalic,
    })
  }
  return runs
}

function canvasFontMeasure(
  role: EditorFontRole,
  weight: 400 | 700,
  italic: boolean,
) {
  if (typeof document === 'undefined') return undefined
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return undefined
  return (fontPx: number, sample: string) => {
    context.font = `${italic ? 'italic' : 'normal'} ${weight} ${fontPx}px ${cssFontFamily(role, weight)}`
    return context.measureText(sample).width
  }
}

function inkFillRatio(
  image: PixelBuffer,
  rect: { x: number; y: number; width: number; height: number },
) {
  const left = Math.max(0, Math.floor(rect.x * image.width))
  const top = Math.max(0, Math.floor(rect.y * image.height))
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width))
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  let dark = 0
  let total = 0
  const step = Math.max(1, Math.floor(Math.min(width, height) / 24))
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const index = (y * image.width + x) * 4
      const luma =
        0.2126 * (image.data[index] ?? 255) +
        0.7152 * (image.data[index + 1] ?? 255) +
        0.0722 * (image.data[index + 2] ?? 255)
      total += 1
      if (luma < 140) dark += 1
    }
  }
  return total === 0 ? 0 : dark / total
}

function sharpenGrayscale(pixels: Uint8ClampedArray, width: number, height: number) {
  const copy = new Uint8ClampedArray(pixels)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const center = copy[index] ?? 0
      const north = copy[((y - 1) * width + x) * 4] ?? center
      const south = copy[((y + 1) * width + x) * 4] ?? center
      const west = copy[(y * width + x - 1) * 4] ?? center
      const east = copy[(y * width + x + 1) * 4] ?? center
      const value = Math.max(0, Math.min(255, 5 * center - north - south - west - east))
      pixels[index] = value
      pixels[index + 1] = value
      pixels[index + 2] = value
    }
  }
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
    const stretched = Math.round(((luma - min) / span) ** 0.85 * 255)
    pixels[index] = stretched
    pixels[index + 1] = stretched
    pixels[index + 2] = stretched
  }
  sharpenGrayscale(pixels, canvas.width, canvas.height)
  context.putImageData(image, 0, 0)
  return canvas
}

function finishOcrRuns(
  runs: ExtractedTextRun[],
  image: PixelBuffer,
  canvasWidth: number,
  canvasHeight: number,
  renderScale: number,
) {
  return runs.map((run) => {
    const appearance = sampleNormalizedRect(image, run)
    const fontWeight = inkFillRatio(image, run) > 0.36 ? 700 : (run.fontWeight ?? 400)
    const fontRole = run.fontRole ?? 'sans'
    const measure = canvasFontMeasure(fontRole, fontWeight, Boolean(run.fontItalic))
    return {
      ...run,
      fontRole,
      fontWeight,
      color: appearance.color,
      backgroundColor: appearance.backgroundColor,
      fontSize: fittedOcrFontSize(
        run.text,
        run.width * canvasWidth,
        run.height * canvasHeight,
        renderScale,
        measure,
      ),
    }
  })
}

async function tesseractCanvas(
  canvas: HTMLCanvasElement,
  image: PixelBuffer,
  renderScale: number,
  signal?: AbortSignal,
  onStatus?: (status: string) => void,
) {
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
    const result = await recognizeScannedImage(blob, signal, onStatus, {
      dpi: Math.round(72 * renderScale),
    })
    const lines = linesFromTesseractBlocks(result.data.blocks)
    const measure = canvasFontMeasure('sans', 400, false)
    const runs = tesseractLinesToRuns(
      lines,
      canvas.width,
      canvas.height,
      renderScale,
      35,
      measure,
    )
    return finishOcrRuns(runs, image, canvas.width, canvas.height, renderScale)
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
  const scale = Math.min(3, 2200 / Math.max(base.width, base.height, 1))
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
    const image = context.getImageData(0, 0, canvas.width, canvas.height)

    if (mode === 'platform') {
      const Detector = textDetectorCtor()
      if (!Detector) return []
      try {
        const detections = await new Detector().detect(canvas)
        return detectionsToRuns(detections, canvas.width, canvas.height, scale)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        return []
      }
    }

    if (mode !== 'tesseract') return []
    try {
      return await tesseractCanvas(canvas, image, scale, signal, onStatus)
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
