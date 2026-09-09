import type { LogoStampConfig, StampCorner } from './document'
import type { AppSettings, OcrConsent, SavedSignature } from './preferences'
import { compressSignatureForStorage } from '../pdf/signatureImage'

const DB_NAME = 'pdfe'
const DB_VERSION = 2
const ASSETS_STORE = 'assets'
const SETTINGS_STORE = 'settings'
const SIGNATURE_KEY = 'signature'
const STAMP_IMAGE_KEY = 'stamp'
const SETTINGS_KEY = 'app'

const LEGACY_STORAGE_KEYS = ['pdfe.preferences', 'pdf-editor.preferences'] as const

export interface LoadedAppStorage {
  settings: AppSettings
  stamp: LogoStampConfig | null
  signature: SavedSignature | null
}

interface StoredStampSettings {
  corner: StampCorner
  size: number
  opacity: number
}

function isCorner(value: unknown): value is StampCorner {
  return (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'bottom-left' ||
    value === 'bottom-right'
  )
}

function parseOcrConsent(value: unknown): OcrConsent {
  return value === 'accepted' || value === 'declined' ? value : 'unset'
}

function parseStampSettings(value: unknown): StoredStampSettings | null {
  if (!value || typeof value !== 'object') return null
  const stamp = value as Partial<StoredStampSettings & { imageData?: string }>
  if (!isCorner(stamp.corner)) return null
  return {
    corner: stamp.corner,
    size: Math.max(0.06, Math.min(0.4, Number(stamp.size) || 0.14)),
    opacity: Math.max(0.15, Math.min(1, Number(stamp.opacity) || 1)),
  }
}

function parseSignature(value: unknown): SavedSignature | null {
  if (!value || typeof value !== 'object') return null
  const signature = value as Partial<SavedSignature>
  if (
    typeof signature.imageData !== 'string' ||
    !signature.imageData.startsWith('data:image/') ||
    typeof signature.ratio !== 'number' ||
    !Number.isFinite(signature.ratio) ||
    signature.ratio <= 0
  ) {
    return null
  }
  return { imageData: signature.imageData, ratio: signature.ratio }
}

function parseLegacyStamp(value: unknown): LogoStampConfig | null {
  if (!value || typeof value !== 'object') return null
  const stamp = value as Partial<LogoStampConfig>
  if (
    typeof stamp.imageData !== 'string' ||
    !stamp.imageData.startsWith('data:image/') ||
    !isCorner(stamp.corner)
  ) {
    return null
  }
  return {
    imageData: stamp.imageData,
    corner: stamp.corner,
    size: Math.max(0.06, Math.min(0.4, Number(stamp.size) || 0.14)),
    opacity: Math.max(0.15, Math.min(1, Number(stamp.opacity) || 1)),
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE)
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'))
  })
}

async function readAsset<T>(key: string, parse: (value: unknown) => T | null): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(ASSETS_STORE, 'readonly').objectStore(ASSETS_STORE).get(key)
      request.onsuccess = () => resolve(parse(request.result))
      request.onerror = () => reject(request.error ?? new Error(`Could not read ${key}.`))
    })
  } finally {
    db.close()
  }
}

async function writeAsset(key: string, value: unknown | null): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable.')
  }
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, 'readwrite')
      const store = tx.objectStore(ASSETS_STORE)
      if (value == null) store.delete(key)
      else store.put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error(`Could not save ${key}.`))
    })
  } finally {
    db.close()
  }
}

async function readSettings(): Promise<AppSettings> {
  if (typeof indexedDB === 'undefined') {
    return { ocrConsent: 'unset', stamp: null }
  }
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(SETTINGS_STORE, 'readonly')
        .objectStore(SETTINGS_STORE)
        .get(SETTINGS_KEY)
      request.onsuccess = () => {
        const value = request.result as { ocrConsent?: unknown; stamp?: unknown } | undefined
        resolve({
          ocrConsent: parseOcrConsent(value?.ocrConsent),
          stamp: parseStampSettings(value?.stamp),
        })
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read settings.'))
    })
  } finally {
    db.close()
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable.')
  }
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite')
      tx.objectStore(SETTINGS_STORE).put(settings, SETTINGS_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not save settings.'))
    })
  } finally {
    db.close()
  }
}

