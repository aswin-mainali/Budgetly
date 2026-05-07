import { useEffect, useState } from 'react'

export function PwaUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ waiting: ServiceWorker }>).detail
      if (detail?.waiting) setWaiting(detail.waiting)
    }
    window.addEventListener('budgetly:sw-update', onUpdate as EventListener)
    return () => window.removeEventListener('budgetly:sw-update', onUpdate as EventListener)
  }, [])

  if (!waiting) return null

  return (
    <div className="pwaBanner">
      <span>A new version of Budgetly is ready.</span>
      <div className="pwaActions">
        <button className="btn" onClick={() => { waiting.postMessage({ type: 'SKIP_WAITING' }); window.location.reload() }}>Refresh</button>
      </div>
    </div>
  )
}
