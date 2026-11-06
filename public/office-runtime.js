/* Imported by the editor's existing service worker before Workbox routes. */
const officeRoot = new URL('office/', self.registration.scope).href
const officeCache = 'pdfe-office-2.7.2'
const officeProgressChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pdfe-office-download') : null
let officeSizes
async function getOfficeSizes(cache) {
  if (!officeSizes) officeSizes = (async () => {
    const url = `${officeRoot}sizes.json`
    const cached = await cache.match(url)
    if (cached) return cached.json()
    const response = await fetch(url)
    if (!response.ok) throw new Error('Office asset sizes unavailable')
    await cache.put(url, response.clone())
    return response.json()
  })().catch(() => { officeSizes = undefined; return null })
  return officeSizes
}
function trackOfficeDownload(body, report, total) {
  let loaded = 0, lastReport = 0
  report(0, total, false)
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength
      if (Date.now() - lastReport >= 100) { report(loaded, total, false); lastReport = Date.now() }
      controller.enqueue(chunk)
    },
    flush() { report(loaded, total, true) },
  }))
}
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const officeAsset = request.url.startsWith(officeRoot)
  if (!officeAsset && request.mode !== 'navigate') return
  event.stopImmediatePropagation()
  event.respondWith((async () => {
    let response
    if (officeAsset) {
      const cache = await caches.open(officeCache)
      response = await cache.match(request)
      const name = new URL(request.url).pathname.split('/').pop()
      const tracked = name === 'soffice.wasm' || name === 'soffice.data'
      const sizes = tracked ? await getOfficeSizes(cache) : null
      const entry = sizes?.[name]
      const report = (loaded, total, done) => officeProgressChannel?.postMessage({
        root: officeRoot, file: name, loaded, total, done,
        weight: entry?.compressedSize ?? 1,
        totalWeight: sizes ? Object.values(sizes).reduce((sum, item) => sum + item.compressedSize, 0) : 0,
      })
      if (response && tracked) report(1, 1, true)
      if (!response) {
        const compressed = /\.(wasm|data)$/.test(new URL(request.url).pathname)
        response = await fetch(compressed ? `${request.url}.gz` : request)
        if (!response.ok) return response
        if (compressed) {
          const decoded = response.headers.get('Content-Encoding') === 'gzip'
          const total = decoded ? entry?.size : (Number(response.headers.get('Content-Length')) || entry?.compressedSize)
          const body = trackOfficeDownload(response.body, report, total ?? 0)
          response = new Response(decoded ? body : body.pipeThrough(new DecompressionStream('gzip')), {
            headers: { 'Content-Type': request.url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
          })
        }
        const headers = new Headers(response.headers)
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
        headers.set('Cross-Origin-Resource-Policy', 'same-origin')
        response = new Response(response.body, { status: response.status, headers })
        const copy = response.clone()
        event.waitUntil(cache.put(request, copy).catch(() => {}))
      }
    } else {
      try { response = await fetch(request) } catch {
        response = await caches.match(new URL('index.html', self.registration.scope).href, { ignoreSearch: true })
        if (!response) return Response.error()
      }
    }
    const headers = new Headers(response.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })())
})
