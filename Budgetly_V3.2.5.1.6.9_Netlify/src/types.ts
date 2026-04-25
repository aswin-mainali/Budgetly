export type TxType = 'income' | 'expense'

export type Category = {
  id: string
  user_id: string
  name: string
  color: string | null
  emoji?: string | null
  budget_monthly: number
  sort_order: number
  created_at?: string
  updated_at?: string
}

export type Transaction = {
  id: string
  user_id: string
  date: string // YYYY-MM-DD
  type: TxType
  category_id: string | null
  amount: number
  note: string | null
  created_at?: string
  updated_at?: string
}


export type RecurrenceType = 'monthly' | 'weekly' | 'biweekly'
export type RecurringKind = 'expense' | 'income'

export type RecurringItem = {
  id: string
  user_id: string
  name: string
  category_id: string | null
  amount: number
  kind?: RecurringKind
  recurrence_type: RecurrenceType
  day_of_month: number
  anchor_date?: string | null
  note: string | null
  created_at?: string
  updated_at?: string
}


export type Goal = {
  id: string
  user_id: string
  name: string
  emoji?: string | null
  target_amount: number
  current_amount: number
  target_date?: string | null
  note: string | null
  created_at?: string
  updated_at?: string
}

export type SyncState = 'offline' | 'pending' | 'syncing' | 'synced' | 'error'

export type LocalSettings = {
  allowTxnInFutureDate: boolean
}


export type UserRole = 'user' | 'admin' | 'super_admin'

export type Profile = {
  id: string
  email: string
  first_name?: string
  last_name?: string
  avatar_url?: string | null
  role: UserRole
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export type FeatureKey = 'dashboard' | 'transactions' | 'categories' | 'recurring' | 'reports' | 'goals' | 'advice' | 'converter' | 'support' | 'settings'

export type FeatureAccess = Record<FeatureKey, boolean>

export type UserFeatureAccess = {
  user_id: string
  dashboard: boolean
  transactions: boolean
  categories: boolean
  recurring: boolean
  reports: boolean
  goals: boolean
  advice: boolean
  converter: boolean
  support: boolean
  settings: boolean
  created_at?: string
  updated_at?: string
}


export type BugReportStatus = 'pending' | 'completed'

export type BugReport = {
  id: string
  user_id: string
  user_email: string
  steps_to_reproduce: string
  contact_when_resolved: boolean
  screenshot_name?: string | null
  screenshot_data_url?: string | null
  status: BugReportStatus
  admin_notes?: string | null
  created_at?: string
  updated_at?: string
}

export type AdminAuditLog = {
  id: string
  admin_user_id: string
  target_user_id: string | null
  action: string
  details?: Record<string, unknown> | null
  created_at?: string
}