export function parseLegacyPreferencesJson(raw: string | null): {
  ocrConsent: OcrConsent
  stamp: LogoStampConfig | null
  signature: SavedSignature | null
} {
  if (!raw) {
    return { ocrConsent: 'unset', stamp: null, signature: null }
  }
  try {
    const parsed = JSON.parse(raw) as {
      ocrConsent?: unknown
      stamp?: unknown
      signature?: unknown
    }
    return {
      ocrConsent: parseOcrConsent(parsed.ocrConsent),
      stamp: parseLegacyStamp(parsed.stamp),
      signature: parseSignature(parsed.signature),
    }
  } catch {
    return { ocrConsent: 'unset', stamp: null, signature: null }
  }
}

function readLegacyLocalStorage(): {
  ocrConsent: OcrConsent
  stamp: LogoStampConfig | null
  signature: SavedSignature | null
} | null {
  if (typeof localStorage === 'undefined') return null
  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    const parsed = parseLegacyPreferencesJson(raw)
    if (parsed.stamp || parsed.signature || parsed.ocrConsent !== 'unset') {
      return parsed
    }
  }
  return null
}

function clearLegacyLocalStorage() {
  if (typeof localStorage === 'undefined') return
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore quota or privacy errors while clearing legacy data.
    }
  }
}

async function migrateLegacyLocalStorage(): Promise<void> {
  const legacy = readLegacyLocalStorage()
  if (!legacy) return

  const [currentSettings, currentSignature, currentStampImage] = await Promise.all([
    readSettings(),
    readAsset(SIGNATURE_KEY, parseSignature),
    readAsset(STAMP_IMAGE_KEY, (value) =>
      typeof value === 'string' && value.startsWith('data:image/') ? value : null,
    ),
  ])

  const nextSettings: AppSettings = {
    ocrConsent: currentSettings.ocrConsent === 'unset' ? legacy.ocrConsent : currentSettings.ocrConsent,
    stamp: currentSettings.stamp ?? (legacy.stamp
      ? {
          corner: legacy.stamp.corner,
          size: legacy.stamp.size,
          opacity: legacy.stamp.opacity,
        }
      : null),
  }

  await writeSettings(nextSettings)

  if (!currentSignature && legacy.signature) {
    await writeAsset(SIGNATURE_KEY, legacy.signature)
  }
  if (!currentStampImage && legacy.stamp?.imageData) {
    await writeAsset(STAMP_IMAGE_KEY, legacy.stamp.imageData)
  }

  clearLegacyLocalStorage()
}

async function mergeStamp(
  settings: AppSettings,
  stampImage: string | null,
): Promise<LogoStampConfig | null> {
  if (!settings.stamp || !stampImage) return null
  return {
    imageData: stampImage,
    corner: settings.stamp.corner,
    size: settings.stamp.size,
    opacity: settings.stamp.opacity,
  }
}

export async function loadAppStorage(): Promise<LoadedAppStorage> {
  await migrateLegacyLocalStorage()
  const [settings, signature, stampImage] = await Promise.all([
    readSettings(),
    readAsset(SIGNATURE_KEY, parseSignature),
    readAsset(STAMP_IMAGE_KEY, (value) =>
      typeof value === 'string' && value.startsWith('data:image/') ? value : null,
    ),
  ])
  return {
    settings,
    stamp: await mergeStamp(settings, stampImage),
    signature,
  }
}

export async function saveOcrConsent(ocrConsent: OcrConsent): Promise<void> {
  const settings = await readSettings()
  await writeSettings({ ...settings, ocrConsent })
}

export async function saveStamp(stamp: LogoStampConfig | null): Promise<void> {
  const settings = await readSettings()
  if (!stamp) {
    await Promise.all([
      writeSettings({ ...settings, stamp: null }),
      writeAsset(STAMP_IMAGE_KEY, null),
    ])
    return
  }
  const compressed = await compressSignatureForStorage(stamp.imageData, 640)
  await Promise.all([
    writeSettings({
      ...settings,
      stamp: {
        corner: stamp.corner,
        size: stamp.size,
        opacity: stamp.opacity,
      },
    }),
    writeAsset(STAMP_IMAGE_KEY, compressed.data),
  ])
}

export async function saveSavedSignature(signature: SavedSignature | null): Promise<void> {
  if (!signature) {
    await writeAsset(SIGNATURE_KEY, null)
    return
  }
  const compressed = await compressSignatureForStorage(signature.imageData)
  await writeAsset(SIGNATURE_KEY, {
    imageData: compressed.data,
    ratio: compressed.ratio,
  })
}
