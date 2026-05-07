import { usePwaInstall } from '../../hooks/usePwaInstall'

export function PwaInstallPrompt() {
  const { canInstall, dismiss, install } = usePwaInstall()
  if (!canInstall) return null

  return (
    <div className="pwaBanner">
      <span>Install Budgetly for faster access and an app-like experience.</span>
      <div className="pwaActions">
        <button className="btn" onClick={() => void install()}>Install Budgetly</button>
        <button className="btn ghost" onClick={dismiss} aria-label="Dismiss install prompt">Dismiss</button>
      </div>
    </div>
  )
}
