// Server-side notification generators (Deno / Edge Functions).
// Mirrors src/services/notificationService.ts but runs with the service-role key so
// notifications exist even when the app is closed. Invoked by generate-notifications.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Priority = 'critical' | 'high' | 'normal' | 'low'
const SUBSCRIPTION_PATTERNS = ['netflix', 'spotify', 'disney', 'apple', 'google', 'adobe', 'microsoft', 'youtube', 'amazon prime', 'prime']
const GOAL_MILESTONES = [25, 50, 75, 100]

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const toIsoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const money = (n: number, c = 'CAD') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n || 0)) } catch { return `${c} ${Number(n || 0).toFixed(2)}` } }

type Ctx = { db: SupabaseClient; userId: string; currency: string; now: Date; muteKeys: Set<string> }
type Payload = {
  category: string; section: string; title: string; message: string; type: string
  priority?: Priority; group_key?: string | null; action_label?: string; action_target?: string
  metadata: Record<string, unknown>
}

const isMuted = (ctx: Ctx, p: Payload) => {
  const dedupe = String(p.metadata?.dedupe_key || '')
  if (dedupe && ctx.muteKeys.has(`dedupe:${dedupe}`)) return true
  if (p.group_key && ctx.muteKeys.has(`group:${p.group_key}`)) return true
  if (ctx.muteKeys.has(`category:${p.category}`)) return true
  if (ctx.muteKeys.has(`type:${p.type}`)) return true
  return false
}

const insertIfMissing = async (ctx: Ctx, p: Payload) => {
  const dedupe = String(p.metadata?.dedupe_key || '')
  if (!dedupe || isMuted(ctx, p)) return false
  const existing = await ctx.db.from('notifications').select('id').eq('user_id', ctx.userId).contains('metadata', { dedupe_key: dedupe }).maybeSingle()
  if (existing.data) return false
  const { error } = await ctx.db.from('notifications').insert({ user_id: ctx.userId, ...p, priority: p.priority ?? 'normal', status: 'unread' })
  return !error
}

const nextDueDate = (item: any, today: Date) => {
  const start = startOfDay(today)
  if (item.recurrence_type === 'monthly') {
    const day = Math.max(1, Math.min(31, Number(item.day_of_month ?? 1) || 1))
    let due = new Date(start.getFullYear(), start.getMonth(), Math.min(day, daysInMonth(start)))
    if (due < start) { const nd = new Date(start.getFullYear(), start.getMonth() + 2, 0).getDate(); due = new Date(start.getFullYear(), start.getMonth() + 1, Math.min(day, nd)) }
    return due
  }
  const anchor = item.anchor_date ? new Date(`${item.anchor_date}T00:00:00`) : start
  const step = item.recurrence_type === 'weekly' ? 7 : 14
  let due = startOfDay(anchor)
  while (due < start) due = new Date(due.getFullYear(), due.getMonth(), due.getDate() + step)
  return due
}

const genRecurringAndSubs = async (ctx: Ctx, prefs: any) => {
  const { data } = await ctx.db.from('recurring_items').select('*').eq('user_id', ctx.userId)
  const today = startOfDay(ctx.now)
  for (const item of (data ?? [])) {
    const due = nextDueDate(item, today)
    const days = Math.round((startOfDay(due).getTime() - today.getTime()) / 86400000)
    if (days < 0 || days > 3) continue
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
    const name = (item.name || '').toLowerCase()
    const isSub = item.kind !== 'income' && SUBSCRIPTION_PATTERNS.some((k) => name.includes(k))
    if (isSub && prefs.subscriptions !== false) {
      await insertIfMissing(ctx, { category: 'subscriptions', section: days === 0 ? 'action_needed' : 'upcoming', title: `${item.name} charges ${when}`, message: `${item.name} charges ${when} — ${money(item.amount, ctx.currency)}`, type: 'subscription_due', priority: days === 0 ? 'high' : 'normal', group_key: 'subscription_due', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: `subscription-${item.id}-due-${toIsoDay(due)}` } })
    }
    if (prefs.bills_recurring !== false) {
      const verb = item.kind === 'income' ? 'arrives' : 'is due'
      await insertIfMissing(ctx, { category: 'bills_recurring', section: days === 0 ? 'action_needed' : 'upcoming', title: `${item.name} ${verb} ${when}`, message: `${item.name} ${verb} ${when} — ${money(item.amount, ctx.currency)}`, type: 'recurring_due', priority: days === 0 ? 'high' : 'normal', group_key: 'recurring_due', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: `recurring-${item.id}-due-${toIsoDay(due)}`, recurring_id: item.id, due_date: toIsoDay(due) } })
    }
  }
}

