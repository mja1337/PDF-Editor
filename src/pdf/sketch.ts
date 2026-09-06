export interface SketchPoint {
  x: number
  y: number
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

function wobbleSegment(
  start: SketchPoint,
  end: SketchPoint,
  next: () => number,
  roughness: number,
): SketchPoint[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy) || 1
  const midCount = length > 0.45 ? 2 : 1
  const points: SketchPoint[] = [start]
  for (let index = 1; index <= midCount; index += 1) {
    const t = index / (midCount + 1)
    const nx = -dy / length
    const ny = dx / length
    points.push({
      x: start.x + dx * t + nx * jitter(next, roughness),
      y: start.y + dy * t + ny * jitter(next, roughness),
    })
  }
  points.push(end)
  return points
}

function wobbleLoop(corners: SketchPoint[], seed: number, roughness: number) {
  const next = rng(seed)
  const points: SketchPoint[] = []
  for (let index = 0; index < corners.length; index += 1) {
    const start = corners[index]
    const end = corners[(index + 1) % corners.length]
    const segment = wobbleSegment(start, end, next, roughness)
    if (index > 0) segment.shift()
    points.push(...segment)
  }
  return points
}

export function sketchRectPoints(seed: number): SketchPoint[] {
  return wobbleLoop(
    [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.06 },
      { x: 0.94, y: 0.95 },
      { x: 0.06, y: 0.94 },
    ],
    seed,
    0.045,
  )
}

export function sketchDiamondPoints(seed: number): SketchPoint[] {
  return wobbleLoop(
    [
      { x: 0.5, y: 0.04 },
      { x: 0.96, y: 0.5 },
      { x: 0.5, y: 0.96 },
      { x: 0.04, y: 0.5 },
    ],
    seed,
    0.04,
  )
}

export function sketchEllipsePoints(seed: number): SketchPoint[] {
  const next = rng(seed)
  const points: SketchPoint[] = []
  const steps = 18
  for (let index = 0; index < steps; index += 1) {
    const angle = (Math.PI * 2 * index) / steps
    points.push({
      x: 0.5 + Math.cos(angle) * (0.44 + jitter(next, 0.05)),
      y: 0.5 + Math.sin(angle) * (0.44 + jitter(next, 0.05)),
    })
  }
  points.push(points[0])
  return points
}

export function sketchLinePoints(seed: number): SketchPoint[] {
  const next = rng(seed)
  return wobbleSegment(
    { x: 0.08 + jitter(next, 0.03), y: 0.82 + jitter(next, 0.03) },
    { x: 0.92 + jitter(next, 0.03), y: 0.18 + jitter(next, 0.03) },
    next,
    0.05,
  )
}

export function sketchArrowPoints(seed: number): SketchPoint[] {
  const shaft = sketchLinePoints(seed)
  const tip = shaft.at(-1) ?? { x: 0.9, y: 0.2 }
  const previous = shaft.at(-2) ?? { x: 0.7, y: 0.4 }
  const dx = tip.x - previous.x
  const dy = tip.y - previous.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const head = 0.16
  const left = {
    x: tip.x - ux * head + -uy * head * 0.55,
    y: tip.y - uy * head + ux * head * 0.55,
  }
  const right = {
    x: tip.x - ux * head - -uy * head * 0.55,
    y: tip.y - uy * head - ux * head * 0.55,
  }
  return [...shaft, left, tip, right]
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
