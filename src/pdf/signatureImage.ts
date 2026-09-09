export function cropSignatureCanvas(source: HTMLCanvasElement) {
  const context = source.getContext('2d')
  if (!context) {
    return { data: source.toDataURL('image/png'), ratio: 3 }
  }
  const { width, height } = source
  const pixels = context.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3] ?? 0
      if (alpha > 8) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX <= minX || maxY <= minY) {
    return { data: source.toDataURL('image/png'), ratio: 3 }
  }
  const pad = 16
  const left = Math.max(0, minX - pad)
  const top = Math.max(0, minY - pad)
  const right = Math.min(width - 1, maxX + pad)
  const bottom = Math.min(height - 1, maxY + pad)
  const cropped = document.createElement('canvas')
  cropped.width = Math.max(1, right - left + 1)
  cropped.height = Math.max(1, bottom - top + 1)
  cropped.getContext('2d')?.drawImage(
    source,
    left,
    top,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height,
  )
  return {
    data: cropped.toDataURL('image/png'),
    ratio: cropped.width / cropped.height,
  }
}
