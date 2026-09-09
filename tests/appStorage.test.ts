import { describe, expect, it, vi } from 'vitest'
import { purgeLegacyLocalStorage } from '../src/domain/appStorage'
import type { AppSettings } from '../src/domain/preferences'

describe('purgeLegacyLocalStorage', () => {
  it('removes legacy preference keys', () => {
    const store = new Map<string, string>([
      ['pdfe.preferences', '{"signature":null}'],
      ['pdf-editor.preferences', '{"signature":null}'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    })
    purgeLegacyLocalStorage()
    expect(store.has('pdfe.preferences')).toBe(false)
    expect(store.has('pdf-editor.preferences')).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('app storage settings shape', () => {
  it('keeps stamp metadata separate from image blobs', () => {
    const settings: AppSettings = {
      ocrConsent: 'accepted',
      stamp: { corner: 'top-right', size: 0.14, opacity: 1 },
    }
    expect(settings.stamp?.corner).toBe('top-right')
    expect(JSON.stringify(settings).includes('data:image/')).toBe(false)
  })
})
