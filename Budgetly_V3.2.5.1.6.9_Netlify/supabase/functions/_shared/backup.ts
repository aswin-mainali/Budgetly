// Shared backup engine used by the data-backup, data-restore (safety snapshot)
// and auto-backup edge functions.
//
// A "bundle" is the canonical, storage-agnostic representation of a user's
// backup: one array of rows per data domain, plus a manifest and a README.
// The manifest carries a SHA-256 checksum computed over the canonical
// serialization of the domains, so any tampering or corruption is detectable
// before a restore is ever attempted.
import { zipSync, strToU8 } from 'https://esm.sh/fflate@0.8.2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Bump when the on-disk backup shape changes in a way older/newer app builds
// can't read. Restore refuses bundles whose backupVersion !== this.
export const BACKUP_VERSION = 1
export const APP_VERSION = '3.2.5.1.6.9'
export const BACKUP_BUCKET = 'user-backups'

// Every user-owned data domain included in a backup, ordered parents -> children
// so the restore RPC can insert them in a foreign-key-safe sequence. Auth
// tokens, passkeys, push endpoints, sessions, admin/audit and shared-space
// tables are deliberately excluded — a backup is the user's own records only.
export const DOMAINS = [
  'categories', 'goals', 'investment_accounts', 'debts',
  'transactions', 'recurring_items', 'goal_contributions', 'investment_holdings',
  'investment_value_snapshots', 'net_worth_items', 'net_worth_snapshots',
  'debt_payments', 'debt_settings', 'safe_to_spend_settings',
  'notifications', 'notification_preferences', 'notification_mutes', 'user_account_profiles',
] as const
export type Domain = typeof DOMAINS[number]

// Human-friendly labels for the manifest / UI.
export const DOMAIN_LABELS: Record<string, string> = {
  categories: 'Categories & budgets',
  goals: 'Savings goals',
  investment_accounts: 'Investment accounts',
  debts: 'Debts',
  transactions: 'Transactions',
  recurring_items: 'Recurring items',
  goal_contributions: 'Goal contributions',
  investment_holdings: 'Investment holdings',
  investment_value_snapshots: 'Investment value history',
  net_worth_items: 'Net-worth items',
  net_worth_snapshots: 'Net-worth history',
  debt_payments: 'Debt payments',
  debt_settings: 'Debt strategy settings',
  safe_to_spend_settings: 'Safe-to-spend settings',
  notifications: 'Notifications',
  notification_preferences: 'Notification preferences',
  notification_mutes: 'Notification mutes',
  user_account_profiles: 'Profile & preferences',
}

// How many stored backups to retain per kind, per user.
export const RETENTION: Record<string, number> = { manual: 8, auto: 8, snapshot: 5 }

export type Domains = Record<string, Record<string, unknown>[]>

export interface Manifest {
  backupVersion: number
  appVersion: string
  createdAt: string
  userId: string
  recordCount: number
  counts: Record<string, number>
  domains: string[]
  checksum: string
}

export interface Bundle {
  domains: Domains
  manifest: Manifest
  readme: string
}

// ---------------------------------------------------------------------------
// Deterministic serialization + checksum. MUST stay byte-for-byte identical to
// the client implementation in src/services/backupService.ts, otherwise a
// backup generated here would fail client-side checksum verification.
// ---------------------------------------------------------------------------
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}'
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function checksumOf(domains: Domains): Promise<string> {
  return sha256Hex(canonicalJSON(domains))
}

// ---------------------------------------------------------------------------
// Gather every domain for a user. `db` should be a client scoped to the user
// (RLS enforces they only ever read their own rows) OR the service role client
// filtered explicitly by user_id.
// ---------------------------------------------------------------------------
export async function gatherDomains(db: SupabaseClient, userId: string): Promise<Domains> {
  const entries = await Promise.all(
    DOMAINS.map(async (table) => {
      const { data, error } = await db.from(table).select('*').eq('user_id', userId)
      if (error) throw new Error(`Failed to read ${table}: ${error.message}`)
      return [table, (data ?? []) as Record<string, unknown>[]] as const
    }),
  )
  const domains: Domains = {}
  for (const [table, rows] of entries) domains[table] = rows
  return domains
}

