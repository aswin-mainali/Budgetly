import { useCallback, useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(() => isStandalone())

  useEffect(() => {
    const syncInstalledState = () => {
      if (isStandalone()) setInstalled(true)
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }

    const onInstalled = () => {
      setPromptEvent(null)
      setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('focus', syncInstalledState)
    document.addEventListener('visibilitychange', syncInstalledState)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('focus', syncInstalledState)
      document.removeEventListener('visibilitychange', syncInstalledState)
    }
  }, [])

  useEffect(() => {
    if (isStandalone()) setInstalled(true)
  })

  const canInstall = useMemo(() => !installed && !!promptEvent, [installed, promptEvent])
  const showInstallButton = useMemo(() => !installed, [installed])

  const install = useCallback(async () => {
    if (!promptEvent) return false
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
      setPromptEvent(null)
      return true
    }
    return false
  }, [promptEvent])

  return { canInstall, showInstallButton, install, installed }
}
