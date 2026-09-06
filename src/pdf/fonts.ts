import sans400 from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'
import sans400Italic from '@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff?url'
import sans700 from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url'
import sans700Italic from '@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff?url'
import serif400 from '@fontsource/noto-serif/files/noto-serif-latin-400-normal.woff?url'
import serif400Italic from '@fontsource/noto-serif/files/noto-serif-latin-400-italic.woff?url'
import serif700 from '@fontsource/noto-serif/files/noto-serif-latin-700-normal.woff?url'
import serif700Italic from '@fontsource/noto-serif/files/noto-serif-latin-700-italic.woff?url'
import mono400 from '@fontsource/noto-sans-mono/files/noto-sans-mono-latin-400-normal.woff?url'
import mono700 from '@fontsource/noto-sans-mono/files/noto-sans-mono-latin-700-normal.woff?url'
import type { PDFDocument, PDFFont } from 'pdf-lib'
import type { PageOverlay } from '../domain/document'
import type { EditorFontRole } from './fontMatch'

type FaceStyle = 'normal' | 'italic'
type FaceKey = `${EditorFontRole}-${400 | 700}-${FaceStyle}`

const FACE_URLS: Record<FaceKey, string> = {
  'sans-400-normal': sans400,
  'sans-400-italic': sans400Italic,
  'sans-700-normal': sans700,
  'sans-700-italic': sans700Italic,
  'serif-400-normal': serif400,
  'serif-400-italic': serif400Italic,
  'serif-700-normal': serif700,
  'serif-700-italic': serif700Italic,
  'mono-400-normal': mono400,
  'mono-400-italic': mono400,
  'mono-700-normal': mono700,
  'mono-700-italic': mono700,
}

const faceBytes = new Map<string, Promise<ArrayBuffer>>()

export function overlayFontKey(overlay: PageOverlay): FaceKey {
  const role = overlay.fontRole ?? 'sans'
  const weight = overlay.fontWeight ?? (overlay.extracted ? 400 : 700)
  const style: FaceStyle = overlay.fontItalic ? 'italic' : 'normal'
  return `${role}-${weight}-${style}`
}

async function loadFace(url: string): Promise<Uint8Array> {
  let pending = faceBytes.get(url)
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('The bundled text font could not be loaded. Please retry.')
        return response.arrayBuffer()
      })
      .catch((error) => {
        faceBytes.delete(url)
        throw error
      })
    faceBytes.set(url, pending)
  }
  return new Uint8Array(await pending)
}

export interface OverlayFontLibrary {
  defaultFont: PDFFont
  fontFor(overlay: PageOverlay): PDFFont
}

export async function createOverlayFontLibrary(
  document: PDFDocument,
  overlays: PageOverlay[],
  fallbackBytes?: Uint8Array,
): Promise<OverlayFontLibrary> {
  const { default: fontkit } = await import('@pdf-lib/fontkit')
  document.registerFontkit(fontkit)

  if (fallbackBytes) {
    const font = await document.embedFont(fallbackBytes, { subset: true })
    return { defaultFont: font, fontFor: () => font }
  }

  const embedded = new Map<FaceKey, PDFFont>()
  const embed = async (key: FaceKey) => {
    const existing = embedded.get(key)
    if (existing) return existing
    const font = await document.embedFont(await loadFace(FACE_URLS[key]), { subset: true })
    embedded.set(key, font)
    return font
  }

  const defaultFont = await embed('sans-700-normal')
  for (const overlay of overlays) {
    if (overlay.type === 'text' && (!overlay.extracted || overlay.edited)) {
      await embed(overlayFontKey(overlay))
    }
  }
  return {
    defaultFont,
    fontFor: (overlay) => embedded.get(overlayFontKey(overlay)) ?? defaultFont,
  }
}

export async function embedEditorFont(document: PDFDocument, bytes?: Uint8Array): Promise<PDFFont> {
  const library = await createOverlayFontLibrary(document, [], bytes)
  return library.defaultFont
}

export function validateEditorText(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet())
  const unsupported = [...new Set([...text].filter((character) => !supported.has(character.codePointAt(0)!)))]
  if (unsupported.length) {
    throw new Error(`Unsupported text: ${unsupported.slice(0, 8).join(' ')}. The bundled font supports Western European Latin text and common punctuation. Edit these characters before exporting.`)
  }
}
