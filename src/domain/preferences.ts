import type { LogoStampConfig } from './document'

const STORAGE_KEY = 'pdfe.preferences'
const LEGACY_STORAGE_KEY = 'pdf-editor.preferences'

export type OcrConsent = 'unset' | 'accepted' | 'declined'

export interface EditorPreferences {
  stamp: LogoStampConfig | null
  ocrConsent: OcrConsent
}

const emptyPreferences: EditorPreferences = { stamp: null, ocrConsent: 'unset' }

function isCorner(
  value: unknown,
): value is LogoStampConfig['corner'] {
  return (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'bottom-left' ||
    value === 'bottom-right'
  )
}

function parseStamp(value: unknown): LogoStampConfig | null {
  if (!value || typeof value !== 'object') return null
  const stamp = value as Partial<LogoStampConfig>
  if (
    typeof stamp.imageData !== 'string' ||
    !stamp.imageData.startsWith('data:image/') ||
    !isCorner(stamp.corner)
  ) {
    return null
  }
  return {
    imageData: stamp.imageData,
    corner: stamp.corner,
    size: Math.max(0.06, Math.min(0.4, Number(stamp.size) || 0.14)),
    opacity: Math.max(0.15, Math.min(1, Number(stamp.opacity) || 1)),
  }
}

function parseOcrConsent(value: unknown): OcrConsent {
  return value === 'accepted' || value === 'declined' ? value : 'unset'
}

export function parsePreferences(raw: string | null): EditorPreferences {
  if (!raw) return emptyPreferences
  try {
    const parsed = JSON.parse(raw) as {
      stamp?: unknown
      ocrConsent?: unknown
    }
    return {
      stamp: parseStamp(parsed.stamp),
      ocrConsent: parseOcrConsent(parsed.ocrConsent),
    }
  } catch {
    return emptyPreferences
  }
}

export function loadPreferences(): EditorPreferences {
  if (typeof localStorage === 'undefined') return emptyPreferences
  try {
    return parsePreferences(
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY),
    )
  } catch {
    return emptyPreferences
  }
}

export function savePreferences(preferences: EditorPreferences) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
