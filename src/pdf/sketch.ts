export interface SketchPoint {
  x: number
  y: number
  move?: boolean
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function jitter(next: () => number, amount: number) {
  return (next() - 0.5) * amount
}

function along(start: SketchPoint, end: SketchPoint, amount: number): SketchPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: end.x + (dx / length) * amount,
    y: end.y + (dy / length) * amount,
  }
}

function slip(next: () => number) {
  const magnitude = 0.006 + next() * 0.01
  return next() < 0.42 ? -magnitude : magnitude
}

function wobbleSegment(
  start: SketchPoint,
  end: SketchPoint,
  next: () => number,
  roughness: number,
): SketchPoint[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const midCount = length > 0.55 ? 2 : 1
  const points: SketchPoint[] = [{ x: start.x, y: start.y }]
  for (let index = 1; index <= midCount; index += 1) {
    const t = index / (midCount + 1)
    const nx = -dy / length
    const ny = dx / length
    points.push({
      x: start.x + dx * t + nx * jitter(next, roughness),
      y: start.y + dy * t + ny * jitter(next, roughness),
    })
  }
  points.push({ x: end.x, y: end.y })
  return points
}

function joinStrokes(strokes: SketchPoint[][]): SketchPoint[] {
  const points: SketchPoint[] = []
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index]
    if (!stroke || stroke.length === 0) continue
    for (let offset = 0; offset < stroke.length; offset += 1) {
      const point = stroke[offset]
      if (!point) continue
      points.push(index > 0 && offset === 0 ? { ...point, move: true } : { x: point.x, y: point.y })
    }
  }
  return points
}

export function sketchStrokes(points: SketchPoint[]): SketchPoint[][] {
  const strokes: SketchPoint[][] = []
  let current: SketchPoint[] = []
  for (const point of points) {
    if (point.move && current.length > 0) {
      strokes.push(current)
      current = []
    }
    current.push({ x: point.x, y: point.y })
  }
  if (current.length > 0) strokes.push(current)
  return strokes
}

function sketchEdges(corners: SketchPoint[], seed: number, roughness: number) {
  const next = rng(seed)
  return joinStrokes(
    corners.map((start, index) => {
      const end = corners[(index + 1) % corners.length]
      if (!end) return []
      const from = along(end, start, slip(next))
      const to = along(start, end, slip(next))
      return wobbleSegment(from, to, next, roughness)
    }),
  )
}

export function sketchRectPoints(seed: number): SketchPoint[] {
  return sketchEdges(
    [
      { x: 0.03, y: 0.03 },
      { x: 0.97, y: 0.03 },
      { x: 0.97, y: 0.97 },
      { x: 0.03, y: 0.97 },
    ],
    seed,
    0.012,
  )
}

export function sketchDiamondPoints(seed: number): SketchPoint[] {
  return sketchEdges(
    [
      { x: 0.5, y: 0.03 },
      { x: 0.97, y: 0.5 },
      { x: 0.5, y: 0.97 },
      { x: 0.03, y: 0.5 },
    ],
    seed,
    0.012,
  )
}

export function sketchEllipsePoints(seed: number): SketchPoint[] {
  const next = rng(seed)
  const steps = 22
  const points: SketchPoint[] = []
  const extra = 0.04 + next() * 0.05
  const count = steps + (next() < 0.5 ? 1 : 0)
  for (let index = 0; index <= count; index += 1) {
    const angle = Math.PI * 2 * (index / steps) - extra * (index === 0 ? 1 : 0)
    const radius = 0.455 + jitter(next, 0.016)
    points.push({
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius,
    })
  }
  return points
}

export function sketchLineBetween(
  start: SketchPoint,
  end: SketchPoint,
  seed: number,
  roughness = 0.014,
): SketchPoint[] {
  const next = rng(seed)
  return wobbleSegment(
    { x: start.x + jitter(next, roughness * 0.85), y: start.y + jitter(next, roughness * 0.85) },
    { x: end.x + jitter(next, roughness * 0.85), y: end.y + jitter(next, roughness * 0.85) },
    next,
    roughness,
  )
}

export function sketchLinePoints(seed: number): SketchPoint[] {
  return sketchLineBetween({ x: 0.04, y: 0.86 }, { x: 0.96, y: 0.14 }, seed)
}

export function sketchArrowBetween(
  start: SketchPoint,
  end: SketchPoint,
  seed: number,
  roughness = 0.014,
  headSize?: number,
): SketchPoint[] {
  const next = rng(seed)
  const shaft = sketchLineBetween(start, end, seed, roughness)
  const tip = shaft.at(-1) ?? end
  const previous = shaft.at(-2) ?? start
  const dx = tip.x - previous.x
  const dy = tip.y - previous.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const head = headSize ?? 0.11 + next() * 0.025
  const spread = headSize ? 0.48 : 0.42 + next() * 0.08
  const left = {
    x: tip.x - ux * head + -uy * head * spread,
    y: tip.y - uy * head + ux * head * spread,
  }
  const right = {
    x: tip.x - ux * head - -uy * head * spread,
    y: tip.y - uy * head - ux * head * spread,
  }
  const neck = {
    x: tip.x - ux * head * 0.18,
    y: tip.y - uy * head * 0.18,
  }
  return joinStrokes([shaft, [left, neck, tip], [right, neck, tip]])
}

export function sketchArrowPoints(seed: number): SketchPoint[] {
  return sketchArrowBetween({ x: 0.04, y: 0.86 }, { x: 0.96, y: 0.14 }, seed)
}

export function sketchPointsFor(
  type: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'diamond',
  seed: number,
) {
  switch (type) {
    case 'ellipse':
      return sketchEllipsePoints(seed)
    case 'diamond':
      return sketchDiamondPoints(seed)
    case 'line':
      return sketchLinePoints(seed)
    case 'arrow':
      return sketchArrowPoints(seed)
    default:
      return sketchRectPoints(seed)
  }
}
