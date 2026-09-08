import { createReadStream, cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import { rewriteTesseractWorkerSource } from './src/pdf/ocrWorkerSource.ts'

const repositoryBase = process.env.BASE_PATH ?? '/'
const require = createRequire(import.meta.url)
const PDFJS_ROOT = dirname(require.resolve('pdfjs-dist/package.json'))
const PDFJS_FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const
const PDFJS_MIME: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.icc': 'application/vnd.iccprofile',
}

const TESSERACT_JS_ROOT = dirname(require.resolve('tesseract.js/package.json'))
const TESSERACT_CORE_ROOT = dirname(require.resolve('tesseract.js-core/package.json'))
const OCR_CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
] as const
const OCR_CORE_ALIASES = {
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm': 'tesseract-core-simd-lstm.wasm',
} as const
const TESSDATA_BEST_URL =
  'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/eng.traineddata'
const OCR_CACHE_DIR = resolve('.ocr-cache')
const OCR_LANG_GZ = join(OCR_CACHE_DIR, 'eng.traineddata.gz')
const OCR_WORKER_JS = join(OCR_CACHE_DIR, 'worker.min.js')
const OCR_MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm',
}

function pdfjsPublicPath(url: string, base: string) {
  const path = decodeURIComponent(url.split('?')[0] ?? '')
  const prefix = `${base.replace(/\/?$/, '/')}pdfjs/`
  if (!path.startsWith(prefix)) return null
  return path.slice(prefix.length)
}

function sendPdfjsAsset(
  url: string,
  base: string,
  response: ServerResponse,
  next: () => void,
) {
  const rest = pdfjsPublicPath(url, base)
  if (!rest) {
    next()
    return
  }

  const [folder, ...parts] = rest.split('/').filter(Boolean)
  if (!PDFJS_FOLDERS.includes(folder as (typeof PDFJS_FOLDERS)[number]) || parts.length === 0) {
    next()
    return
  }

  const root = resolve(PDFJS_ROOT, folder)
  const file = resolve(root, ...parts)
  if (relative(root, file).startsWith('..') || !existsSync(file) || !statSync(file).isFile()) {
    next()
    return
  }

  response.setHeader('Content-Type', PDFJS_MIME[extname(file)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'public, max-age=86400')
  createReadStream(file).pipe(response)
}

function pdfjsAssetsPlugin(): Plugin {
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      const base = server.config.base
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next) => {
        sendPdfjsAsset(request.url ?? '', base, response, next)
      })
    },
    writeBundle(options) {
      if (!options.dir) return
      for (const folder of PDFJS_FOLDERS) {
        cpSync(join(PDFJS_ROOT, folder), join(options.dir, 'pdfjs', folder), {
          recursive: true,
        })
      }
    },
  }
}

function ocrPublicPath(url: string, base: string) {
  const path = decodeURIComponent(url.split('?')[0] ?? '')
  const prefix = `${base.replace(/\/?$/, '/')}ocr/`
  if (!path.startsWith(prefix)) return null
  return path.slice(prefix.length)
}

async function ensureEnglishTessdata() {
  if (existsSync(OCR_LANG_GZ) && statSync(OCR_LANG_GZ).size > 1024 * 1024) {
    return OCR_LANG_GZ
  }
  mkdirSync(OCR_CACHE_DIR, { recursive: true })
  const response = await fetch(TESSDATA_BEST_URL, {
    headers: { 'User-Agent': 'pdfe-ocr-build' },
  })
  if (!response.ok) {
    throw new Error(
      `Could not download English tessdata_best (${response.status}). Build needs network access to ${TESSDATA_BEST_URL}`,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 1024 * 1024) {
    throw new Error('Downloaded tessdata_best file was too small to be valid.')
  }
  writeFileSync(OCR_LANG_GZ, gzipSync(bytes, { level: 4 }))
  return OCR_LANG_GZ
}

function ensurePatchedTesseractWorker() {
  mkdirSync(OCR_CACHE_DIR, { recursive: true })
  const source = readFileSync(join(TESSERACT_JS_ROOT, 'dist', 'worker.min.js'), 'utf8')
  writeFileSync(OCR_WORKER_JS, rewriteTesseractWorkerSource(source))
  return OCR_WORKER_JS
}

function resolveOcrAsset(rest: string) {
  const name = rest.split('/').filter(Boolean)[0]
  if (!name) return null
  if (name === 'worker.min.js') return OCR_WORKER_JS
  if (name === 'eng.traineddata.gz') return OCR_LANG_GZ
  const aliased =
    name in OCR_CORE_ALIASES
      ? OCR_CORE_ALIASES[name as keyof typeof OCR_CORE_ALIASES]
      : name
  if ((OCR_CORE_FILES as readonly string[]).includes(aliased)) {
    return join(TESSERACT_CORE_ROOT, aliased)
  }
  return null
}

function sendOcrAsset(
  url: string,
  base: string,
  response: ServerResponse,
  next: () => void,
) {
  const rest = ocrPublicPath(url, base)
  if (!rest) {
    next()
    return
  }
  const file = resolveOcrAsset(rest)
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    next()
    return
  }
  response.setHeader('Content-Type', OCR_MIME[extname(file)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'public, max-age=86400')
  createReadStream(file).pipe(response)
}

function copyOcrAssets(outDir: string) {
  const dest = join(outDir, 'ocr')
  mkdirSync(dest, { recursive: true })
  cpSync(ensurePatchedTesseractWorker(), join(dest, 'worker.min.js'))
  for (const file of OCR_CORE_FILES) {
    cpSync(join(TESSERACT_CORE_ROOT, file), join(dest, file))
  }
  for (const [alias, target] of Object.entries(OCR_CORE_ALIASES)) {
    cpSync(join(TESSERACT_CORE_ROOT, target), join(dest, alias))
  }
  cpSync(OCR_LANG_GZ, join(dest, 'eng.traineddata.gz'))
}

function ocrAssetsPlugin(): Plugin {
  return {
    name: 'ocr-assets',
    async buildStart() {
      if (process.env.VITEST) return
      await ensureEnglishTessdata()
      ensurePatchedTesseractWorker()
    },
    configureServer(server) {
      if (process.env.VITEST) return
      const ready = ensureEnglishTessdata()
        .then(() => ensurePatchedTesseractWorker())
        .catch((error) => {
          server.config.logger.warn(
            `[ocr-assets] ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      const base = server.config.base
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next) => {
        if (!ocrPublicPath(request.url ?? '', base)) {
          next()
          return
        }
        void ready.then(() => sendOcrAsset(request.url ?? '', base, response, next))
      })
    },
    async writeBundle(options) {
      if (!options.dir) return
      await ensureEnglishTessdata()
      ensurePatchedTesseractWorker()
      copyOcrAssets(options.dir)
    },
  }
}

export default defineConfig({
  base: repositoryBase,
  plugins: [
    react(),
    pdfjsAssetsPlugin(),
    ocrAssetsPlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'pdfe',
        short_name: 'pdfe',
        description: 'A private PDF workspace that runs entirely in your browser.',
        theme_color: '#101715',
        background_color: '#101715',
        display: 'standalone',
        start_url: repositoryBase,
        scope: repositoryBase,
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{html,js,css,svg,mjs,wasm,woff,woff2,bcmap,pfb,ttf,otf,icc}',
        ],
        globIgnores: ['**/ocr/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/ocr\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/ocr\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ocr-engine-v3',
              networkTimeoutSeconds: 60,
              expiration: {
                maxEntries: 16,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 1,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
