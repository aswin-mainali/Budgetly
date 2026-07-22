// Restore-from-backup for the authenticated user.
//
// Two actions:
//   action: 'preview' -> validate the bundle (manifest well-formed, checksum
//                        matches, version compatible, referential integrity)
//                        and return a diff of what Merge / Replace would do.
//                        NOTHING is written.
//   action: 'apply'   -> re-validate, take a server-side safety snapshot of the
//                        user's CURRENT data, then run the transactional
//                        restore_user_backup() RPC. Returns a change summary.
//
// Deploy: supabase functions deploy data-restore   (verify_jwt = true)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  BACKUP_VERSION, DOMAINS, DOMAIN_LABELS, buildBundle, storeBundle, checksumOf,
  type Domains, type Manifest,
} from '../_shared/backup.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Tables keyed by user_id (one row per user) rather than by a surrogate id.
const USER_KEYED = new Set(['debt_settings', 'user_account_profiles'])
const keyField = (table: string) => (USER_KEYED.has(table) ? 'user_id' : 'id')

// Foreign keys we validate before restore so we can surface a specific error
// instead of letting the transaction blow up mid-way (it would still roll back,
// but a vague DB error is a poor experience).
const FKS: { table: string; col: string; parent: string }[] = [
  { table: 'transactions', col: 'category_id', parent: 'categories' },
  { table: 'recurring_items', col: 'category_id', parent: 'categories' },
  { table: 'goal_contributions', col: 'goal_id', parent: 'goals' },
  { table: 'investment_holdings', col: 'account_id', parent: 'investment_accounts' },
  { table: 'debt_payments', col: 'debt_id', parent: 'debts' },
  { table: 'debt_payments', col: 'linked_transaction_id', parent: 'transactions' },
]

type ValidationError = { code: string; message: string }

async function validateBundle(domains: Domains, manifest: Manifest): Promise<ValidationError[]> {
  const errors: ValidationError[] = []
  if (!manifest || typeof manifest !== 'object') {
    return [{ code: 'no_manifest', message: 'The backup is missing a manifest and cannot be restored.' }]
  }
  if (typeof manifest.backupVersion !== 'number' || !manifest.checksum || typeof manifest.counts !== 'object') {
    errors.push({ code: 'bad_manifest', message: 'The manifest is malformed (missing version, checksum, or counts).' })
  }
  if (manifest.backupVersion !== BACKUP_VERSION) {
    errors.push({
      code: 'incompatible_version',
      message: `This backup is from an incompatible version (backup v${manifest.backupVersion}, this app expects v${BACKUP_VERSION}). Restore has been blocked to protect your data.`,
    })
  }
  if (!domains || typeof domains !== 'object') {
    errors.push({ code: 'no_data', message: 'The backup contains no data files.' })
    return errors
  }
  // Re-derive the checksum from the supplied data; reject on any mismatch.
  if (manifest.checksum) {
    const actual = await checksumOf(pickDomains(domains))
    if (actual !== manifest.checksum) {
      errors.push({
        code: 'checksum_mismatch',
        message: 'Checksum verification failed — this backup is corrupted or has been tampered with. Restore has been blocked.',
      })
    }
  }
  return errors
}

// Only the known domains participate in the checksum, in the canonical set.
function pickDomains(domains: Domains): Domains {
  const out: Domains = {}
  for (const d of DOMAINS) out[d] = Array.isArray(domains[d]) ? domains[d] : []
  return out
}

async function currentKeySets(db: SupabaseClient, userId: string): Promise<Record<string, Set<string>>> {
  const entries = await Promise.all(
    DOMAINS.map(async (table) => {
      const kf = keyField(table)
      const { data, error } = await db.from(table).select(kf).eq('user_id', userId)
      if (error) throw new Error(`Failed to read ${table}: ${error.message}`)
      const set = new Set<string>()
      for (const row of data ?? []) set.add(String((row as Record<string, unknown>)[kf]))
      return [table, set] as const
    }),
  )
  const out: Record<string, Set<string>> = {}
  for (const [t, s] of entries) out[t] = s
  return out
}

function backupKeySet(domains: Domains, table: string): Set<string> {
  const kf = keyField(table)
  const set = new Set<string>()
  for (const row of domains[table] ?? []) {
    const v = (row as Record<string, unknown>)[kf]
    if (v != null) set.add(String(v))
  }
  return set
}

