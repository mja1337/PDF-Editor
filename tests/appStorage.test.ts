import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../src/domain/preferences'

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