export function buildReadme(manifest: Manifest): string {
  const lines = [
    'Budgetly — Full Data Backup',
    '===========================',
    '',
    `Created:        ${manifest.createdAt}`,
    `App version:    ${manifest.appVersion}`,
    `Backup version: ${manifest.backupVersion}`,
    `Total records:  ${manifest.recordCount}`,
    '',
    'What is this file?',
    '------------------',
    'This .zip is a complete, restorable snapshot of your Budgetly account data.',
    'It contains one JSON file per data domain (transactions.json, categories.json,',
    'goals.json, and so on), a manifest.json describing the contents, and this',
    'README. It does NOT contain your password, login tokens, or any other',
    'security credentials — only your own financial records.',
    '',
    'Contents',
    '--------',
    ...manifest.domains.map((d) => `  ${(DOMAIN_LABELS[d] ?? d).padEnd(26)} ${manifest.counts[d] ?? 0} records  (${d}.json)`),
    '',
    'How do I restore it?',
    '--------------------',
    '1. Open Budgetly and go to Settings -> Data & backup.',
    '2. In the "Restore from backup" panel, drag this .zip file onto the upload',
    '   zone (or click to choose it). If you protected it with a password, you',
    '   will be asked for it.',
    '3. Budgetly validates the file (manifest + checksum) and shows a preview of',
    '   exactly what will change.',
    '4. Choose "Merge" (add only missing records) or "Replace everything", then',
    '   press Restore. A safety snapshot of your current data is taken first, so',
    '   the restore can be undone.',
    '',
    'The manifest.json checksum protects this backup from corruption and',
    'tampering: if a single byte of data changes, Budgetly will refuse to restore',
    'it rather than importing something broken.',
    '',
    'Keep this file somewhere safe. Anyone who can open it can read your financial',
    'data, so consider using the optional password protection when you download.',
  ]
  return lines.join('\n')
}

export async function buildBundle(db: SupabaseClient, userId: string): Promise<Bundle> {
  const domains = await gatherDomains(db, userId)
  const counts: Record<string, number> = {}
  let recordCount = 0
  for (const d of DOMAINS) {
    const n = domains[d]?.length ?? 0
    counts[d] = n
    recordCount += n
  }
  const checksum = await checksumOf(domains)
  const manifest: Manifest = {
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    userId,
    recordCount,
    counts,
    domains: [...DOMAINS],
    checksum,
  }
  return { domains, manifest, readme: buildReadme(manifest) }
}

// Build a real .zip (one pretty-printed JSON file per domain + manifest + README).
export function buildZipBytes(bundle: Bundle): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(bundle.manifest, null, 2)),
    'README.txt': strToU8(bundle.readme),
  }
  for (const d of DOMAINS) {
    files[`data/${d}.json`] = strToU8(JSON.stringify(bundle.domains[d] ?? [], null, 2))
  }
  return zipSync(files, { level: 6 })
}

// ---------------------------------------------------------------------------
// Store a bundle as a .zip in the user's private storage folder, record a
// backup_history row, and prune older backups of the same kind. Requires a
// service-role client (history inserts are service-only).
// ---------------------------------------------------------------------------
export async function storeBundle(
  service: SupabaseClient,
  userId: string,
  bundle: Bundle,
  kind: 'manual' | 'auto' | 'snapshot',
  note?: string,
): Promise<{ historyId: string; storagePath: string; sizeBytes: number }> {
  const zip = buildZipBytes(bundle)
  const stamp = bundle.manifest.createdAt.replace(/[:.]/g, '-')
  const historyId = crypto.randomUUID()
  const storagePath = `${userId}/${kind}-${stamp}-${historyId}.zip`

  const up = await service.storage.from(BACKUP_BUCKET).upload(storagePath, zip, {
    contentType: 'application/zip',
    upsert: true,
  })
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`)

  const ins = await service.from('backup_history').insert({
    id: historyId,
    user_id: userId,
    kind,
    storage_path: storagePath,
    record_count: bundle.manifest.recordCount,
    size_bytes: zip.byteLength,
    checksum: bundle.manifest.checksum,
    app_version: bundle.manifest.appVersion,
    backup_version: String(bundle.manifest.backupVersion),
    manifest: bundle.manifest,
    note: note ?? null,
  })
  if (ins.error) throw new Error(`History insert failed: ${ins.error.message}`)

  await pruneBackups(service, userId, kind)
  return { historyId, storagePath, sizeBytes: zip.byteLength }
}

export async function pruneBackups(
  service: SupabaseClient,
  userId: string,
  kind: 'manual' | 'auto' | 'snapshot',
): Promise<void> {
  const keep = RETENTION[kind] ?? 8
  const { data, error } = await service
    .from('backup_history')
    .select('id, storage_path')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .range(keep, 999)
  if (error || !data || data.length === 0) return

  const paths = data.map((r) => r.storage_path).filter(Boolean) as string[]
  if (paths.length) await service.storage.from(BACKUP_BUCKET).remove(paths)
  await service.from('backup_history').delete().in('id', data.map((r) => r.id))
}
