import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const repositoryBase = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base: repositoryBase,
  plugins: [
    react(),
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
        globPatterns: ['**/*.{html,js,css,svg,mjs,wasm}'],
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
