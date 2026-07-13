// Sends daily / weekly email digests of recent notifications via Resend. Respects the
// per-user channel_email flag and email_digest_frequency, and uses last_digest_at so a
// weekly digest only goes out once every 7 days. Safe to run daily from cron.
//
// Deploy:  supabase functions deploy email-digest --no-verify-jwt
// Secrets: RESEND_API_KEY, DIGEST_FROM (e.g. "Budgetly <alerts@yourdomain.com>")
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
const APP_URL = 'https://budgetly.netlify.app'

const dueForDigest = (prefs: any, now: Date) => {
  if (prefs.email_digest_frequency === 'off') return false
  const last = prefs.last_digest_at ? new Date(prefs.last_digest_at).getTime() : 0
  const gap = prefs.email_digest_frequency === 'daily' ? 20 * 3600000 : 6.5 * 24 * 3600000
  return now.getTime() - last >= gap
}

const sectionLabel: Record<string, string> = { action_needed: 'Needs attention', upcoming: 'Upcoming', insights: 'Insights', system: 'Updates' }

const buildHtml = (name: string, groups: Record<string, any[]>) => {
  const blocks = Object.entries(groups).filter(([, items]) => items.length).map(([section, items]) => `
    <h3 style="margin:20px 0 8px;font:600 14px system-ui;color:#334155;text-transform:uppercase;letter-spacing:.4px">${sectionLabel[section] ?? section}</h3>
    ${items.map((n) => `
      <div style="padding:12px 14px;margin:6px 0;border:1px solid #e2e8f0;border-radius:12px;background:#fff">
        <div style="font:600 15px system-ui;color:#0f172a">${n.title}</div>
        <div style="font:400 13px system-ui;color:#475569;margin-top:2px">${n.message}</div>
      </div>`).join('')}`).join('')
  return `<div style="max-width:560px;margin:0 auto;padding:24px;background:#f8fafc;font-family:system-ui">
    <h1 style="font:700 22px system-ui;color:#0f172a;margin:0 0 4px">Your Budgetly digest</h1>
    <p style="font:400 14px system-ui;color:#64748b;margin:0 0 8px">Hi ${name}, here's what's happening with your money.</p>
    ${blocks || '<p style="color:#64748b">No new alerts. You\'re all caught up 🎉</p>'}
    <a href="${APP_URL}" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2563eb;color:#fff;border-radius:10px;font:600 14px system-ui;text-decoration:none">Open Budgetly</a>
    <p style="font:400 12px system-ui;color:#94a3b8;margin-top:20px">Manage email preferences in Settings › Notifications.</p>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('DIGEST_FROM') || 'Budgetly <onboarding@resend.dev>'
  if (!resendKey) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })

  const now = new Date()
  const { data: prefsRows } = await db.from('notification_preferences').select('*').eq('channel_email', true).neq('email_digest_frequency', 'off')
  let sent = 0

  for (const prefs of (prefsRows ?? [])) {
    if (!dueForDigest(prefs, now)) continue
    const since = prefs.last_digest_at ?? new Date(now.getTime() - 7 * 24 * 3600000).toISOString()
    const { data: notifs } = await db.from('notifications').select('*').eq('user_id', prefs.user_id).is('archived_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(40)
    if (!notifs?.length) { await db.from('notification_preferences').update({ last_digest_at: now.toISOString() }).eq('user_id', prefs.user_id); continue }

    const { data: userRes } = await db.auth.admin.getUserById(prefs.user_id)
    const email = userRes?.user?.email
    if (!email) continue
    const name = (userRes?.user?.user_metadata?.first_name as string) || email.split('@')[0]

    const groups: Record<string, any[]> = { action_needed: [], upcoming: [], insights: [], system: [] }
    for (const n of notifs) (groups[n.section] ??= []).push(n)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: email, subject: `Budgetly: ${notifs.length} update${notifs.length === 1 ? '' : 's'} for you`, html: buildHtml(name, groups) }),
    })
    if (res.ok) {
      sent += 1
      const ids = notifs.map((n: any) => n.id)
      await db.from('notifications').update({ emailed_at: now.toISOString() }).in('id', ids)
      await db.from('notification_preferences').update({ last_digest_at: now.toISOString() }).eq('user_id', prefs.user_id)
    } else {
      console.error('resend failed', res.status, await res.text())
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
