// Emails the reporter when a bug report changes status (e.g. "resolved"), via Resend.
// Called from the admin panel after a status update. The caller's JWT is verified to
// be a super admin, then a service-role client loads the report + reporter email and
// sends the mail. Respects the report's contact_when_resolved flag.
//
// Deploy:  supabase functions deploy bug-status-email
// Secrets: RESEND_API_KEY, DIGEST_FROM (e.g. "Budgetly <alerts@yourdomain.com>")
//          (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY injected automatically)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const APP_URL = 'https://budgetly.netlify.app'

const STATUS_COPY: Record<string, { subject: string; heading: string; blurb: string; accent: string }> = {
  in_progress: {
    subject: 'is now being worked on',
    heading: "We're on it 🛠️",
    blurb: 'Our team has started investigating the issue you reported. We\'ll let you know as soon as there\'s an update.',
    accent: '#f59e0b',
  },
  in_review: {
    subject: 'is in review',
    heading: 'Almost there 🔍',
    blurb: 'A fix for your report is being reviewed and verified. You\'re close to the finish line.',
    accent: '#6366f1',
  },
  resolved: {
    subject: 'has been resolved',
    heading: 'Fixed! 🎉',
    blurb: 'Good news — the issue you reported has been resolved. Thanks for helping us make Budgetly better.',
    accent: '#22c55e',
  },
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const buildHtml = (name: string, ref: string, title: string, status: string, note: string | null) => {
  const copy = STATUS_COPY[status] ?? STATUS_COPY.resolved
  return `<div style="max-width:560px;margin:0 auto;padding:24px;background:#f8fafc;font-family:system-ui">
    <div style="text-align:center;font:800 14px system-ui;color:#64748b;margin-bottom:12px">🐞 Budgetly</div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px">
      <div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${copy.accent}1a;color:${copy.accent};font:700 12px system-ui;letter-spacing:.3px;text-transform:uppercase">${esc(ref)}</div>
      <h1 style="font:700 22px system-ui;color:#0f172a;margin:14px 0 6px">${copy.heading}</h1>
      <p style="font:400 14px system-ui;color:#475569;margin:0 0 4px">Hi ${esc(name)}, your bug report <strong>"${esc(title)}"</strong> ${copy.subject}.</p>
      <p style="font:400 14px system-ui;color:#475569;margin:12px 0 0">${copy.blurb}</p>
      ${note ? `<div style="margin-top:16px;padding:12px 14px;border-left:3px solid ${copy.accent};background:#f8fafc;border-radius:8px;font:400 13px system-ui;color:#334155">${esc(note)}</div>` : ''}
      <a href="${APP_URL}" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2563eb;color:#fff;border-radius:10px;font:600 14px system-ui;text-decoration:none">Open Budgetly</a>
    </div>
    <p style="font:400 12px system-ui;color:#94a3b8;margin-top:16px;text-align:center">You're receiving this because you asked to be contacted about this report.</p>
  </div>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('DIGEST_FROM') || 'Budgetly <onboarding@resend.dev>'
  if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)

  // Verify the caller is an authenticated super admin.
  const authHeader = req.headers.get('Authorization') || ''
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userRes } = await caller.auth.getUser()
  if (!userRes?.user) return json({ error: 'Unauthorized' }, 401)
  const { data: isAdmin } = await caller.rpc('is_super_admin')
  if (!isAdmin) return json({ error: 'Forbidden' }, 403)

  let body: { report_id?: string; note?: string } = {}
  try { body = await req.json() } catch { /* empty body */ }
  if (!body.report_id) return json({ error: 'report_id is required' }, 400)

  const db = createClient(url, serviceKey)
  const { data: report, error } = await db
    .from('bug_reports')
    .select('id, user_id, user_email, title, steps_to_reproduce, reference_code, workflow_status, contact_when_resolved')
    .eq('id', body.report_id)
    .single()
  if (error || !report) return json({ error: 'Report not found' }, 404)

  // Only email if the reporter opted in, and only for meaningful states.
  if (!report.contact_when_resolved) return json({ ok: true, skipped: 'contact opt-out' })
  if (!STATUS_COPY[report.workflow_status]) return json({ ok: true, skipped: 'no email for this status' })

  const email = report.user_email
  if (!email) return json({ error: 'No email on report' }, 400)

  // Greet with the name from the app's profile settings; the auth signup metadata
  // can be stale (users can rename themselves in Settings, which only updates
  // user_account_profiles), so it is only a fallback.
  const { data: accountProfile } = await db
    .from('user_account_profiles')
    .select('first_name')
    .eq('user_id', report.user_id)
    .maybeSingle()
  let name = (accountProfile?.first_name || '').trim()
  if (!name) {
    const { data: authUser } = await db.auth.admin.getUserById(report.user_id)
    name = ((authUser?.user?.user_metadata?.first_name as string) || '').trim() || email.split('@')[0]
  }
  const title = report.title || String(report.steps_to_reproduce || 'your report').slice(0, 60)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: email,
      subject: `Budgetly · ${report.reference_code || 'Bug report'} ${report.workflow_status === 'resolved' ? 'resolved 🎉' : 'update'}`,
      html: buildHtml(name, report.reference_code || 'Bug report', title, report.workflow_status, body.note ?? null),
    }),
  })
  if (!res.ok) {
    const detail = await res.text()
    console.error('resend failed', res.status, detail)
    return json({ error: 'Email send failed', detail }, 502)
  }
  return json({ ok: true, sent: true })
})
