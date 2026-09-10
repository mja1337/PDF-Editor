import type { ColorSegment } from './inkSegments'

export interface ExtractedTextRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontRole?: 'sans' | 'serif' | 'mono'
  fontWeight?: 400 | 700
  fontItalic?: boolean
  color?: string
  backgroundColor?: string
  colorSegments?: ColorSegment[]
}

export interface PitchBox {
  x: number
  y: number
  width: number
  height: number
}

/** A clamp that would cut a box below this share of its measured height is
 * treated as a measurement oddity and skipped. */
const MIN_PITCH_SHARE = 0.4

function sharesColumn(box: PitchBox, other: PitchBox) {
  return other.x < box.x + box.width && other.x + other.width > box.x
}

/**
 * The vertical band a line owns: halfway to the line above it and halfway to
 * the line below it in the same column. pdf.js reports run heights that include
 * ascenders and descenders, so on tight leading the raw boxes overlap their
 * neighbours before anything is edited.
 */
export function pitchBand(box: PitchBox, others: readonly PitchBox[]) {
  const centre = box.y + box.height / 2
  let top = 0
  let bottom = 1
  for (const other of others) {
    if (other === box || !sharesColumn(box, other)) continue
    const otherCentre = other.y + other.height / 2
    if (otherCentre < centre) top = Math.max(top, (otherCentre + centre) / 2)
    else if (otherCentre > centre) bottom = Math.min(bottom, (otherCentre + centre) / 2)
  }
  return { top, bottom }
}

/** Trims line boxes so neighbours in the same column stop overlapping. */
export function clampBoxesToPitch<T extends PitchBox>(boxes: T[]): T[] {
  return boxes.map((box) => {
    const band = pitchBand(box, boxes)
    const top = Math.max(box.y, band.top)
    const bottom = Math.min(box.y + box.height, band.bottom)
    const height = bottom - top
    if (height >= box.height - 1e-9) return box
    if (height < box.height * MIN_PITCH_SHARE) return box
    return { ...box, y: top, height }
  })
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function padRun(run: ExtractedTextRun): ExtractedTextRun {
  const padX = Math.min(0.006, Math.max(0.001, run.width * 0.03))
  const padY = Math.min(0.006, Math.max(0.001, run.height * 0.16))
  const x = clamp01(run.x - padX)
  const y = clamp01(run.y - padY)
  return {
    ...run,
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, run.width + padX * 2)),
    height: Math.max(0.01, Math.min(1 - y, run.height + padY * 2)),
  }
}

function mergeLine(runs: ExtractedTextRun[]): ExtractedTextRun {
  const ordered = [...runs].sort((left, right) => left.x - right.x)
  let text = ordered[0]?.text ?? ''
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const gap = current.x - (previous.x + previous.width)
    const needsSpace =
      !text.endsWith(' ') &&
      !current.text.startsWith(' ') &&
      gap > Math.max(previous.height, current.height) * 0.08
    text += `${needsSpace ? ' ' : ''}${current.text}`
  }

  const x = Math.min(...ordered.map((run) => run.x))
  const y = Math.min(...ordered.map((run) => run.y))
  const right = Math.max(...ordered.map((run) => run.x + run.width))
  const bottom = Math.max(...ordered.map((run) => run.y + run.height))
  const fontSize =
    ordered.reduce((total, run) => total + run.fontSize, 0) / ordered.length
  const face = ordered.reduce((best, run) => (run.width > best.width ? run : best))
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    x,
    y,
    width: Math.max(0.01, right - x),
    height: Math.max(0.01, bottom - y),
    fontSize,
    fontRole: face.fontRole ?? 'sans',
    fontWeight: face.fontWeight ?? 400,
    fontItalic: face.fontItalic ?? false,
    color: face.color,
    backgroundColor: face.backgroundColor,
  }
}

export function groupTextRuns(runs: ExtractedTextRun[]): ExtractedTextRun[] {
  const usable = runs.filter((run) => run.text.trim().length > 0)
  usable.sort((left, right) => left.y - right.y || left.x - right.x)

  const rows: ExtractedTextRun[][] = []
  for (const run of usable) {
    const mid = run.y + run.height / 2
    const row = rows.find((candidate) => {
      const sample = candidate[0]
      const sampleMid = sample.y + sample.height / 2
      return Math.abs(mid - sampleMid) <= Math.max(sample.height, run.height) * 0.38
    })
    if (row) row.push(run)
    else rows.push([run])
  }

  const grouped: ExtractedTextRun[] = []
  for (const row of rows) {
    row.sort((left, right) => left.x - right.x)
    let cluster: ExtractedTextRun[] = [row[0]]
    for (let index = 1; index < row.length; index += 1) {
      const previous = cluster.at(-1)!
      const current = row[index]
      const gap = current.x - (previous.x + previous.width)
      const splitGap = Math.max(0.028, Math.max(previous.height, current.height) * 1.8)
      if (gap > splitGap) {
        grouped.push(mergeLine(cluster))
        cluster = [current]
      } else {
        cluster.push(current)
      }
    }
    grouped.push(mergeLine(cluster))
  }
  return clampBoxesToPitch(grouped.filter((run) => run.text.length > 0).map(padRun))
}
