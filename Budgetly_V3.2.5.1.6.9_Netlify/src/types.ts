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
  /** Optional captured receipt image as a compressed JPEG data URL (AI receipt capture). */
  receipt_url?: string | null
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

export type GoalContribution = {
  id: string
  goal_id: string
  user_id: string
  amount: number
  created_at: string
}

export type SyncState = 'offline' | 'pending' | 'syncing' | 'synced' | 'error'

export type LocalSettings = {
  allowTxnInFutureDate: boolean
  showCustomizeInDashboard: boolean
}


export type UserRole = 'user' | 'admin' | 'super_admin'

export type Profile = {
  id: string
  email: string
  role: UserRole
  is_active: boolean
  created_at?: string
  updated_at?: string
  last_active_at?: string | null
}

export type FeatureKey = 'dashboard' | 'transactions' | 'categories' | 'recurring' | 'reports' | 'goals' | 'advice' | 'converter' | 'investments' | 'support' | 'settings'

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
  investments: boolean
  support: boolean
  settings: boolean
  created_at?: string
  updated_at?: string
}


export type BugReportStatus = 'pending' | 'completed'

export type BugWorkflowStatus = 'pending' | 'in_progress' | 'in_review' | 'resolved'

export type BugSeverity = 'low' | 'medium' | 'high' | 'critical'

export type BugCategory =
  | 'ui' | 'data' | 'sync' | 'performance' | 'crash' | 'account' | 'other'

export type BugDiagnostics = {
  app_version?: string
  page?: string
  user_agent?: string
  platform?: string
  language?: string
  screen?: string
  viewport?: string
  timezone?: string
  online?: boolean
  captured_at?: string
}

export type BugReport = {
  id: string
  user_id: string
  user_email: string
  title?: string | null
  category?: BugCategory | string | null
  user_severity?: BugSeverity | null
  steps_to_reproduce: string
  contact_when_resolved: boolean
  screenshot_name?: string | null
  screenshot_data_url?: string | null
  status: BugReportStatus
  workflow_status?: BugWorkflowStatus | null
  reference_code?: string | null
  diagnostics?: BugDiagnostics | null
  admin_notes?: string | null
  created_at?: string
  updated_at?: string
}

export type BugReportEvent = {
  id: string
  report_id: string
  status: string
  note?: string | null
  actor: 'user' | 'admin' | 'system'
  created_at: string
}

export type AdminAuditLog = {
  id: string
  admin_user_id: string
  target_user_id: string | null
  action: string
  category?: string | null
  details?: Record<string, unknown> | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  actor_email?: string | null
  target_email?: string | null
  ip_address?: string | null
  user_agent?: string | null
  created_at?: string
}

export type AuditFilters = {
  search: string
  category: string
  from: string
  to: string
}
