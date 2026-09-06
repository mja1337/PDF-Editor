import { describe, expect, it } from 'vitest'
import { parsePreferences } from '../src/domain/preferences'
import {
  cleanupOcrText,
  detectionsToRuns,
  fittedOcrFontSize,
  guessOcrFace,
  platformOcrAvailable,
  tesseractLinesToRuns,
  tesseractWordBoxesToRuns,
} from '../src/pdf/ocr'
import {
  lstmCoreFileName,
  tesseractBrowserApi,
  workerSourceLooksLikeHtml,
} from '../src/pdf/ocrEngine'
import { rewriteTesseractWorkerSource } from '../src/pdf/ocrWorkerSource'

describe('platform OCR', () => {
  it('is unavailable in Node without a TextDetector', () => {
    expect(platformOcrAvailable()).toBe(false)
  })

  it('maps detector boxes into grouped page lines', () => {
    const runs = detectionsToRuns(
      [
        { boundingBox: { x: 20, y: 40, width: 80, height: 16 }, rawValue: 'Hello' },
        { boundingBox: { x: 108, y: 40, width: 70, height: 16 }, rawValue: 'world' },
        { boundingBox: { x: 20, y: 80, width: 50, height: 14 }, rawValue: '  ' },
      ],
      400,
      200,
      2,
    )
    expect(runs.map((run) => run.text)).toEqual(['Hello world'])
    expect(runs[0]?.fontSize).toBeCloseTo(8)
    expect(runs[0]?.y).toBeGreaterThan(0.1)
  })
})

describe('Tesseract word boxes', () => {
  it('maps confident words into grouped page lines', () => {
    const runs = tesseractWordBoxesToRuns(
      [
        { text: 'Invoice', confidence: 90, bbox: { x0: 20, y0: 40, x1: 100, y1: 56 } },
        { text: 'total', confidence: 88, bbox: { x0: 108, y0: 40, x1: 178, y1: 56 } },
        { text: 'noise', confidence: 12, bbox: { x0: 20, y0: 80, x1: 70, y1: 94 } },
        { text: '  ', confidence: 99, bbox: { x0: 20, y0: 120, x1: 70, y1: 134 } },
      ],
      400,
      200,
      2,
    )
    expect(runs.map((run) => run.text)).toEqual(['Invoice total'])
    expect(runs[0]?.fontSize).toBeCloseTo(6.08)
  })

  it('keeps Tesseract line boxes instead of flattening the page into one row', () => {
    const runs = tesseractLinesToRuns(
      [
        {
          words: [
            { text: 'Hello', confidence: 90, bbox: { x0: 20, y0: 40, x1: 80, y1: 56 } },
            { text: 'world', confidence: 88, bbox: { x0: 88, y0: 40, x1: 150, y1: 56 } },
          ],
        },
        {
          words: [
            { text: 'Next', confidence: 91, bbox: { x0: 20, y0: 80, x1: 70, y1: 96 } },
          ],
        },
      ],
      400,
      200,
      2,
    )
    expect(runs.map((run) => run.text)).toEqual(['Hello world', 'Next'])
  })
})

describe('OCR replacement type', () => {
  it('cleans spacing and fits a line size to the scanned box width', () => {
    expect(cleanupOcrText('  Total ,  $12 ')).toBe('Total, $12')
    expect(fittedOcrFontSize('Hello', 100, 20, 2, (px, text) => text.length * px * 0.5)).toBeCloseTo(
      9,
    )
  })

  it('treats even character widths as mono and dense ink as bold', () => {
    expect(
      guessOcrFace(
        [
          { text: 'ABC', width: 30, height: 10 },
          { text: 'DEF', width: 30, height: 10 },
          { text: 'GHI', width: 30, height: 10 },
        ],
        0.2,
      ),
    ).toMatchObject({ fontRole: 'mono', fontWeight: 400 })
    expect(guessOcrFace([{ text: 'Hi', width: 20, height: 12 }], 0.5)).toMatchObject({
      fontWeight: 700,
    })
  })
})

describe('Tesseract browser API', () => {
  it('reads createWorker from a Vite-style default export', () => {
    const createWorker = async () => ({})
    const api = tesseractBrowserApi({
      default: { createWorker, OEM: { LSTM_ONLY: 1 }, PSM: { SINGLE_BLOCK: '6' } },
    })
    expect(api.createWorker).toBe(createWorker)
    expect(tesseractBrowserApi({ createWorker }).createWorker).toBe(createWorker)
    expect(
      tesseractBrowserApi({ default: { default: { createWorker } } }).createWorker,
    ).toBe(createWorker)
  })

  it('picks the LSTM core file and rejects HTML served in place of the worker', () => {
    expect(lstmCoreFileName(false)).toBe('tesseract-core-lstm.wasm.js')
    expect(lstmCoreFileName(true)).toBe('tesseract-core-simd-lstm.wasm.js')
    expect(workerSourceLooksLikeHtml('<!doctype html><html><body>app</body></html>')).toBe(
      true,
    )
    expect(workerSourceLooksLikeHtml('importScripts("core.js");')).toBe(false)
  })

  it('rewrites the relaxed-SIMD core request to the working SIMD core', () => {
    expect(
      rewriteTesseractWorkerSource(
        'importScripts("/ocr/tesseract-core-relaxedsimd-lstm.wasm.js")',
      ),
    ).toBe('importScripts("/ocr/tesseract-core-simd-lstm.wasm.js")')
  })
})

describe('OCR consent', () => {
  it('keeps a saved stamp while reading OCR consent independently', () => {
    const imageData = 'data:image/png;base64,aaaa'
    const parsed = parsePreferences(
      JSON.stringify({
        stamp: { imageData, corner: 'bottom-left', size: 0.2, opacity: 0.8 },
        ocrConsent: 'accepted',
      }),
    )
    expect(parsed.stamp).toMatchObject({ corner: 'bottom-left' })
    expect(parsed.ocrConsent).toBe('accepted')
    expect(parsePreferences('{"stamp":{"corner":"top-left"}}').ocrConsent).toBe(
      'unset',
    )
    expect(parsePreferences('{"ocrConsent":"declined"}').ocrConsent).toBe('declined')
  })
})
