import type { PageOverlay } from '../domain/document'
import { PAGE_EDGE_MARGIN, extractedPadPx, wrapTextToWidth } from './textLayout'

/** Extracted lines sit on their own baseline, so wrapped lines stay tight. */
export const EXTRACTED_LINE_HEIGHT = 1.08

/** How small a replacement may shrink before it is reported as overflowing. */
export const MIN_FONT_SCALE = 0.6

/** Clear space kept between a growing line and the next one, in page units. */
export const NEIGHBOUR_GAP = 0.004

/**
 * The screen measures with canvas metrics and the export with the embedded
 * font's own, which differ slightly. A fitted box carries this much slack so the
 * export does not wrap a line the editor showed on one line.
 */
export const METRIC_HEADROOM = 1.04

/** Measures text at a given font size, in the caller's own units. */
export type MeasureAtSize = (text: string, fontSize: number) => number

export type FitBox = Pick<PageOverlay, 'x' | 'y' | 'width' | 'height'>

export interface FitBounds {
  maxRight: number
  maxBottom: number
}

export interface ExtractedFit {
  width: number
  height: number
  fontSize: number
  lines: string[]
  overflow: boolean
  /** Height the text actually needs, so the caller can offer to make room. */
  neededHeight: number
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return bStart < aEnd && bEnd > aStart
}

/**
 * The original geometry a line was analysed with. Edits measure against this so
 * a line that grew can shrink back when text is deleted.
 */
export function extractedSource(
  overlay: Pick<PageOverlay, 'width' | 'height' | 'fontSize' | 'source'>,
) {
  return {
    width: overlay.source?.width ?? overlay.width,
    height: overlay.source?.height ?? overlay.height,
    fontSize: overlay.source?.fontSize ?? overlay.fontSize ?? 18,
  }
}

/**
 * How far a line may grow before it would touch the next analysed line. Only
 * other extracted lines constrain growth; annotations are free to overlap.
 */
export function extractedFitBounds(
  overlay: FitBox & { id?: string },
  neighbours: ReadonlyArray<PageOverlay>,
): FitBounds {
  const centre = overlay.y + overlay.height / 2
  const lines = neighbours.filter(
    (other) => other.extracted && other.id !== overlay.id,
  )

  // Order by centre, not by box edges: analysed boxes from tight leading can
  // overlap, and edge tests then fail to see the neighbour at all.
  let maxRight = 1 - PAGE_EDGE_MARGIN
  for (const other of lines) {
    const otherCentre = other.y + other.height / 2
    const sameRow =
      Math.abs(otherCentre - centre) < Math.max(overlay.height, other.height) * 0.5
    if (sameRow && other.x > overlay.x) {
      maxRight = Math.min(maxRight, other.x - NEIGHBOUR_GAP)
    }
  }

  // A line only needs room below once it has already grown as far right as it
  // can, so the span that matters is the grown one, not the measured one.
  let maxBottom = 1 - PAGE_EDGE_MARGIN
  const grownRight = Math.max(overlay.x + overlay.width, maxRight)
  for (const other of lines) {
    const otherCentre = other.y + other.height / 2
    if (
      otherCentre > centre &&
      overlaps(overlay.x, grownRight, other.x, other.x + other.width)
    ) {
      maxBottom = Math.min(maxBottom, other.y - NEIGHBOUR_GAP)
    }
  }
  // A bound tighter than the current box means no room to grow, which is not
  // the same as being free to grow to the page edge.
  return {
    maxRight: Math.max(overlay.x, maxRight),
    maxBottom: Math.max(overlay.y, maxBottom),
  }
}

/** Extracted lines are single-line source text, so whitespace collapses. */
export function normalizeExtractedText(text: string) {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Wraps a replacement inside a box that is already sized. Every renderer uses
 * this so the screen, the vector export and the scan export break identically.
 */
export function layoutExtractedLines(
  text: string,
  maxWidthPx: number,
  fontSize: number,
  measure: MeasureAtSize,
) {
  const single = normalizeExtractedText(text)
  if (single.length === 0) return ['']
  const pad = extractedPadPx(fontSize)
  const inner = Math.max(1, maxWidthPx - pad.x * 2)
  if (measure(single, fontSize) <= inner) return [single]
  return wrapTextToWidth(single, inner, (value) => measure(value, fontSize))
}

function scaleSteps() {
  const steps: number[] = []
  for (let scale = 1; scale >= MIN_FONT_SCALE - 0.0001; scale -= 0.05) {
    steps.push(Number(scale.toFixed(2)))
  }
  return steps
}

/**
 * Sizes a replacement so it always fits: grow right into free space, then wrap
 * downward into free space, then shrink the type. Reports overflow rather than
 * silently clipping when even the smallest size will not fit.
 */
export function fitExtractedText(options: {
  overlay: FitBox & Pick<PageOverlay, 'fontSize' | 'source'>
  text: string
  bounds: FitBounds
  pageWidth: number
  pageHeight: number
  measure: MeasureAtSize
}): ExtractedFit {
  const { overlay, bounds, pageWidth, pageHeight, measure } = options
  const source = extractedSource(overlay)
  const single = normalizeExtractedText(options.text) || ' '
  const minWidthPx = source.width * pageWidth
  const minHeightPx = source.height * pageHeight
  const maxWidthPx = Math.max(minWidthPx, (bounds.maxRight - overlay.x) * pageWidth)
  const maxHeightPx = Math.max(minHeightPx, (bounds.maxBottom - overlay.y) * pageHeight)

  let fallback: ExtractedFit | null = null
  for (const scale of scaleSteps()) {
    const fontSize = source.fontSize * scale
    const pad = extractedPadPx(fontSize)
    const onePx = measure(single, fontSize) + pad.x * 2 + 2
    if (onePx <= maxWidthPx) {
      const roomy = Math.min(maxWidthPx, onePx * METRIC_HEADROOM)
      return {
        width: Math.max(minWidthPx, roomy) / pageWidth,
        height: minHeightPx / pageHeight,
        fontSize,
        lines: [single],
        overflow: false,
        neededHeight: minHeightPx / pageHeight,
      }
    }
    const lines = layoutExtractedLines(single, maxWidthPx, fontSize, measure)
    const neededPx = lines.length * fontSize * EXTRACTED_LINE_HEIGHT + pad.y * 2
    if (neededPx <= maxHeightPx) {
      const wanted = Math.max(minHeightPx, neededPx * METRIC_HEADROOM)
      return {
        width: maxWidthPx / pageWidth,
        height: Math.min(maxHeightPx, wanted) / pageHeight,
        fontSize,
        lines,
        overflow: false,
        neededHeight: wanted / pageHeight,
      }
    }
    fallback = {
      width: maxWidthPx / pageWidth,
      height: maxHeightPx / pageHeight,
      fontSize,
      lines,
      overflow: true,
      neededHeight: Math.max(minHeightPx, neededPx * METRIC_HEADROOM) / pageHeight,
    }
  }
  return (
    fallback ?? {
      width: maxWidthPx / pageWidth,
      height: maxHeightPx / pageHeight,
      fontSize: source.fontSize * MIN_FONT_SCALE,
      lines: [single],
      overflow: true,
      neededHeight: maxHeightPx / pageHeight,
    }
  )
}
