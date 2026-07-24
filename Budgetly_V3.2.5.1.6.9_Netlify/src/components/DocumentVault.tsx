import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, ArrowRight, Building2, CalendarClock, CalendarDays, CheckCircle2,
  ChevronLeft, Clock, Delete, ExternalLink, Eye, FileText, FileCheck2,
  Hash, KeyRound, Loader2, Lock, Mail, Pencil, Plus, RefreshCw, Search, Shield,
  ShieldCheck, ShieldAlert, Sparkles, StickyNote, Trash2, Upload, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import '../styles/documentVault.css'

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

type DocType = 'agreement' | 'insurance' | 'contract' | 'warranty' | 'lease' | 'license' | 'certificate' | 'other'

type VaultDoc = {
  id: string
  title: string
  docType: DocType
  issuer: string
  referenceNumber: string
  agreementDate: string | null
  expirationDate: string | null
  notes: string
  storagePath: string
  fileName: string
  mimeType: string | null
  fileSize: number | null
  aiExtracted: boolean
  aiConfidence: number | null
  aiSummary: string
  createdAt: string
  updatedAt: string
}

type DocRow = {
  id: string
  title: string | null
  doc_type: DocType
  issuer: string | null
  reference_number: string | null
  agreement_date: string | null
  expiration_date: string | null
  notes: string | null
  storage_path: string
  file_name: string | null
  mime_type: string | null
  file_size: number | string | null
  ai_extracted: boolean | null
  ai_confidence: number | string | null
  ai_summary: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** Result from /api/document-extract. */
type ExtractResult = {
  title: string
  docType: DocType
  issuer: string
  referenceNumber: string
  agreementDate: string
  expirationDate: string
  summary: string
  confidence: number | null
}

/* ────────────────────────────────────────────────────────────────────────────
   Constants / helpers
   ──────────────────────────────────────────────────────────────────────────── */

const BUCKET = 'document-vault'
const EXPIRY_SOON_DAYS = 30
const MAX_FILE_BYTES = 25 * 1024 * 1024
const AI_MAX_BYTES = 7 * 1024 * 1024 // above this we skip AI to stay under the function limit
const LOCK_MAX_ATTEMPTS = 5
const LOCK_MINUTES = 5

const DOC_TYPE_META: Record<DocType, { label: string; accent: string }> = {
  agreement: { label: 'Agreement', accent: '#6366f1' },
  insurance: { label: 'Insurance', accent: '#0ea5e9' },
  contract: { label: 'Contract', accent: '#8b5cf6' },
  warranty: { label: 'Warranty', accent: '#22c55e' },
  lease: { label: 'Lease', accent: '#f59e0b' },
  license: { label: 'License', accent: '#14b8a6' },
  certificate: { label: 'Certificate', accent: '#ec4899' },
  other: { label: 'Other', accent: '#64748b' },
}
const DOC_TYPE_ORDER: DocType[] = ['agreement', 'insurance', 'contract', 'warranty', 'lease', 'license', 'certificate', 'other']

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,application/pdf,image/*'

const mapDoc = (r: DocRow): VaultDoc => ({
  id: r.id,
  title: (r.title || '').trim() || (r.file_name || 'Untitled document'),
  docType: (DOC_TYPE_ORDER as string[]).includes(r.doc_type) ? r.doc_type : 'other',
  issuer: r.issuer || '',
  referenceNumber: r.reference_number || '',
  agreementDate: r.agreement_date || null,
  expirationDate: r.expiration_date || null,
  notes: r.notes || '',
  storagePath: r.storage_path,
  fileName: r.file_name || 'document',
  mimeType: r.mime_type,
  fileSize: r.file_size != null ? Number(r.file_size) : null,
  aiExtracted: !!r.ai_extracted,
  aiConfidence: r.ai_confidence != null ? Number(r.ai_confidence) : null,
  aiSummary: r.ai_summary || '',
  createdAt: r.created_at || new Date().toISOString(),
  updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
})

const isMissingTableError = (error: unknown) =>
  /document_vault|does not exist|schema cache|could not find the table|bucket not found/i.test(
    String((error as { message?: string })?.message || error || ''),
  )

const todayIso = () => new Date().toISOString().slice(0, 10)

const daysUntil = (iso: string | null): number | null => {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - start.getTime()) / 86400000)
}

type ExpiryStatus = 'expired' | 'soon' | 'active' | 'none'
const expiryStatus = (iso: string | null): ExpiryStatus => {
  const d = daysUntil(iso)
  if (d == null) return 'none'
  if (d < 0) return 'expired'
  if (d <= EXPIRY_SOON_DAYS) return 'soon'
  return 'active'
}

const formatDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatBytes = (n: number | null) => {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const expiryLabel = (iso: string | null): string => {
  const d = daysUntil(iso)
  if (d == null) return 'No expiry date'
  if (d < 0) return `Expired ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago`
  if (d === 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  if (d <= EXPIRY_SOON_DAYS) return `Expires in ${d} days`
  return `Expires ${formatDate(iso)}`
}

// Short status word + relative time, used by the table rows and details modal.
const STATUS_META: Record<ExpiryStatus, { label: string; icon: React.ComponentType<{ size?: number | string }> }> = {
  expired: { label: 'Expired', icon: AlertTriangle },
  soon: { label: 'Expiring soon', icon: CalendarClock },
  active: { label: 'Active', icon: CheckCircle2 },
  none: { label: 'No expiry', icon: Clock },
}
const relativeExpiry = (iso: string | null): string => {
  const d = daysUntil(iso)
  if (d == null) return '—'
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago`
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d < 45) return `in ${d} days`
  if (d < 365) return `in ${Math.round(d / 30)} months`
  const years = d / 365
  return `in ${years < 1.5 ? '1 year' : `${Math.round(years)} years`}`
}

const fileExt = (name: string) => {
  const parts = name.split('.')
  return (parts.length > 1 ? parts.pop() : '') || ''
}

/* ── PIN crypto (client-side; the raw PIN never leaves the device) ──────────── */
const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
const randomSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)).buffer)
const hashPin = (pin: string, salt: string) => sha256Hex(`${salt}:${pin}`)

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  })

/* ────────────────────────────────────────────────────────────────────────────
   Root component
   ──────────────────────────────────────────────────────────────────────────── */

type SecurityRow = {
  pin_hash: string | null
  pin_salt: string | null
  failed_attempts: number | null
  locked_until: string | null
}

