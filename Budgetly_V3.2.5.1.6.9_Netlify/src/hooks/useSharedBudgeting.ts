import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  SharedSpace,
  SharedSpaceMember,
  SharedSpaceInvite,
  SharedExpense,
  SharedSettlement,
  SharedSplitType,
} from '../types'

const notify = (message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))
}

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The fraction of an expense the NON-payer owes the payer, derived from the
// payer's responsibility percentage (payer_share).
const otherOwedFraction = (payerShare: number) => Math.min(1, Math.max(0, (100 - payerShare) / 100))

export type SharedBalance = {
  // Net amount the OTHER member owes ME. Positive → they owe me; negative → I owe them.
  net: number
  otherUserId: string | null
}

export type ActionResult = { ok: boolean; error?: string }

export type AddExpenseInput = {
  amount: number
  paidBy: string
  note: string
  emoji?: string | null
  date?: string
  splitType: SharedSplitType
  // Percentage the payer is responsible for (0–100). Ignored for the *_full types.
  payerShare?: number
}

export function useSharedBudgeting(userId: string | null, email: string | null, hasFeature: boolean) {
  const [loading, setLoading] = useState(true)
  const [spaces, setSpaces] = useState<SharedSpace[]>([])
  const [members, setMembers] = useState<SharedSpaceMember[]>([])
  const [expenses, setExpenses] = useState<SharedExpense[]>([])
  const [settlements, setSettlements] = useState<SharedSettlement[]>([])
  const [invites, setInvites] = useState<SharedSpaceInvite[]>([])
  const [emailByUser, setEmailByUser] = useState<Record<string, string>>({})
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRef = useRef<string | null>(null)
  activeRef.current = activeSpaceId

  const myEmail = (email ?? '').toLowerCase()

  const load = useCallback(async () => {
    if (!userId || !hasFeature) {
      setSpaces([]); setMembers([]); setExpenses([]); setSettlements([]); setInvites([]); setEmailByUser({})
      setLoading(false)
      return
    }
    setError(null)
    try {
      // Which spaces am I in? RLS scopes every table below to my spaces.
      const membershipRes = await supabase
        .from('shared_space_members')
        .select('space_id')
        .eq('user_id', userId)
      if (membershipRes.error) throw membershipRes.error
      const spaceIds = (membershipRes.data ?? []).map((r) => r.space_id as string)

      const [spacesRes, membersRes, expensesRes, settlementsRes, invitesRes] = await Promise.all([
        spaceIds.length
          ? supabase.from('shared_spaces').select('*').in('id', spaceIds)
          : Promise.resolve({ data: [], error: null }),
        spaceIds.length
          ? supabase.from('shared_space_members').select('*').in('space_id', spaceIds)
          : Promise.resolve({ data: [], error: null }),
        spaceIds.length
          ? supabase.from('shared_expenses').select('*').in('space_id', spaceIds).order('date', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        spaceIds.length
          ? supabase.from('shared_settlements').select('*').in('space_id', spaceIds).order('date', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        // Every invite visible to me: ones sent to my email + ones in my spaces.
        supabase.from('shared_space_invites').select('*').eq('status', 'pending'),
      ])

      if (spacesRes.error) throw spacesRes.error
      if (membersRes.error) throw membersRes.error
      if (expensesRes.error) throw expensesRes.error
      if (settlementsRes.error) throw settlementsRes.error
      if (invitesRes.error) throw invitesRes.error

      const nextSpaces = (spacesRes.data ?? []) as SharedSpace[]
      setSpaces(nextSpaces)
      setMembers((membersRes.data ?? []) as SharedSpaceMember[])
      setExpenses((expensesRes.data ?? []) as SharedExpense[])
      setSettlements((settlementsRes.data ?? []) as SharedSettlement[])
      setInvites((invitesRes.data ?? []) as SharedSpaceInvite[])

      // Resolve member emails for labelling (one RPC per space).
      const emailMap: Record<string, string> = {}
      await Promise.all(spaceIds.map(async (sid) => {
        const res = await supabase.rpc('shared_space_member_emails', { p_space_id: sid })
        if (!res.error && Array.isArray(res.data)) {
          for (const row of res.data as Array<{ user_id: string; email: string }>) {
            emailMap[row.user_id] = row.email
          }
        }
      }))
      setEmailByUser(emailMap)

      // Keep a sensible active space selected.
      setActiveSpaceId((current) => {
        if (current && nextSpaces.some((s) => s.id === current)) return current
        return nextSpaces[0]?.id ?? null
      })
    } catch (err: any) {
      setError(err?.message ?? 'Could not load shared budgeting data.')
    } finally {
      setLoading(false)
    }
  }, [userId, hasFeature])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Realtime: any change to my shared rows triggers a reload. RLS guarantees a
  // refetch only ever returns rows I'm allowed to see.
  useEffect(() => {
    if (!userId || !hasFeature) return
    const channel = supabase
      .channel(`shared:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_expenses' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_settlements' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_space_members' }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_space_invites' }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, hasFeature, load])

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  )

  const spaceMembers = useMemo(
    () => members
      .filter((m) => m.space_id === activeSpaceId)
      .map((m) => ({ ...m, email: emailByUser[m.user_id] ?? null })),
    [members, activeSpaceId, emailByUser],
  )

  const otherMember = useMemo(
    () => spaceMembers.find((m) => m.user_id !== userId) ?? null,
    [spaceMembers, userId],
  )

  const spaceExpenses = useMemo(
    () => expenses.filter((e) => e.space_id === activeSpaceId),
    [expenses, activeSpaceId],
  )

  const spaceSettlements = useMemo(
    () => settlements.filter((s) => s.space_id === activeSpaceId),
    [settlements, activeSpaceId],
  )

  // Invites addressed to me for spaces I have NOT joined yet.
  const incomingInvites = useMemo(() => {
    const joined = new Set(members.filter((m) => m.user_id === userId).map((m) => m.space_id))
    return invites.filter((i) => i.invitee_email.toLowerCase() === myEmail && i.status === 'pending' && !joined.has(i.space_id))
  }, [invites, members, userId, myEmail])

  // Invites I sent that are still pending, for the active space.
  const outgoingInvites = useMemo(
    () => invites.filter((i) => i.space_id === activeSpaceId && i.status === 'pending' && i.invitee_email.toLowerCase() !== myEmail),
    [invites, activeSpaceId, myEmail],
  )

  // Running balance for the active (2-person) space, from my perspective.
  const balance = useMemo<SharedBalance>(() => {
    if (!userId || !otherMember) return { net: 0, otherUserId: otherMember?.user_id ?? null }
    let net = 0
    for (const e of spaceExpenses) {
      const owed = e.amount * otherOwedFraction(e.payer_share)
      if (e.paid_by === userId) net += owed          // other owes me their share
      else if (e.paid_by === otherMember.user_id) net -= owed // I owe the payer my share
    }
    for (const s of spaceSettlements) {
      if (s.from_user === userId) net += s.amount     // I repaid → my debt shrinks
      else if (s.to_user === userId) net -= s.amount  // I was repaid → their debt to me shrinks
    }
    return { net: Math.round(net * 100) / 100, otherUserId: otherMember.user_id }
  }, [spaceExpenses, spaceSettlements, userId, otherMember])

  // Totals for the shared dashboard: how much each member has paid into the space.
  const paidTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const e of spaceExpenses) totals[e.paid_by] = (totals[e.paid_by] ?? 0) + e.amount
    return totals
  }, [spaceExpenses])

  const totalShared = useMemo(
    () => spaceExpenses.reduce((sum, e) => sum + e.amount, 0),
    [spaceExpenses],
  )

  const labelFor = useCallback((uid: string | null | undefined) => {
    if (!uid) return 'Someone'
    if (uid === userId) return 'You'
    const mail = emailByUser[uid]
    return mail ? mail.split('@')[0] : 'Partner'
  }, [emailByUser, userId])

  // ------------------------------------------------------------------- actions
  const run = useCallback(async (fn: () => Promise<void>, successMessage?: string): Promise<ActionResult> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (successMessage) notify(successMessage)
      await load()
      return { ok: true }
    } catch (err: any) {
      const message = err?.message ?? 'Something went wrong.'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setBusy(false)
    }
  }, [load])

  const createSpace = useCallback((name: string, currency: string, inviteeEmail?: string) =>
    run(async () => {
      const res = await supabase.rpc('create_shared_space', {
        p_name: name,
        p_currency: currency || 'CAD',
        p_invitee_email: inviteeEmail?.trim() ? inviteeEmail.trim() : null,
      })
      if (res.error) throw res.error
      if (typeof res.data === 'string') setActiveSpaceId(res.data)
    }, inviteeEmail?.trim() ? 'Space created and invite sent' : 'Shared space created'),
  [run])

  const invitePartner = useCallback((spaceId: string, inviteeEmail: string) =>
    run(async () => {
      const res = await supabase.rpc('invite_to_shared_space', { p_space_id: spaceId, p_invitee_email: inviteeEmail })
      if (res.error) throw res.error
    }, 'Invite sent'),
  [run])

  const acceptInvite = useCallback((inviteId: string) =>
    run(async () => {
      const res = await supabase.rpc('accept_shared_invite', { p_invite_id: inviteId })
      if (res.error) throw res.error
      if (typeof res.data === 'string') setActiveSpaceId(res.data)
    }, 'You joined the shared space'),
  [run])

  const declineInvite = useCallback((inviteId: string) =>
    run(async () => {
      const res = await supabase.rpc('decline_shared_invite', { p_invite_id: inviteId })
      if (res.error) throw res.error
    }, 'Invite declined'),
  [run])

  const leaveSpace = useCallback((spaceId: string) =>
    run(async () => {
      const res = await supabase.rpc('leave_shared_space', { p_space_id: spaceId })
      if (res.error) throw res.error
      setActiveSpaceId(null)
    }, 'You left the shared space'),
  [run])

  const addExpense = useCallback((input: AddExpenseInput) => {
    if (!activeSpaceId || !userId) return Promise.resolve({ ok: false, error: 'No active space.' })
    const payerShare =
      input.splitType === 'equal' ? 50 :
      input.splitType === 'payer_full' ? 100 :
      input.splitType === 'other_full' ? 0 :
      Math.min(100, Math.max(0, input.payerShare ?? 50))
    return run(async () => {
      const res = await supabase.from('shared_expenses').insert({
        space_id: activeSpaceId,
        paid_by: input.paidBy,
        created_by: userId,
        amount: input.amount,
        note: input.note?.trim() || null,
        emoji: input.emoji ?? null,
        date: input.date || todayIso(),
        split_type: input.splitType,
        payer_share: payerShare,
      })
      if (res.error) throw res.error
    }, 'Shared expense added')
  }, [activeSpaceId, userId, run])

  const deleteExpense = useCallback((id: string) =>
    run(async () => {
      const res = await supabase.from('shared_expenses').delete().eq('id', id)
      if (res.error) throw res.error
    }, 'Expense removed'),
  [run])

  const deleteSettlement = useCallback((id: string) =>
    run(async () => {
      const res = await supabase.from('shared_settlements').delete().eq('id', id)
      if (res.error) throw res.error
    }, 'Settlement removed'),
  [run])

  // Settle the whole outstanding balance: the debtor pays the creditor.
  const settleUp = useCallback((amount: number, note?: string) => {
    if (!activeSpaceId || !userId || !otherMember) return Promise.resolve({ ok: false, error: 'No partner to settle with.' })
    // net > 0 → other owes me, so THEY pay ME. net < 0 → I owe them, so I pay them.
    const fromUser = balance.net >= 0 ? otherMember.user_id : userId
    const toUser = balance.net >= 0 ? userId : otherMember.user_id
    return run(async () => {
      const res = await supabase.from('shared_settlements').insert({
        space_id: activeSpaceId,
        from_user: fromUser,
        to_user: toUser,
        amount,
        note: note?.trim() || null,
        date: todayIso(),
      })
      if (res.error) throw res.error
    }, 'Balance settled')
  }, [activeSpaceId, userId, otherMember, balance.net, run])

  return {
    loading,
    busy,
    error,
    spaces,
    activeSpace,
    activeSpaceId,
    setActiveSpaceId,
    spaceMembers,
    otherMember,
    spaceExpenses,
    spaceSettlements,
    incomingInvites,
    outgoingInvites,
    balance,
    paidTotals,
    totalShared,
    emailByUser,
    labelFor,
    refresh: load,
    createSpace,
    invitePartner,
    acceptInvite,
    declineInvite,
    leaveSpace,
    addExpense,
    deleteExpense,
    deleteSettlement,
    settleUp,
  }
}

export type SharedBudgetingApi = ReturnType<typeof useSharedBudgeting>
