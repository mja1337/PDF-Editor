import type { PageOverlay } from '../domain/document'
import { cssFontFamily } from './fontMatch'

export type MeasureText = (text: string) => number

/** Fraction of page width/height kept clear of line growth. About 5mm on A4. */
export const PAGE_EDGE_MARGIN = 0.03

export function overlayFontPx(
  overlay: Pick<PageOverlay, 'fontSize'>,
  renderScale: number,
) {
  return Math.max(0.5, (overlay.fontSize ?? 18) * renderScale)
}

export type FontFace = Pick<
  PageOverlay,
  'extracted' | 'fontItalic' | 'fontRole' | 'fontWeight'
>

export function fontCssAtPx(overlay: FontFace, fontPx: number) {
  const weight = overlay.fontWeight ?? (overlay.extracted ? 400 : 900)
  const italic = overlay.fontItalic ? 'italic' : 'normal'
  return `${italic} ${weight} ${fontPx}px ${cssFontFamily(overlay.fontRole ?? 'sans', weight)}`
}

export function overlayFontCss(
  overlay: FontFace & Pick<PageOverlay, 'fontSize'>,
  renderScale: number,
) {
  return fontCssAtPx(overlay, overlayFontPx(overlay, renderScale))
}

/** Inner padding for an extracted line, in the same units as fontPx. */
export function extractedPadPx(fontPx: number) {
  return { x: fontPx * 0.08, y: fontPx * 0.14 }
}

export function overlayPadPx(
  overlay: Pick<PageOverlay, 'extracted' | 'fontSize'>,
  renderScale: number,
) {
  if (!overlay.extracted) return { x: Math.max(0.25, 2 * renderScale), y: 0 }
  return extractedPadPx(overlayFontPx(overlay, renderScale))
}

export function createCanvasMeasurer(font: string): MeasureText {
  if (typeof document === 'undefined') {
    return (text) => text.length * 8
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return (text) => text.length * 8
  context.font = font
  return (text) => context.measureText(text).width
}

/** Measures text at any size for the same typeface, for fit-and-shrink layout. */
export function createCanvasSizeMeasurer(overlay: FontFace) {
  if (typeof document === 'undefined') {
    return (text: string, fontSize: number) => text.length * fontSize * 0.5
  }
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return (text: string, fontSize: number) => text.length * fontSize * 0.5
  return (text: string, fontSize: number) => {
    context.font = fontCssAtPx(overlay, fontSize)
    return context.measureText(text).width
  }
}

export function caretIndexAtX(text: string, x: number, measure: MeasureText) {
  if (text.length === 0 || x <= 0) return 0
  let previous = 0
  for (let index = 1; index <= text.length; index += 1) {
    const width = measure(text.slice(0, index))
    if (x < (previous + width) / 2) return index - 1
    previous = width
  }
  return text.length
}

export function wrapTextToWidth(text: string, maxWidth: number, measure: MeasureText) {
  const limit = Math.max(1, maxWidth)
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const token of paragraph.split(/(\s+)/u)) {
      const next = `${current}${token}`
      if (current.length > 0 && measure(next) > limit) {
        lines.push(current.replace(/\s+$/u, ''))
        current = token.replace(/^\s+/u, '')
      } else {
        current = next
      }
      while (current.length > 1 && measure(current) > limit) {
        let cut = current.length - 1
        while (cut > 1 && measure(current.slice(0, cut)) > limit) cut -= 1
        lines.push(current.slice(0, cut))
        current = current.slice(cut)
      }
    }
    lines.push(current.replace(/\s+$/u, ''))
  }
  return lines.length > 0 ? lines : ['']
}

/** Sizes a free-standing text note. Analysed lines use fitExtractedText instead. */
export function fitOverlayToText(
  overlay: Pick<PageOverlay, 'extracted' | 'fontSize' | 'height' | 'width' | 'x' | 'y'>,
  text: string,
  pageWidth: number,
  pageHeight: number,
  renderScale: number,
  measure: MeasureText,
) {
  const fontPx = overlayFontPx(overlay, renderScale)
  const lineHeightPx = fontPx * 1.15
  const pad = overlayPadPx({ ...overlay, extracted: false }, renderScale)
  const minWidthPx = fontPx * 0.35 + pad.x * 2
  const minHeightPx = lineHeightPx + pad.y * 2
  const maxWidthPx = Math.max(
    minWidthPx,
    (1 - PAGE_EDGE_MARGIN - overlay.x) * pageWidth,
  )
  const maxHeightPx = Math.max(
    minHeightPx,
    (1 - PAGE_EDGE_MARGIN - overlay.y) * pageHeight,
  )
  const innerMax = Math.max(1, maxWidthPx - pad.x * 2)
  const lines = wrapTextToWidth(text.length > 0 ? text : ' ', innerMax, measure)
  const contentWidth = Math.max(0, ...lines.map((line) => measure(line))) + pad.x * 2 + 4
  const widthPx = Math.min(maxWidthPx, Math.max(minWidthPx, contentWidth))
  const heightPx = Math.min(
    maxHeightPx,
    Math.max(minHeightPx, lines.length * lineHeightPx + pad.y * 2),
  )
  return {
    width: Math.max(0.01, widthPx / pageWidth),
    height: Math.max(0.01, heightPx / pageHeight),
  }
}
