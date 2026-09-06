import type { WordArtStyle } from '../domain/document'

export const WORD_ART_STYLES: Array<{ id: WordArtStyle; label: string }> = [
  { id: 'plain', label: 'Plain' },
  { id: 'outline', label: 'Outline' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'arch', label: 'Arch' },
  { id: 'stack', label: 'Stack' },
]

export function archOffset(index: number, length: number) {
  if (length <= 1) return { y: 0, rotate: 0 }
  const t = (index / (length - 1)) * 2 - 1
  return {
    y: (t * t - 1) * 0.55,
    rotate: t * 22,
  }
}
