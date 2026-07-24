import { supabase } from '../lib/supabase'

type RecurringKind = 'income' | 'expense'
type RecurrenceType = 'monthly' | 'weekly' | 'biweekly'
type Preferences = Record<NotificationCategory, boolean> & NotificationSettings

export type NotificationSection = 'action_needed' | 'upcoming' | 'insights' | 'system'
export type NotificationStatus = 'unread' | 'read'
export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low'
export type NotificationCategory = 'bills_recurring' | 'budgets' | 'subscriptions' | 'goals' | 'investments' | 'net_worth' | 'monthly_reports' | 'system_updates' | 'documents'
export type MuteScope = 'dedupe' | 'group' | 'category' | 'type'

export type NotificationSettings = {
  channel_in_app: boolean
  channel_push: boolean
  channel_email: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: number
  quiet_hours_end: number
  email_digest_frequency: 'off' | 'daily' | 'weekly'
  min_priority: NotificationPriority
  timezone: string
  last_generated_at?: string | null
  last_digest_at?: string | null
}

export type BudgetlyNotification = {
  id: string
  user_id: string
  category: NotificationCategory
  section: NotificationSection
  title: string
  message: string
  type: string
  status: NotificationStatus
  priority: NotificationPriority
  group_key?: string | null
  action_label?: string | null
  action_target?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  read_at?: string | null
  expires_at?: string | null
  archived_at?: string | null
}

export type NotificationMute = { mute_key: string; scope: MuteScope; expires_at?: string | null }

type RecurringRow = { id: string; user_id: string; name: string; amount: number; kind?: RecurringKind; recurrence_type: RecurrenceType; day_of_month: number; anchor_date?: string | null; category_id?: string | null }
type GoalRow = { id: string; name: string; emoji?: string | null; target_amount: number; current_amount: number; target_date?: string | null }
type HoldingRow = { id: string; symbol: string; company_name: string; quantity: number; average_cost: number; current_price: number; previous_close?: number | null; currency?: string | null; last_price_updated_at?: string | null }
type SnapshotRow = { date_key: string; total_value: number }
type TxRow = { id: string; category_id: string | null; amount: number; type: string; date: string; note?: string | null }
type VaultDocRow = { id: string; title: string | null; doc_type: string | null; issuer: string | null; expiration_date: string | null }

const DEFAULT_CATEGORY_PREFS: Record<NotificationCategory, boolean> = { bills_recurring: true, budgets: true, subscriptions: true, goals: true, investments: true, net_worth: true, monthly_reports: true, system_updates: true, documents: true }
const DEFAULT_SETTINGS: NotificationSettings = { channel_in_app: true, channel_push: false, channel_email: false, quiet_hours_enabled: false, quiet_hours_start: 22, quiet_hours_end: 7, email_digest_frequency: 'weekly', min_priority: 'low', timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : 'UTC' }
export const DEFAULT_PREFERENCES: Preferences = { ...DEFAULT_CATEGORY_PREFS, ...DEFAULT_SETTINGS }

const SUBSCRIPTION_PATTERNS = ['netflix', 'spotify', 'disney', 'apple', 'google', 'adobe', 'microsoft', 'youtube', 'amazon prime', 'prime']
const GOAL_MILESTONES = [25, 50, 75, 100]
const GENERATION_THROTTLE_MS = 6 * 60 * 60 * 1000 // regenerate at most every 6h per user
const PRIORITY_RANK: Record<NotificationPriority, number> = { low: 0, normal: 1, high: 2, critical: 3 }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const toIsoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const money = (n: number, currency = 'CAD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n || 0)) }
  catch { return `${currency} ${Number(n || 0).toFixed(2)}` }
}

// The user's chosen currency lives in the per-user localStorage cache written by useBudgetApp.
const resolveCurrency = (userId: string): string => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`raswibudgeting:cloud:v1:${userId}`) : null
    if (raw) { const parsed = JSON.parse(raw) as { currency?: string }; if (parsed?.currency) return parsed.currency }
  } catch { /* ignore */ }
  return 'CAD'
}