export function DocumentVault({
  userId,
  currency,
  theme = 'dark',
  email,
}: {
  userId?: string | null
  currency?: string
  theme?: 'light' | 'dark'
  email?: string | null
}) {
  // ── Gate state ─────────────────────────────────────────────────────────────
  const [gateLoading, setGateLoading] = useState(true)
  const [security, setSecurity] = useState<SecurityRow | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [missingTable, setMissingTable] = useState(false)

  const loadSecurity = useCallback(async (uid: string) => {
    setGateLoading(true)
    setMissingTable(false)
    const { data, error } = await supabase
      .from('document_vault_security')
      .select('pin_hash, pin_salt, failed_attempts, locked_until')
      .eq('user_id', uid)
      .maybeSingle()
    if (error && isMissingTableError(error)) {
      setMissingTable(true); setGateLoading(false); return
    }
    const row = (data as SecurityRow | null) || null
    setSecurity(row)
    setSetupNeeded(!row || !row.pin_hash)
    setGateLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) { setGateLoading(false); return }
    setUnlocked(false)
    void loadSecurity(userId)
  }, [userId, loadSecurity])

  // Re-lock the vault after the tab has been away for a while, so the PIN is
  // asked "every time" you return — but not when you briefly pop out to view a
  // document in another tab.
  useEffect(() => {
    if (!unlocked) return
    const RELOCK_AFTER_MS = 90_000
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) { setUnlocked(false) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [unlocked])

  if (!userId) {
    return (
      <section className="dvPage">
        <div className="dvGateCard"><Lock size={30} /><h2>Sign in to open your vault</h2></div>
      </section>
    )
  }

  if (gateLoading) {
    return (
      <section className="dvPage">
        <div className="dvGateLoading"><Loader2 size={26} className="dvSpin" /><span>Opening the vault…</span></div>
      </section>
    )
  }

  if (missingTable) {
    return (
      <section className="dvPage">
        <div className="dvGateCard">
          <div className="dvGateIcon warn"><ShieldAlert size={30} /></div>
          <h2>Finish setting up the Document Vault</h2>
          <p>The database tables and storage bucket for this feature haven’t been created yet. Run <code>supabase/add_document_vault.sql</code> against your Supabase project, then reload.</p>
          <button className="dvBtn dvBtnPrimary" onClick={() => userId && void loadSecurity(userId)}><RefreshCw size={16} /> Reload</button>
        </div>
      </section>
    )
  }

  if (!unlocked) {
    return (
      <VaultGate
        userId={userId}
        security={security}
        setupNeeded={setupNeeded}
        email={email}
        onUnlocked={() => { setUnlocked(true); void loadSecurity(userId) }}
        onSecurityChanged={(row) => { setSecurity(row); setSetupNeeded(!row.pin_hash) }}
      />
    )
  }

  return <VaultBoard userId={userId} currency={currency} theme={theme} onLock={() => setUnlocked(false)} />
}

/* ────────────────────────────────────────────────────────────────────────────
   PIN gate — setup, unlock, and forgot-PIN
   ──────────────────────────────────────────────────────────────────────────── */

type GateMode = 'unlock' | 'setup' | 'forgot'

