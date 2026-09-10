// Playwright resolves its browser directory once, at import time, from
// PLAYWRIGHT_BROWSERS_PATH. A sandbox that points the variable at its own empty
// cache therefore fails every run with "Executable doesn't exist", even though the
// browsers are installed in the default location. Drop such an override and let
// Playwright fall back to its default cache.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
const override = env.PLAYWRIGHT_BROWSERS_PATH

// '0' asks Playwright to keep browsers beside the package, which is a real choice.
function hasInstalledBrowsers(directory) {
  if (directory === '0') return true
  try {
    return readdirSync(directory).some((entry) => entry.startsWith('chromium'))
  } catch {
    return false
  }
}

if (override && !hasInstalledBrowsers(override)) {
  delete env.PLAYWRIGHT_BROWSERS_PATH
  console.warn(
    `[e2e] PLAYWRIGHT_BROWSERS_PATH=${override} contains no browsers; using the default cache.`,
  )
}

const local = join(repoRoot, 'node_modules', '.bin', 'playwright')
const command = existsSync(local) ? local : 'playwright'
const child = spawn(command, ['test', ...process.argv.slice(2)], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
