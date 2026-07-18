import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FeatureAccess, FeatureKey, Profile, UserFeatureAccess, AdminAuditLog, AuditFilters, BugReport, BugReportStatus, BugWorkflowStatus } from '../types'

const AUDIT_PAGE_SIZE = 25
const AUDIT_EXPORT_CAP = 2000
const RICH_AUDIT_COLUMNS = 'id,admin_user_id,target_user_id,action,category,details,before,after,actor_email,target_email,ip_address,user_agent,created_at'
const LEGACY_AUDIT_COLUMNS = 'id,admin_user_id,target_user_id,action,details,created_at'

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { search: '', category: 'all', from: '', to: '' }

const notify = (message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))
}

export const DEFAULT_FEATURE_ACCESS: FeatureAccess = {
  dashboard: true,
  transactions: true,
  categories: true,
  recurring: true,
  reports: true,
  goals: true,
  advice: true,
  converter: true,
  investments: true,
  support: true,
  settings: true,
}

const FEATURE_KEYS = Object.keys(DEFAULT_FEATURE_ACCESS) as FeatureKey[]

export type AdminManagedUser = Profile & {
  feature_access: UserFeatureAccess | null
  first_name?: string | null
  last_name?: string | null
  image_url?: string | null
}

const mergeFeatureAccess = (value?: Partial<FeatureAccess> | null): FeatureAccess => ({
  ...DEFAULT_FEATURE_ACCESS,
  ...(value ?? {}),
})

const getSingleOrNull = async <T,>(query: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>) => {
  const result = await query
  if (result.error && result.error.code !== 'PGRST116') throw new Error(result.error.message || 'Request failed.')
  return result.data
}

