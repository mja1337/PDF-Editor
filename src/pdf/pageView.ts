export type PageViewMode = 'width' | 'page' | 'custom'

export const STAGE_WIDTH_INSET = 128
export const MIN_PAGE_WIDTH = 280
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2
export const ZOOM_STEP = 0.25

export function fitWidthPx(stageWidth: number) {
  return Math.max(stageWidth - STAGE_WIDTH_INSET, MIN_PAGE_WIDTH)
}

export function previewTargetWidth(
  viewMode: PageViewMode,
  zoom: number,
  stageWidth: number,
) {
  const width = fitWidthPx(stageWidth)
  return Math.round(viewMode === 'custom' ? width * zoom : width)
}

export function zoomRatioFromPreview(previewWidth: number, stageWidth: number) {
  const width = fitWidthPx(stageWidth)
  if (previewWidth <= 0 || width <= 0) return 1
  return previewWidth / width
}

export function stepCustomZoom(currentRatio: number, direction: 1 | -1) {
  const next = currentRatio + direction * ZOOM_STEP
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100))
}