const genBudgets = async (ctx: Ctx) => {
  const now = ctx.now
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthEnd = `${month}-${String(daysInMonth(now)).padStart(2, '0')}`
  const { data: categories } = await ctx.db.from('categories').select('id,name,budget_monthly').eq('user_id', ctx.userId)
  const { data: tx } = await ctx.db.from('transactions').select('category_id,amount').eq('user_id', ctx.userId).eq('type', 'expense').gte('date', `${month}-01`).lte('date', monthEnd)
  const spentBy = new Map<string, number>()
  for (const t of (tx ?? [])) spentBy.set(t.category_id, (spentBy.get(t.category_id) ?? 0) + Number(t.amount || 0))
  for (const c of (categories ?? [])) {
    const budget = Number(c.budget_monthly || 0); if (budget <= 0) continue
    const spent = spentBy.get(c.id) ?? 0
    const pct = (spent / budget) * 100
    const rounded = Math.floor(pct)
    const keyBase = c.id || slugify(c.name || 'budget')
    const base = { category: 'budgets', group_key: `budget-${keyBase}`, action_label: 'View budget', action_target: 'categories', type: 'budget_threshold' } as const
    if (pct > 100) await insertIfMissing(ctx, { ...base, section: 'action_needed', title: `${c.name} exceeded budget`, message: `${c.name} is at ${rounded}% of budget (${money(spent, ctx.currency)} of ${money(budget, ctx.currency)}).`, priority: 'high', metadata: { dedupe_key: `budget-${keyBase}-exceeded-${month}`, month_key: month } })
    else if (pct >= 100) await insertIfMissing(ctx, { ...base, section: 'action_needed', title: `${c.name} is at 100% of budget`, message: `${c.name} has reached its ${money(budget, ctx.currency)} budget.`, priority: 'high', metadata: { dedupe_key: `budget-${keyBase}-100-${month}`, month_key: month } })
    else if (pct >= 90) await insertIfMissing(ctx, { ...base, section: 'insights', title: `${c.name} is at 90% of budget`, message: `${c.name} is at ${rounded}% of budget.`, priority: 'normal', metadata: { dedupe_key: `budget-${keyBase}-90-${month}`, month_key: month } })
    else if (pct >= 80) await insertIfMissing(ctx, { ...base, section: 'insights', title: `${c.name} is at 80% of budget`, message: `${c.name} is at ${rounded}% of budget.`, priority: 'low', metadata: { dedupe_key: `budget-${keyBase}-80-${month}`, month_key: month } })
  }
}

const genGoals = async (ctx: Ctx) => {
  const { data } = await ctx.db.from('goals').select('id,name,emoji,target_amount,current_amount').eq('user_id', ctx.userId)
  for (const g of (data ?? [])) {
    const target = Number(g.target_amount || 0); if (target <= 0) continue
    const pct = Math.floor((Number(g.current_amount || 0) / target) * 100)
    const milestone = [...GOAL_MILESTONES].reverse().find((m) => pct >= m)
    if (!milestone) continue
    const reached = milestone === 100
    await insertIfMissing(ctx, { category: 'goals', section: reached ? 'action_needed' : 'insights', title: reached ? `🎉 Goal reached: ${g.name}` : `${g.emoji ? g.emoji + ' ' : ''}${g.name} is ${milestone}% funded`, message: reached ? `You've fully funded ${g.name} (${money(g.current_amount, ctx.currency)} of ${money(target, ctx.currency)}).` : `${g.name} just crossed ${milestone}% — ${money(g.current_amount, ctx.currency)} of ${money(target, ctx.currency)} saved.`, type: 'goal_milestone', priority: reached ? 'high' : 'low', group_key: `goal-${g.id}`, action_label: 'View goals', action_target: 'goals', metadata: { dedupe_key: `goal-${g.id}-milestone-${milestone}`, milestone } })
  }
}

