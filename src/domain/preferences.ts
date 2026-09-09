import type { LogoStampConfig, StampCorner } from './document'

export type OcrConsent = 'unset' | 'accepted' | 'declined'

export interface SavedSignature {
  imageData: string
  ratio: number
}

export interface StampSettings {
  corner: StampCorner
  size: number
  opacity: number
}

export interface AppSettings {
  ocrConsent: OcrConsent
  stamp: StampSettings | null
}

/** @deprecated Use LoadedAppStorage from appStorage instead. */
export interface EditorPreferences {
  stamp: LogoStampConfig | null
  ocrConsent: OcrConsent
  signature: SavedSignature | null
}
