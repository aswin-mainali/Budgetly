// Client side of the backup & restore feature.
//
// The server (data-backup edge function) does all the data gathering, manifest
// building and checksum computation. This module:
//   * turns the returned bundle into a downloadable .zip (optionally
//     AES-256 encrypted with a user password) via zip.js,
//   * reads a backup .zip back (decrypting if needed) and verifies its checksum
//     locally before anything is sent for restore,
//   * drives the data-restore preview / apply flow,
//   * and reads backup history / settings from Supabase.
import {
  ZipWriter, ZipReader, BlobWriter, BlobReader, TextReader, TextWriter, configure,
} from '@zip.js/zip.js'
import { supabase } from '../lib/supabase'

// Run zip.js on the main thread — avoids web-worker/CSP friction in the PWA and
// the datasets here are small enough that it stays snappy.
configure({ useWebWorkers: false })

export const BACKUP_VERSION = 1

export const DOMAINS = [
  'categories', 'goals', 'investment_accounts', 'debts',
  'transactions', 'recurring_items', 'goal_contributions', 'investment_holdings',
  'investment_value_snapshots', 'net_worth_items', 'net_worth_snapshots',
  'debt_payments', 'debt_settings', 'safe_to_spend_settings',
  'notifications', 'notification_preferences', 'notification_mutes', 'user_account_profiles',
] as const
export type Domain = typeof DOMAINS[number]

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

export interface BackupHistoryRow {
  id: string
  kind: 'manual' | 'auto' | 'snapshot'
  storage_path: string | null
  record_count: number
  size_bytes: number
  checksum: string | null
  app_version: string | null
  created_at: string
  note: string | null
}

export interface BackupSettings {
  auto_backup_enabled: boolean
  last_manual_backup_at: string | null
  last_auto_backup_at: string | null
}

export interface DomainDiff {
  label: string
  backup: number
  current: number
  merge: { add: number; keep: number }
  replace: { add: number; overwrite: number; remove: number }
}
export interface RestoreDiff {
  perDomain: Record<string, DomainDiff>
  totals: { merge: { add: number }; replace: { add: number; overwrite: number; remove: number } }
}

export class PasswordRequiredError extends Error {
  constructor() { super('This backup is password protected. Enter the password to continue.') }
}
export class ChecksumError extends Error {
  constructor() { super('Checksum verification failed — this file is corrupted or has been tampered with.') }
}

// ---------------------------------------------------------------------------
// Deterministic serialization + checksum. MUST match the server implementation
// in supabase/functions/_shared/backup.ts byte-for-byte.
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

function pickDomains(domains: Domains): Domains {
  const out: Domains = {}
  for (const d of DOMAINS) out[d] = Array.isArray(domains[d]) ? domains[d] : []
  return out
}

export async function verifyChecksum(domains: Domains, manifest: Manifest): Promise<boolean> {
  const actual = await sha256Hex(canonicalJSON(pickDomains(domains)))
  return actual === manifest.checksum
}

// ---------------------------------------------------------------------------
// Edge-function helpers
// ---------------------------------------------------------------------------
async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    // Surface the server's JSON message when present.
    let message = error.message
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json()
        if (parsed?.message) message = parsed.message
        else if (parsed?.error) message = parsed.error
      }
    } catch { /* keep default */ }
    throw new Error(message || `${fn} failed`)
  }
  return data as T
}

// Ask the server to generate a backup bundle (also stores a server-side copy +
// history row). Returns the bundle so the client can build a download.
export async function requestBackupBundle(kind: 'manual' = 'manual'): Promise<Bundle> {
  const res = await invoke<{ bundle: Bundle }>('data-backup', { kind, store: true })
  return res.bundle
}

