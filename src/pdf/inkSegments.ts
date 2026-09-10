/**
 * Analysed lines store one ink colour, which loses a coloured mark inside an
 * otherwise monochrome line -- the red asterisk on a form label is repainted
 * black the first time the line is edited. These helpers carry colour per
 * character instead, so the mark survives analysis, editing and export.
 */

export interface ColorSegment {
  text: string
  color: string
}

/** Colour distance at which two inks are treated as deliberately different. */
export const DISTINCT_INK_DELTA = 90

function channels(color: string) {
  const value = color.replace('#', '')
  if (value.length !== 6) return null
  const number = Number.parseInt(value, 16)
  if (Number.isNaN(number)) return null
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255] as const
}

export function inkDistance(left: string, right: string) {
  const a = channels(left)
  const b = channels(right)
  if (!a || !b) return left === right ? 0 : Number.POSITIVE_INFINITY
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
}

export function hasDistinctInk(colors: readonly string[]) {
  const first = colors[0]
  if (!first) return false
  return colors.some((color) => inkDistance(color, first) >= DISTINCT_INK_DELTA)
}

export function segmentsToColors(segments: readonly ColorSegment[]) {
  const colors: string[] = []
  for (const segment of segments) {
    for (let index = Array.from(segment.text).length; index > 0; index -= 1) {
      colors.push(segment.color)
    }
  }
  return colors
}

export function colorsToSegments(
  text: string,
  colors: readonly string[],
): ColorSegment[] {
  const characters = Array.from(text)
  const segments: ColorSegment[] = []
  for (let index = 0; index < characters.length; index += 1) {
    const color = colors[index] ?? colors[colors.length - 1] ?? '#000000'
    const last = segments[segments.length - 1]
    if (last && last.color === color) last.text += characters[index]
    else segments.push({ text: characters[index]!, color })
  }
  return segments
}

/** The dominant ink, by character count, used for anything newly typed. */
export function dominantColor(colors: readonly string[], fallback: string) {
  const tally = new Map<string, number>()
  for (const color of colors) tally.set(color, (tally.get(color) ?? 0) + 1)
  let best = fallback
  let bestCount = 0
  for (const [color, count] of tally) {
    if (count > bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}

/**
 * Carries colour across an edit. Characters the edit left alone at the start and
 * end of the line keep their ink; whatever was typed takes the dominant colour.
 */
export function remapSegments(
  previousText: string,
  previous: readonly ColorSegment[],
  nextText: string,
  fallback: string,
): ColorSegment[] | undefined {
  const before = Array.from(previousText)
  const after = Array.from(nextText)
  const colors = segmentsToColors(previous)
  if (colors.length !== before.length) return undefined
  if (after.length === 0) return undefined

  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const typed = dominantColor(colors, fallback)
  const next: string[] = []
  for (let index = 0; index < after.length; index += 1) {
    if (index < prefix) next.push(colors[index] ?? typed)
    else if (index >= after.length - suffix) {
      next.push(colors[before.length - (after.length - index)] ?? typed)
    } else next.push(typed)
  }
  return hasDistinctInk(next) ? colorsToSegments(nextText, next) : undefined
}

/**
 * Collapses whitespace the way an extracted line is normalized before layout,
 * keeping the colour array aligned with the characters that survive.
 */
export function normalizeColoredText(text: string, colors: readonly string[]) {
  const characters = Array.from(text)
  const outText: string[] = []
  const outColors: string[] = []
  let pendingSpace = false
  let pendingColor = colors[0] ?? '#000000'
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!
    const color = colors[index] ?? pendingColor
    if (/\s/u.test(character)) {
      if (outText.length > 0 && !pendingSpace) {
        pendingSpace = true
        pendingColor = color
      }
      continue
    }
    if (pendingSpace) {
      outText.push(' ')
      outColors.push(pendingColor)
      pendingSpace = false
    }
    outText.push(character)
    outColors.push(color)
  }
  return { text: outText.join(''), colors: outColors }
}

/**
 * Splits per-character colours across wrapped lines. Every wrapped line is a
 * contiguous slice of the text it was wrapped from, with the break whitespace
 * dropped, so the cursor only has to step over spaces between lines.
 */
export function lineColorSegments(
  text: string,
  colors: readonly string[],
  lines: readonly string[],
): ColorSegment[][] {
  const characters = Array.from(text)
  let cursor = 0
  return lines.map((line) => {
    while (cursor < characters.length && characters[cursor] === ' ') cursor += 1
    const length = Array.from(line).length
    const slice = colors.slice(cursor, cursor + length)
    cursor += length
    return colorsToSegments(line, slice)
  })
}