// ---------------------------------------------------------------------------
// Generation context — loaded once per run and shared across all generators.
// ---------------------------------------------------------------------------
type GenContext = { userId: string; currency: string; now: Date; muteKeys: Set<string> }

const buildContext = async (userId: string): Promise<GenContext> => {
  const now = new Date()
  const { data } = await supabase.from('notification_mutes').select('mute_key,scope,expires_at').eq('user_id', userId)
  const muteKeys = new Set<string>()
  for (const m of (data ?? []) as NotificationMute[]) {
    if (m.expires_at && new Date(m.expires_at).getTime() < now.getTime()) continue
    muteKeys.add(`${m.scope}:${m.mute_key}`)
  }
  return { userId, currency: resolveCurrency(userId), now, muteKeys }
}

const isMuted = (ctx: GenContext, payload: { metadata?: Record<string, unknown>; group_key?: string | null; category: string; type: string }) => {
  const dedupe = String(payload.metadata?.dedupe_key || '')
  if (dedupe && ctx.muteKeys.has(`dedupe:${dedupe}`)) return true
  if (payload.group_key && ctx.muteKeys.has(`group:${payload.group_key}`)) return true
  if (ctx.muteKeys.has(`category:${payload.category}`)) return true
  if (ctx.muteKeys.has(`type:${payload.type}`)) return true
  return false
}

type InsertPayload = Omit<BudgetlyNotification, 'id' | 'created_at' | 'status' | 'read_at' | 'archived_at' | 'priority'> & {
  metadata: Record<string, unknown>
  priority?: NotificationPriority
  group_key?: string | null
  expires_at?: string | null
}

const insertIfMissing = async (ctx: GenContext, payload: InsertPayload) => {
  const dedupeKey = String(payload.metadata?.dedupe_key || '')
  if (!dedupeKey) return false
  if (isMuted(ctx, { metadata: payload.metadata, group_key: payload.group_key, category: payload.category, type: payload.type })) return false
  const existing = await supabase.from('notifications').select('id').eq('user_id', payload.user_id).contains('metadata', { dedupe_key: dedupeKey }).maybeSingle()
  if (existing.data) return false
  const { error } = await supabase.from('notifications').insert({ ...payload, priority: payload.priority ?? 'normal', status: 'unread' })
  if (error && import.meta.env.DEV) console.error('Notification insert failed', error)
  return !error
}

