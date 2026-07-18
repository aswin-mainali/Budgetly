import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FeatureAccess, FeatureKey, Profile, UserFeatureAccess, AdminAuditLog, BugReport, BugReportStatus, BugWorkflowStatus } from '../types'

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
  networth: true,
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
    const [profilesResult, accessResult, accountProfilesResult, auditResult, bugResult, activityResult, txCount, catCount, recurringCount, goalCount] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_feature_access').select('*'),
      supabase.from('user_account_profiles').select('user_id,first_name,last_name,image_url'),
      supabase.from('admin_audit_logs').select('id,admin_user_id,target_user_id,action,details,created_at').order('created_at', { ascending: false }).limit(15),
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
    if (auditResult.error) throw new Error(auditResult.error.message)
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
    setAuditLogs((auditResult.data ?? []) as AdminAuditLog[])
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

  const writeAudit = useCallback(async (action: string, targetUserId: string, details: Record<string, unknown>) => {
    if (!userId || !isSuperAdmin) return
    await supabase.from('admin_audit_logs').insert({
      admin_user_id: userId,
      target_user_id: targetUserId,
      action,
      details,
    })
  }, [userId, isSuperAdmin])

  const refresh = useCallback(async () => {
    await ensureSelfRecords()
    await loadAdminData()
  }, [ensureSelfRecords, loadAdminData])

  const updateManagedUser = useCallback(async (targetUserId: string, updates: Partial<Profile>) => {
    if (!isSuperAdmin) return
    setBusyAction(`profile:${targetUserId}`)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('profiles').update(updates).eq('id', targetUserId)
      if (updateError) throw new Error(updateError.message)
      await writeAudit('profile_update', targetUserId, updates)
      await refresh()
      notify('User updated')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update user profile.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, refresh, writeAudit])

  const updateManagedFeatures = useCallback(async (targetUserId: string, nextAccess: Partial<FeatureAccess>) => {
    if (!isSuperAdmin) return
    setBusyAction(`features:${targetUserId}`)
    setError(null)
    try {
      const payload = { user_id: targetUserId, ...nextAccess }
      const { error: upsertError } = await supabase.from('user_feature_access').upsert(payload, { onConflict: 'user_id' })
      if (upsertError) throw new Error(upsertError.message)
      await writeAudit('feature_access_update', targetUserId, nextAccess)
      await refresh()
      notify('Access updated')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update feature access.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, refresh, writeAudit])

  const resetManagedUserPassword = useCallback(async (targetUserId: string, targetEmail: string) => {
    if (!isSuperAdmin) return
    setBusyAction(`reset:${targetUserId}`)
    setError(null)
    try {
      const redirectTo = new URL('/reset-password', window.location.origin).toString()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(targetEmail, { redirectTo })
      if (resetError) throw new Error(resetError.message)
      await writeAudit('password_reset_sent', targetUserId, { email: targetEmail })
      await loadAdminData()
      notify('Password reset email sent')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to send password reset email.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, writeAudit, loadAdminData])

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
      await writeAudit('user_removed', targetUserId, {})
      if (selectedUserId === targetUserId) setSelectedUserId(null)
      await loadAdminData()
      notify('User removed')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to remove user.')
    } finally {
      setBusyAction(null)
    }
  }, [isSuperAdmin, writeAudit, loadAdminData, selectedUserId])

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