export function useSuperAdmin(userId: string | null, email: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [featureAccess, setFeatureAccess] = useState<FeatureAccess>(DEFAULT_FEATURE_ACCESS)
  const [loading, setLoading] = useState(true)
  const [managedUsers, setManagedUsers] = useState<AdminManagedUser[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([])
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(DEFAULT_AUDIT_FILTERS)
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const auditPageRef = useRef(0)
  const [bugReports, setBugReports] = useState<BugReport[]>([])
  const [overview, setOverview] = useState({ users: 0, activeUsers: 0, transactions: 0, categories: 0, recurring: 0, goals: 0 })
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isSuperAdmin = profile?.role === 'super_admin'

  const visibleFeatures = useMemo(() => (isSuperAdmin ? DEFAULT_FEATURE_ACCESS : mergeFeatureAccess(featureAccess)), [isSuperAdmin, featureAccess])

  const ensureSelfRecords = useCallback(async () => {
    if (!userId) return null

    // Best-effort: stamp this user's real "last active" time on load. Ignored if the
    // touch_last_active() function has not been created yet (pre-migration).
    void supabase.rpc('touch_last_active')

    let currentProfile = await getSingleOrNull(
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    ) as Profile | null

    if (!currentProfile) {
      const insertResult = await supabase.from('profiles').insert({ id: userId, email: email ?? '', role: 'user', is_active: true })
      if (insertResult.error && insertResult.error.code !== '23505') throw new Error(insertResult.error.message || 'Failed to create profile.')
      currentProfile = await getSingleOrNull(
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      ) as Profile | null
    }

    let currentAccess = await getSingleOrNull(
      supabase.from('user_feature_access').select('*').eq('user_id', userId).maybeSingle(),
    ) as UserFeatureAccess | null

    if (!currentAccess) {
      const insertResult = await supabase.from('user_feature_access').insert({ user_id: userId, ...DEFAULT_FEATURE_ACCESS })
      if (insertResult.error && insertResult.error.code !== '23505') throw new Error(insertResult.error.message || 'Failed to create feature access row.')
      currentAccess = await getSingleOrNull(
        supabase.from('user_feature_access').select('*').eq('user_id', userId).maybeSingle(),
      ) as UserFeatureAccess | null
    }

    setProfile(currentProfile)
    setFeatureAccess(mergeFeatureAccess(currentAccess))
    return { currentProfile, currentAccess }
  }, [userId, email])

  const loadAdminData = useCallback(async () => {
    if (!isSuperAdmin) {
      setManagedUsers([])
      setAuditLogs([])
      setBugReports([])
      setOverview({ users: 0, activeUsers: 0, transactions: 0, categories: 0, recurring: 0, goals: 0 })
      return
    }

    setError(null)
    const [profilesResult, accessResult, accountProfilesResult, bugResult, activityResult, txCount, catCount, recurringCount, goalCount] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_feature_access').select('*'),
      supabase.from('user_account_profiles').select('user_id,first_name,last_name,image_url'),
      supabase.from('bug_reports').select('id,user_id,user_email,title,category,user_severity,steps_to_reproduce,contact_when_resolved,screenshot_name,screenshot_data_url,status,workflow_status,reference_code,diagnostics,admin_notes,created_at,updated_at').order('created_at', { ascending: false }),
      // Real per-user "last active" = auth.users.last_sign_in_at, exposed to super
      // admins via a SECURITY DEFINER function. Best-effort: ignored if the
      // admin_user_activity() function has not been created yet (pre-migration).
      supabase.rpc('admin_user_activity'),
      supabase.from('transactions').select('*', { count: 'exact', head: true }),
      supabase.from('categories').select('*', { count: 'exact', head: true }),
      supabase.from('recurring_items').select('*', { count: 'exact', head: true }),
      supabase.from('goals').select('*', { count: 'exact', head: true }),
    ])

    if (profilesResult.error) throw new Error(profilesResult.error.message)
    if (accessResult.error) throw new Error(accessResult.error.message)
    if (accountProfilesResult.error) throw new Error(accountProfilesResult.error.message)
    if (bugResult.error) throw new Error(bugResult.error.message)

    const accessMap = new Map((accessResult.data ?? []).map((row) => [row.user_id, row]))
    const accountProfileMap = new Map((accountProfilesResult.data ?? []).map((row) => [row.user_id, row]))
    const activityMap = new Map(
      (!activityResult.error ? ((activityResult.data ?? []) as Array<{ id: string; last_sign_in_at: string | null }>) : [])
        .map((row) => [row.id, row.last_sign_in_at]),
    )
    const nextManagedUsers = (profilesResult.data ?? []).map((item) => {
      const accountProfile = accountProfileMap.get(item.id)
      return {
        ...item,
        // Prefer the real last sign-in time; fall back to the tracked column,
        // then to updated_at (handled at the display layer).
        last_active_at: activityMap.get(item.id) ?? item.last_active_at ?? null,
        feature_access: accessMap.get(item.id) ?? null,
        first_name: accountProfile?.first_name ?? null,
        last_name: accountProfile?.last_name ?? null,
        image_url: accountProfile?.image_url ?? null,
      }
    }) as AdminManagedUser[]

    setManagedUsers(nextManagedUsers)
    setBugReports((bugResult.data ?? []) as BugReport[])
    setOverview({
      users: nextManagedUsers.length,
      activeUsers: nextManagedUsers.filter((item) => item.is_active).length,
      transactions: txCount.count ?? 0,
      categories: catCount.count ?? 0,
      recurring: recurringCount.count ?? 0,
      goals: goalCount.count ?? 0,
    })
  }, [isSuperAdmin, selectedUserId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    const run = async () => {
      try {
        if (!userId) {
          if (!alive) return
          setProfile(null)
          setFeatureAccess(DEFAULT_FEATURE_ACCESS)
          setManagedUsers([])
          setAuditLogs([])
          setBugReports([])
          setLoading(false)
          return
        }
        await ensureSelfRecords()
      } catch (err: any) {
        if (!alive) return
        setError(err?.message ?? 'Failed to load access profile.')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [userId, ensureSelfRecords])

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        await loadAdminData()
      } catch (err: any) {
        if (!alive) return
        setError(err?.message ?? 'Failed to load admin data.')
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [loadAdminData])

  // Audit rows are written server-side by database triggers (profiles /
  // user_feature_access / bug_reports) so every super-admin change is captured
  // with an exact before -> after diff and cannot be forged or forgotten by the
  // client. This RPC covers events that aren't a table change (e.g. a password
  // reset email). Best-effort: ignored if the migration has not been applied.
  const logAdminAction = useCallback(async (action: string, category: string, targetUserId: string | null, details: Record<string, unknown>) => {
    if (!isSuperAdmin) return
    try {
      await supabase.rpc('log_admin_action', {
        p_action: action,
        p_category: category,
        p_target_user_id: targetUserId,
        p_details: details,
      })
    } catch {
      // Non-fatal: the primary action already succeeded.
    }
  }, [isSuperAdmin])

  // Runs one audit query for a page range, applying the active filters. Falls
  // back to the legacy column set if the advanced-audit migration is not applied.
  const runAuditQuery = useCallback(async (from: number, to: number) => {
    const term = auditFilters.search.trim().replace(/[,()]/g, ' ').trim()
    const decorate = (builder: any, rich: boolean) => {
      let q = builder
      if (rich && auditFilters.category !== 'all') q = q.eq('category', auditFilters.category)
      if (auditFilters.from) q = q.gte('created_at', new Date(`${auditFilters.from}T00:00:00`).toISOString())
      if (auditFilters.to) q = q.lte('created_at', new Date(`${auditFilters.to}T23:59:59.999`).toISOString())
      if (term) {
        q = rich
          ? q.or(`action.ilike.%${term}%,actor_email.ilike.%${term}%,target_email.ilike.%${term}%`)
          : q.ilike('action', `%${term}%`)
      }
      return q.order('created_at', { ascending: false }).range(from, to)
    }

    let res = await decorate(supabase.from('admin_audit_logs').select(RICH_AUDIT_COLUMNS, { count: 'exact' }), true)
    if (res.error) {
      // Advanced columns not present yet — retry against the legacy schema.
      res = await decorate(supabase.from('admin_audit_logs').select(LEGACY_AUDIT_COLUMNS, { count: 'exact' }), false)
    }
    return res
  }, [auditFilters])

  const reloadAudit = useCallback(async () => {
    if (!isSuperAdmin) {
      setAuditLogs([])
      setAuditTotal(0)
      setAuditHasMore(false)
      auditPageRef.current = 0
      return
    }
    setAuditLoading(true)
    try {
      const res = await runAuditQuery(0, AUDIT_PAGE_SIZE - 1)
      if (res.error) throw new Error(res.error.message)
      const rows = (res.data ?? []) as AdminAuditLog[]
      setAuditLogs(rows)
      auditPageRef.current = 0
      const total = res.count ?? rows.length
      setAuditTotal(total)
      setAuditHasMore(rows.length < total)
    } catch {
      // Best-effort: keep whatever is already on screen.
    } finally {
      setAuditLoading(false)
    }
  }, [isSuperAdmin, runAuditQuery])

  const loadMoreAudit = useCallback(async () => {
    if (!isSuperAdmin || auditLoading) return
    setAuditLoading(true)
    try {
      const nextPage = auditPageRef.current + 1
      const from = nextPage * AUDIT_PAGE_SIZE
      const to = from + AUDIT_PAGE_SIZE - 1
      const res = await runAuditQuery(from, to)
      if (res.error) throw new Error(res.error.message)
      const rows = (res.data ?? []) as AdminAuditLog[]
      setAuditLogs((prev) => [...prev, ...rows])
      auditPageRef.current = nextPage
      const total = res.count ?? auditTotal
      setAuditTotal(total)
      setAuditHasMore(from + rows.length < total)
    } catch {
      // Best-effort.
    } finally {
      setAuditLoading(false)
    }
  }, [isSuperAdmin, auditLoading, runAuditQuery, auditTotal])

  const exportAuditLogs = useCallback(async (format: 'csv' | 'json') => {
    if (!isSuperAdmin || typeof window === 'undefined') return
    try {
      const res = await runAuditQuery(0, AUDIT_EXPORT_CAP - 1)
      if (res.error) throw new Error(res.error.message)
      const rows = (res.data ?? []) as AdminAuditLog[]
      const stamp = new Date().toISOString().slice(0, 10)
      let blob: Blob
      if (format === 'json') {
        blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      } else {
        const columns = ['created_at', 'action', 'category', 'actor_email', 'target_email', 'before', 'after', 'ip_address', 'user_agent'] as const
        const escape = (value: unknown) => {
          const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
          return `"${text.replace(/"/g, '""')}"`
        }
        const lines = [columns.join(',')]
        rows.forEach((row) => lines.push(columns.map((col) => escape((row as any)[col])).join(',')))
        blob = new Blob([lines.join('\n')], { type: 'text/csv' })
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `budgetly-audit-log-${stamp}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      notify(`Exported ${rows.length} audit ${rows.length === 1 ? 'entry' : 'entries'}`)
    } catch {
      notify('Could not export audit log')
    }
  }, [isSuperAdmin, runAuditQuery])

  useEffect(() => {
    const timer = window.setTimeout(() => { void reloadAudit() }, 250)
    return () => window.clearTimeout(timer)
  }, [reloadAudit])

  const refresh = useCallback(async () => {
    await ensureSelfRecords()
    await loadAdminData()
    await reloadAudit()
  }, [ensureSelfRecords, loadAdminData, reloadAudit])

  const updateManagedUser = useCallback(async (targetUserId: string, updates: Partial<Profile>) => {
    if (!isSuperAdmin) return
    setBusyAction(`profile:${targetUserId}`)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', targetUserId)
      if (updateError) throw new Error(updateError.message)
      // The audit entry (with an exact before -> after diff) is written by the
      // profiles trigger; no client-side log needed.
      await refresh()
      notify('User updated')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update user profile.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, refresh])

  const updateManagedFeatures = useCallback(async (targetUserId: string, nextAccess: Partial<FeatureAccess>) => {
    if (!isSuperAdmin) return
    setBusyAction(`features:${targetUserId}`)
    setError(null)
    try {
      const payload = { user_id: targetUserId, ...nextAccess }
      const { error: upsertError } = await supabase.from('user_feature_access').upsert(payload, { onConflict: 'user_id' })
      if (upsertError) throw new Error(upsertError.message)
      // Audited by the user_feature_access trigger (records which toggles flipped).
      await refresh()
      notify('Access updated')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update feature access.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, refresh])

  const resetManagedUserPassword = useCallback(async (targetUserId: string, targetEmail: string) => {
    if (!isSuperAdmin) return
    setBusyAction(`reset:${targetUserId}`)
    setError(null)
    try {
      const redirectTo = new URL('/reset-password', window.location.origin).toString()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(targetEmail, { redirectTo })
      if (resetError) throw new Error(resetError.message)
      // No table change to trigger on, so record this one explicitly.
      await logAdminAction('password_reset_sent', 'security', targetUserId, { email: targetEmail })
      await loadAdminData()
      await reloadAudit()
      notify('Password reset email sent')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send password reset email.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, logAdminAction, loadAdminData, reloadAudit])

  const removeManagedUser = useCallback(async (targetUserId: string) => {
    if (!isSuperAdmin) return
    setBusyAction(`remove:${targetUserId}`)
    setError(null)
    try {
      const accessResult = await supabase.from('user_feature_access').delete().eq('user_id', targetUserId)
      if (accessResult.error) throw new Error(accessResult.error.message)
      // Use .select() so we can confirm a row was actually deleted. Under row-level
      // security a blocked delete succeeds but affects 0 rows, which previously showed
      // a false "success" while the user stayed in the directory.
      const { data: removedProfiles, error: profileError } = await supabase
        .from('profiles').delete().eq('id', targetUserId).select('id')
      if (profileError) throw new Error(profileError.message)
      if (!removedProfiles || removedProfiles.length === 0) {
        throw new Error('User was not removed. This requires the Super Admin delete policy — apply the add_user_delete_and_last_active.sql migration.')
      }
      // The profiles delete trigger records 'user_removed' with a snapshot of the
      // removed account (email / role / status) so the entry stays readable.
      if (selectedUserId === targetUserId) setSelectedUserId(null)
      await loadAdminData()
      await reloadAudit()
      notify('User removed')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to remove user.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, loadAdminData, reloadAudit, selectedUserId])

  const updateBugReport = useCallback(async (
    reportId: string,
    updates: Partial<Pick<BugReport, 'status' | 'admin_notes' | 'workflow_status'>>,
    options?: { publicNote?: string; notifyByEmail?: boolean },
  ) => {
    if (!isSuperAdmin) return
    setBusyAction(`bug:${reportId}`)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('bug_reports').update(updates).eq('id', reportId)
      if (updateError) throw new Error(updateError.message)

      const publicNote = options?.publicNote?.trim()
      if (publicNote) {
        // Recorded as a public timeline entry the reporter can read.
        await supabase.from('bug_report_events').insert({
          report_id: reportId,
          status: (updates.workflow_status as BugWorkflowStatus) ?? 'pending',
          note: publicNote,
          actor: 'admin',
        })
      }

      // Email the reporter about the status change (best-effort; the edge function
      // enforces the reporter's contact-me opt-in and only mails meaningful states).
      if (options?.notifyByEmail && updates.workflow_status && updates.workflow_status !== 'pending') {
        try {
          await supabase.functions.invoke('bug-status-email', {
            body: { report_id: reportId, note: publicNote ?? undefined },
          })
        } catch {
          // A mail hiccup shouldn't block the status update; the in-app
          // notification (via DB trigger) still reaches the reporter.
        }
      }

      await refresh()
      notify('Bug report updated')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update bug report.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, refresh])

  const selectedUser = useMemo(() => managedUsers.find((item) => item.id === selectedUserId) ?? null, [managedUsers, selectedUserId])

  return {
    loading,
    error,
    profile,
    isSuperAdmin,
    visibleFeatures,
    managedUsers,
    selectedUser,
    selectedUserId,
    setSelectedUserId,
    overview,
    auditLogs,
    auditFilters,
    setAuditFilters,
    auditTotal,
    auditHasMore,
    auditLoading,
    loadMoreAudit,
    reloadAudit,
    exportAuditLogs,
    defaultAuditFilters: DEFAULT_AUDIT_FILTERS,
    bugReports,
    busyAction,
    refresh,
    updateManagedUser,
    updateManagedFeatures,
    resetManagedUserPassword,
    removeManagedUser,
    updateBugReport,
    featureKeys: FEATURE_KEYS,
    defaultFeatureAccess: DEFAULT_FEATURE_ACCESS,
  }
}
