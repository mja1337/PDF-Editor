import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import type { EditorDocument, PageOverlay, QuarterTurn } from '../domain/document'
import { createExtractedOverlay } from '../domain/overlays'
import type { PdfSession } from './engine'
import { classifyPdfFont } from './fontMatch'
import { sampleCellInk, sampleNormalizedRect, type PixelBuffer } from './pageSample'
import {
  colorsToSegments,
  hasDistinctInk,
  type ColorSegment,
} from './inkSegments'
import { createCanvasSizeMeasurer } from './textLayout'
import { ocrRenderedPage } from './ocr'
import type { OcrMode } from './ocrEngine'
import {
  groupTextRuns,
  type ExtractedTextRun,
} from './textGeometry'

export type { ExtractedTextRun }

export interface PageTextAnalysis {
  pageId: string
  runs: ExtractedTextRun[]
  pageText: string
}

export interface DocumentTextAnalysis {
  pages: PageTextAnalysis[]
  overlays: Array<{ pageId: string; overlay: PageOverlay }>
  blocks: number
  pagesWithText: number
  emptyPages: number
  ocrPages: number
}

type Transform = [number, number, number, number, number, number]

function multiplyTransform(left: number[], right: number[]): Transform {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function resolvedFontName(
  page: { commonObjs: { has(id: string): boolean; get(id: string): { name?: string } } },
  fontName?: string,
) {
  if (!fontName) return fontName
  try {
    if (!page.commonObjs.has(fontName)) return fontName
    return page.commonObjs.get(fontName)?.name ?? fontName
  } catch {
    return fontName
  }
}

function runsFromTextContent(
  items: Array<{ str?: string; transform?: number[]; width?: number; height?: number; fontName?: string }>,
  styles: Record<string, { ascent?: number; descent?: number; fontFamily?: string }>,
  viewport: PageViewport,
  page: { commonObjs: { has(id: string): boolean; get(id: string): { name?: string } } },
): ExtractedTextRun[] {
  const runs: ExtractedTextRun[] = []
  for (const item of items) {
    if (!item.str || !item.transform || item.transform.length < 6) continue
    const tx = multiplyTransform(viewport.transform, item.transform)
    const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 1
    const style = item.fontName ? styles[item.fontName] : undefined
    let ascent = fontHeight
    if (style?.ascent) ascent = style.ascent * fontHeight
    else if (style?.descent) ascent = (1 + style.descent) * fontHeight
    const angle = Math.atan2(tx[1], tx[0])
    const left = angle === 0 ? tx[4] : tx[4] - ascent * Math.sin(angle)
    const top = angle === 0 ? tx[5] - ascent : tx[5] - ascent * Math.cos(angle)
    const fontScale = fontHeight / (item.height || fontHeight || 1)
    const width = (item.width ?? 0) * fontScale
    if (viewport.width <= 0 || viewport.height <= 0) continue
    const face = classifyPdfFont(
      resolvedFontName(page, item.fontName),
      style?.fontFamily,
    )
    runs.push({
      text: item.str,
      x: left / viewport.width,
      y: top / viewport.height,
      width: width / viewport.width,
      height: fontHeight / viewport.height,
      fontSize: fontHeight,
      fontRole: face.role,
      fontWeight: face.weight,
      fontItalic: face.italic,
    })
  }
  return groupTextRuns(runs)
}

/**
 * Reads the ink colour of each glyph in a line. Character positions come from the
 * matched face, then are rescaled so the last glyph lands on the run's real right
 * edge -- that removes the systematic drift between the matched font's metrics and
 * the font the PDF actually used, which is what would otherwise colour the wrong
 * characters.
 */
function sampleRunInk(
  image: PixelBuffer,
  run: ExtractedTextRun,
  appearance: { color: string; backgroundColor: string },
): ColorSegment[] | undefined {
  const characters = Array.from(run.text)
  if (characters.length < 2 || run.width <= 0) return undefined
  const measure = createCanvasSizeMeasurer({ ...run, extracted: true })
  const total = measure(run.text, 100)
  if (!(total > 0)) return undefined

  const colors: string[] = []
  let cursor = 0
  for (const character of characters) {
    const advance = measure(character, 100) / total
    const start = cursor
    cursor = Math.min(1, cursor + advance)
    if (character === ' ') {
      colors.push(appearance.color)
      continue
    }
    const ink = sampleCellInk(
      image,
      {
        x: run.x + start * run.width,
        y: run.y,
        width: Math.max(1 / image.width, (cursor - start) * run.width),
        height: run.height,
      },
      appearance.backgroundColor,
    )
    colors.push(ink ?? appearance.color)
  }
  if (!hasDistinctInk(colors)) return undefined
  return colorsToSegments(run.text, colors)
}

async function sampleRunAppearance(
  page: PDFPageProxy,
  rotation: number,
  runs: ExtractedTextRun[],
): Promise<ExtractedTextRun[]> {
  if (runs.length === 0 || typeof document === 'undefined') return runs
  try {
    const base = page.getViewport({ scale: 1, rotation })
    const scale = Math.min(2, 900 / Math.max(base.width, base.height, 1))
    const viewport = page.getViewport({ scale, rotation })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return runs
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      background: '#ffffff',
    }).promise
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    canvas.width = 0
    canvas.height = 0
    return runs.map((run) => {
      const appearance = sampleNormalizedRect(image, run)
      return {
        ...run,
        color: appearance.color,
        backgroundColor: appearance.backgroundColor,
        colorSegments: sampleRunInk(image, run, appearance),
      }
    })
  } catch {
    return runs
  }
}