function referentialErrors(domains: Domains, mode: 'merge' | 'replace', current: Record<string, Set<string>>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const fk of FKS) {
    const rows = domains[fk.table] ?? []
    if (rows.length === 0) continue
    const allowed = backupKeySet(domains, fk.parent)
    if (mode === 'merge') for (const k of current[fk.parent] ?? []) allowed.add(k)
    let missing = 0
    const sample: string[] = []
    for (const row of rows) {
      const ref = (row as Record<string, unknown>)[fk.col]
      if (ref == null) continue
      if (!allowed.has(String(ref))) {
        missing += 1
        if (sample.length < 3) sample.push(String(ref))
      }
    }
    if (missing > 0) {
      const pl = DOMAIN_LABELS[fk.table] ?? fk.table
      const pp = DOMAIN_LABELS[fk.parent] ?? fk.parent
      errors.push({
        code: 'referential_integrity',
        message: `${missing} ${pl} record(s) reference a ${pp} that is not present (${fk.col}: ${sample.join(', ')}${missing > 3 ? '…' : ''}). Restore blocked to avoid a broken import.`,
      })
    }
  }
  return errors
}

function buildDiff(domains: Domains, current: Record<string, Set<string>>) {
  const perDomain: Record<string, {
    label: string; backup: number; current: number
    merge: { add: number; keep: number }
    replace: { add: number; overwrite: number; remove: number }
  }> = {}
  const totals = {
    merge: { add: 0 },
    replace: { add: 0, overwrite: 0, remove: 0 },
  }
  for (const table of DOMAINS) {
    const backupSet = backupKeySet(domains, table)
    const curSet = current[table] ?? new Set<string>()
    let addNew = 0, overlap = 0
    for (const k of backupSet) (curSet.has(k) ? overlap++ : addNew++)
    const remove = curSet.size - overlap
    perDomain[table] = {
      label: DOMAIN_LABELS[table] ?? table,
      backup: backupSet.size,
      current: curSet.size,
      merge: { add: addNew, keep: curSet.size },
      replace: { add: addNew, overwrite: overlap, remove },
    }
    totals.merge.add += addNew
    totals.replace.add += addNew
    totals.replace.overwrite += overlap
    totals.replace.remove += remove
  }
  return { perDomain, totals }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const user = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: auth, error: authError } = await user.auth.getUser()
  if (authError || !auth?.user) return json({ error: 'unauthorized' }, 401)
  const userId = auth.user.id

  let body: { action?: string; domains?: Domains; manifest?: Manifest; mode?: 'merge' | 'replace' } = {}
  try { body = await req.json() } catch { return json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400) }

  const action = body.action === 'apply' ? 'apply' : 'preview'
  const mode: 'merge' | 'replace' = body.mode === 'replace' ? 'replace' : 'merge'
  const domains = pickDomains(body.domains ?? {})
  const manifest = body.manifest as Manifest

  try {
    // 1) Structural + integrity validation (both actions).
    const errors = await validateBundle(domains, manifest)
    if (errors.length) return json({ ok: false, valid: false, errors }, 422)

    const current = await currentKeySets(user, userId)
    const refErrors = referentialErrors(domains, mode, current)
    if (refErrors.length && action === 'apply') {
      return json({ ok: false, valid: false, errors: refErrors }, 422)
    }

    const diff = buildDiff(domains, current)

    if (action === 'preview') {
      return json({
        ok: true,
        valid: refErrors.length === 0,
        warnings: refErrors,
        manifest,
        diff,
      })
    }

    // 2) Apply: safety snapshot of CURRENT data, then transactional restore.
    const service = createClient(url, serviceKey)
    let snapshot: { historyId: string; storagePath: string } | null = null
    try {
      const snapBundle = await buildBundle(user, userId)
      const s = await storeBundle(service, userId, snapBundle, 'snapshot', `Safety snapshot before ${mode} restore`)
      snapshot = { historyId: s.historyId, storagePath: s.storagePath }
    } catch (e) {
      console.error('safety snapshot failed', e)
      return json({ error: 'snapshot_failed', message: 'Could not create a safety snapshot; restore aborted. Your data is unchanged.' }, 500)
    }

    const { data: rpc, error: rpcError } = await user.rpc('restore_user_backup', { p: domains, p_mode: mode })
    if (rpcError) {
      return json({ error: 'restore_failed', message: rpcError.message, snapshot }, 500)
    }

    return json({ ok: true, mode, result: rpc, diff, snapshot })
  } catch (e) {
    console.error('data-restore failed', e)
    return json({ error: 'restore_error', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
