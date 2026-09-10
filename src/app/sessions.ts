import type { PdfSession } from '../pdf/engine'

export async function destroySession(session: PdfSession | null) {
  if (!session) return
  await session.viewer.loadingTask.destroy()
}

export async function destroySessions(sessions: ReadonlyMap<string, PdfSession>) {
  await Promise.allSettled([...sessions.values()].map(destroySession))
}
