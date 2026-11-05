import type { OfficeOptions } from './conversion'
export type PendingOffice = { file: File; options: OfficeOptions }

// Only used for the one-time isolation reload. Removed as soon as it is restored.
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pdfe-office-handoff', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('pending')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Could not prepare local conversion storage. Check browser storage permissions.'))
  })
}
export async function pendingOffice(value?: PendingOffice): Promise<PendingOffice | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite')
    const store = tx.objectStore('pending')
    const key = sessionStorage.getItem('pdfe-office-handoff') ?? crypto.randomUUID()
    let result: PendingOffice | undefined
    if (value) {
      sessionStorage.setItem('pdfe-office-handoff', key)
      store.put(value, key)
    } else {
      const request = store.get(key)
      request.onsuccess = () => { result = request.result; store.delete(key) }
    }
    tx.oncomplete = () => { db.close(); if (!value) sessionStorage.removeItem('pdfe-office-handoff'); resolve(result) }
    tx.onerror = () => { db.close(); reject(new Error('Could not save the file for local conversion.')) }
  })
}

export async function prepareOffice(pending: PendingOffice, signal: AbortSignal): Promise<boolean> {
  if (globalThis.crossOriginIsolated) return true
  if (!('serviceWorker' in navigator)) throw new Error('Local Office conversion needs a browser with service worker support.')
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Local conversion is not ready. Reload the app and try again.')), 15000)),
  ])
  signal.throwIfAborted()
  await pendingOffice(pending)
  if (signal.aborted) { await pendingOffice(); signal.throwIfAborted() }
  location.reload()
  return false
}
