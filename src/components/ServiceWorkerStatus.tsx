import { useRegisterSW } from 'virtual:pwa-register/react'

export function ServiceWorkerStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  return (
    <aside className="update-toast" aria-live="polite">
      <div>
        <strong>{offlineReady ? 'Ready offline' : 'Update available'}</strong>
        <span>
          {offlineReady
            ? 'The editor can now open without a network connection.'
            : 'Reload when you are ready to use the latest version.'}
        </span>
      </div>
      <div className="update-actions">
        {needRefresh && (
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Reload
          </button>
        )}
        <button
          type="button"
          className="quiet-button"
          onClick={() => {
            setOfflineReady(false)
            setNeedRefresh(false)
          }}
        >
          Dismiss
        </button>
      </div>
    </aside>
  )
}
