import { platformOcrAvailable } from '../pdf/ocr'

export function userFacingError(error: unknown, fallback: string) {
  if (
    error instanceof TypeError &&
    /Failed to fetch dynamically imported module/i.test(error.message)
  ) {
    if (import.meta.env.DEV) {
      return 'The editor lost its connection to the local app. Refresh the page. If that does not help, restart npm run dev.'
    }
    return 'The editor could not load a required module. Hard-refresh the page (Ctrl+Shift+R or Cmd+Shift+R) to clear stale cache, then try again.'
  }
  return error instanceof Error ? error.message : fallback
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function analysingLabel(progress: string) {
  return progress.includes(' / ') ? `Analysing ${progress}` : progress || 'Analysing…'
}

export function scannedPageHint(ocrConsent: 'unset' | 'accepted' | 'declined') {
  if (ocrConsent === 'accepted') {
    return platformOcrAvailable()
      ? 'No text was found with PDF data, this browser’s detector, or Tesseract OCR. The page is likely a photo or a language other than English.'
      : 'No text was found with PDF data or Tesseract OCR. The page is likely a photo or a language other than English.'
  }
  if (platformOcrAvailable()) {
    return 'No text was found, including with this browser’s on-device detector. You can download a local Tesseract engine from this GitHub Pages site in Settings to retry scans.'
  }
  return 'No extractable PDF text was found. You can download a local Tesseract engine from this GitHub Pages site in Settings to read scanned pages.'
}
