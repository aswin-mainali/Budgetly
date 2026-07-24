// Document Vault — forgot-PIN reset via email (Resend).
//
// Two actions, both for the authenticated caller (their own vault only):
//   • action: "request"  → generate a one-time code, store its hash + a short
//                           expiry on the caller's document_vault_security row
//                           (service role), and email the code to them.
//   • action: "verify"   → given { code, pin_hash, pin_salt }, verify the code
//                           against the stored hash + expiry and, if valid,
//                           set the new PIN hash/salt and clear the reset state.
//
// The raw PIN never reaches the server — the client sends only its salted hash.
// Verifying the emailed code server-side keeps the (short) code from being
// brute-forced against a client-readable hash.
//
// Deploy:  supabase functions deploy document-vault-pin-reset
// Secrets: RESEND_API_KEY, DIGEST_FROM (e.g. "Budgetly <alerts@yourdomain.com>")
//          (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY injected automatically)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = (req: Request): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    req.headers.get('Access-Control-Request-Headers') ?? 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
})
const jsonWith = (cors: Record<string, string>) => (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const APP_URL = 'https://budgetly.netlify.app'
const CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// SHA-256 hex of the code (same scheme the client uses for the PIN).
const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 6-digit numeric code, easy to type from an email.
const generateCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')

const buildHtml = (name: string, code: string) =>
  `<div style="max-width:520px;margin:0 auto;padding:24px;background:#f8fafc;font-family:system-ui">
    <div style="text-align:center;font:800 14px system-ui;color:#64748b;margin-bottom:12px">🔐 Budgetly · Document Vault</div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;text-align:center">
      <h1 style="font:700 22px system-ui;color:#0f172a;margin:0 0 6px">Reset your vault PIN</h1>
      <p style="font:400 14px system-ui;color:#475569;margin:0 0 18px">Hi ${esc(name)}, use this one-time code to set a new PIN for your Document Vault. It expires in 15 minutes.</p>
      <div style="display:inline-block;padding:14px 26px;border-radius:12px;background:#eef2ff;color:#4338ca;font:800 30px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:8px">${esc(code)}</div>
      <p style="font:400 13px system-ui;color:#94a3b8;margin:20px 0 0">If you didn't request this, you can safely ignore this email — your PIN stays unchanged.</p>
      <a href="${APP_URL}" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#2563eb;color:#fff;border-radius:10px;font:600 14px system-ui;text-decoration:none">Open Budgetly</a>
    </div>
  </div>`

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
  const json = jsonWith(cors)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('DIGEST_FROM') || 'Budgetly <onboarding@resend.dev>'

  // Verify the caller is authenticated; the reset only ever touches their row.
  const authHeader = req.headers.get('Authorization') || ''
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userRes } = await caller.auth.getUser()
  const user = userRes?.user
  if (!user) return json({ error: 'Unauthorized' }, 401)

  let body: { action?: string; code?: string; pin_hash?: string; pin_salt?: string; pin_length?: number } = {}
  try { body = await req.json() } catch { /* empty body */ }

  const db = createClient(url, serviceKey)

  // ── Request a reset code ───────────────────────────────────────────────────
  if (body.action === 'request') {
    if (!resendKey) return json({ error: 'RESEND_API_KEY not configured' }, 500)
    const email = user.email
    if (!email) return json({ error: 'No email on account' }, 400)

    const code = generateCode()
    const codeHash = await sha256Hex(code)
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString()

    const { error: upErr } = await db
      .from('document_vault_security')
      .upsert(
        { user_id: user.id, reset_code_hash: codeHash, reset_expires_at: expires, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (upErr) {
      console.error('pin-reset request upsert failed', upErr)
      return json({ error: 'Could not start reset' }, 500)
    }

    // Greet by first name where we have it (matches bug-status-email behaviour).
    const { data: accountProfile } = await db
      .from('user_account_profiles')
      .select('first_name')
      .eq('user_id', user.id)
      .maybeSingle()
    let name = (accountProfile?.first_name || '').trim()
    if (!name) name = ((user.user_metadata?.first_name as string) || '').trim() || email.split('@')[0]

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: email,
        subject: 'Budgetly · Your Document Vault PIN reset code',
        html: buildHtml(name, code),
      }),
    })
    if (!res.ok) {
      const detail = await res.text()
      console.error('resend failed', res.status, detail)
      return json({ error: 'Email send failed' }, 502)
    }
    // Return the (masked) destination so the UI can tell the user where to look.
    const [local, domain] = email.split('@')
    const maskedLocal = local.length <= 2 ? `${local[0] ?? ''}*` : `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}`
    return json({ ok: true, sent: true, email_hint: `${maskedLocal}@${domain}` })
  }

  // ── Verify a code + set the new PIN ────────────────────────────────────────
  if (body.action === 'verify') {
    const code = String(body.code || '').trim()
    const pinHash = String(body.pin_hash || '').trim()
    const pinSalt = String(body.pin_salt || '').trim()
    const pinLength = Number(body.pin_length)
    if (!/^\d{6}$/.test(code)) return json({ error: 'invalid_code', message: 'Enter the 6-digit code from your email.' }, 400)
    if (!/^[a-f0-9]{64}$/i.test(pinHash) || !pinSalt) return json({ error: 'invalid_pin' }, 400)

    const { data: row } = await db
      .from('document_vault_security')
      .select('reset_code_hash, reset_expires_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!row?.reset_code_hash || !row.reset_expires_at) {
      return json({ error: 'no_reset', message: 'No reset is in progress. Request a new code.' }, 400)
    }
    if (new Date(row.reset_expires_at).getTime() < Date.now()) {
      return json({ error: 'expired', message: 'That code has expired. Request a new one.' }, 400)
    }
    const codeHash = await sha256Hex(code)
    if (codeHash !== row.reset_code_hash) {
      return json({ error: 'mismatch', message: 'That code is incorrect. Check the email and try again.' }, 400)
    }

    const updatePayload: Record<string, unknown> = {
      pin_hash: pinHash,
      pin_salt: pinSalt,
      failed_attempts: 0,
      locked_until: null,
      reset_code_hash: null,
      reset_expires_at: null,
      updated_at: new Date().toISOString(),
    }
    if (Number.isInteger(pinLength) && pinLength >= 4 && pinLength <= 6) updatePayload.pin_length = pinLength

    let { error: setErr } = await db.from('document_vault_security').update(updatePayload).eq('user_id', user.id)
    // Gracefully handle databases where the pin_length column hasn't been added yet.
    if (setErr && /pin_length/.test(setErr.message || '')) {
      delete updatePayload.pin_length
      ;({ error: setErr } = await db.from('document_vault_security').update(updatePayload).eq('user_id', user.id))
    }
    if (setErr) {
      console.error('pin-reset verify update failed', setErr)
      return json({ error: 'Could not set new PIN' }, 500)
    }
    return json({ ok: true, reset: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
