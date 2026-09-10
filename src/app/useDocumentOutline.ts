import { useCallback, useEffect, useState } from 'react'
import type { EditorDocument } from '../domain/document'
import type { PdfSession } from '../pdf/engine'
import type { OutlineEntry } from '../pdf/navigation'

interface OutlineOptions {
  editorDocument: EditorDocument | null
  sessions: ReadonlyMap<string, PdfSession>
  sessionsRef: React.RefObject<Map<string, PdfSession>>
  onUnavailable: () => void
}

export function useDocumentOutline({
  editorDocument,
  sessions,
  sessionsRef,
  onUnavailable,
}: OutlineOptions) {
  const [entries, setEntries] = useState<OutlineEntry[]>([])
  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle')

  useEffect(() => {
    if (!editorDocument || sessions.size === 0) return
    let cancelled = false
    void import('../pdf/navigation').then(({ documentHasOutline }) =>
      documentHasOutline(sessionsRef.current, editorDocument).then((value) => {
        if (cancelled) return
        setAvailable(value)
        if (!value) onUnavailable()
      }),
    )
    return () => {
      cancelled = true
    }
  }, [editorDocument, onUnavailable, sessions, sessionsRef])

  const load = useCallback(async () => {
    if (!editorDocument || status !== 'idle') return
    setStatus('loading')
    try {
      const { readEditorOutline } = await import('../pdf/navigation')
      setEntries(await readEditorOutline(sessionsRef.current, editorDocument))
    } catch {
      setEntries([])
    } finally {
      setStatus('ready')
    }
  }, [editorDocument, sessionsRef, status])

  // Merging pages invalidates the cached outline but not whether one exists.
  const invalidate = useCallback(() => {
    setEntries([])
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    setEntries([])
    setAvailable(false)
    setStatus('idle')
  }, [])

  return { entries, available, status, load, invalidate, reset }
}
