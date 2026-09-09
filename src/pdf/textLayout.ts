import type { PageOverlay } from '../domain/document'
import { cssFontFamily } from './fontMatch'

export type MeasureText = (text: string) => number

/** Fraction of page width/height kept clear of line growth. About 5mm on A4. */
export const PAGE_EDGE_MARGIN = 0.03

export function overlayAtPageMargin(
  overlay: Pick<PageOverlay, 'width' | 'x'>,
  epsilon = 0.002,
) {
  return overlay.x + overlay.width >= 1 - PAGE_EDGE_MARGIN - epsilon
}

export function overlayFontPx(
  overlay: Pick<PageOverlay, 'fontSize'>,
  renderScale: number,
) {
  return Math.max(0.5, (overlay.fontSize ?? 18) * renderScale)
}

export function overlayFontCss(
  overlay: Pick<
    PageOverlay,
    'extracted' | 'fontItalic' | 'fontRole' | 'fontSize' | 'fontWeight'
  >,
  renderScale: number,
) {
  const weight = overlay.fontWeight ?? (overlay.extracted ? 400 : 900)
  const italic = overlay.fontItalic ? 'italic' : 'normal'
  return `${italic} ${weight} ${overlayFontPx(overlay, renderScale)}px ${cssFontFamily(overlay.fontRole ?? 'sans', weight)}`
}

export function overlayPadPx(
  overlay: Pick<PageOverlay, 'extracted' | 'fontSize'>,
  renderScale: number,
) {
  if (!overlay.extracted) return { x: Math.max(0.25, 2 * renderScale), y: 0 }
  const fontPx = overlayFontPx(overlay, renderScale)
  return {
    x: fontPx * 0.08,
    y: fontPx * 0.14,
  }
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

export function fitOverlayToText(
  overlay: Pick<PageOverlay, 'extracted' | 'fontSize' | 'height' | 'width' | 'x' | 'y'>,
  text: string,
  pageWidth: number,
  pageHeight: number,
  renderScale: number,
  measure: MeasureText,
) {
  const fontPx = overlayFontPx(overlay, renderScale)
  const lineHeightPx = fontPx * (overlay.extracted ? 1 : 1.15)
  const pad = overlayPadPx(overlay, renderScale)
  const minWidthPx = overlay.extracted
    ? overlay.width * pageWidth
    : fontPx * 0.35 + pad.x * 2
  const minHeightPx = overlay.extracted
    ? overlay.height * pageHeight
    : lineHeightPx + pad.y * 2
  const maxWidthPx = Math.max(
    minWidthPx,
    (1 - PAGE_EDGE_MARGIN - overlay.x) * pageWidth,
  )
  const maxHeightPx = Math.max(
    minHeightPx,
    (1 - PAGE_EDGE_MARGIN - overlay.y) * pageHeight,
  )
  const innerMax = Math.max(1, maxWidthPx - pad.x * 2)
  const sample = text.length > 0 ? text : ' '
  const unwrapped = overlay.extracted ? sample.replace(/\s+/g, ' ').trim() || ' ' : sample
  const unwrappedWidth = measure(unwrapped) + pad.x * 2 + 4
  const fitsOnLine = overlay.extracted && unwrappedWidth <= maxWidthPx
  const lines = fitsOnLine ? [unwrapped] : wrapTextToWidth(unwrapped, innerMax, measure)
  const contentWidth = Math.max(0, ...lines.map((line) => measure(line))) + pad.x * 2 + 4
  const widthPx = overlay.extracted && !fitsOnLine
    ? maxWidthPx
    : Math.min(maxWidthPx, Math.max(minWidthPx, contentWidth))
  const heightPx = Math.min(
    maxHeightPx,
    Math.max(minHeightPx, lines.length * lineHeightPx + pad.y * 2),
  )
  return {
    width: Math.max(0.01, widthPx / pageWidth),
    height: Math.max(0.01, heightPx / pageHeight),
  }
}
