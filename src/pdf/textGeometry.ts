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
  return grouped.filter((run) => run.text.length > 0).map(padRun)
}
