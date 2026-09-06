import type { LogoStampConfig } from '../domain/document'

export function stampDisplayRect(
  stamp: Pick<LogoStampConfig, 'corner' | 'size'>,
  pageWidth: number,
  pageHeight: number,
  aspect: number,
) {
  const margin = Math.min(pageWidth, pageHeight) * 0.035
  const width = Math.min(pageWidth, pageHeight) * Math.max(0.06, Math.min(0.4, stamp.size))
  const height = width / Math.max(0.2, aspect)
  const x = stamp.corner.endsWith('left') ? margin : pageWidth - margin - width
  const y = stamp.corner.startsWith('top') ? margin : pageHeight - margin - height
  return { x, y, width, height }
}
