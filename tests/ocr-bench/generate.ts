import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import type { Page } from '@playwright/test'
import { degradeScanInBrowser } from './degrade'
import {
  BANK_STATEMENTS,
  SCAN_PROFILES,
  fixtureId,
  statementHtml,
  statementKeywords,
  statementPlainText,
} from './statements'

const ROOT = dirname(fileURLToPath(import.meta.url))
export const OCR_FIXTURE_DIR = join(ROOT, 'fixtures')
export const PAGE_WIDTH_PX = 794
export const PAGE_HEIGHT_PX = 1123
export const SCAN_SCALE = 1.75

async function embedScanPdf(jpeg: Uint8Array) {
  const pdf = await PDFDocument.create()
  const image = await pdf.embedJpg(jpeg)
  const page = pdf.addPage([595.28, 841.89])
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  })
  return pdf.save()
}

export async function generateOcrFixtures(page: Page) {
  await mkdir(OCR_FIXTURE_DIR, { recursive: true })
  await page.setViewportSize({ width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX })

  const fixtures = []
  for (const statement of BANK_STATEMENTS) {
    await page.setContent(statementHtml(statement), { waitUntil: 'load' })
    const png = await page.locator('.page').screenshot({ type: 'png', omitBackground: false })
    const pngDataUrl = `data:image/png;base64,${png.toString('base64')}`
    const expectedText = statementPlainText(statement)
    const keywords = statementKeywords(statement)

    for (const profile of SCAN_PROFILES) {
      const id = fixtureId(statement.id, profile.id)
      const jpegBytes = Uint8Array.from(
        await page.evaluate(degradeScanInBrowser, {
          pngDataUrl,
          profile,
          seed: Array.from(id).reduce((total, char) => total + char.charCodeAt(0), 17),
        }),
      )
      const imageName = `${id}.jpg`
      const pdfName = `${id}.pdf`
      await writeFile(join(OCR_FIXTURE_DIR, imageName), jpegBytes)
      await writeFile(join(OCR_FIXTURE_DIR, pdfName), await embedScanPdf(jpegBytes))
      fixtures.push({
        id,
        statementId: statement.id,
        profile: profile.id,
        image: imageName,
        pdf: pdfName,
        expectedText,
        keywords,
      })
    }
  }

  await writeFile(
    join(OCR_FIXTURE_DIR, 'manifest.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pageCssPixels: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX },
        deviceScaleFactor: SCAN_SCALE,
        fixtures,
      },
      null,
      2,
    )}\n`,
  )
  return fixtures
}
