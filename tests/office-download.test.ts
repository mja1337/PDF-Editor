import { describe, expect, it } from 'vitest'
import { createDownloadProgress } from '../src/office/downloadProgress'
const root = 'https://example.test/PDF-Editor/office/'
const event = (file: string, loaded: number, total: number, done = false) => ({ root, file, loaded, total, done, weight: file === 'soffice.data' ? 30 : 70, totalWeight: 100 })
describe('engine download progress', () => {
  it('weights both concurrent downloads and reserves completion for both assets', () => {
    const receive = createDownloadProgress(root)
    expect(receive(event('soffice.data', 50, 100))).toEqual({ percent: 15, complete: false })
    expect(receive(event('soffice.wasm', 50, 100))).toEqual({ percent: 50, complete: false })
    expect(receive(event('soffice.wasm', 100, 100, true))).toEqual({ percent: 85, complete: false })
    expect(receive(event('soffice.data', 100, 100, true))).toEqual({ percent: 100, complete: true })
  })
  it('counts cached files without requiring a download and handles unknown lengths', () => {
    const receive = createDownloadProgress(root)
    expect(receive(event('soffice.data', 1, 1, true))?.percent).toBe(30)
    expect(receive(event('soffice.wasm', 10, 0))).toEqual({ percent: null, complete: false })
    expect(receive(event('soffice.wasm', 10, 0, true))).toEqual({ percent: 100, complete: true })
  })
  it('ignores other scopes, unrelated files and malformed byte counts', () => {
    const receive = createDownloadProgress(root)
    expect(receive({ ...event('soffice.data', 1, 2), root: 'https://other.test/' })).toBeUndefined()
    expect(receive(event('unknown', 1, 2))).toBeUndefined()
    expect(receive(event('soffice.data', -1, 2))).toBeUndefined()
    expect(receive(event('soffice.data', Number.NaN, 2))).toBeUndefined()
  })
})
