import { useOnlineStatus } from '../../hooks/useOnlineStatus'

export function OfflineStatusBanner() {
  const isOnline = useOnlineStatus()
  if (isOnline) return null
  return <div className="pwaBanner offline">You&apos;re offline. Some live data may be unavailable.</div>
}
