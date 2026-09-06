import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ocr-bench',
  testMatch: 'generate.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
})