function pagePlainText(items: Array<{ str?: string; hasEOL?: boolean }>) {
  return items
    .map((item) => {
      if (!item.str) return ''
      return `${item.str}${item.hasEOL ? '\n' : ' '}`
    })
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractPageText(
  viewer: PDFDocumentProxy,
  pageIndex: number,
  rotationDelta: QuarterTurn = 0,
  signal?: AbortSignal,
  ocr: OcrMode = 'platform',
  onStatus?: (status: string) => void,
): Promise<{ runs: ExtractedTextRun[]; pageText: string; ocr: boolean }> {
  const page = await viewer.getPage(pageIndex + 1)
  const rotation = (page.rotate + rotationDelta + 360) % 360
  const viewport = page.getViewport({ scale: 1, rotation })
  const content = await page.getTextContent()
  const items = content.items.flatMap((item) => ('str' in item ? [item] : []))
  let runs = await sampleRunAppearance(
    page,
    rotation,
    runsFromTextContent(items, content.styles, viewport, page),
  )
  let pageText = pagePlainText(items)
  let usedOcr = false
  if (runs.length === 0) {
    const scanned = await ocrRenderedPage(page, rotation, signal, ocr, onStatus)
    if (scanned.length > 0) {
      runs = scanned[0]?.color
        ? scanned
        : await sampleRunAppearance(page, rotation, scanned)
      pageText = scanned.map((run) => run.text).join('\n')
      usedOcr = true
    }
  }
  return { runs, pageText, ocr: usedOcr }
}

export async function analyseEditorDocument(
  sessions: ReadonlyMap<string, PdfSession>,
  document: EditorDocument,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number, label?: string) => void,
  ocr: OcrMode = 'platform',
): Promise<DocumentTextAnalysis> {
  const pages: PageTextAnalysis[] = []
  const overlays: Array<{ pageId: string; overlay: PageOverlay }> = []
  let ocrPages = 0

  for (let position = 0; position < document.pages.length; position += 1) {
    if (signal.aborted) throw new DOMException('Analysis cancelled.', 'AbortError')
    const reference = document.pages[position]
    const session = sessions.get(reference.sourceDocumentId)
    if (!session) continue
    const extracted = await extractPageText(
      session.viewer,
      reference.sourcePageIndex,
      reference.rotationDelta,
      signal,
      ocr,
      (status) => onProgress?.(position, document.pages.length, status),
    )
    if (extracted.ocr) ocrPages += 1
    pages.push({
      pageId: reference.id,
      runs: extracted.runs,
      pageText: extracted.pageText,
    })
    for (const run of extracted.runs) {
      overlays.push({
        pageId: reference.id,
        overlay: createExtractedOverlay({ ...run, scanned: extracted.ocr }),
      })
    }
    onProgress?.(position + 1, document.pages.length)
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })
  }

  const pagesWithText = pages.filter((page) => page.runs.length > 0).length
  return {
    pages,
    overlays,
    blocks: overlays.length,
    pagesWithText,
    emptyPages: pages.length - pagesWithText,
    ocrPages,
  }
}
