import type { WatermarkConfig } from '../domain/document'

export const DEFAULT_WATERMARK = { opacity: 0.2, rotation: 45 } as const

export type WatermarkDraft = WatermarkConfig & { documentId: string }

export function watermarkFieldsForDocument(
  documentId: string | undefined,
  applied: WatermarkConfig | null | undefined,
  draft: WatermarkDraft | null,
) {
  if (draft && documentId && draft.documentId === documentId) {
    return {
      text: draft.text,
      opacity: draft.opacity,
      rotation: draft.rotation,
    }
  }
  if (applied) {
    return {
      text: applied.text,
      opacity: applied.opacity,
      rotation: applied.rotation,
    }
  }
  return {
    text: '',
    opacity: DEFAULT_WATERMARK.opacity,
    rotation: DEFAULT_WATERMARK.rotation,
  }
}
