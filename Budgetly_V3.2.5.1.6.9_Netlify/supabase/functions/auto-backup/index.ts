// Scheduled weekly automatic backups.
//
// For every user who has enabled automatic backups, generate the same bundle
// as a manual backup, store it in their private storage folder as kind='auto',
// and prune to the last 8. Runs server-side under the service role so it works
// while the app is closed.
//
// Deploy:  supabase functions deploy auto-backup --no-verify-jwt
// Schedule (pg_cron, weekly — Sundays 04:00 UTC):
//   select cron.schedule('weekly-auto-backup', '0 4 * * 0', $$
//     select net.http_post(
//       url := 'https://<ref>.functions.supabase.co/auto-backup',
//       headers := jsonb_build_object('Content-Type','application/json',
//                    'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
//       body := '{}'::jsonb) $$);
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildBundle, storeBundle } from '../_shared/backup.ts'
import { guardServiceRequest } from '../_shared/auth.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const denied = guardServiceRequest(req, cors)
  if (denied) return denied

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const service = createClient(url, serviceKey)

  // Optional single-user run for testing: POST { "user_id": "..." }
  let onlyUser: string | null = null
  try { const b = await req.json(); onlyUser = b?.user_id ?? null } catch { /* no body */ }

  let query = service.from('backup_settings').select('user_id').eq('auto_backup_enabled', true)
  if (onlyUser) query = query.eq('user_id', onlyUser)
  const { data: rows, error } = await query
  if (error) return json({ error: error.message }, 500)

  let processed = 0
  const failures: { user_id: string; error: string }[] = []
  for (const row of rows ?? []) {
    const userId = row.user_id as string
    try {
      const bundle = await buildBundle(service, userId)
      await storeBundle(service, userId, bundle, 'auto', 'Scheduled weekly backup')
      const stamp = new Date().toISOString()
      await service.from('backup_settings').update({ last_auto_backup_at: stamp }).eq('user_id', userId)
      processed += 1
    } catch (e) {
      console.error('auto-backup failed for', userId, e)
      failures.push({ user_id: userId, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return json({ ok: true, processed, failures })
})
