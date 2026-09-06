import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { keywordFound, levenshtein, normalizeOcrText, scoreOcr, tokenF1 } from './ocr-bench/score'
import { BANK_STATEMENTS, SCAN_PROFILES, fixtureId, statementKeywords } from './ocr-bench/statements'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'ocr-bench/fixtures')

describe('OCR benchmark scoring', () => {
  it('treats a perfect transcript as zero error', () => {
    const expected = BANK_STATEMENTS[0]
    if (!expected) throw new Error('Missing statement fixture.')
    const text = 'Northbridge Bank plc\nMr Alex Rivera\n40-12-88'
    const score = scoreOcr(text, text, ['Northbridge', '40-12-88', 'Alex Rivera'])
    expect(score.characterErrorRate).toBe(0)
    expect(score.wordErrorRate).toBe(0)
    expect(score.tokenF1).toBe(1)
    expect(score.keywordRecall).toBe(1)
  })

  it('counts substitutions in character and word error rates', () => {
    expect(levenshtein('SORT CODE', 'SORT GODE')).toBe(1)
    const score = scoreOcr('TESCO STORES 3842', 'TESCO STORE5 3842', ['TESCO STORES 3842', '54.21'])
    expect(score.characterErrorRate).toBeGreaterThan(0)
    expect(score.characterErrorRate).toBeLessThan(0.2)
    expect(score.keywords.find((hit) => hit.keyword === '54.21')?.found).toBe(false)
  })

  it('scores unordered token overlap even when line order differs', () => {
    expect(tokenF1('SORT CODE 40-12-88', '40-12-88 SORT CODE')).toBe(1)
    expect(tokenF1('TESCO 54.21', 'TESCO 99.00')).toBeLessThan(0.7)
  })

  it('matches account numbers even when OCR drops hyphens or spaces', () => {
    expect(keywordFound('Sort code 401288 account 12345678', '40-12-88')).toBe(true)
    expect(keywordFound('IBAN GB29NBRG40128812345678', 'GB29 NBRG 4012 8812 3456 78')).toBe(true)
    expect(keywordFound('LS14AB Leeds', 'LS1 4AB')).toBe(false)
    expect(normalizeOcrText('  Paid  out   £54.21 ')).toContain('54.21')
  })
})

describe('scanned statement fixtures', () => {
  it('includes a noisy JPEG and image-only PDF for each statement profile', () => {
    const manifestPath = join(FIXTURES, 'manifest.json')
    expect(existsSync(manifestPath), 'Run npm run generate:ocr-fixtures first').toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      fixtures: Array<{ id: string; image: string; pdf: string; keywords: string[] }>
    }
    expect(manifest.fixtures).toHaveLength(BANK_STATEMENTS.length * SCAN_PROFILES.length)
    for (const statement of BANK_STATEMENTS) {
      for (const profile of SCAN_PROFILES) {
        const id = fixtureId(statement.id, profile.id)
        const fixture = manifest.fixtures.find((entry) => entry.id === id)
        expect(fixture, id).toBeTruthy()
        expect(existsSync(join(FIXTURES, fixture?.image ?? ''))).toBe(true)
        expect(existsSync(join(FIXTURES, fixture?.pdf ?? ''))).toBe(true)
        expect(fixture?.keywords).toEqual(statementKeywords(statement))
      }
    }
  })
})
