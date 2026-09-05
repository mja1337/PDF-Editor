import type { OverlayType, PageOverlay } from './document'
import { normalizeOverlay } from './document'

export function createDefaultOverlay(
  type: OverlayType,
  x: number,
  y: number,
  color: string,
): PageOverlay {
  const sizes: Record<OverlayType, { width: number; height: number }> = {
    text: { width: 0.34, height: 0.075 },
    highlight: { width: 0.34, height: 0.055 },
    underline: { width: 0.34, height: 0.035 },
    strikeout: { width: 0.34, height: 0.045 },
    rectangle: { width: 0.27, height: 0.16 },
    ellipse: { width: 0.24, height: 0.15 },
    line: { width: 0.27, height: 0.12 },
  }
  const size = sizes[type]
  return normalizeOverlay({
    id: crypto.randomUUID(),
    type,
    x: x - size.width / 2,
    y: y - size.height / 2,
    width: size.width,
    height: size.height,
    color: type === 'highlight' ? '#f4d35e' : color,
    opacity: type === 'highlight' ? 0.42 : 0.95,
    strokeWidth: 2,
    text: type === 'text' ? 'Add text' : undefined,
    fontSize: type === 'text' ? 18 : undefined,
  })
}
