export type EditorFontRole = 'sans' | 'serif' | 'mono'

export interface EditorFontFace {
  role: EditorFontRole
  weight: 400 | 700
  italic: boolean
}

const SERIF =
  /times|georgia|garamond|palatino|cambria|minion|caslon|baskerville|constantia|charter|bookman|schoolbook|liberation serif|nimbus roman|liberation-serif|noto serif|source serif|pt serif|merriweather|crimson|libre baskerville|iowan|new york|droid serif/i
const MONO =
  /courier|mono|consolas|menlo|monaco|inconsolata|lucida console|liberation mono|nimbus mono|typewriter|ocr|source code|fira code|jetbrains|cascadia|dejavu sans mono|ubuntu mono|pt mono/i

function readableFontName(value: string) {
  return value
    .replace(/^.*\+/u, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function classifyPdfFont(fontName?: string, cssFamily?: string): EditorFontFace {
  const sample = readableFontName(`${cssFamily ?? ''} ${fontName ?? ''}`)
  const italic = /italic|oblique/i.test(sample)
  const bold = /bold|black|heavy|semibold|demi|extrabold|ultra|fw[6-9]/i.test(sample)
  let role: EditorFontRole = 'sans'
  if (MONO.test(sample)) role = 'mono'
  else if (SERIF.test(sample) || /(?:^|,\s*)serif(?:\s*,|$)/i.test(cssFamily ?? '')) {
    role = 'serif'
  }
  return { role, weight: bold ? 700 : 400, italic }
}

export function cssFontFamily(role: EditorFontRole): string {
  switch (role) {
    case 'serif':
      return '"Times New Roman", Times, "Noto Serif", serif'
    case 'mono':
      return '"Courier New", Courier, "Noto Sans Mono", monospace'
    default:
      return 'Arial, Helvetica, "Noto Sans", sans-serif'
  }
}