// ---------------------------------------------------------------------------
// Zip build (download) — optional AES-256 password protection
// ---------------------------------------------------------------------------
export async function bundleToZipBlob(bundle: Bundle, password?: string): Promise<Blob> {
  const opts = password ? { password, encryptionStrength: 3 as const } : {}
  const writer = new ZipWriter(new BlobWriter('application/zip'), opts)
  await writer.add('manifest.json', new TextReader(JSON.stringify(bundle.manifest, null, 2)))
  await writer.add('README.txt', new TextReader(bundle.readme))
  for (const d of DOMAINS) {
    await writer.add(`data/${d}.json`, new TextReader(JSON.stringify(bundle.domains[d] ?? [], null, 2)))
  }
  return writer.close()
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// Full manual-backup flow: generate on the server, build the (optionally
// encrypted) zip, and download it. Returns the manifest for status display.
export async function downloadManualBackup(password?: string): Promise<Manifest> {
  const bundle = await requestBackupBundle('manual')
  const blob = await bundleToZipBlob(bundle, password)
  const stamp = bundle.manifest.createdAt.slice(0, 19).replace(/[:T]/g, '-')
  const suffix = password ? '-protected' : ''
  triggerDownload(blob, `budgetly-backup-${stamp}${suffix}.zip`)
  return bundle.manifest
}

// ---------------------------------------------------------------------------
// Zip read (restore)
// ---------------------------------------------------------------------------
export async function readBackupZip(file: File | Blob, password?: string): Promise<Bundle> {
  const reader = new ZipReader(new BlobReader(file), password ? { password } : {})
  let entries
  try {
    entries = await reader.getEntries()
  } catch {
    await reader.close().catch(() => {})
    throw new Error('This file is not a valid .zip archive.')
  }

  const encrypted = entries.some((e) => e.encrypted)
  if (encrypted && !password) {
    await reader.close().catch(() => {})
    throw new PasswordRequiredError()
  }

  const readText = async (name: string): Promise<string | null> => {
    const entry = entries.find((e) => e.filename === name)
    if (!entry || !entry.getData) return null
    return entry.getData(new TextWriter())
  }

  try {
    const manifestText = await readText('manifest.json')
    if (!manifestText) throw new Error('This backup is missing its manifest.json and cannot be restored.')
    const manifest = JSON.parse(manifestText) as Manifest

    const domains: Domains = {}
    for (const d of DOMAINS) {
      const t = await readText(`data/${d}.json`)
      domains[d] = t ? (JSON.parse(t) as Record<string, unknown>[]) : []
    }
    const readme = (await readText('README.txt')) ?? ''
    return { domains, manifest, readme }
  } catch (e) {
    if (e instanceof PasswordRequiredError) throw e
    // A wrong password typically surfaces here as a decompression/parse error.
    if (encrypted) throw new Error('Could not read the backup — the password may be incorrect.')
    throw e
  } finally {
    await reader.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Restore preview / apply
// ---------------------------------------------------------------------------
export interface PreviewResult {
  ok: boolean
  valid: boolean
  warnings: { code: string; message: string }[]
  errors?: { code: string; message: string }[]
  manifest: Manifest
  diff: RestoreDiff
}

export async function previewRestore(bundle: Bundle, mode: 'merge' | 'replace'): Promise<PreviewResult> {
  return invoke<PreviewResult>('data-restore', {
    action: 'preview', mode, domains: bundle.domains, manifest: bundle.manifest,
  })
}

export interface ApplyResult {
  ok: boolean
  mode: 'merge' | 'replace'
  result: { mode: string; inserted_total: number; inserted: Record<string, number>; deleted: Record<string, number> }
  diff: RestoreDiff
  snapshot: { historyId: string; storagePath: string } | null
}

export async function applyRestore(bundle: Bundle, mode: 'merge' | 'replace'): Promise<ApplyResult> {
  return invoke<ApplyResult>('data-restore', {
    action: 'apply', mode, domains: bundle.domains, manifest: bundle.manifest,
  })
}

// ---------------------------------------------------------------------------
// History + settings
// ---------------------------------------------------------------------------
export async function listBackupHistory(limit = 12): Promise<BackupHistoryRow[]> {
  const { data, error } = await supabase
    .from('backup_history')
    .select('id, kind, storage_path, record_count, size_bytes, checksum, app_version, created_at, note')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as BackupHistoryRow[]
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const { data, error } = await supabase
    .from('backup_settings')
    .select('auto_backup_enabled, last_manual_backup_at, last_auto_backup_at')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? { auto_backup_enabled: false, last_manual_backup_at: null, last_auto_backup_at: null }
}

export async function setAutoBackup(enabled: boolean, userId: string): Promise<void> {
  const { error } = await supabase
    .from('backup_settings')
    .upsert({ user_id: userId, auto_backup_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

// Download a previously stored backup from the user's private bucket.
export async function downloadStoredBackup(row: BackupHistoryRow): Promise<void> {
  if (!row.storage_path) throw new Error('This backup has no stored file.')
  const { data, error } = await supabase.storage.from('user-backups').createSignedUrl(row.storage_path, 120)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not create a download link.')
  const resp = await fetch(data.signedUrl)
  if (!resp.ok) throw new Error('Could not fetch the stored backup.')
  const blob = await resp.blob()
  const stamp = row.created_at.slice(0, 19).replace(/[:T]/g, '-')
  triggerDownload(blob, `budgetly-${row.kind}-backup-${stamp}.zip`)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
