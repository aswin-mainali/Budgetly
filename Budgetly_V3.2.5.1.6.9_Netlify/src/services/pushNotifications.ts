import { supabase } from '../lib/supabase'

// Public VAPID key (safe to ship to the browser). Set VITE_VAPID_PUBLIC_KEY in your
// environment; the matching private key lives only in the Edge Function secrets.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export const getPushPermission = (): NotificationPermission =>
  pushSupported() ? Notification.permission : 'denied'

const getRegistration = async () => {
  if (!pushSupported()) return null
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
}

export const isPushEnabled = async () => {
  const reg = await getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return Boolean(sub)
}

// Ask for permission, subscribe via VAPID, and persist the subscription server-side.
export const enablePush = async (userId: string): Promise<{ ok: boolean; reason?: string }> => {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'missing_vapid_key' }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }
  const reg = await getRegistration()
  if (!reg) return { ok: false, reason: 'no_service_worker' }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
  }
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    user_agent: navigator.userAgent,
    last_used_at: new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint' })
  if (error) return { ok: false, reason: 'save_failed' }
  await supabase.from('notification_preferences').upsert({ user_id: userId, channel_push: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  return { ok: true }
}

export const disablePush = async (userId: string) => {
  const reg = await getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', sub.endpoint)
    await sub.unsubscribe().catch(() => undefined)
  }
  await supabase.from('notification_preferences').upsert({ user_id: userId, channel_push: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}
