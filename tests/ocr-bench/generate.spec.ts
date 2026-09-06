import { test } from '@playwright/test'
import { generateOcrFixtures } from './generate'

test.use({
  viewport: { width: 794, height: 1123 },
  deviceScaleFactor: 1.75,
})

test('write noisy scanned bank-statement fixtures', async ({ page }) => {
  test.setTimeout(120_000)
  const fixtures = await generateOcrFixtures(page)
  if (fixtures.length === 0) throw new Error('No OCR fixtures were generated.')
})
