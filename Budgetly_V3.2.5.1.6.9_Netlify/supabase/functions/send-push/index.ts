// Delivers undelivered notifications as Web Push, respecting each user's channel
// preference, quiet hours, and minimum-priority threshold. Marks rows pushed_at so
// they are never delivered twice. Prunes dead subscriptions (410/404).
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@app.com)
//          (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY injected automatically)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { guardServiceRequest } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret' }
const PRIORITY_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, critical: 3 }

const hourInZone = (tz: string, at = new Date()) => {
  try { return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(at)) % 24 }
  catch { return at.getUTCHours() }
}
const inQuietHours = (prefs: any) => {
  if (!prefs.quiet_hours_enabled) return false
  const h = hourInZone(prefs.timezone || 'UTC')
  const s = prefs.quiet_hours_start ?? 22, e = prefs.quiet_hours_end ?? 7
  return s <= e ? h >= s && h < e : h >= s || h < e
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const denied = guardServiceRequest(req, cors)
  if (denied) return denied
  const url = Deno.env.get('SUPABASE_URL')!
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:notifications@budgetly.app'
  if (!vapidPublic || !vapidPrivate) return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  // Users who opted into push.
  const { data: prefsRows } = await db.from('notification_preferences').select('*').eq('channel_push', true)
  let sent = 0, pruned = 0
  const targetFor = (t?: string | null) => t?.startsWith('utilities/') ? `/?view=${t}` : t ? `/?view=${t}` : '/'

  for (const prefs of (prefsRows ?? [])) {
    if (inQuietHours(prefs)) continue
    const minRank = PRIORITY_RANK[prefs.min_priority || 'low'] ?? 0

    const { data: notifs } = await db.from('notifications').select('*').eq('user_id', prefs.user_id).eq('status', 'unread').is('pushed_at', null).is('archived_at', null).order('created_at', { ascending: false }).limit(10)
    const deliverable = (notifs ?? []).filter((n: any) => (PRIORITY_RANK[n.priority] ?? 1) >= minRank)
    if (!deliverable.length) continue

    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', prefs.user_id)
    if (!subs?.length) continue

    for (const n of deliverable) {
      const payload = JSON.stringify({ title: n.title, body: n.message, tag: n.group_key || n.type, url: targetFor(n.action_target), category: n.category, priority: n.priority })
      for (const sub of subs) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          sent += 1
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from('push_subscriptions').delete().eq('id', sub.id); pruned += 1 }
          else console.error('push send failed', e?.statusCode, e?.body)
        }
      }
      await db.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', n.id)
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, pruned }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
