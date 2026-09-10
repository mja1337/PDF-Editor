import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function ServiceWorkerStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      registration?.update()
    },
  })

  useEffect(() => {
    const checkForUpdates = () => {
      if (document.visibilityState !== 'visible') return
      void navigator.serviceWorker?.ready.then((registration) => registration.update())
    }
    document.addEventListener('visibilitychange', checkForUpdates)
    window.addEventListener('focus', checkForUpdates)
    return () => {
      document.removeEventListener('visibilitychange', checkForUpdates)
      window.removeEventListener('focus', checkForUpdates)
    }
  }, [])

  if (!offlineReady && !needRefresh) return null

  return (
    <aside className="update-toast" aria-live="polite">
      <div>
        <strong>{offlineReady ? 'Ready offline' : 'Update available'}</strong>
        <span>
          {offlineReady
            ? 'The editor can now open without a network connection.'
            : 'A newer version is downloading. The page will reload automatically when it is ready.'}
        </span>
      </div>
      <div className="update-actions">
        {needRefresh && (
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Reload now
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
