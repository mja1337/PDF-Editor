export type BrowserScanProfile = {
  rotateDeg: number
  scale: number
  blurPx: number
  contrast: number
  brightness: number
  jpegQuality: number
  grain: number
  speckle: number
  paperTint: number
  vignette: number
  streaks: number
}

export async function degradeScanInBrowser(input: {
  pngDataUrl: string
  profile: BrowserScanProfile
  seed: number
}) {
  const { pngDataUrl, profile, seed } = input
  const image = new Image()
  image.src = pngDataUrl
  await image.decode()

  const width = image.width
  const height = image.height
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const sourceContext = source.getContext('2d', { alpha: false })
  if (!sourceContext) throw new Error('Could not create a source canvas.')
  sourceContext.drawImage(image, 0, 0)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Could not create a scan canvas.')
  context.fillStyle = '#cfc8ba'
  context.fillRect(0, 0, width, height)
  context.save()
  context.translate(width / 2, height / 2)
  context.rotate((profile.rotateDeg * Math.PI) / 180)
  context.scale(profile.scale, profile.scale)
  context.filter = `blur(${profile.blurPx}px) contrast(${profile.contrast}) brightness(${profile.brightness}) saturate(0.72)`
  context.translate(-width / 2, -height / 2)
  context.drawImage(source, 0, 0)
  context.restore()
  context.filter = 'none'

  context.fillStyle = `rgba(214, 186, 122, ${profile.paperTint})`
  context.fillRect(0, 0, width, height)

  let random = seed >>> 0
  const next = () => {
    random += 0x6d2b79f5
    let value = random
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  const pixels = context.getImageData(0, 0, width, height)
  const data = pixels.data
  for (let index = 0; index < data.length; index += 4) {
    const x = (index / 4) % width
    const y = Math.floor(index / 4 / width)
    const dx = x / width - 0.5
    const dy = y / height - 0.5
    const radius = Math.sqrt(dx * dx + dy * dy)
    const shade = 1 - profile.vignette * Math.max(0, radius * 1.6 - 0.35)
    const grain = (next() - 0.5) * profile.grain
    const speckle = next() < profile.speckle ? (next() < 0.5 ? -90 : 70) : 0
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (data[index + channel] ?? 0) * shade + grain + speckle
      data[index + channel] = Math.max(0, Math.min(255, value))
    }
    data[index + 3] = 255
  }
  context.putImageData(pixels, 0, 0)

  context.strokeStyle = 'rgba(90, 70, 40, 0.18)'
  context.lineWidth = 1
  for (let streak = 0; streak < profile.streaks; streak += 1) {
    const x = next() * width
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + (next() - 0.5) * 24, height)
    context.stroke()
  }

  const jpegUrl = canvas.toDataURL('image/jpeg', profile.jpegQuality)
  const jpegImage = new Image()
  jpegImage.src = jpegUrl
  await jpegImage.decode()
  context.drawImage(jpegImage, 0, 0)
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (file) => (file ? resolve(file) : reject(new Error('Could not encode the scan JPEG.'))),
      'image/jpeg',
      profile.jpegQuality,
    )
  })
  const buffer = await blob.arrayBuffer()
  return Array.from(new Uint8Array(buffer))
}
