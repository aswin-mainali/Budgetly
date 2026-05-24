import { supabase } from '../lib/supabase'

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

type Preferences = Record<NotificationCategory, boolean>
const DEFAULT_PREFS: Preferences = { bills_recurring: true, budgets: true, subscriptions: true, goals: true, investments: true, net_worth: true, monthly_reports: true, system_updates: true }

const upsertIfNotExists = async (payload: Omit<BudgetlyNotification, 'id' | 'created_at' | 'status' | 'read_at'> & { metadata?: Record<string, unknown> }) => {
  const dedupeKey = typeof payload.metadata?.dedupe_key === 'string' ? payload.metadata.dedupe_key : null
  if (!dedupeKey) return
  const existing = await supabase.from('notifications').select('id').eq('user_id', payload.user_id).contains('metadata', { dedupe_key: dedupeKey }).maybeSingle()
  if (existing.data) return
  await supabase.from('notifications').insert({ ...payload, status: 'unread' })
}

export const getNotifications = async (userId: string) => {
  const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  return (data ?? []) as BudgetlyNotification[]
}
export const markNotificationAsRead = async (notificationId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', notificationId)
export const markAllNotificationsAsRead = async (userId: string) => supabase.from('notifications').update({ status: 'read', read_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'unread')
export const clearReadNotifications = async (userId: string) => supabase.from('notifications').delete().eq('user_id', userId).eq('status', 'read')

export const getNotificationPreferences = async (userId: string) => {
  const { data } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle()
  if (!data) {
    await supabase.from('notification_preferences').insert({ user_id: userId, ...DEFAULT_PREFS })
    return DEFAULT_PREFS
  }
  return { ...DEFAULT_PREFS, ...data } as Preferences
}
export const updateNotificationPreferences = async (userId: string, preferences: Partial<Preferences>) => {
  await supabase.from('notification_preferences').upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
}

export const generateBudgetNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'budgets', section: 'insights', title: 'Groceries budget is at 82%', message: 'Groceries budget is at 82%.', type: 'threshold', action_label: 'View budget', action_target: 'categories', metadata: { dedupe_key: `budget-groceries-80-${new Date().toISOString().slice(0,7)}` } })
export const generateRecurringNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'bills_recurring', section: 'action_needed', title: 'Rent is due in 3 days — CA$1,400', message: 'Rent is due in 3 days — CA$1,400', type: 'due_soon', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: `recurring-rent-due-${new Date().toISOString().slice(0,10)}` } })
export const generateSubscriptionNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'subscriptions', section: 'upcoming', title: 'Netflix charges tomorrow — CA$20.99', message: 'Netflix charges tomorrow — CA$20.99', type: 'upcoming_charge', action_label: 'View recurring', action_target: 'recurring', metadata: { dedupe_key: `subscription-netflix-${new Date().toISOString().slice(0,7)}` } })
export const generateGoalNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'goals', section: 'insights', title: 'Emergency Fund reached 70%', message: 'Emergency Fund reached 70%.', type: 'progress', action_label: 'View goals', action_target: 'goals', metadata: { dedupe_key: `goal-emergency-70-${new Date().toISOString().slice(0,7)}` } })
export const generateInvestmentNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'investments', section: 'insights', title: 'Investment prices can be refreshed', message: 'Refresh investment prices to update your portfolio.', type: 'refresh_needed', action_label: 'View investments', action_target: 'utilities/investments', metadata: { dedupe_key: `investment-refresh-needed-${new Date().toISOString().slice(0,10)}` } })
export const generateNetWorthNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'net_worth', section: 'insights', title: 'Your net worth increased this month', message: 'Your net worth increased this month.', type: 'net_worth_change', action_label: 'View net worth', action_target: 'utilities/net-worth', metadata: { dedupe_key: `net-worth-increase-${new Date().toISOString().slice(0,7)}` } })
export const generateMonthlyReportNotifications = async (userId: string) => upsertIfNotExists({ user_id: userId, category: 'monthly_reports', section: 'system', title: 'April monthly report is ready', message: 'Your monthly report is ready.', type: 'report_ready', action_label: 'View report', action_target: 'utilities/reports', metadata: { dedupe_key: `monthly-report-ready-${new Date().toISOString().slice(0,7)}` } })
