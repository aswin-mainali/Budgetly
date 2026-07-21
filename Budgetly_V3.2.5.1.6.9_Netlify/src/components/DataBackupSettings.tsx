import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ShieldCheck, Download, UploadCloud, Lock, Unlock, AlertTriangle, Clock, HardDriveDownload,
  RefreshCw, CheckCircle2, XCircle, FileArchive, History, Loader2, Info, Database,
  ArrowRightLeft, Layers, Trash2, Sparkles, KeyRound, ChevronRight,
} from 'lucide-react'
import {
  downloadManualBackup, readBackupZip, verifyChecksum, previewRestore, applyRestore,
  listBackupHistory, getBackupSettings, setAutoBackup, downloadStoredBackup, formatBytes,
  PasswordRequiredError, DOMAINS, DOMAIN_LABELS,
  type Bundle, type PreviewResult, type ApplyResult, type BackupHistoryRow, type BackupSettings,
} from '../services/backupService'
import '../styles/backup.css'

type Props = { userId: string }
type RestoreMode = 'merge' | 'replace'

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
function fullDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  manual: { label: 'Manual', cls: 'bkKindManual' },
  auto: { label: 'Automatic', cls: 'bkKindAuto' },
  snapshot: { label: 'Safety snapshot', cls: 'bkKindSnapshot' },
}

