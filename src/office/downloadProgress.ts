export type OfficeDownloadProgress = { percent: number | null; complete: boolean }
type AssetProgress = { root: string; file: string; loaded: number; total: number; done: boolean; weight: number; totalWeight: number }

export function createDownloadProgress(root: string) {
  const assets = new Map<string, AssetProgress>()
  return (message: AssetProgress): OfficeDownloadProgress | undefined => {
    if (message.root !== root || !['soffice.wasm', 'soffice.data'].includes(message.file)) return undefined
    if (![message.loaded, message.total, message.weight, message.totalWeight].every(Number.isFinite)) return undefined
    if (message.loaded < 0 || message.total < 0 || message.weight <= 0 || message.totalWeight < 0) return undefined
    assets.set(message.file, message)
    const complete = assets.size === 2 && [...assets.values()].every((asset) => asset.done)
    if (complete) return { percent: 100, complete: true }
    if (!message.totalWeight || [...assets.values()].some((asset) => !asset.done && !asset.total)) return { percent: null, complete: false }
    const loadedWeight = [...assets.values()].reduce((sum, asset) => sum + asset.weight * (asset.done ? 1 : Math.min(1, asset.loaded / asset.total)), 0)
    return { percent: Math.min(99, Math.floor(100 * loadedWeight / message.totalWeight)), complete: false }
  }
}

export function watchOfficeDownload(root: string, update: (progress: OfficeDownloadProgress) => void) {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const channel = new BroadcastChannel('pdfe-office-download')
  const receive = createDownloadProgress(root)
  channel.onmessage = (event: MessageEvent<AssetProgress>) => {
    if (!event.data || typeof event.data !== 'object') return
    const progress = receive(event.data)
    if (progress) update(progress)
  }
  return () => channel.close()
}
