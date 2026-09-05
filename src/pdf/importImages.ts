const MAX_IMAGE_DIMENSION_POINTS = 1440

export interface ImportedImagePdf {
  name: string
  bytes: Uint8Array
}

function pdfName(name: string) {
  const baseName = name.replace(/\.[^.]+$/, '') || 'image'
  return `${baseName}.pdf`
}

export async function imageToPdf(file: File): Promise<ImportedImagePdf> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error(`${file.name}: only JPEG and PNG images are supported.`)
  }

  const { PDFDocument } = await import('pdf-lib')
  const document = await PDFDocument.create()
  const fileBytes = new Uint8Array(await file.arrayBuffer())
  const image =
    file.type === 'image/png'
      ? await document.embedPng(fileBytes)
      : await document.embedJpg(fileBytes)

  const pointWidth = Math.max(1, image.width * 0.75)
  const pointHeight = Math.max(1, image.height * 0.75)
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION_POINTS / Math.max(pointWidth, pointHeight),
  )
  const width = pointWidth * scale
  const height = pointHeight * scale
  const page = document.addPage([width, height])
  page.drawImage(image, { x: 0, y: 0, width, height })

  return {
    name: pdfName(file.name),
    bytes: await document.save({ useObjectStreams: true }),
  }
}
