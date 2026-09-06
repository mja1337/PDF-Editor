import { describe, expect, it } from 'vitest'
import { parsePreferences } from '../src/domain/preferences'
import {
  detectionsToRuns,
  platformOcrAvailable,
  tesseractWordBoxesToRuns,
} from '../src/pdf/ocr'
import {
  lstmCoreFileName,
  tesseractBrowserApi,
  workerSourceLooksLikeHtml,
} from '../src/pdf/ocrEngine'

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
    expect(runs[0]?.fontSize).toBeCloseTo(8)
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
    expect(lstmCoreFileName(false, false)).toBe('tesseract-core-lstm.wasm.js')
    expect(lstmCoreFileName(true, false)).toBe('tesseract-core-simd-lstm.wasm.js')
    expect(lstmCoreFileName(true, true)).toBe(
      'tesseract-core-relaxedsimd-lstm.wasm.js',
    )
    expect(workerSourceLooksLikeHtml('<!doctype html><html><body>app</body></html>')).toBe(
      true,
    )
    expect(workerSourceLooksLikeHtml('importScripts("core.js");')).toBe(false)
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
