import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FeatureAccess, FeatureKey, Profile, UserFeatureAccess, AdminAuditLog, BugReport, BugReportStatus } from '../types'

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
  support: true,
  settings: true,
}

const FEATURE_KEYS = Object.keys(DEFAULT_FEATURE_ACCESS) as FeatureKey[]

export type AdminManagedUser = Profile & {
  feature_access: UserFeatureAccess | null
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

    let currentProfile = await getSingleOrNull(
      supabase.from('profiles').select('id,email,first_name,last_name,avatar_url,role,is_active,created_at,updated_at').eq('id', userId).maybeSingle(),
    ) as Profile | null

    if (!currentProfile) {
      const insertResult = await supabase.from('profiles').insert({ id: userId, email: email ?? '', role: 'user', is_active: true })
      if (insertResult.error && insertResult.error.code !== '23505') throw new Error(insertResult.error.message || 'Failed to create profile.')
      currentProfile = await getSingleOrNull(
        supabase.from('profiles').select('id,email,first_name,last_name,avatar_url,role,is_active,created_at,updated_at').eq('id', userId).maybeSingle(),
      ) as Profile | null
    }

    let currentAccess = await getSingleOrNull(
      supabase.from('user_feature_access').select('user_id,dashboard,transactions,categories,recurring,reports,goals,advice,converter,support,settings,created_at,updated_at').eq('user_id', userId).maybeSingle(),
    ) as UserFeatureAccess | null

    if (!currentAccess) {
      const insertResult = await supabase.from('user_feature_access').insert({ user_id: userId, ...DEFAULT_FEATURE_ACCESS })
      if (insertResult.error && insertResult.error.code !== '23505') throw new Error(insertResult.error.message || 'Failed to create feature access row.')
      currentAccess = await getSingleOrNull(
        supabase.from('user_feature_access').select('user_id,dashboard,transactions,categories,recurring,reports,goals,advice,converter,support,settings,created_at,updated_at').eq('user_id', userId).maybeSingle(),
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
    const [profilesResult, accessResult, auditResult, bugResult, txCount, catCount, recurringCount, goalCount] = await Promise.all([
      supabase.from('profiles').select('id,email,first_name,last_name,avatar_url,role,is_active,created_at,updated_at').order('created_at', { ascending: false }),
      supabase.from('user_feature_access').select('user_id,dashboard,transactions,categories,recurring,reports,goals,advice,converter,support,settings,created_at,updated_at'),
      supabase.from('admin_audit_logs').select('id,admin_user_id,target_user_id,action,details,created_at').order('created_at', { ascending: false }).limit(15),
      supabase.from('bug_reports').select('id,user_id,user_email,steps_to_reproduce,contact_when_resolved,screenshot_name,screenshot_data_url,status,admin_notes,created_at,updated_at').order('created_at', { ascending: false }),
      supabase.from('transactions').select('*', { count: 'exact', head: true }),
      supabase.from('categories').select('*', { count: 'exact', head: true }),
      supabase.from('recurring_items').select('*', { count: 'exact', head: true }),
      supabase.from('goals').select('*', { count: 'exact', head: true }),
    ])

    if (profilesResult.error) throw new Error(profilesResult.error.message)
    if (accessResult.error) throw new Error(accessResult.error.message)
    if (auditResult.error) throw new Error(auditResult.error.message)
    if (bugResult.error) throw new Error(bugResult.error.message)

    const accessMap = new Map((accessResult.data ?? []).map((row) => [row.user_id, row]))
    const nextManagedUsers = (profilesResult.data ?? []).map((item) => ({
      ...item,
      feature_access: accessMap.get(item.id) ?? null,
    })) as AdminManagedUser[]

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

  const updateBugReport = useCallback(async (reportId: string, updates: Partial<Pick<BugReport, 'status' | 'admin_notes'>>) => {
    if (!isSuperAdmin) return
    setBusyAction(`bug:${reportId}`)
    setError(null)
    try {
      const { error: updateError } = await supabase.from('bug_reports').update(updates).eq('id', reportId)
      if (updateError) throw new Error(updateError.message)
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
    updateBugReport,
    featureKeys: FEATURE_KEYS,
    defaultFeatureAccess: DEFAULT_FEATURE_ACCESS,
  }
}
