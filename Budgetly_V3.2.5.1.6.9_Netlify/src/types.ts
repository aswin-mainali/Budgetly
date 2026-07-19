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

export type FeatureKey = 'dashboard' | 'transactions' | 'categories' | 'recurring' | 'reports' | 'goals' | 'advice' | 'converter' | 'investments' | 'shared_budgeting' | 'support' | 'settings'

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
  shared_budgeting: boolean
  support: boolean
  settings: boolean
  created_at?: string
  updated_at?: string
}


// ---------------------------------------------------------------------------
// Shared budgeting (couples): a Together space with a split "who owes whom"
// ledger. Gated behind the shared_budgeting feature flag.
// ---------------------------------------------------------------------------

export type SharedSpace = {
  id: string
  name: string
  currency: string
  created_by: string
  created_at?: string
  updated_at?: string
}

export type SharedMemberRole = 'owner' | 'member'

export type SharedSpaceMember = {
  id: string
  space_id: string
  user_id: string
  role: SharedMemberRole
  default_split: number
  joined_at?: string
  // Hydrated client-side from shared_space_member_emails().
  email?: string | null
}

export type SharedInviteStatus = 'pending' | 'accepted' | 'declined'

export type SharedSpaceInvite = {
  id: string
  space_id: string
  invited_by: string
  invitee_email: string
  status: SharedInviteStatus
  created_at?: string
  responded_at?: string | null
}

// payer_share is the percentage of the total the payer is responsible for; the
// remainder is what the other member owes the payer.
export type SharedSplitType = 'equal' | 'percent' | 'payer_full' | 'other_full'

export type SharedExpense = {
  id: string
  space_id: string
  paid_by: string
  created_by: string
  amount: number
  note: string | null
  emoji: string | null
  date: string // YYYY-MM-DD
  split_type: SharedSplitType
  payer_share: number
  created_at?: string
  updated_at?: string
}

export type SharedSettlement = {
  id: string
  space_id: string
  from_user: string
  to_user: string
  amount: number
  note: string | null
  date: string // YYYY-MM-DD
  created_at?: string
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