function VaultGate({
  userId, security, setupNeeded, email, onUnlocked, onSecurityChanged,
}: {
  userId: string
  security: SecurityRow | null
  setupNeeded: boolean
  email?: string | null
  onUnlocked: () => void
  onSecurityChanged: (row: SecurityRow) => void
}) {
  const [mode, setMode] = useState<GateMode>(setupNeeded ? 'setup' : 'unlock')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lockedUntil, setLockedUntil] = useState<number | null>(
    security?.locked_until ? new Date(security.locked_until).getTime() : null,
  )
  const [nowTick, setNowTick] = useState(Date.now())

  useEffect(() => { setMode(setupNeeded ? 'setup' : 'unlock') }, [setupNeeded])

  const isLocked = lockedUntil != null && lockedUntil > nowTick
  useEffect(() => {
    if (!isLocked) return
    const t = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [isLocked])

  // ── Setup a brand-new PIN ──────────────────────────────────────────────────
  const handleSetup = async (pin: string) => {
    setBusy(true); setError('')
    try {
      const salt = randomSalt()
      const pin_hash = await hashPin(pin, salt)
      const { error: upErr } = await supabase
        .from('document_vault_security')
        .upsert({ user_id: userId, pin_hash, pin_salt: salt, failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (upErr) throw upErr
      onSecurityChanged({ pin_hash, pin_salt: salt, failed_attempts: 0, locked_until: null })
      onUnlocked()
    } catch (e) {
      setError(isMissingTableError(e) ? 'Vault tables aren’t set up yet.' : 'Could not set your PIN. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── Verify an existing PIN ─────────────────────────────────────────────────
  const handleUnlock = async (pin: string) => {
    if (!security?.pin_hash || !security.pin_salt) { setError('No PIN is set yet.'); return }
    setBusy(true); setError('')
    try {
      const candidate = await hashPin(pin, security.pin_salt)
      if (candidate === security.pin_hash) {
        if ((security.failed_attempts ?? 0) > 0 || security.locked_until) {
          await supabase.from('document_vault_security').update({ failed_attempts: 0, locked_until: null }).eq('user_id', userId)
        }
        onUnlocked()
        return
      }
      const attempts = (security.failed_attempts ?? 0) + 1
      const shouldLock = attempts >= LOCK_MAX_ATTEMPTS
      const lockTs = shouldLock ? Date.now() + LOCK_MINUTES * 60000 : null
      await supabase.from('document_vault_security').update({
        failed_attempts: shouldLock ? 0 : attempts,
        locked_until: lockTs ? new Date(lockTs).toISOString() : null,
      }).eq('user_id', userId)
      onSecurityChanged({ ...security, failed_attempts: shouldLock ? 0 : attempts, locked_until: lockTs ? new Date(lockTs).toISOString() : null })
      if (shouldLock) { setLockedUntil(lockTs); setError('') }
      else setError(`Incorrect PIN. ${LOCK_MAX_ATTEMPTS - attempts} attempt${LOCK_MAX_ATTEMPTS - attempts === 1 ? '' : 's'} left.`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const lockRemaining = isLocked ? Math.max(0, Math.ceil((lockedUntil! - nowTick) / 1000)) : 0
  const lockMin = Math.floor(lockRemaining / 60)
  const lockSec = String(lockRemaining % 60).padStart(2, '0')

  return (
    <section className="dvPage dvGatePage">
      <div className="dvGateGlow" aria-hidden="true" />
      <div className="dvGateShell">
        <div className="dvGateBrand">
          <span className="dvGateBadge"><ShieldCheck size={15} /> Document Vault</span>
          <h1>{mode === 'setup' ? 'Secure your vault' : mode === 'forgot' ? 'Reset your PIN' : 'Enter your PIN'}</h1>
          <p>
            {mode === 'setup'
              ? 'Create a PIN to protect your agreements, policies, and contracts. You’ll enter it each time you open the vault.'
              : mode === 'forgot'
                ? 'We’ll email a one-time code to reset your PIN.'
                : 'Your documents are locked. Enter your PIN to continue.'}
          </p>
        </div>

        {mode === 'forgot' ? (
          <ForgotPin email={email} onCancel={() => { setMode('unlock'); setError('') }} onReset={(row) => { onSecurityChanged(row); onUnlocked() }} userId={userId} />
        ) : isLocked ? (
          <div className="dvLockOut">
            <div className="dvGateIcon warn"><Lock size={26} /></div>
            <h3>Too many attempts</h3>
            <p>For your security the vault is paused. Try again in <strong>{lockMin}:{lockSec}</strong>.</p>
            <button className="dvGateLink" onClick={() => setMode('forgot')}>Forgot your PIN? Reset it instead</button>
          </div>
        ) : (
          <PinPad
            key={mode}
            mode={mode}
            busy={busy}
            error={error}
            onSubmit={mode === 'setup' ? handleSetup : handleUnlock}
            onForgot={mode === 'unlock' ? () => { setMode('forgot'); setError('') } : undefined}
          />
        )}
      </div>
    </section>
  )
}

/* ── PIN entry pad (used for both setup and unlock) ─────────────────────────── */
function PinPad({
  mode, busy, error, onSubmit, onForgot,
}: {
  mode: GateMode
  busy: boolean
  error: string
  onSubmit: (pin: string) => void
  onForgot?: () => void
}) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter')
  const [localError, setLocalError] = useState('')
  const MAX = 6
  const MIN = 4

  const active = stage === 'enter' ? pin : confirm
  const setActive = stage === 'enter' ? setPin : setConfirm

  const reset = () => { setPin(''); setConfirm(''); setStage('enter'); setLocalError('') }

  const press = (digit: string) => {
    if (busy) return
    setLocalError('')
    setActive((cur) => (cur.length >= MAX ? cur : cur + digit))
  }
  const backspace = () => { if (busy) return; setActive((cur) => cur.slice(0, -1)) }

  const submit = useCallback(() => {
    if (busy) return
    if (mode === 'setup') {
      if (stage === 'enter') {
        if (pin.length < MIN) { setLocalError(`Use at least ${MIN} digits.`); return }
        setStage('confirm'); return
      }
      if (confirm !== pin) { setLocalError('PINs don’t match. Start again.'); setPin(''); setConfirm(''); setStage('enter'); return }
      onSubmit(pin)
      return
    }
    if (pin.length < MIN) { setLocalError(`Enter your ${MIN}–${MAX} digit PIN.`); return }
    onSubmit(pin)
  }, [busy, mode, stage, pin, confirm, onSubmit])

  // Physical keyboard support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submit]) // eslint-disable-line react-hooks/exhaustive-deps

  const canAdvance = active.length >= MIN
  const shownError = localError || error

  return (
    <div className="dvPinArea">
      {mode === 'setup' ? (
        <div className="dvPinStageHint">{stage === 'enter' ? 'Choose a PIN' : 'Re-enter to confirm'}</div>
      ) : null}

      <div className={`dvPinDots ${shownError ? 'err' : ''}`} aria-hidden="true">
        {Array.from({ length: MAX }).map((_, i) => (
          <span key={i} className={`dvPinDot ${i < active.length ? 'filled' : ''}`} />
        ))}
      </div>

      <div className="dvPinMsg" role="status">
        {shownError ? <span className="dvPinErr"><AlertTriangle size={13} /> {shownError}</span> : <span>&nbsp;</span>}
      </div>

      <div className="dvKeypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="dvKey" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <button type="button" className="dvKey dvKeyGhost" onClick={reset} disabled={busy} aria-label="Clear">C</button>
        <button type="button" className="dvKey" onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" className="dvKey dvKeyGhost" onClick={backspace} disabled={busy} aria-label="Delete"><Delete size={20} /></button>
      </div>

      <button type="button" className="dvBtn dvBtnPrimary dvPinSubmit" onClick={submit} disabled={busy || !canAdvance}>
        {busy ? <><Loader2 size={16} className="dvSpin" /> Please wait…</>
          : mode === 'setup' ? (stage === 'enter' ? <>Continue <ArrowRight size={16} /></> : <><ShieldCheck size={16} /> Set PIN & open</>)
            : <><KeyRound size={16} /> Unlock</>}
      </button>

      {onForgot ? <button type="button" className="dvGateLink" onClick={onForgot}>Forgot your PIN?</button> : null}
    </div>
  )
}

/* ── Forgot-PIN: request an email code, then verify + set a new PIN ──────────── */
function ForgotPin({
  userId, email, onCancel, onReset,
}: {
  userId: string
  email?: string | null
  onCancel: () => void
  onReset: (row: SecurityRow) => void
}) {
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')

  const requestCode = async () => {
    setBusy(true); setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('document-vault-pin-reset', { body: { action: 'request' } })
      if (fnErr) throw fnErr
      setHint((data as { email_hint?: string })?.email_hint || email || '')
      setStep('verify')
    } catch {
      setError('Couldn’t send the code. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your email.'); return }
    if (pin.length < 4) { setError('Your new PIN needs at least 4 digits.'); return }
    if (pin !== confirm) { setError('The new PINs don’t match.'); return }
    setBusy(true); setError('')
    try {
      const salt = randomSalt()
      const pin_hash = await hashPin(pin, salt)
      const { data, error: fnErr } = await supabase.functions.invoke('document-vault-pin-reset', {
        body: { action: 'verify', code, pin_hash, pin_salt: salt },
      })
      if (fnErr) throw fnErr
      const res = data as { ok?: boolean; error?: string; message?: string }
      if (!res?.ok) { setError(res?.message || 'That code didn’t work. Try again.'); setBusy(false); return }
      onReset({ pin_hash, pin_salt: salt, failed_attempts: 0, locked_until: null })
    } catch {
      setError('Couldn’t reset your PIN. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dvForgot">
      {step === 'request' ? (
        <>
          <div className="dvGateIcon"><Mail size={24} /></div>
          <p className="dvForgotLead">We’ll send a one-time reset code to your account email{email ? <> <strong>({email})</strong></> : ''}.</p>
          <div className="dvForgotActions">
            <button className="dvBtn dvBtnGhost" onClick={onCancel} disabled={busy}><ChevronLeft size={16} /> Back</button>
            <button className="dvBtn dvBtnPrimary" onClick={requestCode} disabled={busy}>
              {busy ? <><Loader2 size={16} className="dvSpin" /> Sending…</> : <><Mail size={16} /> Send reset code</>}
            </button>
          </div>
          {error ? <div className="dvPinErr center"><AlertTriangle size={13} /> {error}</div> : null}
        </>
      ) : (
        <>
          <p className="dvForgotLead">Enter the 6-digit code we emailed{hint ? <> to <strong>{hint}</strong></> : ''}, then choose a new PIN.</p>
          <label className="dvField">
            <span>Reset code</span>
            <input className="dvInput dvCodeInput" inputMode="numeric" maxLength={6} placeholder="000000" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          <div className="dvFieldRow">
            <label className="dvField">
              <span>New PIN</span>
              <input className="dvInput" inputMode="numeric" maxLength={6} placeholder="4–6 digits" value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
            <label className="dvField">
              <span>Confirm PIN</span>
              <input className="dvInput" inputMode="numeric" maxLength={6} placeholder="Repeat" value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
          </div>
          {error ? <div className="dvPinErr center"><AlertTriangle size={13} /> {error}</div> : null}
          <div className="dvForgotActions">
            <button className="dvBtn dvBtnGhost" onClick={() => { setStep('request'); setError('') }} disabled={busy}><ChevronLeft size={16} /> Back</button>
            <button className="dvBtn dvBtnPrimary" onClick={verify} disabled={busy}>
              {busy ? <><Loader2 size={16} className="dvSpin" /> Saving…</> : <><ShieldCheck size={16} /> Reset PIN & open</>}
            </button>
          </div>
          <button type="button" className="dvGateLink" onClick={requestCode} disabled={busy}>Didn’t get it? Resend code</button>
        </>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   The vault itself
   ──────────────────────────────────────────────────────────────────────────── */

type FilterKey = 'all' | 'expiring' | 'expired' | DocType

function VaultBoard({
  userId, currency, theme, onLock,
}: {
  userId: string
  currency?: string
  theme?: 'light' | 'dark'
  onLock: () => void
}) {
  const [docs, setDocs] = useState<VaultDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<VaultDoc | null>(null)
  const [toDelete, setToDelete] = useState<VaultDoc | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [viewing, setViewing] = useState<VaultDoc | null>(null)
  // Desktop shows a table/list; mobile keeps the card grid (a wide table won't fit).
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.matchMedia('(min-width: 769px)').matches : true))
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)')
    const on = () => setIsDesktop(mq.matches)
    on()
    if (mq.addEventListener) { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
    mq.addListener(on); return () => mq.removeListener(on)
  }, [])

  const notify = (msg: string) => {
    setFlash(msg)
    window.clearTimeout((notify as any)._t)
    ;(notify as any)._t = window.setTimeout(() => setFlash(null), 2400)
  }

  const load = useCallback(async (uid: string) => {
    setLoading(true); setLoadError(false)
    const { data, error } = await supabase
      .from('document_vault_files')
      .select('*')
      .eq('user_id', uid)
      .order('expiration_date', { ascending: true, nullsFirst: false })
    if (error) { setLoadError(true); setLoading(false); return }
    setDocs(((data as DocRow[]) || []).map(mapDoc))
    setLoading(false)
  }, [])

  useEffect(() => { void load(userId) }, [userId, load])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let expiring = 0, expired = 0, active = 0
    for (const d of docs) {
      const s = expiryStatus(d.expirationDate)
      if (s === 'expired') expired++
      else if (s === 'soon') expiring++
      else if (s === 'active') active++
    }
    return { total: docs.length, expiring, expired, active }
  }, [docs])

  const nextExpiry = useMemo(() => {
    const upcoming = docs
      .map((d) => ({ d, days: daysUntil(d.expirationDate) }))
      .filter((x) => x.days != null && x.days >= 0)
      .sort((a, b) => (a.days! - b.days!))
    return upcoming[0] || null
  }, [docs])

  const typeCounts = useMemo(() => {
    const m = new Map<DocType, number>()
    for (const d of docs) m.set(d.docType, (m.get(d.docType) || 0) + 1)
    return m
  }, [docs])

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs.filter((d) => {
      if (filter === 'expiring' && expiryStatus(d.expirationDate) !== 'soon') return false
      if (filter === 'expired' && expiryStatus(d.expirationDate) !== 'expired') return false
      if (filter !== 'all' && filter !== 'expiring' && filter !== 'expired' && d.docType !== filter) return false
      if (q) {
        const hay = `${d.title} ${d.issuer} ${d.referenceNumber} ${d.notes} ${DOC_TYPE_META[d.docType].label}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [docs, filter, query])

  // ── Persistence ─────────────────────────────────────────────────────────────
  const saveDoc = async (
    draft: {
      id?: string
      title: string; docType: DocType; issuer: string; referenceNumber: string
      agreementDate: string | null; expirationDate: string | null; notes: string
      aiExtracted?: boolean; aiConfidence?: number | null; aiSummary?: string
    },
    file: File | null,
  ) => {
    // Upload the file first for new documents.
    let storagePath = ''
    let fileMeta: { file_name: string; mime_type: string | null; file_size: number | null } | null = null
    if (file) {
      const ext = fileExt(file.name)
      storagePath = `${userId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
      const up = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false, contentType: file.type || undefined })
      if (up.error) throw up.error
      fileMeta = { file_name: file.name, mime_type: file.type || null, file_size: file.size }
    }

    const base = {
      user_id: userId,
      title: draft.title.trim(),
      doc_type: draft.docType,
      issuer: draft.issuer.trim() || null,
      reference_number: draft.referenceNumber.trim() || null,
      agreement_date: draft.agreementDate || null,
      expiration_date: draft.expirationDate || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (draft.id) {
      const { data, error } = await supabase.from('document_vault_files').update(base).eq('id', draft.id).eq('user_id', userId).select('*').single()
      if (error) throw error
      const updated = mapDoc(data as DocRow)
      setDocs((cur) => cur.map((d) => (d.id === draft.id ? updated : d)))
      notify('Document updated')
    } else {
      if (!fileMeta || !storagePath) throw new Error('missing_file')
      const insertPayload = {
        ...base,
        ...fileMeta,
        storage_path: storagePath,
        ai_extracted: !!draft.aiExtracted,
        ai_confidence: draft.aiConfidence ?? null,
        ai_summary: draft.aiSummary || null,
      }
      const { data, error } = await supabase.from('document_vault_files').insert(insertPayload).select('*').single()
      if (error) {
        // Roll back the orphaned upload so storage doesn't drift from the table.
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
        throw error
      }
      setDocs((cur) => [mapDoc(data as DocRow), ...cur])
      notify('Document added to your vault')
    }
  }

  const deleteDoc = async (doc: VaultDoc) => {
    try {
      const { error } = await supabase.from('document_vault_files').delete().eq('id', doc.id).eq('user_id', userId)
      if (error) throw error
      await supabase.storage.from(BUCKET).remove([doc.storagePath]).catch(() => {})
      setDocs((cur) => cur.filter((d) => d.id !== doc.id))
      setToDelete(null)
      setViewing((cur) => (cur && cur.id === doc.id ? null : cur))
      notify('Document removed')
    } catch {
      notify('Could not remove the document.')
    }
  }

  const openDoc = async (doc: VaultDoc) => {
    setOpening(doc.id)
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storagePath, 120)
      if (error || !data?.signedUrl) throw error || new Error('no_url')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch {
      notify('Could not open that file.')
    } finally {
      setOpening(null)
    }
  }

  const hasDocs = docs.length > 0

  return (
    <section className="dvPage dvBoard">
      {flash ? <div className="dvFlash" role="status">{flash}</div> : null}

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <header className="dvHero">
        <div className="dvHeroGlow" aria-hidden="true" />
        <div className="dvHeroTop">
          <div className="dvHeroLead">
            <span className="dvEyebrow"><ShieldCheck size={13} /> Document Vault</span>
            <h1>Your important documents, secured &amp; tracked</h1>
            <p>Store agreements, policies, contracts and warranties. Budgetly’s AI reads the key dates and reminds you before anything expires.</p>
          </div>
          <div className="dvHeroActions">
            <button className="dvBtn dvBtnPrimary" onClick={() => { setEditing(null); setAddOpen(true) }}><Plus size={16} /> Add document</button>
            <button className="dvBtn dvBtnGhost dvLockBtn" onClick={onLock}><Lock size={15} /> Lock vault</button>
          </div>
        </div>

        <div className="dvStatRow">
          <div className="dvStat">
            <span className="dvStatIcon" style={{ background: 'rgba(99,102,241,.14)', color: '#818cf8' }}><FileText size={18} /></span>
            <div><strong>{stats.total}</strong><small>Documents</small></div>
          </div>
          <div className="dvStat">
            <span className="dvStatIcon" style={{ background: 'rgba(245,158,11,.14)', color: '#f59e0b' }}><CalendarClock size={18} /></span>
            <div><strong>{stats.expiring}</strong><small>Expiring soon</small></div>
          </div>
          <div className="dvStat">
            <span className="dvStatIcon" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}><AlertTriangle size={18} /></span>
            <div><strong>{stats.expired}</strong><small>Expired</small></div>
          </div>
          <div className="dvStat">
            <span className="dvStatIcon" style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}><CheckCircle2 size={18} /></span>
            <div><strong>{stats.active}</strong><small>Active</small></div>
          </div>
        </div>

        {nextExpiry && nextExpiry.days != null ? (
          <div className={`dvNextExpiry ${nextExpiry.days <= EXPIRY_SOON_DAYS ? 'warn' : ''}`}>
            <Clock size={15} />
            <span><strong>{nextExpiry.d.title}</strong> — {expiryLabel(nextExpiry.d.expirationDate)}</span>
          </div>
        ) : null}
      </header>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      {hasDocs ? (
        <div className="dvControls">
          <div className="dvSearch">
            <Search size={16} />
            <input placeholder="Search by title, issuer, reference…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query ? <button className="dvSearchClear" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button> : null}
          </div>
          <div className="dvFilters">
            <button className={`dvChip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All <span>{docs.length}</span></button>
            {stats.expiring > 0 ? <button className={`dvChip warn ${filter === 'expiring' ? 'active' : ''}`} onClick={() => setFilter('expiring')}>Expiring <span>{stats.expiring}</span></button> : null}
            {stats.expired > 0 ? <button className={`dvChip danger ${filter === 'expired' ? 'active' : ''}`} onClick={() => setFilter('expired')}>Expired <span>{stats.expired}</span></button> : null}
            {DOC_TYPE_ORDER.filter((t) => typeCounts.get(t)).map((t) => (
              <button key={t} className={`dvChip ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
                {DOC_TYPE_META[t].label} <span>{typeCounts.get(t)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="dvGateLoading"><Loader2 size={24} className="dvSpin" /><span>Loading your documents…</span></div>
      ) : loadError ? (
        <div className="dvEmpty">
          <div className="dvEmptyIllus"><ShieldAlert size={38} /></div>
          <h2>Couldn’t load your vault</h2>
          <p>Something went wrong reaching the server. Check your connection and try again.</p>
          <button className="dvBtn dvBtnPrimary" onClick={() => void load(userId)}><RefreshCw size={16} /> Retry</button>
        </div>
      ) : !hasDocs ? (
        <div className="dvEmpty">
          <div className="dvEmptyIllus"><FileCheck2 size={38} /></div>
          <h2>Your vault is empty</h2>
          <p>Add your first document — an insurance policy, a lease, a warranty. Upload it and our AI fills in the type, issuer and the important dates for you.</p>
          <button className="dvBtn dvBtnPrimary" onClick={() => { setEditing(null); setAddOpen(true) }}><Upload size={16} /> Add your first document</button>
          <div className="dvEmptyChips">
            {(['insurance', 'contract', 'warranty', 'lease'] as DocType[]).map((t) => (
              <span key={t} className="dvSeedChip" style={{ color: DOC_TYPE_META[t].accent }}><FileText size={13} /> {DOC_TYPE_META[t].label}</span>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dvEmpty small">
          <div className="dvEmptyIllus"><Search size={30} /></div>
          <h2>No matches</h2>
          <p>No documents match your search or filter.</p>
          <button className="dvBtn dvBtnGhost" onClick={() => { setFilter('all'); setQuery('') }}>Clear filters</button>
        </div>
      ) : isDesktop ? (
        <DocTable
          docs={filtered}
          onView={(doc) => setViewing(doc)}
          onEdit={(doc) => { setEditing(doc); setAddOpen(true) }}
          onDelete={(doc) => setToDelete(doc)}
        />
      ) : (
        <div className="dvGrid">
          {filtered.map((doc) => (
            <DocCard
              key={doc.id}
              doc={doc}
              onView={() => setViewing(doc)}
              onEdit={() => { setEditing(doc); setAddOpen(true) }}
              onDelete={() => setToDelete(doc)}
            />
          ))}
        </div>
      )}

      {viewing ? (
        <DocDetailsModal
          doc={viewing}
          opening={opening === viewing.id}
          onOpenFile={() => void openDoc(viewing)}
          onEdit={() => { setEditing(viewing); setViewing(null); setAddOpen(true) }}
          onDelete={() => { const d = viewing; setViewing(null); setToDelete(d) }}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {addOpen ? (
        <AddDocumentModal
          editing={editing}
          onClose={() => { setAddOpen(false); setEditing(null) }}
          onSave={saveDoc}
        />
      ) : null}

      {toDelete ? (
        <div className="dvModalBackdrop" onClick={() => setToDelete(null)}>
          <div className="dvConfirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="dvConfirmIcon"><Trash2 size={20} /></div>
            <h3>Remove “{toDelete.title}”?</h3>
            <p>This document and its file will be permanently deleted from your vault. This can’t be undone.</p>
            <div className="dvConfirmActions">
              <button className="dvBtn dvBtnGhost" onClick={() => setToDelete(null)}>Cancel</button>
              <button className="dvBtn dvBtnDanger" onClick={() => void deleteDoc(toDelete)}>Remove</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ── Document card (mobile) ─────────────────────────────────────────────────── */
function DocCard({
  doc, onView, onEdit, onDelete,
}: {
  doc: VaultDoc
  onView: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const status = expiryStatus(doc.expirationDate)
  const meta = DOC_TYPE_META[doc.docType]
  return (
    <article className={`dvCard status-${status}`}>
      <div className="dvCardAccent" style={{ background: meta.accent }} aria-hidden="true" />
      <div className="dvCardHead">
        <span className="dvCardType" style={{ background: `${meta.accent}1e`, color: meta.accent }}><FileText size={13} /> {meta.label}</span>
        <div className="dvCardMenu">
          <button aria-label="Edit" onClick={onEdit}><Pencil size={14} /></button>
          <button aria-label="Remove" className="danger" onClick={onDelete}><Trash2 size={14} /></button>
        </div>
      </div>

      <h3 className="dvCardTitle" title={doc.title}>{doc.title}</h3>
      {doc.issuer ? <div className="dvCardIssuer">{doc.issuer}</div> : null}
      {doc.aiSummary ? <p className="dvCardSummary">{doc.aiSummary}</p> : null}

      <div className="dvCardDates">
        <div>
          <small>Agreement</small>
          <span>{formatDate(doc.agreementDate)}</span>
        </div>
        <div>
          <small>Expiration</small>
          <span>{formatDate(doc.expirationDate)}</span>
        </div>
      </div>

      <div className="dvCardFoot">
        <span className={`dvExpiryBadge ${status}`}>
          {status === 'expired' ? <AlertTriangle size={12} /> : status === 'soon' ? <CalendarClock size={12} /> : status === 'active' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
          {expiryLabel(doc.expirationDate)}
        </span>
        <button className="dvCardOpen" onClick={onView}>
          <Eye size={14} /> View
        </button>
      </div>

      {doc.aiExtracted ? <span className="dvAiTag" title={doc.aiConfidence != null ? `AI confidence ${(doc.aiConfidence * 100).toFixed(0)}%` : 'Auto-filled by AI'}><Sparkles size={11} /> AI</span> : null}
    </article>
  )
}

/* ── Document table (desktop list view) ─────────────────────────────────────── */
function DocTable({
  docs, onView, onEdit, onDelete,
}: {
  docs: VaultDoc[]
  onView: (doc: VaultDoc) => void
  onEdit: (doc: VaultDoc) => void
  onDelete: (doc: VaultDoc) => void
}) {
  return (
    <div className="dvTableCard">
      <div className="dvTableScroll">
        <div className="dvTable" role="table" aria-label="Documents">
          <div className="dvTableHead" role="row">
            <span role="columnheader">Type</span>
            <span role="columnheader">Document</span>
            <span role="columnheader">Agreement</span>
            <span role="columnheader">Expiration</span>
            <span role="columnheader">Status</span>
            <span role="columnheader" className="dvColRight">Actions</span>
          </div>
          {docs.map((doc) => {
            const meta = DOC_TYPE_META[doc.docType]
            const status = expiryStatus(doc.expirationDate)
            const sMeta = STATUS_META[status]
            const StatusIcon = sMeta.icon
            return (
              <div key={doc.id} className="dvRow" role="row" onClick={() => onView(doc)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onView(doc) }}>
                <span role="cell">
                  <span className="dvRowType" style={{ background: `${meta.accent}1e`, color: meta.accent }}><FileText size={13} /> {meta.label}</span>
                </span>
                <div className="dvRowDoc" role="cell">
                  <div className="dvRowTitle" title={doc.title}>
                    <span className="dvRowTitleText">{doc.title}</span>
                    {doc.aiExtracted ? <span className="dvAiPill" title={doc.aiConfidence != null ? `AI confidence ${(doc.aiConfidence * 100).toFixed(0)}%` : 'Auto-filled by AI'}><Sparkles size={10} /> AI</span> : null}
                  </div>
                  {doc.issuer ? <div className="dvRowIssuer" title={doc.issuer}>{doc.issuer}</div> : null}
                </div>
                <div className="dvRowDate" role="cell">{formatDate(doc.agreementDate)}</div>
                <div className="dvRowDate" role="cell">
                  {formatDate(doc.expirationDate)}
                  {doc.expirationDate ? <small>{relativeExpiry(doc.expirationDate)}</small> : null}
                </div>
                <span role="cell"><span className={`dvExpiryBadge ${status}`}><StatusIcon size={12} /> {sMeta.label}</span></span>
                <div className="dvRowActions" role="cell" onClick={(e) => e.stopPropagation()}>
                  <button className="dvViewBtn" onClick={() => onView(doc)}><Eye size={15} /> View</button>
                  <button className="dvIconBtn" aria-label="Edit" title="Edit" onClick={() => onEdit(doc)}><Pencil size={15} /></button>
                  <button className="dvIconBtn danger" aria-label="Remove" title="Remove" onClick={() => onDelete(doc)}><Trash2 size={15} /></button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Document details modal (opened by "View") ──────────────────────────────── */
function DocDetailsModal({
  doc, opening, onOpenFile, onEdit, onDelete, onClose,
}: {
  doc: VaultDoc
  opening: boolean
  onOpenFile: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('txp-drawer-lock')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('txp-drawer-lock') }
  }, [onClose])

  const meta = DOC_TYPE_META[doc.docType]
  const status = expiryStatus(doc.expirationDate)
  const sMeta = STATUS_META[status]
  const StatusIcon = sMeta.icon

  const rows: Array<{ icon: React.ComponentType<{ size?: number | string }>; label: string; value: React.ReactNode }> = [
    { icon: Building2, label: 'Issuer', value: doc.issuer || '—' },
    { icon: Hash, label: 'Reference #', value: doc.referenceNumber || '—' },
    { icon: CalendarDays, label: 'Agreement date', value: formatDate(doc.agreementDate) },
    { icon: CalendarClock, label: 'Expiration date', value: doc.expirationDate ? `${formatDate(doc.expirationDate)} · ${relativeExpiry(doc.expirationDate)}` : '—' },
    { icon: FileText, label: 'File', value: `${doc.fileName}${doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ''}` },
  ]

  return createPortal(
    <div className="dvModalBackdrop" onClick={onClose}>
      <div className="dvModal dvDetails" role="dialog" aria-modal="true" aria-label={doc.title} onClick={(e) => e.stopPropagation()}>
        <div className="dvModalHead">
          <div className="dvDetailsHeadMain">
            <span className="dvModalTag" style={{ color: meta.accent }}><FileText size={13} /> {meta.label}</span>
            <h3>{doc.title}</h3>
            <span className={`dvExpiryBadge ${status} dvDetailsStatus`}><StatusIcon size={12} /> {sMeta.label}{doc.expirationDate ? ` · ${expiryLabel(doc.expirationDate)}` : ''}</span>
          </div>
          <button className="dvModalClose" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="dvModalBody">
          <div className="dvDetailsGrid">
            {rows.map((r) => {
              const Icon = r.icon
              return (
                <div className="dvDetailsField" key={r.label}>
                  <span className="dvDetailsLabel"><Icon size={13} /> {r.label}</span>
                  <span className="dvDetailsValue">{r.value}</span>
                </div>
              )
            })}
          </div>

          {doc.aiSummary ? (
            <div className="dvDetailsSummary">
              <span className="dvDetailsSummaryTag"><Sparkles size={12} /> AI summary</span>
              <p>{doc.aiSummary}</p>
            </div>
          ) : null}

          {doc.notes ? (
            <div className="dvDetailsNotes">
              <span className="dvDetailsLabel"><StickyNote size={13} /> Notes</span>
              <p>{doc.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="dvModalFooter dvDetailsFooter">
          <button className="dvBtn dvBtnGhost" onClick={onDelete}><Trash2 size={15} /> Delete</button>
          <div className="dvDetailsFooterRight">
            <button className="dvBtn dvBtnGhost" onClick={onEdit}><Pencil size={15} /> Edit</button>
            <button className="dvBtn dvBtnPrimary" onClick={onOpenFile} disabled={opening}>
              {opening ? <><Loader2 size={15} className="dvSpin" /> Opening…</> : <><ExternalLink size={15} /> Open file</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Add / edit modal (with AI extraction) ──────────────────────────────────── */
type ExtractPhase = 'idle' | 'scanning' | 'done' | 'error'

function AddDocumentModal({
  editing, onClose, onSave,
}: {
  editing: VaultDoc | null
  onClose: () => void
  onSave: (
    draft: {
      id?: string
      title: string; docType: DocType; issuer: string; referenceNumber: string
      agreementDate: string | null; expirationDate: string | null; notes: string
      aiExtracted?: boolean; aiConfidence?: number | null; aiSummary?: string
    },
    file: File | null,
  ) => Promise<void>
}) {
  const isEdit = !!editing
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState(editing?.title || '')
  const [docType, setDocType] = useState<DocType>(editing?.docType || 'other')
  const [issuer, setIssuer] = useState(editing?.issuer || '')
  const [referenceNumber, setReferenceNumber] = useState(editing?.referenceNumber || '')
  const [agreementDate, setAgreementDate] = useState(editing?.agreementDate || '')
  const [expirationDate, setExpirationDate] = useState(editing?.expirationDate || '')
  const [notes, setNotes] = useState(editing?.notes || '')
  const [aiSummary, setAiSummary] = useState(editing?.aiSummary || '')
  const [aiConfidence, setAiConfidence] = useState<number | null>(editing?.aiConfidence ?? null)
  const [aiExtracted, setAiExtracted] = useState(editing?.aiExtracted || false)

  const [phase, setPhase] = useState<ExtractPhase>('idle')
  const [scanMsg, setScanMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('txp-drawer-lock')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('txp-drawer-lock') }
  }, [onClose, saving])

  const canAiExtract = file && file.size <= AI_MAX_BYTES && (file.type === 'application/pdf' || file.type.startsWith('image/'))

  const pickFile = (f: File) => {
    if (f.size > MAX_FILE_BYTES) { setSaveError('That file is too large (max 25 MB).'); return }
    setSaveError('')
    setFile(f)
    setPhase('idle')
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const runExtract = async (f: File) => {
    setPhase('scanning'); setScanMsg('')
    try {
      const dataUrl = await fileToBase64(f)
      const res = await fetch('/api/document-extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: dataUrl, mediaType: f.type, today: todayIso() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setScanMsg(
          res.status === 429 ? 'Too many scans right now — wait a moment and try again.'
            : body.error === 'service_unavailable' ? 'AI extraction isn’t configured on this server yet.'
            : body.error === 'could_not_read_document' ? 'Couldn’t read that document. Fill the details in manually.'
            : body.error === 'file_too_large' ? 'That file is too large for AI reading. Enter the details manually.'
            : 'The scan failed. You can fill the details in manually.',
        )
        setPhase('error')
        return
      }
      const body = await res.json() as { ok?: boolean; data?: ExtractResult }
      if (!body.ok || !body.data) { setScanMsg('The scan failed. Enter the details manually.'); setPhase('error'); return }
      const d = body.data
      if (d.title) setTitle(d.title)
      if (d.docType) setDocType(d.docType)
      if (d.issuer) setIssuer(d.issuer)
      if (d.referenceNumber) setReferenceNumber(d.referenceNumber)
      if (d.agreementDate) setAgreementDate(d.agreementDate)
      if (d.expirationDate) setExpirationDate(d.expirationDate)
      if (d.summary) setAiSummary(d.summary)
      setAiConfidence(d.confidence)
      setAiExtracted(true)
      setPhase('done')
    } catch {
      setScanMsg('Network error while scanning. Check your connection and try again.')
      setPhase('error')
    }
  }

  const valid = title.trim().length > 0 && (isEdit || !!file)

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true); setSaveError('')
    try {
      await onSave(
        {
          id: editing?.id,
          title, docType, issuer, referenceNumber,
          agreementDate: agreementDate || null,
          expirationDate: expirationDate || null,
          notes,
          aiExtracted, aiConfidence, aiSummary,
        },
        isEdit ? null : file,
      )
      onClose()
    } catch (e) {
      setSaveError(isMissingTableError(e) ? 'Vault storage isn’t set up yet.' : 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  return createPortal(
    <div className="dvModalBackdrop" onClick={() => !saving && onClose()}>
      <div className="dvModal" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit document' : 'Add document'} onClick={(e) => e.stopPropagation()}>
        <div className="dvModalHead">
          <div>
            <span className="dvModalTag"><FileText size={13} /> {isEdit ? 'Edit document' : 'Add document'}</span>
            <h3>{isEdit ? 'Update details' : 'Add to your vault'}</h3>
          </div>
          <button className="dvModalClose" aria-label="Close" onClick={() => !saving && onClose()}><X size={18} /></button>
        </div>

        <div className="dvModalBody">
          {!isEdit ? (
            <div className="dvUploadZone">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); if (fileInputRef.current) fileInputRef.current.value = '' }}
              />
              {!file ? (
                <button type="button" className="dvDrop" onClick={() => fileInputRef.current?.click()}>
                  <div className="dvDropIcon"><Upload size={24} /></div>
                  <strong>Choose a file to upload</strong>
                  <span>PDF, image, or Word document · up to 25 MB</span>
                </button>
              ) : (
                <div className="dvFilePicked">
                  <div className="dvFileIcon"><FileText size={20} /></div>
                  <div className="dvFileMeta">
                    <strong title={file.name}>{file.name}</strong>
                    <small>{formatBytes(file.size)}{file.type ? ` · ${file.type}` : ''}</small>
                  </div>
                  <button className="dvFileSwap" onClick={() => fileInputRef.current?.click()}>Change</button>
                </div>
              )}

              {file ? (
                <div className="dvAiRow">
                  {phase === 'scanning' ? (
                    <div className="dvAiScanning"><Loader2 size={15} className="dvSpin" /> Reading your document…</div>
                  ) : (
                    <button
                      type="button"
                      className="dvBtn dvBtnAi"
                      onClick={() => canAiExtract && runExtract(file)}
                      disabled={!canAiExtract}
                      title={!canAiExtract ? 'AI reading supports PDFs and images up to ~7 MB' : undefined}
                    >
                      <Sparkles size={15} /> {phase === 'done' ? 'Re-scan with AI' : 'Auto-fill with AI'}
                    </button>
                  )}
                  {phase === 'done' ? <span className="dvAiOk"><CheckCircle2 size={13} /> Details filled{aiConfidence != null ? ` · ${(aiConfidence * 100).toFixed(0)}% confident` : ''}</span> : null}
                  {phase === 'error' ? <span className="dvAiErr"><AlertTriangle size={13} /> {scanMsg}</span> : null}
                  {phase === 'idle' && !canAiExtract ? <span className="dvAiHint">AI reading supports PDFs &amp; images (≤7 MB). Enter details below.</span> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="dvEditFileNote"><FileText size={16} /> <span>{editing?.fileName}</span> <small>· file can’t be changed</small></div>
          )}

          <label className="dvField">
            <span>Title</span>
            <input className="dvInput" placeholder="e.g. Auto insurance policy" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <div className="dvField">
            <span>Type</span>
            <div className="dvTypeChips">
              {DOC_TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`dvTypeChip ${docType === t ? 'active' : ''}`}
                  style={docType === t ? { borderColor: DOC_TYPE_META[t].accent, background: `${DOC_TYPE_META[t].accent}18`, color: DOC_TYPE_META[t].accent } : undefined}
                  onClick={() => setDocType(t)}
                >
                  {DOC_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          <div className="dvFieldRow">
            <label className="dvField">
              <span>Issuer <em>(optional)</em></span>
              <input className="dvInput" placeholder="e.g. Geico" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </label>
            <label className="dvField">
              <span>Reference # <em>(optional)</em></span>
              <input className="dvInput" placeholder="Policy / contract no." value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
            </label>
          </div>

          <div className="dvFieldRow">
            <label className="dvField">
              <span>Agreement date</span>
              <input className="dvInput" type="date" value={agreementDate} onChange={(e) => setAgreementDate(e.target.value)} />
            </label>
            <label className="dvField">
              <span>Expiration date</span>
              <input className="dvInput" type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </label>
          </div>

          <label className="dvField">
            <span>Notes <em>(optional)</em></span>
            <textarea className="dvInput dvTextarea" rows={2} placeholder="Anything worth remembering…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {saveError ? <div className="dvPinErr center"><AlertTriangle size={13} /> {saveError}</div> : null}
        </div>

        <div className="dvModalFooter">
          <button className="dvBtn dvBtnGhost" onClick={() => !saving && onClose()} disabled={saving}>Cancel</button>
          <button className="dvBtn dvBtnPrimary" onClick={submit} disabled={!valid || saving}>
            {saving ? <><Loader2 size={15} className="dvSpin" /> Saving…</> : isEdit ? <><CheckCircle2 size={15} /> Save changes</> : <><Shield size={15} /> Add to vault</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default DocumentVault