const genInvestments = async (ctx: Ctx) => {
  const { data } = await ctx.db.from('investment_holdings').select('id,symbol,company_name,quantity,current_price,previous_close,currency').eq('user_id', ctx.userId)
  const holdings = data ?? []
  if (!holdings.length) return
  const today = toIsoDay(ctx.now)
  let dayValue = 0, prevValue = 0
  for (const h of holdings) {
    const qty = Number(h.quantity || 0)
    dayValue += qty * Number(h.current_price || 0)
    prevValue += qty * Number(h.previous_close || h.current_price || 0)
    const prev = Number(h.previous_close || 0)
    if (prev > 0) {
      const movePct = ((Number(h.current_price || 0) - prev) / prev) * 100
      if (Math.abs(movePct) >= 5) await insertIfMissing(ctx, { category: 'investments', section: 'insights', title: `${h.symbol} ${movePct >= 0 ? 'up' : 'down'} ${Math.abs(movePct).toFixed(1)}% today`, message: `${h.company_name} moved ${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}% to ${money(h.current_price, h.currency || ctx.currency)}.`, type: 'investment_move', priority: Math.abs(movePct) >= 10 ? 'high' : 'normal', group_key: `holding-${h.id}`, action_label: 'View investments', action_target: 'utilities/investments', metadata: { dedupe_key: `investment-move-${h.id}-${today}` } })
    }
  }
  if (prevValue > 0) {
    const movePct = ((dayValue - prevValue) / prevValue) * 100
    if (Math.abs(movePct) >= 2) await insertIfMissing(ctx, { category: 'investments', section: 'insights', title: `Portfolio ${movePct >= 0 ? 'up' : 'down'} ${Math.abs(movePct).toFixed(1)}% today`, message: `Your holdings are ${movePct >= 0 ? 'up' : 'down'} ${money(Math.abs(dayValue - prevValue), ctx.currency)} (${movePct.toFixed(1)}%) to ${money(dayValue, ctx.currency)}.`, type: 'investment_move', priority: Math.abs(movePct) >= 5 ? 'high' : 'normal', group_key: 'portfolio', action_label: 'View investments', action_target: 'utilities/investments', metadata: { dedupe_key: `portfolio-move-${today}` } })
  }
}

const genNetWorth = async (ctx: Ctx) => {
  const { data } = await ctx.db.from('investment_value_snapshots').select('date_key,total_value').eq('user_id', ctx.userId).order('date_key', { ascending: false }).limit(2)
  const snaps = data ?? []
  if (snaps.length < 2 || Number(snaps[1].total_value) <= 0) return
  const change = Number(snaps[0].total_value || 0) - Number(snaps[1].total_value || 0)
  const changePct = (change / Number(snaps[1].total_value)) * 100
  if (Math.abs(changePct) < 5) return
  await insertIfMissing(ctx, { category: 'net_worth', section: 'insights', title: `Net worth ${change >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}%`, message: `Your tracked net worth ${change >= 0 ? 'rose' : 'fell'} ${money(Math.abs(change), ctx.currency)} to ${money(snaps[0].total_value, ctx.currency)} since ${snaps[1].date_key}.`, type: 'net_worth_change', priority: 'normal', group_key: 'net_worth', action_label: 'View investments', action_target: 'utilities/investments', metadata: { dedupe_key: `net-worth-change-${snaps[0].date_key}` } })
}

const genMonthlyReport = async (ctx: Ctx) => {
  const monthKey = `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, '0')}`
  await insertIfMissing(ctx, { category: 'monthly_reports', section: 'system', title: `${ctx.now.toLocaleString('en-US', { month: 'long' })} monthly report is ready`, message: 'Your monthly report is ready to review.', type: 'monthly_report_ready', priority: 'low', group_key: 'monthly_report', action_label: 'View report', action_target: 'utilities/reports', metadata: { dedupe_key: `monthly-report-ready-${monthKey}` } })
}

// Generate for a single user, respecting their category preferences and mutes.
export const generateForUser = async (db: SupabaseClient, userId: string, prefs: any) => {
  const { data: mutes } = await db.from('notification_mutes').select('mute_key,scope,expires_at').eq('user_id', userId)
  const now = new Date()
  const muteKeys = new Set<string>()
  for (const m of (mutes ?? [])) { if (m.expires_at && new Date(m.expires_at).getTime() < now.getTime()) continue; muteKeys.add(`${m.scope}:${m.mute_key}`) }
  const ctx: Ctx = { db, userId, currency: prefs.currency || 'CAD', now, muteKeys }
  if (prefs.bills_recurring !== false || prefs.subscriptions !== false) await genRecurringAndSubs(ctx, prefs)
  if (prefs.budgets !== false) await genBudgets(ctx)
  if (prefs.goals !== false) await genGoals(ctx)
  if (prefs.investments !== false) await genInvestments(ctx)
  if (prefs.net_worth !== false) await genNetWorth(ctx)
  if (prefs.monthly_reports !== false) await genMonthlyReport(ctx)
  await db.from('notification_preferences').update({ last_generated_at: now.toISOString() }).eq('user_id', userId)
}