// ---------------------------------------------------------------------------
// Reads / mutations
// ---------------------------------------------------------------------------
export const getNotifications = async (userId: string, limit = 50) => {
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).is('archived_at', null).order('created_at', { ascending: false }).limit(limit)
  if (error && import.meta.env.DEV) console.error('Notification load failed', error)
  return (data ?? []) as BudgetlyNotification[]
}
export const markNotificationAsRead = async (notificationId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', notificationId)
export const markAllNotificationsAsRead = async (userId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'unread')
export const clearReadNotifications = async (userId: string) => supabase.from('notifications').delete().eq('user_id', userId).eq('status', 'read')
export const archiveNotification = async (notificationId: string) => supabase.from('notifications').update({ archived_at: new Date().toISOString() }).eq('id', notificationId)

// Snooze = temporary mute (auto-expires); Mute = permanent. Both also clear the current row.
export const snoozeNotification = async (userId: string, notification: BudgetlyNotification, hours = 24) => {
  const dedupe = typeof notification.metadata?.dedupe_key === 'string' ? notification.metadata.dedupe_key : null
  const key = dedupe ?? notification.group_key ?? notification.type
  const scope: MuteScope = dedupe ? 'dedupe' : notification.group_key ? 'group' : 'type'
  const expires_at = new Date(Date.now() + hours * 3600000).toISOString()
  await supabase.from('notification_mutes').upsert({ user_id: userId, mute_key: key, scope, expires_at }, { onConflict: 'user_id,mute_key,scope' })
  await archiveNotification(notification.id)
}
export const muteNotification = async (userId: string, notification: BudgetlyNotification, scope: MuteScope = 'type') => {
  const dedupe = typeof notification.metadata?.dedupe_key === 'string' ? notification.metadata.dedupe_key : null
  const key = scope === 'category' ? notification.category : scope === 'group' ? (notification.group_key ?? notification.type) : scope === 'dedupe' ? (dedupe ?? notification.type) : notification.type
  await supabase.from('notification_mutes').upsert({ user_id: userId, mute_key: key, scope, expires_at: null }, { onConflict: 'user_id,mute_key,scope' })
  await archiveNotification(notification.id)
}
export const getMutes = async (userId: string) => {
  const { data } = await supabase.from('notification_mutes').select('mute_key,scope,expires_at').eq('user_id', userId)
  return (data ?? []) as NotificationMute[]
}
export const unmute = async (userId: string, mute_key: string, scope: MuteScope) =>
  supabase.from('notification_mutes').delete().eq('user_id', userId).eq('mute_key', mute_key).eq('scope', scope)

// ---------------------------------------------------------------------------
// Preferences (categories + delivery settings)
// ---------------------------------------------------------------------------
export const getNotificationPreferences = async (userId: string): Promise<Preferences> => {
  const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle()
  if (error && import.meta.env.DEV) console.error('Preferences load failed', error)
  if (!data) {
    await supabase.from('notification_preferences').insert({ user_id: userId, ...DEFAULT_CATEGORY_PREFS })
    return { ...DEFAULT_PREFERENCES }
  }
  return { ...DEFAULT_PREFERENCES, ...data } as Preferences
}
export const updateNotificationPreferences = async (userId: string, preferences: Partial<Preferences>) => {
  await supabase.from('notification_preferences').upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

// Local (client) evaluation of quiet hours, so the UI can suppress noisy push locally too.
export const isWithinQuietHours = (settings: Pick<NotificationSettings, 'quiet_hours_enabled' | 'quiet_hours_start' | 'quiet_hours_end'>, at = new Date()) => {
  if (!settings.quiet_hours_enabled) return false
  const hour = at.getHours()
  const { quiet_hours_start: s, quiet_hours_end: e } = settings
  return s <= e ? hour >= s && hour < e : hour >= s || hour < e
}
export const meetsPriorityThreshold = (priority: NotificationPriority, min: NotificationPriority) => PRIORITY_RANK[priority] >= PRIORITY_RANK[min]

// ---------------------------------------------------------------------------
// Due-date maths for recurring items
// ---------------------------------------------------------------------------
const nextDueDate = (item: RecurringRow, today: Date) => {
  const start = startOfDay(today)
  if (item.recurrence_type === 'monthly') {
    const day = Math.max(1, Math.min(31, Number(item.day_of_month ?? 1) || 1))
    const thisMonthDays = daysInMonth(start)
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

// ---------------------------------------------------------------------------
// Generators (internal, ctx-driven)
// ---------------------------------------------------------------------------
const genRecurring = async (ctx: GenContext) => {
  const { data } = await supabase.from('recurring_items').select('*').eq('user_id', ctx.userId).order('name', { ascending: true })
  const today = startOfDay(ctx.now)
  const recurring = (data ?? []) as RecurringRow[]
  for (const item of recurring) {
    const due = nextDueDate(item, today)
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    if (days < 0 || days > 3) continue
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const verb = item.kind === 'income' ? 'arrives' : 'is due'
    const title = `${item.name} ${verb} ${when}`
    const message = `${title} — ${money(item.amount, ctx.currency)}`
    await insertIfMissing(ctx, {
      user_id: ctx.userId, category: 'bills_recurring', section: days === 0 ? 'action_needed' : 'upcoming',
      title, message, type: 'recurring_due', priority: days === 0 ? 'high' : 'normal', group_key: 'recurring_due',
      action_label: 'View recurring', action_target: 'recurring',
      metadata: { dedupe_key: `recurring-${item.id}-due-${toIsoDay(due)}`, recurring_id: item.id, due_date: toIsoDay(due) },
    })
  }
}

const genSubscriptions = async (ctx: GenContext) => {
  const { data } = await supabase.from('recurring_items').select('*').eq('user_id', ctx.userId)
  const today = startOfDay(ctx.now)
  for (const item of ((data ?? []) as RecurringRow[])) {
    const name = (item.name || '').toLowerCase()
    if (item.kind === 'income' || !SUBSCRIPTION_PATTERNS.some((k) => name.includes(k))) continue
    const due = nextDueDate(item, today)
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    if (days < 0 || days > 3) continue
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const title = `${item.name} charges ${when}`
    await insertIfMissing(ctx, {
      user_id: ctx.userId, category: 'subscriptions', section: days === 0 ? 'action_needed' : 'upcoming',
      title, message: `${title} — ${money(item.amount, ctx.currency)}`, type: 'subscription_due',
      priority: days === 0 ? 'high' : 'normal', group_key: 'subscription_due',
      action_label: 'View recurring', action_target: 'recurring',
      metadata: { dedupe_key: `subscription-${item.id}-due-${toIsoDay(due)}` },
    })
  }
}

const genBudgets = async (ctx: GenContext) => {
  const now = ctx.now
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthEnd = `${month}-${String(daysInMonth(now)).padStart(2, '0')}`
  const { data: categories } = await supabase.from('categories').select('id,name,budget_monthly').eq('user_id', ctx.userId)
  const { data: tx } = await supabase.from('transactions').select('category_id,amount,type,date').eq('user_id', ctx.userId).eq('type', 'expense').gte('date', `${month}-01`).lte('date', monthEnd)
  const spentBy = new Map<string, number>()
  ;(tx ?? []).forEach((t: any) => spentBy.set(t.category_id, (spentBy.get(t.category_id) ?? 0) + Number(t.amount || 0)))

  const dayOfMonth = now.getDate()
  const totalDays = daysInMonth(now)
  for (const c of (categories ?? []) as any[]) {
    const budget = Number(c.budget_monthly || 0); if (budget <= 0) continue
    const spent = spentBy.get(c.id) ?? 0
    const pct = (spent / budget) * 100
    const rounded = Math.floor(pct)
    const keyBase = c.id || slugify(c.name || 'budget')
    const base = { user_id: ctx.userId, category: 'budgets' as const, group_key: `budget-${keyBase}`, action_label: 'View budget', action_target: 'categories', type: 'budget_threshold' }

    if (pct > 100) {
      await insertIfMissing(ctx, { ...base, section: 'action_needed', title: `${c.name} exceeded budget`, message: `${c.name} is at ${rounded}% of budget (${money(spent, ctx.currency)} of ${money(budget, ctx.currency)}).`, priority: 'high', metadata: { dedupe_key: `budget-${keyBase}-exceeded-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: 'exceeded', usage_percent: rounded, month_key: month } })
    } else if (pct >= 100) {
      await insertIfMissing(ctx, { ...base, section: 'action_needed', title: `${c.name} is at 100% of budget`, message: `${c.name} has reached its ${money(budget, ctx.currency)} budget.`, priority: 'high', metadata: { dedupe_key: `budget-${keyBase}-100-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '100', usage_percent: 100, month_key: month } })
    } else if (pct >= 90) {
      await insertIfMissing(ctx, { ...base, section: 'insights', title: `${c.name} is at 90% of budget`, message: `${c.name} is at ${rounded}% of budget.`, priority: 'normal', metadata: { dedupe_key: `budget-${keyBase}-90-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '90', usage_percent: rounded, month_key: month } })
    } else if (pct >= 80) {
      await insertIfMissing(ctx, { ...base, section: 'insights', title: `${c.name} is at 80% of budget`, message: `${c.name} is at ${rounded}% of budget.`, priority: 'low', metadata: { dedupe_key: `budget-${keyBase}-80-${month}`, budget_id: c.id ?? null, category_name: c.name, threshold: '80', usage_percent: rounded, month_key: month } })
    }

    // Forecast: on track to overspend before month-end even though not yet over.
    if (pct < 100 && dayOfMonth >= 5) {
      const projected = (spent / dayOfMonth) * totalDays
      if (projected > budget * 1.05) {
        const overBy = projected - budget
        const projDay = Math.max(1, Math.min(totalDays, Math.ceil((budget / spent) * dayOfMonth)))
        await insertIfMissing(ctx, { ...base, type: 'budget_forecast', section: 'insights', title: `${c.name} is trending over budget`, message: `At this pace you'll spend about ${money(projected, ctx.currency)} — roughly ${money(overBy, ctx.currency)} over, hitting 100% around the ${projDay}${projDay === 1 ? 'st' : projDay === 2 ? 'nd' : projDay === 3 ? 'rd' : 'th'}.`, priority: 'normal', metadata: { dedupe_key: `budget-${keyBase}-forecast-${month}`, budget_id: c.id ?? null, category_name: c.name, projected: Math.round(projected), month_key: month } })
      }
    }
  }
}

const genGoals = async (ctx: GenContext) => {
  const { data } = await supabase.from('goals').select('id,name,emoji,target_amount,current_amount,target_date').eq('user_id', ctx.userId)
  for (const g of ((data ?? []) as GoalRow[])) {
    const target = Number(g.target_amount || 0); if (target <= 0) continue
    const pct = Math.floor((Number(g.current_amount || 0) / target) * 100)
    const milestone = [...GOAL_MILESTONES].reverse().find((m) => pct >= m)
    if (!milestone) continue
    const reached = milestone === 100
    await insertIfMissing(ctx, {
      user_id: ctx.userId, category: 'goals', section: reached ? 'action_needed' : 'insights',
      title: reached ? `🎉 Goal reached: ${g.name}` : `${g.emoji ? g.emoji + ' ' : ''}${g.name} is ${milestone}% funded`,
      message: reached ? `You've fully funded ${g.name} (${money(g.current_amount, ctx.currency)} of ${money(target, ctx.currency)}).` : `${g.name} just crossed ${milestone}% — ${money(g.current_amount, ctx.currency)} of ${money(target, ctx.currency)} saved.`,
      type: 'goal_milestone', priority: reached ? 'high' : 'low', group_key: `goal-${g.id}`,
      action_label: 'View goals', action_target: 'goals',
      metadata: { dedupe_key: `goal-${g.id}-milestone-${milestone}`, goal_id: g.id, milestone, usage_percent: pct },
    })
  }
}

const genInvestments = async (ctx: GenContext) => {
  const { data } = await supabase.from('investment_holdings').select('id,symbol,company_name,quantity,average_cost,current_price,previous_close,currency,last_price_updated_at').eq('user_id', ctx.userId)
  const holdings = (data ?? []) as HoldingRow[]
  if (!holdings.length) return
  const today = toIsoDay(ctx.now)
  let dayValue = 0, prevValue = 0, staleCount = 0
  for (const h of holdings) {
    const qty = Number(h.quantity || 0)
    dayValue += qty * Number(h.current_price || 0)
    prevValue += qty * Number(h.previous_close || h.current_price || 0)
    const updated = h.last_price_updated_at ? new Date(h.last_price_updated_at).getTime() : 0
    if (!updated || ctx.now.getTime() - updated > 24 * 3600000) staleCount += 1

    // Notable single-holding daily move.
    const prev = Number(h.previous_close || 0)
    if (prev > 0) {
      const movePct = ((Number(h.current_price || 0) - prev) / prev) * 100
      if (Math.abs(movePct) >= 5) {
        const up = movePct >= 0
        await insertIfMissing(ctx, {
          user_id: ctx.userId, category: 'investments', section: 'insights',
          title: `${h.symbol} ${up ? 'up' : 'down'} ${Math.abs(movePct).toFixed(1)}% today`,
          message: `${h.company_name} moved ${up ? '+' : ''}${movePct.toFixed(1)}% to ${money(h.current_price, h.currency || ctx.currency)}.`,
          type: 'investment_move', priority: Math.abs(movePct) >= 10 ? 'high' : 'normal', group_key: `holding-${h.id}`,
          action_label: 'View investments', action_target: 'utilities/investments',
          metadata: { dedupe_key: `investment-move-${h.id}-${today}`, holding_id: h.id, move_percent: Number(movePct.toFixed(2)) },
        })
      }
    }
  }

  // Portfolio-level daily move.
  if (prevValue > 0) {
    const movePct = ((dayValue - prevValue) / prevValue) * 100
    if (Math.abs(movePct) >= 2) {
      const up = movePct >= 0
      await insertIfMissing(ctx, {
        user_id: ctx.userId, category: 'investments', section: 'insights',
        title: `Portfolio ${up ? 'up' : 'down'} ${Math.abs(movePct).toFixed(1)}% today`,
        message: `Your holdings are ${up ? 'up' : 'down'} ${money(Math.abs(dayValue - prevValue), ctx.currency)} (${movePct.toFixed(1)}%) to ${money(dayValue, ctx.currency)}.`,
        type: 'investment_move', priority: Math.abs(movePct) >= 5 ? 'high' : 'normal', group_key: 'portfolio',
        action_label: 'View investments', action_target: 'utilities/investments',
        metadata: { dedupe_key: `portfolio-move-${today}`, move_percent: Number(movePct.toFixed(2)) },
      })
    }
  }

  // Stale prices reminder (low priority, at most once/day).
  if (staleCount > 0) {
    await insertIfMissing(ctx, {
      user_id: ctx.userId, category: 'investments', section: 'insights',
      title: 'Investment prices are out of date', message: `${staleCount} holding${staleCount === 1 ? '' : 's'} ${staleCount === 1 ? 'has' : 'have'} not refreshed in over a day.`,
      type: 'investment_refresh', priority: 'low', group_key: 'portfolio',
      action_label: 'View investments', action_target: 'utilities/investments',
      metadata: { dedupe_key: `investment-refresh-needed-${today}`, stale_count: staleCount },
    })
  }
}

const genNetWorth = async (ctx: GenContext) => {
  const { data } = await supabase.from('investment_value_snapshots').select('date_key,total_value').eq('user_id', ctx.userId).order('date_key', { ascending: false }).limit(2)
  const snaps = (data ?? []) as SnapshotRow[]
  if (snaps.length < 2) return
  const [latest, prev] = snaps
  const change = Number(latest.total_value || 0) - Number(prev.total_value || 0)
  if (Number(prev.total_value) <= 0) return
  const changePct = (change / Number(prev.total_value)) * 100
  if (Math.abs(changePct) < 5) return
  const up = change >= 0
  await insertIfMissing(ctx, {
    user_id: ctx.userId, category: 'net_worth', section: 'insights',
    title: `Net worth ${up ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}%`,
    message: `Your tracked net worth ${up ? 'rose' : 'fell'} ${money(Math.abs(change), ctx.currency)} to ${money(latest.total_value, ctx.currency)} since ${prev.date_key}.`,
    type: 'net_worth_change', priority: 'normal', group_key: 'net_worth',
    action_label: 'View investments', action_target: 'utilities/investments',
    metadata: { dedupe_key: `net-worth-change-${latest.date_key}`, change_percent: Number(changePct.toFixed(2)) },
  })
}

// Flag unusually large expenses vs. the user's own recent history for that category.
const genAnomalies = async (ctx: GenContext) => {
  const since = startOfDay(new Date(ctx.now.getFullYear(), ctx.now.getMonth() - 3, ctx.now.getDate()))
  const { data } = await supabase.from('transactions').select('id,category_id,amount,type,date,note').eq('user_id', ctx.userId).eq('type', 'expense').gte('date', toIsoDay(since)).order('date', { ascending: false }).limit(1000)
  const txs = (data ?? []) as TxRow[]
  if (txs.length < 12) return
  const byCat = new Map<string, number[]>()
  for (const t of txs) { const k = t.category_id || 'uncategorized'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k)!.push(Number(t.amount || 0)) }
  const { data: cats } = await supabase.from('categories').select('id,name').eq('user_id', ctx.userId)
  const catName = new Map<string, string>(((cats ?? []) as any[]).map((c) => [c.id, c.name]))
  const recentCutoff = startOfDay(new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() - 3)).getTime()

  for (const t of txs) {
    if (new Date(`${t.date}T00:00:00`).getTime() < recentCutoff) continue
    const amounts = byCat.get(t.category_id || 'uncategorized') || []
    if (amounts.length < 6) continue
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length
    const std = Math.sqrt(variance)
    const amt = Number(t.amount || 0)
    if (std <= 0 || amt < 50) continue
    if (amt > mean + 3 * std && amt > mean * 2) {
      const name = t.category_id ? (catName.get(t.category_id) || 'a category') : 'uncategorized spending'
      await insertIfMissing(ctx, {
        user_id: ctx.userId, category: 'budgets', section: 'action_needed',
        title: 'Unusually large expense detected', message: `A ${money(amt, ctx.currency)} charge in ${name} is well above your usual ${money(mean, ctx.currency)}.`,
        type: 'spending_anomaly', priority: 'high', group_key: 'anomaly',
        action_label: 'View transactions', action_target: 'transactions',
        metadata: { dedupe_key: `anomaly-${t.id}`, transaction_id: t.id, amount: amt, category_mean: Math.round(mean) },
      })
    }
  }
}

const genMonthlyReport = async (ctx: GenContext) => {
  const monthKey = `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, '0')}`
  await insertIfMissing(ctx, {
    user_id: ctx.userId, category: 'monthly_reports', section: 'system',
    title: `${ctx.now.toLocaleString(undefined, { month: 'long' })} monthly report is ready`, message: 'Your monthly report is ready to review.',
    type: 'monthly_report_ready', priority: 'low', group_key: 'monthly_report',
    action_label: 'View report', action_target: 'utilities/reports',
    metadata: { dedupe_key: `monthly-report-ready-${monthKey}` },
  })
}

// Document Vault: remind the user before (and when) a stored document expires.
// Escalating reminder buckets keep it from spamming — each bucket fires once as
// the deadline approaches. Missing tables are ignored (feature not set up yet).
const genDocuments = async (ctx: GenContext) => {
  const { data, error } = await supabase
    .from('document_vault_files')
    .select('id,title,doc_type,issuer,expiration_date')
    .eq('user_id', ctx.userId)
    .not('expiration_date', 'is', null)
  if (error) return // table not provisioned yet, or transient — skip quietly
  const today = startOfDay(ctx.now)
  const BANDS = [0, 1, 3, 7, 14, 30]
  for (const doc of ((data ?? []) as VaultDocRow[])) {
    if (!doc.expiration_date) continue
    const exp = startOfDay(new Date(`${doc.expiration_date}T00:00:00`))
    if (Number.isNaN(exp.getTime())) continue
    const days = Math.round((exp.getTime() - today.getTime()) / 86400000)
    const name = (doc.title || '').trim() || 'A document'
    const typeLabel = (doc.doc_type || 'document').replace(/_/g, ' ')

    if (days < 0) {
      await insertIfMissing(ctx, {
        user_id: ctx.userId, category: 'documents', section: 'action_needed',
        title: `${name} has expired`,
        message: `Your ${typeLabel}${doc.issuer ? ` from ${doc.issuer}` : ''} expired on ${doc.expiration_date}. Renew it and update your vault.`,
        type: 'document_expired', priority: 'high', group_key: `document-${doc.id}`,
        action_label: 'Open vault', action_target: 'utilities/documents',
        metadata: { dedupe_key: `docvault-${doc.id}-expired-${doc.expiration_date}`, document_id: doc.id, expiration_date: doc.expiration_date },
      })
      continue
    }

    const band = BANDS.find((b) => days <= b)
    if (band === undefined) continue // more than 30 days out — no reminder yet
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const urgent = band <= 7
    await insertIfMissing(ctx, {
      user_id: ctx.userId, category: 'documents', section: urgent ? 'action_needed' : 'upcoming',
      title: `${name} expires ${when}`,
      message: `Your ${typeLabel}${doc.issuer ? ` from ${doc.issuer}` : ''} expires on ${doc.expiration_date}${days === 0 ? '' : ` — ${when}`}.`,
      type: 'document_expiring', priority: band <= 1 ? 'high' : urgent ? 'normal' : 'low', group_key: `document-${doc.id}`,
      action_label: 'Open vault', action_target: 'utilities/documents',
      metadata: { dedupe_key: `docvault-${doc.id}-expiry-${band}`, document_id: doc.id, expiration_date: doc.expiration_date, days_left: days },
    })
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — throttled, preference-aware, single entry point for the client.
// ---------------------------------------------------------------------------
export const generateAllNotifications = async (userId: string, options: { force?: boolean } = {}) => {
  const prefs = await getNotificationPreferences(userId)
  const last = prefs.last_generated_at ? new Date(prefs.last_generated_at).getTime() : 0
  if (!options.force && last && Date.now() - last < GENERATION_THROTTLE_MS) {
    if (import.meta.env.DEV) console.log('Notification generation throttled; last run', prefs.last_generated_at)
    return
  }
  const ctx = await buildContext(userId)
  try {
    if (prefs.bills_recurring) await genRecurring(ctx)
    if (prefs.subscriptions) await genSubscriptions(ctx)
    if (prefs.budgets) { await genBudgets(ctx); await genAnomalies(ctx) }
    if (prefs.goals) await genGoals(ctx)
    if (prefs.investments) await genInvestments(ctx)
    if (prefs.net_worth) await genNetWorth(ctx)
    if (prefs.documents) await genDocuments(ctx)
    if (prefs.monthly_reports) await genMonthlyReport(ctx)
  } finally {
    await supabase.from('notification_preferences').update({ last_generated_at: new Date().toISOString() }).eq('user_id', userId)
  }
}

// Backwards-compatible individual exports (each builds its own context).
export const generateRecurringNotifications = async (userId: string) => genRecurring(await buildContext(userId))
export const generateSubscriptionNotifications = async (userId: string) => genSubscriptions(await buildContext(userId))
export const generateBudgetNotifications = async (userId: string) => genBudgets(await buildContext(userId))
export const generateInvestmentNotifications = async (userId: string) => genInvestments(await buildContext(userId))
export const generateGoalNotifications = async (userId: string) => genGoals(await buildContext(userId))
export const generateNetWorthNotifications = async (userId: string) => genNetWorth(await buildContext(userId))
export const generateAnomalyNotifications = async (userId: string) => genAnomalies(await buildContext(userId))
export const generateMonthlyReportNotifications = async (userId: string) => genMonthlyReport(await buildContext(userId))
export const generateDocumentNotifications = async (userId: string) => genDocuments(await buildContext(userId))
