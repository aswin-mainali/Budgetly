// Full-account backup generation for the authenticated user.
//
// Reads every user-owned data domain (RLS-scoped), builds a canonical bundle
// with a SHA-256 manifest checksum, stores a .zip in the user's private
// storage folder + records history, and returns the bundle to the client. The
// client turns the bundle into a downloadable .zip (optionally AES-encrypted
// with a user password) via zip.js — password protection stays client-side so
// the plaintext password never touches the server.
//
// Deploy: supabase functions deploy data-backup   (verify_jwt = true)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildBundle, storeBundle } from '../_shared/backup.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Per-user rate limits on manual generation to prevent abuse.
const MIN_GAP_MS = 15_000     // at least 15s between manual backups
const HOURLY_LIMIT = 30       // at most 30 manual backups per rolling hour

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // User-scoped client: identifies the caller and enforces RLS on every read.
  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: auth, error: authError } = await user.auth.getUser()
  if (authError || !auth?.user) return json({ error: 'unauthorized' }, 401)
  const userId = auth.user.id

  const service = createClient(url, serviceKey)

  let body: { store?: boolean; kind?: 'manual' | 'snapshot'; note?: string } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const kind = body.kind === 'snapshot' ? 'snapshot' : 'manual'
  const store = body.store !== false

  // Rate limit (manual only; snapshots are system-initiated during restore).
  if (kind === 'manual') {
    const sinceHour = new Date(Date.now() - 3_600_000).toISOString()
    const { data: recent } = await service
      .from('backup_history')
      .select('created_at')
      .eq('user_id', userId)
      .eq('kind', 'manual')
      .gte('created_at', sinceHour)
      .order('created_at', { ascending: false })
    if (recent && recent.length >= HOURLY_LIMIT) {
      return json({ error: 'rate_limited', message: 'Too many backups this hour. Please try again later.' }, 429)
    }
    if (recent && recent.length > 0) {
      const last = new Date(recent[0].created_at).getTime()
      const wait = MIN_GAP_MS - (Date.now() - last)
      if (wait > 0) {
        return json({ error: 'rate_limited', message: `Please wait ${Math.ceil(wait / 1000)}s before generating another backup.`, retryAfterMs: wait }, 429)
      }
    }
  }

  try {
    const bundle = await buildBundle(user, userId)

    let stored: { historyId: string; storagePath: string; sizeBytes: number } | null = null
    if (store) {
      stored = await storeBundle(service, userId, bundle, kind, body.note)
      const stamp = new Date().toISOString()
      await service.from('backup_settings').upsert(
        { user_id: userId, last_manual_backup_at: stamp, updated_at: stamp },
        { onConflict: 'user_id' },
      )
    }

    return json({
      ok: true,
      bundle,
      manifest: bundle.manifest,
      historyId: stored?.historyId ?? null,
      storagePath: stored?.storagePath ?? null,
      sizeBytes: stored?.sizeBytes ?? null,
    })
  } catch (e) {
    console.error('data-backup failed', e)
    return json({ error: 'backup_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
