import type { LogoStampConfig } from './document'

const STORAGE_KEY = 'pdf-editor.preferences'

export interface EditorPreferences {
  stamp: LogoStampConfig | null
}

const emptyPreferences: EditorPreferences = { stamp: null }

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

export function parsePreferences(raw: string | null): EditorPreferences {
  if (!raw) return emptyPreferences
  try {
    const parsed = JSON.parse(raw) as { stamp?: Partial<LogoStampConfig> | null }
    const stamp = parsed.stamp
    if (
      !stamp ||
      typeof stamp.imageData !== 'string' ||
      !stamp.imageData.startsWith('data:image/') ||
      !isCorner(stamp.corner)
    ) {
      return emptyPreferences
    }
    return {
      stamp: {
        imageData: stamp.imageData,
        corner: stamp.corner,
        size: Math.max(0.06, Math.min(0.4, Number(stamp.size) || 0.14)),
        opacity: Math.max(0.15, Math.min(1, Number(stamp.opacity) || 1)),
      },
    }
  } catch {
    return emptyPreferences
  }
}

export function loadPreferences(): EditorPreferences {
  if (typeof localStorage === 'undefined') return emptyPreferences
  try {
    return parsePreferences(localStorage.getItem(STORAGE_KEY))
  } catch {
    return emptyPreferences
  }
}

export function savePreferences(preferences: EditorPreferences) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
