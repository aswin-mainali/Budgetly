// Scheduled notification generation. Runs server-side so alerts exist even when the
// app is closed. Invoke via pg_cron (see add_notifications_advanced.sql) or the
// Supabase dashboard scheduler. After generating, it kicks the send-push function.
//
// Deploy:  supabase functions deploy generate-notifications --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are injected automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateForUser } from '../_shared/generators.ts'
import { guardServiceRequest } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const denied = guardServiceRequest(req, cors)
  if (denied) return denied
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, serviceKey)

  // Optional single-user run: POST { "user_id": "..." }
  let onlyUser: string | null = null
  try { const body = await req.json(); onlyUser = body?.user_id ?? null } catch { /* no body */ }

  let query = db.from('notification_preferences').select('*')
  if (onlyUser) query = query.eq('user_id', onlyUser)
  const { data: prefsRows, error } = await query
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })

  let processed = 0
  for (const prefs of (prefsRows ?? [])) {
    try { await generateForUser(db, prefs.user_id, prefs); processed += 1 }
    catch (e) { console.error('generateForUser failed', prefs.user_id, e) }
  }

  // Fan out to push delivery (best-effort).
  try {
    await fetch(`${url.replace('.supabase.co', '.functions.supabase.co')}/send-push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` }, body: '{}',
    })
  } catch (e) { console.error('send-push trigger failed', e) }

  return new Response(JSON.stringify({ ok: true, processed }), { headers: { ...cors, 'Content-Type': 'application/json' } })
})
