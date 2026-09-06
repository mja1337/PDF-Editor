export type KeywordHit = {
  keyword: string
  found: boolean
}

export type OcrScore = {
  characterErrorRate: number
  wordErrorRate: number
  tokenF1: number
  keywordRecall: number
  keywords: KeywordHit[]
  expectedChars: number
  actualChars: number
  expectedWords: number
  actualWords: number
}

export function normalizeOcrText(value: string) {
  return Array.from(value.normalize('NFKC'))
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 10 || code === 13 || code >= 32
    })
    .join('')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–−]/g, '-')
    .toUpperCase()
    .replace(/[^A-Z0-9£.,/\n-]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim()
}

export function compactOcrText(value: string) {
  return normalizeOcrText(value).replace(/[\s-]/g, '')
}

export function levenshtein(left: string, right: string) {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  const previous = new Array<number>(right.length + 1)
  const current = new Array<number>(right.length + 1)
  for (let index = 0; index <= right.length; index += 1) previous[index] = index

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i
    const leftChar = left.charCodeAt(i - 1)
    for (let j = 1; j <= right.length; j += 1) {
      const insert = (current[j - 1] ?? 0) + 1
      const remove = (previous[j] ?? 0) + 1
      const substitute = (previous[j - 1] ?? 0) + (leftChar === right.charCodeAt(j - 1) ? 0 : 1)
      current[j] = Math.min(insert, remove, substitute)
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j] ?? 0
  }
  return previous[right.length] ?? 0
}

export function errorRate(expected: string, actual: string) {
  if (expected.length === 0) return actual.length === 0 ? 0 : 1
  return levenshtein(expected, actual) / expected.length
}

function words(value: string) {
  return normalizeOcrText(value).split(/\s+/).filter(Boolean)
}

function tokenCounts(tokens: string[]) {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

export function tokenF1(expected: string, actual: string) {
  const expectedTokens = words(expected)
  const actualTokens = words(actual)
  if (expectedTokens.length === 0 && actualTokens.length === 0) return 1
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0
  const expectedCounts = tokenCounts(expectedTokens)
  const actualCounts = tokenCounts(actualTokens)
  let overlap = 0
  for (const [token, count] of expectedCounts) {
    overlap += Math.min(count, actualCounts.get(token) ?? 0)
  }
  const precision = overlap / actualTokens.length
  const recall = overlap / expectedTokens.length
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

export function keywordFound(haystack: string, keyword: string) {
  const compactKeyword = compactOcrText(keyword)
  if (!compactKeyword) return false
  const normalizedHaystack = normalizeOcrText(haystack)
  const normalizedKeyword = normalizeOcrText(keyword)
  if (normalizedHaystack.includes(normalizedKeyword)) return true

  const flexibleId =
    /^\d{2}-\d{2}-\d{2}$/.test(keyword.trim()) ||
    /^GB\d{2}/i.test(compactKeyword) ||
    /^\d{6,}$/.test(compactKeyword)
  return flexibleId && compactOcrText(haystack).includes(compactKeyword)
}

export function scoreOcr(expected: string, actual: string, keywords: string[]): OcrScore {
  const expectedNorm = normalizeOcrText(expected)
  const actualNorm = normalizeOcrText(actual)
  const expectedWords = words(expected)
  const actualWords = words(actual)
  const hits = keywords.map((keyword) => ({
    keyword,
    found: keywordFound(actual, keyword),
  }))
  const found = hits.filter((hit) => hit.found).length
  return {
    characterErrorRate: errorRate(expectedNorm, actualNorm),
    wordErrorRate: errorRate(expectedWords.join(' '), actualWords.join(' ')),
    tokenF1: tokenF1(expected, actual),
    keywordRecall: hits.length === 0 ? 1 : found / hits.length,
    keywords: hits,
    expectedChars: expectedNorm.length,
    actualChars: actualNorm.length,
    expectedWords: expectedWords.length,
    actualWords: actualWords.length,
  }
}
