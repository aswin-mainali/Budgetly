import { supabase } from '../lib/supabase'

type RecurringKind = 'income' | 'expense'
type RecurrenceType = 'monthly' | 'weekly' | 'biweekly'
type Preferences = Record<NotificationCategory, boolean>

export type NotificationSection = 'action_needed' | 'upcoming' | 'insights' | 'system'
export type NotificationStatus = 'unread' | 'read'
export type NotificationCategory = 'bills_recurring' | 'budgets' | 'subscriptions' | 'goals' | 'investments' | 'net_worth' | 'monthly_reports' | 'system_updates'

export type BudgetlyNotification = {
  id: string
  user_id: string
  category: NotificationCategory
  section: NotificationSection
  title: string
  message: string
  type: string
  status: NotificationStatus
  action_label?: string | null
  action_target?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  read_at?: string | null
}

type RecurringRow = { id: string; user_id: string; name: string; amount: number; kind?: RecurringKind; recurrence_type: RecurrenceType; day_of_month: number; anchor_date?: string | null; category_id?: string | null }
const DEFAULT_PREFS: Preferences = { bills_recurring: true, budgets: true, subscriptions: true, goals: true, investments: true, net_worth: true, monthly_reports: true, system_updates: true }
const SUBSCRIPTION_PATTERNS = ['netflix', 'spotify', 'disney', 'apple', 'google', 'adobe', 'microsoft', 'youtube', 'amazon prime', 'prime']
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const toIsoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const money = (n: number, currency = 'CAD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n || 0))
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const insertIfMissing = async (payload: Omit<BudgetlyNotification, 'id' | 'created_at' | 'status' | 'read_at'> & { metadata: Record<string, unknown> }) => {
  const dedupeKey = String(payload.metadata?.dedupe_key || '')
  if (!dedupeKey) return false
  const existing = await supabase.from('notifications').select('id').eq('user_id', payload.user_id).contains('metadata', { dedupe_key: dedupeKey }).maybeSingle()
  if (existing.data) return false
  const { error } = await supabase.from('notifications').insert({ ...payload, status: 'unread' })
  if (error && import.meta.env.DEV) console.error('Notification insert failed', error)
  return !error
}

export const getNotifications = async (userId: string) => {
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  if (error && import.meta.env.DEV) console.error('Notification load failed', error)
  return (data ?? []) as BudgetlyNotification[]
}
export const markNotificationAsRead = async (notificationId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', notificationId)
export const markAllNotificationsAsRead = async (userId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'unread')
export const clearReadNotifications = async (userId: string) => supabase.from('notifications').delete().eq('user_id', userId).eq('status', 'read')

export const getNotificationPreferences = async (userId: string) => {
  const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle()
  if (error && import.meta.env.DEV) console.error('Preferences load failed', error)
  if (!data) {
    await supabase.from('notification_preferences').insert({ user_id: userId, ...DEFAULT_PREFS })
    return DEFAULT_PREFS
  }
  return { ...DEFAULT_PREFS, ...data } as Preferences
}
export const updateNotificationPreferences = async (userId: string, preferences: Partial<Preferences>) => {
  await supabase.from('notification_preferences').upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

const nextDueDate = (item: RecurringRow, today: Date) => {
  const start = startOfDay(today)
  if (item.recurrence_type === 'monthly') {
    const day = Math.max(1, Math.min(31, Number(item.day_of_month ?? 1) || 1))
    const thisMonthDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    let due = new Date(start.getFullYear(), start.getMonth(), Math.min(day, thisMonthDays))
    if (due < start) {
      const nextMonthDays = new Date(start.getFullYear(), start.getMonth() + 2, 0).getDate()
      due = new Date(start.getFullYear(), start.getMonth() + 1, Math.min(day, nextMonthDays))
    }
    return due
  }
  const anchorRaw = item.anchor_date ? new Date(`${item.anchor_date}T00:00:00`) : start
  const step = item.recurrence_type === 'weekly' ? 7 : 14
  let due = startOfDay(anchorRaw)
  while (due < start) due = new Date(due.getFullYear(), due.getMonth(), due.getDate() + step)
  return due
}

export const generateRecurringNotifications = async (userId: string) => {
  const { data } = await supabase.from('recurring_items').select('*').eq('user_id', userId).order('name', { ascending: true })
  const today = startOfDay(new Date())
  const recurring = (data ?? []) as RecurringRow[]
  const dueSoon = recurring.map((item) => ({ item, due: nextDueDate(item, today) })).filter(({ due }) => {
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    return days >= 0 && days <= 3
  })
  if (import.meta.env.DEV) console.log('Recurring items due within 3 days:', dueSoon.map((d) => ({ id: d.item.id, name: d.item.name, due: toIsoDay(d.due) })))
  let inserted = 0
  for (const { item, due } of dueSoon) {
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const verb = item.kind === 'income' ? 'arrives' : 'is due'
    const title = `${item.name} ${verb} ${when}`
    const amount = money(item.amount, 'CAD')
    const message = `${title} — ${amount}`
    const dedupe = `recurring-${item.id}-due-${toIsoDay(due)}`
    const ok = await insertIfMissing({ user_id: userId, category: 'bills_recurring', section: days === 0 ? 'action_needed' : 'upcoming', title, message, type: 'recurring_due', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: dedupe, recurring_id: item.id, due_date: toIsoDay(due) } })
    if (ok) inserted += 1
  }
  if (import.meta.env.DEV) console.log('Notifications inserted:', inserted)
}

export const generateSubscriptionNotifications = async (userId: string) => {
  const { data: recurring } = await supabase.from('recurring_items').select('*').eq('user_id', userId)
  const today = startOfDay(new Date())
  for (const item of ((recurring ?? []) as RecurringRow[])) {
    const name = (item.name || '').toLowerCase()
    const isSub = item.kind !== 'income' && SUBSCRIPTION_PATTERNS.some((k) => name.includes(k))
    if (!isSub) continue
    const due = nextDueDate(item, today)
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    if (days < 0 || days > 3) continue
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const title = `${item.name} charges ${when}`
    await insertIfMissing({ user_id: userId, category: 'subscriptions', section: days === 0 ? 'action_needed' : 'upcoming', title, message: `${title} — ${money(item.amount, 'CAD')}`, type: 'subscription_due', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: `subscription-${item.id}-due-${toIsoDay(due)}` } })
  }
}

export const generateBudgetNotifications = async (userId: string) => {
  const month = new Date().toISOString().slice(0, 7)
  const { data: categories } = await supabase.from('categories').select('id,name,budget_monthly').eq('user_id', userId)
  const { data: tx } = await supabase.from('transactions').select('category_id,amount,type,date').eq('user_id', userId).eq('type', 'expense').gte('date', `${month}-01`).lte('date', `${month}-31`)
  const spentBy = new Map<string, number>()
  ;(tx ?? []).forEach((t: any) => spentBy.set(t.category_id, (spentBy.get(t.category_id) ?? 0) + Number(t.amount || 0)))
  for (const c of (categories ?? []) as any[]) {
    const budget = Number(c.budget_monthly || 0); if (budget <= 0) continue
    const pct = ((spentBy.get(c.id) ?? 0) / budget) * 100
    const keyBase = c.id || slugify(c.name || 'budget')
    const rounded = Math.floor(pct)
    if (pct > 100) {
      await insertIfMissing({ user_id: userId, category: 'budgets', section: 'action_needed', title: `${c.name} exceeded budget`, message: `${c.name} is at ${rounded}% of budget.`, type: 'budget_threshold', action_label: 'View budget', action_target: 'categories', metadata: { dedupe_key: `budget-${keyBase}-exceeded-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: 'exceeded', usage_percent: rounded, month_key: month } })
    } else if (pct >= 100) {
      await insertIfMissing({ user_id: userId, category: 'budgets', section: 'action_needed', title: `${c.name} is at 100% of budget`, message: `${c.name} is at 100% of budget.`, type: 'budget_threshold', action_label: 'View budget', action_target: 'categories', metadata: { dedupe_key: `budget-${keyBase}-100-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '100', usage_percent: 100, month_key: month } })
    } else if (pct >= 90) {
      await insertIfMissing({ user_id: userId, category: 'budgets', section: 'insights', title: `${c.name} is at 90% of budget`, message: `${c.name} is at ${rounded}% of budget.`, type: 'budget_threshold', action_label: 'View budget', action_target: 'categories', metadata: { dedupe_key: `budget-${keyBase}-90-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '90', usage_percent: rounded, month_key: month } })
    } else if (pct >= 80) {
      await insertIfMissing({ user_id: userId, category: 'budgets', section: 'insights', title: `${c.name} is at 80% of budget`, message: `${c.name} is at ${rounded}% of budget.`, type: 'budget_threshold', action_label: 'View budget', action_target: 'categories', metadata: { dedupe_key: `budget-${keyBase}-80-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '80', usage_percent: rounded, month_key: month } })
    }
  }
}

export const generateInvestmentNotifications = async (userId: string) => insertIfMissing({ user_id: userId, category: 'investments', section: 'insights', title: 'Investment prices can be refreshed', message: 'Refresh investment prices to update your portfolio.', type: 'investment_refresh', action_label: 'View investments', action_target: 'utilities/investments', metadata: { dedupe_key: `investment-refresh-needed-${toIsoDay(new Date())}` } })
export const generateGoalNotifications = async (userId: string) => insertIfMissing({ user_id: userId, category: 'goals', section: 'insights', title: 'Goal progress updated', message: 'Your goals are making progress.', type: 'goal_progress', action_label: 'View goals', action_target: 'goals', metadata: { dedupe_key: `goals-progress-${new Date().toISOString().slice(0, 7)}` } })
export const generateNetWorthNotifications = async (userId: string) => insertIfMissing({ user_id: userId, category: 'net_worth', section: 'insights', title: 'Net worth update available', message: 'Review your latest net worth movement.', type: 'net_worth_update', action_label: 'View net worth', action_target: 'utilities/net-worth', metadata: { dedupe_key: `net-worth-${new Date().toISOString().slice(0, 7)}` } })
export const generateMonthlyReportNotifications = async (userId: string) => insertIfMissing({ user_id: userId, category: 'monthly_reports', section: 'system', title: `${new Date().toLocaleString(undefined, { month: 'long' })} monthly report is ready`, message: 'Your monthly report is ready.', type: 'monthly_report_ready', action_label: 'View report', action_target: 'utilities/reports', metadata: { dedupe_key: `monthly-report-ready-${new Date().toISOString().slice(0, 7)}` } })
