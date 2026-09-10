import { useState } from 'react'
import type { PageOverlay } from '../domain/document'

export function OverlayTextField({
  overlay,
  onCommit,
  onFocus,
  rows,
}: {
  overlay: PageOverlay
  onCommit: (text: string) => void
  onFocus?: () => void
  rows?: number
}) {
  const [draft, setDraft] = useState(overlay.text ?? '')
  const [source, setSource] = useState({ id: overlay.id, text: overlay.text ?? '' })
  if (overlay.id !== source.id || overlay.text !== source.text) {
    setSource({ id: overlay.id, text: overlay.text ?? '' })
    setDraft(overlay.text ?? '')
  }

  return (
    <textarea
      aria-label="Text"
      value={draft}
      maxLength={4000}
      rows={rows ?? (overlay.extracted ? 4 : 2)}
      onFocus={onFocus}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const next = overlay.extracted ? draft : draft.trim() || 'Add text'
        if (next !== (overlay.text ?? '')) onCommit(next)
      }}
    />
  )
}
