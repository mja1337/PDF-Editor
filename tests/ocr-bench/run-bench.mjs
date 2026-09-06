import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFixtureOcrWorker, recognizeWithWorker, tessdataAvailable } from './recognize.ts'
import { scoreOcr } from './score.ts'

const ROOT = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(ROOT, 'fixtures')
const REPORT = join(ROOT, 'last-report.json')

const LIMITS = {
  'light-scan': { keywordRecall: 0.9, tokenF1: 0.72 },
  'heavy-scan': { keywordRecall: 0.7, tokenF1: 0.55 },
}

const manifest = JSON.parse(await readFile(join(FIXTURES, 'manifest.json'), 'utf8'))
if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
  throw new Error('No OCR fixtures found. Run npm run generate:ocr-fixtures first.')
}
if (!tessdataAvailable()) {
  throw new Error('English tessdata_best is missing from .ocr-cache.')
}

const worker = await createFixtureOcrWorker()
const rows = []
const failures = []
try {
  for (const fixture of manifest.fixtures) {
    const recognized = await recognizeWithWorker(worker, join(FIXTURES, fixture.image))
    const score = scoreOcr(fixture.expectedText, recognized.text, fixture.keywords)
    const limits = LIMITS[fixture.profile]
    const row = {
      id: fixture.id,
      profile: fixture.profile,
      confidence: recognized.confidence,
      characterErrorRate: Number(score.characterErrorRate.toFixed(4)),
      wordErrorRate: Number(score.wordErrorRate.toFixed(4)),
      tokenF1: Number(score.tokenF1.toFixed(4)),
      keywordRecall: Number(score.keywordRecall.toFixed(4)),
      missingKeywords: score.keywords.filter((hit) => !hit.found).map((hit) => hit.keyword),
      sample: recognized.text.replace(/\s+/g, ' ').slice(0, 220),
    }
    rows.push(row)
    if (!limits) {
      failures.push(`${fixture.id}: unknown scan profile ${fixture.profile}`)
      continue
    }
    if (score.keywordRecall < limits.keywordRecall) {
      failures.push(
        `${fixture.id}: keyword recall ${row.keywordRecall} (limit ${limits.keywordRecall})`,
      )
    }
    if (score.tokenF1 < limits.tokenF1) {
      failures.push(`${fixture.id}: token F1 ${row.tokenF1} (limit ${limits.tokenF1})`)
    }
  }
} finally {
  await worker.terminate()
}

await mkdir(ROOT, { recursive: true })
await writeFile(REPORT, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`)
console.log(JSON.stringify(rows, null, 2))
if (failures.length > 0) {
  console.error('\nOCR benchmark failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