export function DataBackupSettings({ userId }: Props) {
  // ----- Backup (left) -----
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [history, setHistory] = useState<BackupHistoryRow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [busyBackup, setBusyBackup] = useState(false)
  const [backupMsg, setBackupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [usePassword, setUsePassword] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // ----- Restore (right) -----
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [validating, setValidating] = useState(false)
  const [restoreError, setRestoreError] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [restoring, setRestoring] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refreshMeta = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const [s, h] = await Promise.all([getBackupSettings(), listBackupHistory()])
      setSettings(s)
      setHistory(h)
    } catch {
      /* non-fatal */
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => { void refreshMeta() }, [refreshMeta])

  // ---- Backup actions ----
  const handleDownloadBackup = async () => {
    if (busyBackup) return
    if (usePassword && backupPassword.trim().length < 4) {
      setBackupMsg({ kind: 'err', text: 'Password must be at least 4 characters, or turn off protection.' })
      return
    }
    setBusyBackup(true)
    setBackupMsg(null)
    try {
      const manifest = await downloadManualBackup(usePassword ? backupPassword : undefined)
      setBackupMsg({ kind: 'ok', text: `Backup downloaded — ${manifest.recordCount} records across ${manifest.domains.length} domains.` })
      setBackupPassword('')
      await refreshMeta()
    } catch (e) {
      setBackupMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Backup failed.' })
    } finally {
      setBusyBackup(false)
    }
  }

  const handleToggleAuto = async () => {
    if (!settings || autoBusy) return
    setAutoBusy(true)
    const next = !settings.auto_backup_enabled
    setSettings({ ...settings, auto_backup_enabled: next })
    try {
      await setAutoBackup(next, userId)
    } catch {
      setSettings({ ...settings, auto_backup_enabled: !next })
    } finally {
      setAutoBusy(false)
    }
  }

  const handleDownloadStored = async (row: BackupHistoryRow) => {
    setDownloadingId(row.id)
    try {
      await downloadStoredBackup(row)
    } catch (e) {
      setBackupMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Download failed.' })
    } finally {
      setDownloadingId(null)
    }
  }

  // ---- Restore actions ----
  const resetRestore = () => {
    setBundle(null); setPreview(null); setRestoreError(''); setApplyResult(null)
    setNeedsPassword(false); setPendingFile(null); setRestorePassword(''); setFileName('')
    setConfirmReplace(false); setMode('merge')
  }

  const runPreview = useCallback(async (b: Bundle, m: RestoreMode) => {
    const res = await previewRestore(b, m)
    setPreview(res)
  }, [])

  const loadFile = useCallback(async (file: File, password?: string) => {
    setValidating(true)
    setRestoreError('')
    setApplyResult(null)
    setPreview(null)
    setFileName(file.name)
    try {
      const b = await readBackupZip(file, password)
      // Client-side checksum gate before we ever talk to the server.
      const ok = await verifyChecksum(b.domains, b.manifest)
      if (!ok) {
        setRestoreError('Checksum verification failed — this file is corrupted or has been tampered with.')
        setBundle(null)
        return
      }
      setNeedsPassword(false)
      setPendingFile(null)
      setBundle(b)
      await runPreview(b, 'merge')
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setNeedsPassword(true)
        setPendingFile(file)
        setBundle(null)
        return
      }
      setBundle(null)
      setRestoreError(e instanceof Error ? e.message : 'Could not read this backup.')
    } finally {
      setValidating(false)
    }
  }, [runPreview])

  const onFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setRestoreError('Please choose a Budgetly backup .zip file.')
      return
    }
    resetRestore()
    void loadFile(file)
  }

  const onModeChange = async (m: RestoreMode) => {
    setMode(m)
    setConfirmReplace(false)
    if (bundle) { try { await runPreview(bundle, m) } catch { /* keep prior */ } }
  }

  const handleRestore = async () => {
    if (!bundle || restoring) return
    if (mode === 'replace' && !confirmReplace) { setConfirmReplace(true); return }
    setRestoring(true)
    setRestoreError('')
    try {
      const res = await applyRestore(bundle, mode)
      setApplyResult(res)
      await refreshMeta()
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Restore failed.')
    } finally {
      setRestoring(false)
      setConfirmReplace(false)
    }
  }

  const canRestore = !!bundle && !!preview && preview.valid && !validating && !restoring

  // Domains with any change, for a compact preview table.
  const previewRows = useMemo(() => {
    if (!preview) return []
    return DOMAINS
      .map((d) => preview.diff.perDomain[d])
      .filter((r) => r && (r.backup > 0 || r.current > 0))
  }, [preview])

  const totals = preview?.diff.totals

  return (
    <div className="bkWrap">
      {/* ================= LEFT COLUMN ================= */}
      <div className="bkCol">
        {/* Full backup card */}
        <section className="bkCard bkBackupCard">
          <div className="bkCardGlow" aria-hidden />
          <header className="bkCardHead">
            <div className="bkIconBadge bkIconAccent"><ShieldCheck size={20} /></div>
            <div>
              <h3 className="bkTitle">Full account backup</h3>
              <p className="bkSub">A complete, restorable snapshot of every record you own — encrypted zip, one file per data domain.</p>
            </div>
          </header>

          <div className="bkStatRow">
            <div className="bkStat">
              <span className="bkStatLabel"><Clock size={13} /> Last backup</span>
              <strong className="bkStatValue">{timeAgo(settings?.last_manual_backup_at ?? null)}</strong>
              <span className="bkStatMeta">{fullDate(settings?.last_manual_backup_at ?? null)}</span>
            </div>
            <div className="bkStat">
              <span className="bkStatLabel"><Layers size={13} /> Domains</span>
              <strong className="bkStatValue">{DOMAINS.length}</strong>
              <span className="bkStatMeta">covered end-to-end</span>
            </div>
            <div className="bkStat">
              <span className="bkStatLabel"><Sparkles size={13} /> Auto backup</span>
              <strong className="bkStatValue">{settings?.auto_backup_enabled ? 'On' : 'Off'}</strong>
              <span className="bkStatMeta">{timeAgo(settings?.last_auto_backup_at ?? null)}</span>
            </div>
          </div>

          <label className={`bkPassToggle ${usePassword ? 'on' : ''}`}>
            <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
            <span className="bkPassToggleTrack"><span className="bkPassToggleThumb" /></span>
            <span className="bkPassToggleCopy">
              <span className="bkPassToggleTitle">{usePassword ? <Lock size={14} /> : <Unlock size={14} />} Password protection</span>
              <span className="bkPassToggleHint">Encrypt the downloaded zip with AES-256. You’ll need this password to restore.</span>
            </span>
          </label>

          {usePassword && (
            <div className="bkPassField">
              <KeyRound size={16} />
              <input
                type="password"
                className="input"
                placeholder="Backup password (min 4 characters)"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          <button className="bkPrimaryBtn" onClick={handleDownloadBackup} disabled={busyBackup}>
            {busyBackup ? <><Loader2 size={17} className="bkSpin" /> Generating backup…</> : <><HardDriveDownload size={17} /> Download backup</>}
          </button>
          {busyBackup && <div className="bkProgress"><div className="bkProgressBar" /></div>}

          {backupMsg && (
            <div className={`bkInline ${backupMsg.kind === 'ok' ? 'ok' : 'err'}`}>
              {backupMsg.kind === 'ok' ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {backupMsg.text}
            </div>
          )}

          <p className="bkFinePrint">
            <Info size={13} /> Backups never include your password, login tokens, or API keys — only your own financial records.
          </p>
        </section>

        {/* Automatic backups card */}
        <section className="bkCard">
          <header className="bkCardHead">
            <div className="bkIconBadge bkIconViolet"><RefreshCw size={18} /></div>
            <div>
              <h3 className="bkTitle">Automatic backups</h3>
              <p className="bkSub">A hands-off weekly snapshot stored securely in your account. We keep the last 8.</p>
            </div>
            <button
              className={`bkSwitch ${settings?.auto_backup_enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={!!settings?.auto_backup_enabled}
              onClick={handleToggleAuto}
              disabled={autoBusy || !settings}
            >
              <span className="bkSwitchThumb" />
            </button>
          </header>

          <div className="bkHistory">
            <div className="bkHistoryHead">
              <span><History size={14} /> Recent backups</span>
              <button className="bkGhostBtn" onClick={() => void refreshMeta()} disabled={loadingHistory}>
                <RefreshCw size={13} className={loadingHistory ? 'bkSpin' : ''} /> Refresh
              </button>
            </div>

            {loadingHistory ? (
              <div className="bkEmpty"><Loader2 size={16} className="bkSpin" /> Loading history…</div>
            ) : history.length === 0 ? (
              <div className="bkEmpty"><FileArchive size={16} /> No backups yet. Generate one to get started.</div>
            ) : (
              <ul className="bkHistoryList">
                {history.map((row) => {
                  const meta = KIND_META[row.kind] ?? KIND_META.manual
                  return (
                    <li key={row.id} className="bkHistoryItem">
                      <span className={`bkKind ${meta.cls}`}>{meta.label}</span>
                      <div className="bkHistoryInfo">
                        <strong>{fullDate(row.created_at)}</strong>
                        <span>{row.record_count} records · {formatBytes(row.size_bytes)}</span>
                      </div>
                      <button
                        className="bkGhostBtn"
                        onClick={() => void handleDownloadStored(row)}
                        disabled={downloadingId === row.id || !row.storage_path}
                        title="Download this backup"
                      >
                        {downloadingId === row.id ? <Loader2 size={14} className="bkSpin" /> : <Download size={14} />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ================= RIGHT COLUMN — RESTORE (danger) ================= */}
      <div className="bkCol">
        <section className="bkCard bkRestoreCard">
          <div className="bkDangerStripe" aria-hidden />
          <header className="bkCardHead">
            <div className="bkIconBadge bkIconDanger"><AlertTriangle size={20} /></div>
            <div>
              <h3 className="bkTitle">Restore from backup</h3>
              <p className="bkSub">This can overwrite your live data. We validate the file and show you exactly what changes before anything is touched.</p>
            </div>
          </header>

          {!applyResult && (
            <>
              {/* Drop zone */}
              <div
                className={`bkDrop ${dragging ? 'drag' : ''} ${bundle ? 'loaded' : ''} ${restoreError ? 'error' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  style={{ display: 'none' }}
                  onChange={(e) => { onFiles(e.target.files); e.currentTarget.value = '' }}
                />
                <div className="bkDropIcon">{validating ? <Loader2 size={26} className="bkSpin" /> : bundle ? <CheckCircle2 size={26} /> : <UploadCloud size={26} />}</div>
                {validating ? (
                  <><strong>Validating…</strong><span>Reading manifest & verifying checksum</span></>
                ) : bundle ? (
                  <><strong>{fileName}</strong><span>Validated · {bundle.manifest.recordCount} records</span></>
                ) : (
                  <><strong>Drop a backup .zip here</strong><span>or click to browse</span></>
                )}
              </div>

              {/* Password prompt for encrypted archives */}
              {needsPassword && (
                <div className="bkPassPrompt">
                  <div className="bkPassField">
                    <Lock size={16} />
                    <input
                      type="password"
                      className="input"
                      placeholder="This backup is password protected"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && pendingFile) void loadFile(pendingFile, restorePassword) }}
                      autoFocus
                    />
                  </div>
                  <button className="bkSecondaryBtn" disabled={!restorePassword || validating} onClick={() => pendingFile && void loadFile(pendingFile, restorePassword)}>
                    <Unlock size={15} /> Unlock
                  </button>
                </div>
              )}

              {restoreError && (
                <div className="bkInline err"><XCircle size={15} /> {restoreError}</div>
              )}

              {/* Validation errors from server (blocking) */}
              {preview && !preview.valid && preview.warnings?.length > 0 && (
                <div className="bkErrorBox">
                  <strong><AlertTriangle size={15} /> This backup can’t be safely restored</strong>
                  <ul>{preview.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                </div>
              )}

              {/* Preview + mode selection */}
              {bundle && preview && (
                <div className="bkPreview">
                  <div className="bkPreviewMeta">
                    <span><Database size={13} /> {bundle.manifest.recordCount} records</span>
                    <span><Clock size={13} /> {fullDate(bundle.manifest.createdAt)}</span>
                    <span><FileArchive size={13} /> v{bundle.manifest.backupVersion} · {bundle.manifest.appVersion}</span>
                    <span className="bkChecksumOk"><CheckCircle2 size={13} /> Checksum verified</span>
                  </div>

                  <div className="bkModes">
                    <button className={`bkModeCard ${mode === 'merge' ? 'active' : ''}`} onClick={() => void onModeChange('merge')}>
                      <span className="bkModeTop"><Layers size={16} /> Merge <span className="bkModeTag safe">Recommended</span></span>
                      <span className="bkModeDesc">Add records from the backup that don’t already exist. Existing data is left untouched.</span>
                      <span className="bkModeStat"><span className="bkAdd">+{totals?.merge.add ?? 0}</span> added</span>
                    </button>
                    <button className={`bkModeCard danger ${mode === 'replace' ? 'active' : ''}`} onClick={() => void onModeChange('replace')}>
                      <span className="bkModeTop"><ArrowRightLeft size={16} /> Replace everything <span className="bkModeTag danger">Destructive</span></span>
                      <span className="bkModeDesc">Wipe current data in these domains and restore the backup exactly.</span>
                      <span className="bkModeStat">
                        <span className="bkAdd">+{totals?.replace.add ?? 0}</span>
                        <span className="bkOver">~{totals?.replace.overwrite ?? 0}</span>
                        <span className="bkRemove">−{totals?.replace.remove ?? 0}</span>
                      </span>
                    </button>
                  </div>

                  {/* Per-domain diff */}
                  <div className="bkDiffTable">
                    <div className="bkDiffHead">
                      <span>Domain</span><span>Current</span><span>Backup</span>
                      <span>{mode === 'merge' ? 'Will add' : 'Net change'}</span>
                    </div>
                    {previewRows.map((r) => {
                      const add = mode === 'merge' ? r.merge.add : r.replace.add
                      const remove = mode === 'merge' ? 0 : r.replace.remove
                      return (
                        <div className="bkDiffRow" key={r.label}>
                          <span className="bkDiffLabel">{r.label}</span>
                          <span className="bkDiffNum">{r.current}</span>
                          <span className="bkDiffNum">{r.backup}</span>
                          <span className="bkDiffDelta">
                            {add > 0 && <em className="bkAdd">+{add}</em>}
                            {remove > 0 && <em className="bkRemove">−{remove}</em>}
                            {add === 0 && remove === 0 && <em className="bkNoop">no change</em>}
                          </span>
                        </div>
                      )
                    })}
                    {previewRows.length === 0 && <div className="bkEmpty">Backup and current data are identical.</div>}
                  </div>

                  {mode === 'replace' && confirmReplace && (
                    <div className="bkErrorBox soft">
                      <strong><AlertTriangle size={15} /> Confirm full replace</strong>
                      <p>This removes {totals?.replace.remove ?? 0} record(s) that aren’t in the backup. A safety snapshot is taken first, so you can undo it from history. Press Restore again to proceed.</p>
                    </div>
                  )}

                  <div className="bkRestoreActions">
                    <button className="bkGhostBtn" onClick={resetRestore} disabled={restoring}><Trash2 size={14} /> Clear</button>
                    <button
                      className={`bkRestoreBtn ${mode === 'replace' ? 'danger' : ''}`}
                      onClick={handleRestore}
                      disabled={!canRestore}
                    >
                      {restoring ? <><Loader2 size={17} className="bkSpin" /> Restoring…</>
                        : mode === 'replace' && confirmReplace ? <><AlertTriangle size={16} /> Yes, replace everything</>
                        : <><ChevronRight size={17} /> Restore ({mode})</>}
                    </button>
                  </div>
                  {restoring && <div className="bkProgress danger"><div className="bkProgressBar" /></div>}
                </div>
              )}

              {!bundle && !validating && !needsPassword && (
                <p className="bkFinePrint">
                  <Info size={13} /> The Restore button stays disabled until a valid, checksum-verified backup is loaded.
                </p>
              )}
            </>
          )}

          {/* Success summary */}
          {applyResult && (
            <div className="bkSuccess">
              <div className="bkSuccessIcon"><CheckCircle2 size={30} /></div>
              <h4>Restore complete</h4>
              <p>Your data was restored using <strong>{applyResult.mode}</strong> mode.</p>
              <div className="bkSuccessStats">
                <div><strong className="bkAdd">+{applyResult.result.inserted_total}</strong><span>records added</span></div>
                <div><strong className="bkRemove">−{Object.values(applyResult.result.deleted ?? {}).reduce((a, b) => a + (b as number), 0)}</strong><span>records removed</span></div>
                <div><strong>{applyResult.snapshot ? '1' : '0'}</strong><span>safety snapshot</span></div>
              </div>
              {applyResult.snapshot && (
                <p className="bkFinePrint"><ShieldCheck size={13} /> A safety snapshot of your previous data was saved to backup history — restore it anytime to undo.</p>
              )}
              <button className="bkSecondaryBtn" onClick={resetRestore}><RefreshCw size={15} /> Restore another backup</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default DataBackupSettings
