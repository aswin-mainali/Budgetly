import { supabase } from './supabase'

export type SafeToSpendSettingRow = {
  user_id: string
  month_key: string
  allocation: number
  notes: string | null
  created_at?: string
  updated_at?: string
}

const MIGRATION_KEY = 'budgetly_safe_to_spend_supabase_migrated'
const keyFor = (m: string) => `budgetly_safe_to_spend_${m.replace('-', '_')}`

export async function getSafeToSpendSetting(userId: string, monthKey: string) {
  const { data, error } = await supabase
    .from('safe_to_spend_settings')
    .select('*')
    .eq('user_id', userId)
    .eq('month_key', monthKey)
    .maybeSingle()
  if (error) {
    if (import.meta.env.DEV) console.error('Safe-To-Spend load failed', { message: error.message, details: error.details, hint: error.hint, code: error.code, monthKey, userId })
    throw error
  }
  return data as SafeToSpendSettingRow | null
}

export async function upsertSafeToSpendSetting(row: SafeToSpendSettingRow) {
  const { error } = await supabase.from('safe_to_spend_settings').upsert({
    user_id: row.user_id,
    month_key: row.month_key,
    allocation: row.allocation,
    notes: row.notes,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,month_key' })
  if (error) {
    if (import.meta.env.DEV) console.error('Safe-To-Spend upsert failed', { message: error.message, details: error.details, hint: error.hint, code: error.code, row })
    throw error
  }
}

export async function migrateLocalSafeToSpendToSupabase(userId: string) {
  if (localStorage.getItem(MIGRATION_KEY) === 'true') return
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('budgetly_safe_to_spend_') && !k.includes('supabase_migrated'))
  try {
    for (const key of keys) {
      const month = key.replace('budgetly_safe_to_spend_', '').replace('_', '-')
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      await upsertSafeToSpendSetting({
        user_id: userId,
        month_key: parsed.month || month,
        allocation: Number(parsed.allocation || 0),
        notes: parsed.notes || null,
      })
    }
    localStorage.setItem(MIGRATION_KEY, 'true')
  } catch {
    if (import.meta.env.DEV) console.warn('Safe-To-Spend migration failed')
  }
}
