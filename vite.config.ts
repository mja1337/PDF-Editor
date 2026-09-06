import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

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

export default defineConfig({
  base: repositoryBase,
  plugins: [
    react(),
    pdfjsAssetsPlugin(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'PDF Editor',
        short_name: 'PDF Editor',
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
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
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
