/* Imported by the editor's existing service worker before Workbox routes. */
const officeRoot = new URL('office/', self.registration.scope).href
const officeCache = 'pdfe-office-2.7.2'
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
      if (!response) {
        const compressed = /\.(wasm|data)$/.test(new URL(request.url).pathname)
        response = await fetch(compressed ? `${request.url}.gz` : request)
        if (!response.ok) return response
        if (compressed) {
          response = new Response(response.headers.get('Content-Encoding') === 'gzip' ? response.body : response.body.pipeThrough(new DecompressionStream('gzip')), {
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
