export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface SampledAppearance {
  color: string
  backgroundColor: string
}

function hex(red: number, green: number, blue: number) {
  const to = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${to(red)}${to(green)}${to(blue)}`
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

function contrast(
  red: number,
  green: number,
  blue: number,
  background: { r: number; g: number; b: number },
) {
  return (
    Math.abs(red - background.r) +
    Math.abs(green - background.g) +
    Math.abs(blue - background.b)
  )
}

export function samplePatch(image: PixelBuffer): SampledAppearance {
  const { data, width, height } = image
  if (width <= 0 || height <= 0 || data.length < 4) {
    return { color: '#000000', backgroundColor: '#ffffff' }
  }

  const insetX = Math.max(1, Math.floor(width * 0.12))
  const insetY = Math.max(1, Math.floor(height * 0.18))
  const step = Math.max(1, Math.floor(Math.min(width, height) / 28))
  const edge: Array<{ r: number; g: number; b: number }> = []

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4
      const r = data[index] ?? 255
      const g = data[index + 1] ?? 255
      const b = data[index + 2] ?? 255
      if (x < insetX || x >= width - insetX || y < insetY || y >= height - insetY) {
        edge.push({ r, g, b })
      }
    }
  }

  const background = {
    r: median(edge.map((pixel) => pixel.r)),
    g: median(edge.map((pixel) => pixel.g)),
    b: median(edge.map((pixel) => pixel.b)),
  }
  if (edge.length === 0) {
    return { color: '#000000', backgroundColor: '#ffffff' }
  }

  const ink: Array<{ r: number; g: number; b: number; contrast: number }> = []
  for (let y = insetY; y < height - insetY; y += step) {
    for (let x = insetX; x < width - insetX; x += step) {
      const index = (y * width + x) * 4
      const r = data[index] ?? 0
      const g = data[index + 1] ?? 0
      const b = data[index + 2] ?? 0
      const amount = contrast(r, g, b, background)
      if (amount >= 48) ink.push({ r, g, b, contrast: amount })
    }
  }

  if (ink.length === 0) {
    const luma = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b
    return {
      color: luma < 140 ? '#ffffff' : '#000000',
      backgroundColor: hex(background.r, background.g, background.b),
    }
  }

  ink.sort((left, right) => right.contrast - left.contrast)
  const top = ink.slice(0, Math.max(1, Math.ceil(ink.length * 0.35)))
  return {
    color: hex(
      median(top.map((pixel) => pixel.r)),
      median(top.map((pixel) => pixel.g)),
      median(top.map((pixel) => pixel.b)),
    ),
    backgroundColor: hex(background.r, background.g, background.b),
  }
}

export function sampleNormalizedRect(
  image: PixelBuffer,
  rect: { x: number; y: number; width: number; height: number },
): SampledAppearance {
  const left = Math.max(0, Math.floor(rect.x * image.width))
  const top = Math.max(0, Math.floor(rect.y * image.height))
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width))
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height))
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const source = ((top + y) * image.width + left) * 4
    data.set(image.data.subarray(source, source + width * 4), y * width * 4)
  }
  return samplePatch({ data, width, height })
}

export function sampleOverlayPixels(
  canvas: HTMLCanvasElement,
  overlay: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): SampledAppearance | null {
  if (pageWidth <= 0 || pageHeight <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return null
  }
  const context = canvas.getContext('2d')
  if (!context) return null
  const scaleX = canvas.width / pageWidth
  const scaleY = canvas.height / pageHeight
  const left = Math.max(0, Math.floor(overlay.x * pageWidth * scaleX))
  const top = Math.max(0, Math.floor(overlay.y * pageHeight * scaleY))
  const width = Math.max(
    1,
    Math.min(canvas.width - left, Math.ceil(overlay.width * pageWidth * scaleX)),
  )
  const height = Math.max(
    1,
    Math.min(canvas.height - top, Math.ceil(overlay.height * pageHeight * scaleY)),
  )
  if (left >= canvas.width || top >= canvas.height) return null
  try {
    return samplePatch(context.getImageData(left, top, width, height))
  } catch {
    return null
  }
}
