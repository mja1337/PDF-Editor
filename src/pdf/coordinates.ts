import type { PageOverlay, QuarterTurn } from '../domain/document'

export interface Point {
  x: number
  y: number
}

export interface PdfRect extends Point {
  width: number
  height: number
}

export function displayDimensions(
  pageWidth: number,
  pageHeight: number,
  rotation: QuarterTurn,
) {
  return rotation === 90 || rotation === 270
    ? { width: pageHeight, height: pageWidth }
    : { width: pageWidth, height: pageHeight }
}

export function displayPointToPdf(
  point: Point,
  pageWidth: number,
  pageHeight: number,
  rotation: QuarterTurn,
): Point {
  switch (rotation) {
    case 0:
      return { x: point.x, y: pageHeight - point.y }
    case 90:
      return { x: point.y, y: point.x }
    case 180:
      return { x: pageWidth - point.x, y: point.y }
    case 270:
      return { x: pageWidth - point.y, y: pageHeight - point.x }
  }
}

export function overlayToPdfRect(
  overlay: PageOverlay,
  pageWidth: number,
  pageHeight: number,
  rotation: QuarterTurn,
): PdfRect {
  const display = displayDimensions(pageWidth, pageHeight, rotation)
  const left = overlay.x * display.width
  const top = overlay.y * display.height
  const right = (overlay.x + overlay.width) * display.width
  const bottom = (overlay.y + overlay.height) * display.height
  const corners = [
    displayPointToPdf({ x: left, y: top }, pageWidth, pageHeight, rotation),
    displayPointToPdf({ x: right, y: top }, pageWidth, pageHeight, rotation),
    displayPointToPdf({ x: left, y: bottom }, pageWidth, pageHeight, rotation),
    displayPointToPdf({ x: right, y: bottom }, pageWidth, pageHeight, rotation),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  }
}

export function overlayLineToPdf(
  overlay: PageOverlay,
  pageWidth: number,
  pageHeight: number,
  rotation: QuarterTurn,
) {
  const display = displayDimensions(pageWidth, pageHeight, rotation)
  return {
    start: displayPointToPdf(
      { x: overlay.x * display.width, y: overlay.y * display.height },
      pageWidth,
      pageHeight,
      rotation,
    ),
    end: displayPointToPdf(
      {
        x: (overlay.x + overlay.width) * display.width,
        y: (overlay.y + overlay.height) * display.height,
      },
      pageWidth,
      pageHeight,
      rotation,
    ),
  }
}
