import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { download, fmtMoney, monthKey, monthLabel, safeCsv } from '../lib/utils'
import { buildCategoryColorMap, colorForCategory, UNCATEGORIZED_ID } from '../lib/categoryColors'
import { Category, Transaction, TxType, SyncState, LocalSettings, RecurringItem, RecurrenceType, RecurringKind, Goal, GoalContribution } from '../types'

type DataState = {
  currency: string
  categories: Category[]
  transactions: Transaction[]
  recurring: RecurringItem[]
  goals: Goal[]
  goalContributions: GoalContribution[]
  settings: LocalSettings
}

type TransactionDraft = {
  date: string
  type: TxType
  category_id: string | ''
  amount: string
  note: string
}

const LOCAL_KEY = 'raswibudgeting:cloud:v1'


const notify = (message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))
}

const defaultSeed = (_userId: string): DataState => ({
  currency: 'CAD',
  categories: [],
  settings: {
    allowTxnInFutureDate: false,
    showCustomizeInDashboard: true,
  },
  recurring: [],
  goals: [],
  goalContributions: [],
  transactions: [],
})

const clampMoney = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)
const todayIso = () => isoAtLocalMidnight(new Date())
const isoAtLocalMidnight = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const parseIsoLocal = (value?: string | null) => {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const categoryColorFor = (category: Pick<Category, 'id' | 'name' | 'color'>, index: number) => {
  if (category.color) return category.color
  const palette = ['#6EE7B7', '#93C5FD', '#FCA5A5', '#FDE68A', '#C4B5FD', '#94a3b8', '#34d399', '#60a5fa', '#f87171', '#fbbf24']
  const seed = `${category.id}:${category.name}`
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return palette[hash % palette.length] ?? palette[index % palette.length]
}

const CATEGORY_EMOJI_RULES: Array<{ emoji: string; keywords: string[] }> = [
  { emoji: '🛒', keywords: ['grocery', 'grocer', 'supermarket', 'food', 'snack', 'market'] },
  { emoji: '🍔', keywords: ['restaurant', 'dining', 'eat', 'burger', 'lunch', 'dinner', 'breakfast', 'meal'] },
  { emoji: '☕', keywords: ['coffee', 'cafe', 'tea', 'drink'] },
  { emoji: '🏠', keywords: ['rent', 'home', 'house', 'mortgage', 'apartment'] },
  { emoji: '🛋️', keywords: ['furniture', 'sofa', 'decor'] },
  { emoji: '🔌', keywords: ['utility', 'utilities', 'hydro', 'electric', 'electricity', 'water', 'internet', 'wifi'] },
  { emoji: '💡', keywords: ['power', 'energy', 'light'] },
  { emoji: '📱', keywords: ['phone', 'mobile', 'cell', 'plan'] },
  { emoji: '🚗', keywords: ['car', 'auto', 'vehicle', 'payment', 'lease'] },
  { emoji: '🛡️', keywords: ['insurance', 'coverage', 'policy'] },
  { emoji: '⛽', keywords: ['gas', 'fuel', 'petrol'] },
  { emoji: '🚌', keywords: ['bus', 'transit', 'metro', 'train', 'uber', 'taxi', 'transport'] },
  { emoji: '✈️', keywords: ['travel', 'flight', 'air', 'trip', 'vacation', 'holiday'] },
  { emoji: '🎬', keywords: ['movie', 'cinema', 'netflix', 'prime video', 'disney', 'entertainment'] },
  { emoji: '🎮', keywords: ['game', 'gaming', 'steam', 'playstation', 'xbox'] },
  { emoji: '🎵', keywords: ['music', 'spotify', 'apple music'] },
  { emoji: '📚', keywords: ['book', 'books', 'study', 'college', 'school', 'tuition', 'education', 'course'] },
  { emoji: '💼', keywords: ['work', 'job', 'office', 'business'] },
  { emoji: '💻', keywords: ['laptop', 'computer', 'software', 'tech'] },
  { emoji: '🧾', keywords: ['bill', 'invoice', 'fee', 'fees', 'tax'] },
  { emoji: '💳', keywords: ['card', 'credit', 'bank', 'loan', 'finance', 'payment'] },
  { emoji: '💵', keywords: ['salary', 'income', 'paycheck', 'wage', 'bonus'] },
  { emoji: '📈', keywords: ['saving', 'savings', 'invest', 'investment'] },
  { emoji: '🎁', keywords: ['gift', 'gifts', 'present'] },
  { emoji: '💄', keywords: ['beauty', 'cosmetic', 'makeup', 'skin', 'salon'] },
  { emoji: '🏥', keywords: ['hospital', 'medical', 'doctor', 'clinic', 'health'] },
  { emoji: '💊', keywords: ['medicine', 'pharmacy', 'drug'] },
  { emoji: '🏋️', keywords: ['gym', 'fitness', 'workout', 'sport'] },
  { emoji: '⚽', keywords: ['soccer', 'football', 'club'] },
  { emoji: '🐶', keywords: ['pet', 'dog', 'cat', 'animal', 'vet'] },
  { emoji: '👶', keywords: ['baby', 'child', 'kid', 'kids', 'daycare'] },
  { emoji: '❤️', keywords: ['donation', 'charity', 'love'] },
  { emoji: '🌴', keywords: ['leisure', 'fun', 'resort', 'beach'] },
  { emoji: '📦', keywords: ['misc', 'miscellaneous', 'other', 'general', 'package'] },
  { emoji: '🔧', keywords: ['repair', 'tool', 'maintenance', 'fix'] },
  { emoji: '🏷️', keywords: [] },
]

const inferCategoryEmoji = (name: string) => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return '🏷️'
  const compact = normalized.replace(/[^a-z0-9]+/g, ' ')
  for (const rule of CATEGORY_EMOJI_RULES) {
    if (rule.keywords.some((keyword) => compact.includes(keyword))) return rule.emoji
  }
  return '🏷️'
}

const GOAL_EMOJI_RULES: Array<{ emoji: string; keywords: string[] }> = [
  { emoji: '💰', keywords: ['saving', 'savings', 'save', 'emergency', 'fund'] },
  { emoji: '🏖️', keywords: ['vacation', 'holiday', 'trip', 'travel'] },
  { emoji: '🚗', keywords: ['car', 'vehicle', 'auto'] },
  { emoji: '🏠', keywords: ['home', 'house', 'mortgage', 'apartment'] },
  { emoji: '👴', keywords: ['retirement', 'retire', 'pension'] },
  { emoji: '🎓', keywords: ['college', 'tuition', 'school', 'education', 'study'] },
  { emoji: '💍', keywords: ['wedding', 'marriage', 'honeymoon'] },
  { emoji: '🧳', keywords: ['moving', 'move', 'relocation'] },
  { emoji: '💻', keywords: ['laptop', 'computer', 'tech', 'business'] },
  { emoji: '📱', keywords: ['phone'] },
  { emoji: '🎁', keywords: ['gift'] },
  { emoji: '📦', keywords: ['other', 'misc', 'miscellaneous', 'custom'] },
  { emoji: '🎯', keywords: [] },
]

const inferGoalEmoji = (name: string) => {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return '🎯'
  const compact = normalized.replace(/[^a-z0-9]+/g, ' ')
  for (const rule of GOAL_EMOJI_RULES) {
    if (rule.keywords.some((keyword) => compact.includes(keyword))) return rule.emoji
  }
  return '🎯'
}

const getResultErrorMessage = (result: unknown) => {
  if (!result || typeof result !== 'object' || !('error' in result)) return null
  const error = (result as { error?: unknown }).error
  if (!error) return null
  return getSupabaseErrorMessage(error) ?? 'Unknown database error.'
}


const getSupabaseErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') return null
  const maybe = error as { message?: string; details?: string; hint?: string; code?: string }
  const parts = [maybe.message, maybe.details, maybe.hint].filter(Boolean)
  const message = parts.join(' ').trim()
  return message || maybe.code || null
}

const throwIfResultError = (result: unknown) => {
  const resultMessage = getResultErrorMessage(result)
  if (resultMessage) throw new Error(resultMessage)
}

export function useBudgetApp(userId: string | null) {
  const [sync, setSync] = useState<SyncState>(navigator.onLine ? 'synced' : 'offline')
  const [data, setData] = useState<DataState>({ currency: 'CAD', categories: [], transactions: [], recurring: [], goals: [], goalContributions: [], settings: { allowTxnInFutureDate: false, showCustomizeInDashboard: true } })
  const [txDraft, setTxDraft] = useState<TransactionDraft>({
    date: todayIso(),
    type: 'expense',
    category_id: '',
    amount: '',
    note: '',
  })
  const [activeMonth, setActiveMonth] = useState(() => monthKey(new Date().toISOString()))
  const [txActiveMonth, setTxActiveMonth] = useState(() => monthKey(new Date().toISOString()))
  const [txSearch, setTxSearch] = useState('')
  const [txType, setTxType] = useState<'all' | TxType>('all')
  const [pendingCategoryDeletes, setPendingCategoryDeletes] = useState<string[]>([])
  const [pendingTxDeletes, setPendingTxDeletes] = useState<string[]>([])
  const [pendingRecurringDeletes, setPendingRecurringDeletes] = useState<string[]>([])
  const [pendingGoalDeletes, setPendingGoalDeletes] = useState<string[]>([])
  const [pendingGoalContributions, setPendingGoalContributions] = useState<GoalContribution[]>([])
  const [categoryDirty, setCategoryDirty] = useState(false)
  const [transactionDirty, setTransactionDirty] = useState(false)
  const [recurringDirty, setRecurringDirty] = useState(false)
  const [goalDirty, setGoalDirty] = useState(false)

  const persistLocal = (updater: DataState | ((current: DataState) => DataState)) => {
    if (!userId) return
    setData((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      // Receipt images are large base64 data URLs. They live in memory (for the
      // UI) and in Supabase (the source of truth), but must NOT be written into
      // localStorage — a few would blow the ~5MB quota. Strip them from the
      // cached copy, and never let a cache-write failure (quota exceeded,
      // private mode) abort the in-memory state update.
      try {
        const forStorage: DataState = {
          ...next,
          transactions: next.transactions.map((t) => (t.receipt_url ? { ...t, receipt_url: null } : t)),
        }
        localStorage.setItem(`${LOCAL_KEY}:${userId}`, JSON.stringify(forStorage))
      } catch (err) {
        console.warn('persistLocal: could not write local cache', err)
      }
      return next
    })
  }

  const markCategoryDirty = () => {
    setCategoryDirty(true)
    setSync((current) => (current === 'offline' ? 'offline' : 'pending'))
  }

  const markTransactionDirty = () => {
    setTransactionDirty(true)
    setSync((current) => (current === 'offline' ? 'offline' : 'pending'))
  }

  const markRecurringDirty = () => {
    setRecurringDirty(true)
    setSync((current) => (current === 'offline' ? 'offline' : 'pending'))
  }

  const markGoalDirty = () => {
    setGoalDirty(true)
    setSync((current) => (current === 'offline' ? 'offline' : 'pending'))
  }

  useEffect(() => {
    const onOnline = () => setSync((current) => (current === 'pending' ? 'pending' : 'synced'))
    const onOffline = () => setSync('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    const raw = localStorage.getItem(`${LOCAL_KEY}:${userId}`)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<DataState>
        setData({
          currency: parsed.currency || 'CAD',
          categories: Array.isArray(parsed.categories) ? parsed.categories as Category[] : [],
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions as Transaction[] : [],
          recurring: Array.isArray(parsed.recurring) ? parsed.recurring as RecurringItem[] : [],
          goals: Array.isArray((parsed as Partial<DataState>).goals) ? (parsed as Partial<DataState>).goals as Goal[] : [],
          goalContributions: Array.isArray((parsed as Partial<DataState>).goalContributions) ? (parsed as Partial<DataState>).goalContributions as GoalContribution[] : [],
          settings: {
            allowTxnInFutureDate: Boolean(parsed.settings?.allowTxnInFutureDate),
            showCustomizeInDashboard: parsed.settings?.showCustomizeInDashboard ?? true,
          },
        })
        return
      } catch {
        // ignore broken cache
      }
    }

    const seeded = defaultSeed(userId)
    setData(seeded)
    localStorage.setItem(`${LOCAL_KEY}:${userId}`, JSON.stringify(seeded))
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const pull = async () => {
      if (!navigator.onLine) {
        setSync('offline')
        return
      }

      setSync('syncing')
      try {
        const [catsRes, txRes, recurringRes, goalsRes, goalContribRes] = await Promise.all([
          supabase.from('categories').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
          supabase.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false }),
          supabase.from('recurring_items').select('*').eq('user_id', userId).order('name', { ascending: true }),
          supabase.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
          supabase.from('goal_contributions').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
        ])

        if (catsRes.error) throw catsRes.error
        if (txRes.error) throw txRes.error
        if (recurringRes.error) throw recurringRes.error
        if (goalsRes.error) throw goalsRes.error
        if (goalContribRes.error) throw goalContribRes.error

        const cloudCats = (catsRes.data ?? []) as Category[]
        const cloudTx = (txRes.data ?? []) as Transaction[]
        const cloudRecurring = (recurringRes.data ?? []) as RecurringItem[]
        const cloudGoals = (goalsRes.data ?? []) as Goal[]
        const cloudGoalContributions = (goalContribRes.data ?? []) as GoalContribution[]

        if (cloudCats.length === 0 && cloudTx.length === 0 && cloudRecurring.length === 0 && cloudGoals.length === 0) {
          const seeded = defaultSeed(userId)
          persistLocal(seeded)
          setSync('synced')
          return
        }

        persistLocal((current) => ({
          currency: current.currency || 'CAD',
          categories: cloudCats,
          transactions: cloudTx,
          recurring: cloudRecurring,
          goals: cloudGoals,
          goalContributions: cloudGoalContributions,
          settings: current.settings ?? { allowTxnInFutureDate: false, showCustomizeInDashboard: true },
        }))
        setCategoryDirty(false)
        setTransactionDirty(false)
        setPendingCategoryDeletes([])
        setPendingTxDeletes([])
        setPendingRecurringDeletes([])
        setPendingGoalDeletes([])
        setPendingGoalContributions([])
        setRecurringDirty(false)
        setGoalDirty(false)
        setSync('synced')
      } catch (error) {
        console.error(error)
        setSync(navigator.onLine ? 'error' : 'offline')
      }
    }

    void pull()
  }, [userId])

  useEffect(() => {
    if (!userId) return

    const refreshCategories = async () => {
      if (categoryDirty) return
      const result = await supabase.from('categories').select('*').eq('user_id', userId).order('sort_order', { ascending: true })
      if (!result.error && result.data) {
        persistLocal((current) => ({ ...current, categories: result.data as Category[] }))
      }
    }

    const refreshTransactions = async () => {
      if (transactionDirty) return
      const result = await supabase.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false })
      if (!result.error && result.data) {
        persistLocal((current) => ({ ...current, transactions: result.data as Transaction[] }))
      }
    }

    const refreshRecurring = async () => {
      if (recurringDirty) return
      const result = await supabase.from('recurring_items').select('*').eq('user_id', userId).order('name', { ascending: true })
      if (!result.error && result.data) {
        persistLocal((current) => ({ ...current, recurring: result.data as RecurringItem[] }))
      }
    }

    const refreshGoals = async () => {
      if (goalDirty) return
      const result = await supabase.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: true })
      if (!result.error && result.data) {
        persistLocal((current) => ({ ...current, goals: result.data as Goal[] }))
      }
    }

    const refreshGoalContributions = async () => {
      if (goalDirty) return
      const result = await supabase.from('goal_contributions').select('*').eq('user_id', userId).order('created_at', { ascending: true })
      if (!result.error && result.data) {
        persistLocal((current) => ({ ...current, goalContributions: result.data as GoalContribution[] }))
      }
    }

    const channel = supabase
      .channel(`raswi:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` }, () => {
        void refreshCategories()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, () => {
        void refreshTransactions()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_items', filter: `user_id=eq.${userId}` }, () => {
        void refreshRecurring()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `user_id=eq.${userId}` }, () => {
        void refreshGoals()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goal_contributions', filter: `user_id=eq.${userId}` }, () => {
        void refreshGoalContributions()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, categoryDirty, transactionDirty, recurringDirty, goalDirty])

  const categories = data.categories
  const transactions = data.transactions
  const recurring = data.recurring
  const goals = data.goals

  const catsById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])

  // Stable id -> color map from the fixed categorical palette, assigned in a
  // consistent order so the same category keeps the same color everywhere.
  const categoryColorMap = useMemo(() => {
    const orderedIds = [...categories]
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.id.localeCompare(right.id))
      .map((category) => category.id)
    orderedIds.push(UNCATEGORIZED_ID)
    return buildCategoryColorMap(orderedIds, 'light')
  }, [categories])

  const months = useMemo(() => {
    const keys = new Set<string>()
    transactions.forEach((tx) => keys.add(monthKey(tx.date)))
    keys.add(monthKey(new Date().toISOString()))
    return Array.from(keys).sort().reverse()
  }, [transactions])

  useEffect(() => {
    if (!months.includes(activeMonth)) setActiveMonth(months[0])
  }, [months, activeMonth])

  useEffect(() => {
    if (!months.includes(txActiveMonth)) setTxActiveMonth(months[0])
  }, [months, txActiveMonth])

  useEffect(() => {
    const syncActiveMonthToCurrentDate = () => {
      const currentMonth = monthKey(new Date().toISOString())
      setActiveMonth((current) => (current === currentMonth ? current : currentMonth))
    }

    syncActiveMonthToCurrentDate()
    const timer = window.setInterval(syncActiveMonthToCurrentDate, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  const monthTx = useMemo(() => transactions.filter((tx) => monthKey(tx.date) === activeMonth), [transactions, activeMonth])
  const transactionMonthTx = useMemo(() => transactions.filter((tx) => monthKey(tx.date) === txActiveMonth), [transactions, txActiveMonth])
  const income = useMemo(() => monthTx.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0), [monthTx])
  const expenses = useMemo(() => monthTx.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0), [monthTx])
  const net = income - expenses

  const prevMonth = useMemo(() => {
    const [y, m] = activeMonth.split('-').map(Number)
    if (!y || !m) return activeMonth
    const date = new Date(y, m - 2, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }, [activeMonth])
  const prevMonthTx = useMemo(() => transactions.filter((tx) => monthKey(tx.date) === prevMonth), [transactions, prevMonth])
  const prevIncome = useMemo(() => prevMonthTx.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0), [prevMonthTx])
  const prevExpenses = useMemo(() => prevMonthTx.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0), [prevMonthTx])
  const prevNet = prevIncome - prevExpenses

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>()
    monthTx.forEach((tx) => {
      if (tx.type !== 'expense') return
      const key = tx.category_id ?? 'uncat'
      totals.set(key, (totals.get(key) ?? 0) + Number(tx.amount || 0))
    })

    return Array.from(totals.entries())
      .map(([id, total]) => {
        const category = id === 'uncat' ? null : catsById.get(id) ?? null
        return { id, name: category?.name ?? 'Uncategorized', emoji: category?.emoji ?? (id === 'uncat' ? '📁' : '🏷️'), total, color: colorForCategory(id, categoryColorMap, 'light') }
      })
      .sort((left, right) => right.total - left.total)
  }, [monthTx, catsById, categoryColorMap])

  const daily = useMemo(() => {
    const totals = new Map<string, number>()
    monthTx.forEach((tx) => {
      if (tx.type !== 'expense') return
      totals.set(tx.date, (totals.get(tx.date) ?? 0) + Number(tx.amount || 0))
    })

    let cumulative = 0
    return Array.from(totals.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([date, spend]) => {
        cumulative += spend
        return { date, spend, cumulative }
      })
  }, [monthTx])


  const monthlyTrend = useMemo(() => {
    const activeDate = new Date(`${activeMonth}-01T00:00:00`)
    const currentYear = activeDate.getFullYear()
    const previousYear = currentYear - 1
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    const totalsCurrent = new Array(12).fill(0)
    const totalsPrevious = new Array(12).fill(0)

    transactions.forEach((tx) => {
      if (tx.type !== 'expense') return
      const date = new Date(`${tx.date}T00:00:00`)
      if (Number.isNaN(date.getTime())) return
      const monthIndex = date.getMonth()
      const amount = Number(tx.amount || 0)
      if (date.getFullYear() === currentYear) totalsCurrent[monthIndex] += amount
      if (date.getFullYear() === previousYear) totalsPrevious[monthIndex] += amount
    })

    const activeMonthIndex = activeDate.getMonth()

    return labels.map((label, index) => ({
      month: label,
      thisYear: totalsCurrent[index],
      lastYear: totalsPrevious[index],
      highlight: index === activeMonthIndex ? totalsCurrent[index] : 0,
    }))
  }, [transactions, activeMonth])

  const filteredTx = useMemo(() => {
    const query = txSearch.trim().toLowerCase()
    return transactionMonthTx.filter((tx) => {
      if (txType !== 'all' && tx.type !== txType) return false
      const categoryName = tx.category_id ? catsById.get(tx.category_id)?.name ?? '' : 'uncategorized'
      const haystack = `${tx.note ?? ''} ${categoryName} ${tx.amount} ${tx.date} ${tx.type}`.toLowerCase()
      return query ? haystack.includes(query) : true
    })
  }, [transactionMonthTx, txSearch, txType, catsById])

  const updateCategoryField = (id: string, field: 'name' | 'budget_monthly' | 'emoji', value: string) => {
    persistLocal((current) => ({
      ...current,
      categories: current.categories.map((category, index) => {
        if (category.id !== id) return category
        if (field === 'name') {
          const cleanName = value
          const nextEmoji = inferCategoryEmoji(cleanName)
          const currentEmoji = category.emoji || '🏷️'
          const previousSuggestedEmoji = inferCategoryEmoji(category.name || '')
          const shouldAutoUpdateEmoji = !currentEmoji || currentEmoji === '🏷️' || currentEmoji === previousSuggestedEmoji
          return {
            ...category,
            name: cleanName,
            color: categoryColorFor({ id: category.id, name: cleanName || category.name, color: category.color }, index),
            emoji: shouldAutoUpdateEmoji ? nextEmoji : currentEmoji,
          }
        }

        if (field === 'emoji') {
          return {
            ...category,
            emoji: value || '🏷️',
          }
        }

        const parsed = Number(value)
        return {
          ...category,
          budget_monthly: value.trim() === '' ? 0 : clampMoney(Number.isFinite(parsed) ? parsed : category.budget_monthly ?? 0),
        }
      }),
    }))
    markCategoryDirty()
  }

  const addCategory = () => {
    if (!userId) return
    const nextSort = (categories.reduce((max, category) => Math.max(max, category.sort_order ?? 0), 0) || 0) + 1
    const id = crypto.randomUUID()
    const name = 'New Category'
    persistLocal((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          id,
          user_id: userId,
          name,
          color: categoryColorFor({ id, name, color: null }, nextSort),
          emoji: inferCategoryEmoji(name),
          budget_monthly: 0,
          sort_order: nextSort,
        },
      ],
    }))
    markCategoryDirty()
  }

  // Return an existing real category id matching `name` (case-insensitive), or
  // create a new real category and return its id. Used so recurring income
  // categories are stored as real rows (the category_id column is a uuid FK, so
  // synthetic ids can't persist).
  const getOrCreateCategory = (name: string, emoji?: string | null): string | null => {
    if (!userId) return null
    const trimmed = name.trim()
    if (!trimmed) return null
    const existing = data.categories.find((category) => category.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing.id
    const nextSort = (data.categories.reduce((max, category) => Math.max(max, category.sort_order ?? 0), 0) || 0) + 1
    const id = crypto.randomUUID()
    persistLocal((current) => ({
      ...current,
      categories: [
        ...current.categories,
        {
          id,
          user_id: userId,
          name: trimmed,
          color: categoryColorFor({ id, name: trimmed, color: null }, nextSort),
          emoji: emoji ?? inferCategoryEmoji(trimmed),
          budget_monthly: 0,
          sort_order: nextSort,
        },
      ],
    }))
    markCategoryDirty()
    return id
  }

  const deleteCategory = (id: string) => {
    persistLocal((current) => ({
      ...current,
      categories: current.categories.filter((category) => category.id !== id),
      transactions: current.transactions.map((tx) => (tx.category_id === id ? { ...tx, category_id: null } : tx)),
    }))
    setPendingCategoryDeletes((current) => (current.includes(id) ? current : [...current, id]))
    markCategoryDirty()
    markTransactionDirty()
    notify('Category removed')
  }

  const saveCategories = async () => {
    if (!userId || !categoryDirty) return false
    if (!navigator.onLine) {
      setSync('offline')
      return false
    }

    const sanitizedCategories = categories.map((category, index) => ({
      id: category.id,
      user_id: userId,
      name: category.name.trim() || 'Untitled',
      color: categoryColorFor({ id: category.id, name: category.name.trim() || 'Untitled', color: category.color }, index),
      emoji: (category.emoji || '🏷️').trim() || '🏷️',
      budget_monthly: clampMoney(Number(category.budget_monthly ?? 0)),
      sort_order: Number(category.sort_order ?? index + 1) || index + 1,
    }))

    persistLocal((current) => ({ ...current, categories: sanitizedCategories }))
    setSync('syncing')

    try {
      const deleteIds = pendingCategoryDeletes.filter((id) => id && !sanitizedCategories.some((category) => category.id === id))

      for (const category of sanitizedCategories) {
        const result = await supabase.from('categories').upsert(category, { onConflict: 'id' })
        throwIfResultError(result)
      }

      for (const id of deleteIds) {
        const result = await supabase.from('categories').delete().eq('id', id).eq('user_id', userId)
        throwIfResultError(result)
      }

      setPendingCategoryDeletes([])
      setCategoryDirty(false)
      setSync(transactionDirty ? 'pending' : 'synced')
      notify('Categories updated')
      return true
    } catch (error) {
      console.error('Category sync failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to save categories.'
      alert(`Category sync failed: ${message}`)
      setSync('error')
      return false
    }
  }

  const addTransaction = () => {
    if (!userId) return
    const amount = Number(txDraft.amount)
    if (!Number.isFinite(amount)) return

    if (txDraft.type === 'expense' && !txDraft.category_id) {
      alert('Please choose a category before adding an expense transaction.')
      return
    }

    const today = todayIso()
    if (!data.settings.allowTxnInFutureDate && txDraft.date > today) {
      alert('Future-dated transactions are currently turned off in Settings.')
      return
    }

    const next: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      date: txDraft.date,
      type: txDraft.type,
      category_id: txDraft.category_id || null,
      amount: clampMoney(amount),
      note: txDraft.note.trim() || null,
    }

    persistLocal((current) => ({
      ...current,
      transactions: [next, ...current.transactions.filter((tx) => tx.id !== next.id)],
    }))

    setTxDraft((current) => ({ ...current, date: todayIso(), amount: '', note: '' }))
    markTransactionDirty()
    notify('New transaction added')
  }

  const createTransaction = (values: { date: string; type: TxType; category_id: string | null; amount: number; note: string | null; receipt_url?: string | null }): string | null => {
    if (!userId) return 'You are signed out.'
    const amount = clampMoney(Number(values.amount))
    if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
    if (values.type === 'expense' && !values.category_id) return 'Choose a category for this expense.'
    const today = todayIso()
    if (!data.settings.allowTxnInFutureDate && values.date > today) return 'Future-dated transactions are turned off in Settings.'

    const next: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      date: values.date,
      type: values.type,
      category_id: values.category_id || null,
      amount,
      note: values.note?.trim() || null,
      receipt_url: values.receipt_url || null,
    }

    persistLocal((current) => ({
      ...current,
      transactions: [next, ...current.transactions.filter((tx) => tx.id !== next.id)],
    }))
    markTransactionDirty()
    notify('New transaction added')
    return null
  }

  const updateTransaction = (id: string, patch: Partial<Pick<Transaction, 'date' | 'type' | 'category_id' | 'amount' | 'note' | 'receipt_url'>>): string | null => {
    if (!userId) return 'You are signed out.'
    if (patch.amount != null) {
      const amount = clampMoney(Number(patch.amount))
      if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
      patch = { ...patch, amount }
    }
    if (patch.date && !data.settings.allowTxnInFutureDate && patch.date > todayIso()) return 'Future-dated transactions are turned off in Settings.'
    persistLocal((current) => ({
      ...current,
      transactions: current.transactions.map((tx) => (tx.id === id ? { ...tx, ...patch, note: patch.note !== undefined ? (patch.note?.trim() || null) : tx.note } : tx)),
    }))
    markTransactionDirty()
    notify('Transaction updated')
    return null
  }

  const duplicateTransaction = (id: string) => {
    if (!userId) return
    persistLocal((current) => {
      const source = current.transactions.find((tx) => tx.id === id)
      if (!source) return current
      const copy: Transaction = { ...source, id: crypto.randomUUID(), created_at: undefined, updated_at: undefined }
      return { ...current, transactions: [copy, ...current.transactions] }
    })
    markTransactionDirty()
    notify('Transaction duplicated')
  }

  const restoreTransaction = (tx: Transaction) => {
    if (!userId) return
    setPendingTxDeletes((current) => current.filter((pendingId) => pendingId !== tx.id))
    persistLocal((current) => ({
      ...current,
      transactions: current.transactions.some((existing) => existing.id === tx.id)
        ? current.transactions
        : [tx, ...current.transactions],
    }))
    markTransactionDirty()
    notify('Transaction restored')
  }

  const deleteTx = (id: string) => {
    persistLocal((current) => ({
      ...current,
      transactions: current.transactions.filter((tx) => tx.id !== id),
    }))
    setPendingTxDeletes((current) => (current.includes(id) ? current : [...current, id]))
    markTransactionDirty()
    notify('Transaction removed')
  }

  const saveTransactions = async () => {
    if (!userId || !transactionDirty) return
    if (!navigator.onLine) {
      setSync('offline')
      return
    }

    if (categoryDirty) {
      const categoriesSaved = await saveCategories()
      if (!categoriesSaved) return
    }

    const validCategoryIds = new Set(data.categories.map((category) => category.id))
    const sanitizedTransactions = transactions.map((tx) => ({
      id: tx.id,
      user_id: userId,
      date: tx.date,
      type: tx.type,
      category_id: tx.category_id && validCategoryIds.has(tx.category_id) ? tx.category_id : null,
      amount: clampMoney(Number(tx.amount ?? 0)),
      note: tx.note?.trim() || null,
      receipt_url: tx.receipt_url || null,
    }))

    persistLocal((current) => ({ ...current, transactions: sanitizedTransactions }))
    setSync('syncing')

    try {
      const deleteIds = pendingTxDeletes.filter((id) => id && !sanitizedTransactions.some((tx) => tx.id === id))

      for (const transaction of sanitizedTransactions) {
        const result = await supabase.from('transactions').upsert(transaction, { onConflict: 'id' })
        throwIfResultError(result)
      }

      for (const id of deleteIds) {
        const result = await supabase.from('transactions').delete().eq('id', id).eq('user_id', userId)
        throwIfResultError(result)
      }

      setPendingTxDeletes([])
      setTransactionDirty(false)
      setSync('synced')
      notify('Transactions updated')
    } catch (error) {
      console.error('Transaction sync failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to save transactions.'
      alert(`Transaction sync failed: ${message}`)
      setSync('error')
    }
  }

  const setAllowTxnInFutureDate = (value: boolean) => {
    persistLocal((current) => ({
      ...current,
      settings: {
        ...(current.settings ?? { allowTxnInFutureDate: false }),
        allowTxnInFutureDate: value,
      },
    }))

    if (!value) {
      const today = todayIso()
      setTxDraft((current) => (current.date > today ? { ...current, date: today } : current))
    }
    notify(value ? 'Future dates enabled' : 'Future dates disabled')
  }

  const setShowCustomizeInDashboard = (value: boolean) => {
    persistLocal((current) => ({
      ...current,
      settings: {
        ...(current.settings ?? { allowTxnInFutureDate: false, showCustomizeInDashboard: true }),
        showCustomizeInDashboard: value,
      },
    }))
    notify(value ? 'Dashboard customize button shown' : 'Dashboard customize button hidden')
  }

  const exportJSON = () => {
    download(`budgetly_${activeMonth}.json`, JSON.stringify(data, null, 2), 'application/json')
  }

  const exportCSV = () => {
    const header = ['date', 'type', 'category', 'amount', 'note']
    const rows = transactions
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((tx) => {
        const categoryName = tx.category_id ? catsById.get(tx.category_id)?.name ?? '' : ''
        return [
          safeCsv(tx.date),
          safeCsv(tx.type),
          safeCsv(categoryName),
          safeCsv(Number(tx.amount ?? 0)),
          safeCsv(tx.note ?? ''),
        ].join(',')
      })

    download('budgetly_transactions.csv', [header.join(','), ...rows].join('\n'), 'text/csv')
  }

  const importJSON = async (file: File) => {
    if (!userId) return
    const text = await file.text()
    const parsed = JSON.parse(text) as DataState
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.transactions)) throw new Error('Invalid JSON.')

    const categoriesToImport = parsed.categories.map((category, index) => ({
      ...category,
      user_id: userId,
      id: category.id || crypto.randomUUID(),
      sort_order: Number(category.sort_order ?? index + 1),
      emoji: category.emoji || '🏷️',
    })) as Category[]

    const transactionsToImport = parsed.transactions.map((tx) => ({
      ...tx,
      user_id: userId,
      id: tx.id || crypto.randomUUID(),
    })) as Transaction[]

    const next: DataState = {
      currency: parsed.currency || data.currency || 'CAD',
      categories: categoriesToImport,
      transactions: transactionsToImport,
      recurring: Array.isArray((parsed as Partial<DataState>).recurring) ? ((parsed as Partial<DataState>).recurring as RecurringItem[]).map((item) => ({ ...item, user_id: userId, id: item.id || crypto.randomUUID(), kind: item.kind === 'income' ? 'income' : 'expense', recurrence_type: item.recurrence_type === 'weekly' || item.recurrence_type === 'biweekly' ? item.recurrence_type : 'monthly', anchor_date: item.anchor_date || todayIso() })) : data.recurring,
      goals: Array.isArray((parsed as Partial<DataState>).goals) ? ((parsed as Partial<DataState>).goals as Goal[]).map((goal) => ({ ...goal, user_id: userId, id: goal.id || crypto.randomUUID(), emoji: goal.emoji || inferGoalEmoji(goal.name || ''), target_amount: clampMoney(Number(goal.target_amount ?? 0)), current_amount: clampMoney(Number(goal.current_amount ?? 0)), target_date: goal.target_date || null, note: goal.note ?? '' })) : data.goals,
      goalContributions: Array.isArray((parsed as Partial<DataState>).goalContributions) ? ((parsed as Partial<DataState>).goalContributions as GoalContribution[]).map((contribution) => ({ ...contribution, user_id: userId, id: contribution.id || crypto.randomUUID() })) : data.goalContributions,
      settings: {
        allowTxnInFutureDate: Boolean((parsed as Partial<DataState>).settings?.allowTxnInFutureDate ?? data.settings.allowTxnInFutureDate),
        showCustomizeInDashboard: (parsed as Partial<DataState>).settings?.showCustomizeInDashboard ?? data.settings.showCustomizeInDashboard ?? true,
      },
    }

    persistLocal(next)
    setCategoryDirty(true)
    setTransactionDirty(true)
    setPendingCategoryDeletes([])
    setPendingTxDeletes([])
    setPendingGoalDeletes([])
    setGoalDirty(true)
    setSync(navigator.onLine ? 'pending' : 'offline')
    notify('Data imported')
  }


  const sortedGoals = useMemo(
    () => [...goals].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    [goals],
  )

  const addGoal = (initial?: { name?: string; emoji?: string; target_amount?: string | number; current_amount?: string | number; target_date?: string | null; note?: string }) => {
    if (!userId) return
    const fallbackName = `New Goal ${goals.length + 1}`
    const name = (initial?.name ?? '').trim() || fallbackName
    const targetAmount = clampMoney(Number(initial?.target_amount ?? 1000))
    const currentAmount = clampMoney(Number(initial?.current_amount ?? 0))
    const goalId = crypto.randomUUID()
    const startingAmount = targetAmount > 0 ? Math.min(currentAmount, targetAmount) : currentAmount
    // Seed an opening contribution so a goal created with money already saved
    // has a real history point to project a pace from.
    const seedContribution: GoalContribution | null = startingAmount > 0 ? {
      id: crypto.randomUUID(),
      goal_id: goalId,
      user_id: userId,
      amount: startingAmount,
      created_at: new Date().toISOString(),
    } : null
    persistLocal((current) => ({
      ...current,
      goals: [
        ...current.goals,
        {
          id: goalId,
          user_id: userId,
          name,
          emoji: initial?.emoji || inferGoalEmoji(name),
          target_amount: targetAmount,
          current_amount: startingAmount,
          target_date: initial?.target_date || null,
          note: initial?.note ?? '',
        },
      ],
      goalContributions: seedContribution ? [...current.goalContributions, seedContribution] : current.goalContributions,
    }))
    if (seedContribution) setPendingGoalContributions((current) => [...current, seedContribution])
    markGoalDirty()
    notify('New goal added')
  }

  const updateGoalField = (id: string, field: 'name' | 'emoji' | 'target_amount' | 'current_amount' | 'target_date' | 'note', value: string) => {
    persistLocal((current) => ({
      ...current,
      goals: current.goals.map((goal) => {
        if (goal.id !== id) return goal
        if (field === 'name') {
          const cleanName = value
          const nextEmoji = inferGoalEmoji(cleanName)
          const currentEmoji = goal.emoji || '🎯'
          const previousSuggestedEmoji = inferGoalEmoji(goal.name || '')
          const shouldAutoUpdateEmoji = !currentEmoji || currentEmoji === '🎯' || currentEmoji === previousSuggestedEmoji
          return { ...goal, name: cleanName, emoji: shouldAutoUpdateEmoji ? nextEmoji : currentEmoji }
        }
        if (field === 'emoji') return { ...goal, emoji: value || '🎯' }
        if (field === 'target_date') return { ...goal, target_date: value || null }
        if (field === 'note') return { ...goal, note: value }
        const parsed = Number(value)
        const safeAmount = value.trim() === '' ? 0 : clampMoney(Number.isFinite(parsed) ? parsed : (field === 'target_amount' ? goal.target_amount : goal.current_amount) ?? 0)
        if (field === 'target_amount') {
          const existingCurrent = clampMoney(Number(goal.current_amount ?? 0))
          return { ...goal, target_amount: safeAmount, current_amount: safeAmount > 0 ? Math.min(existingCurrent, safeAmount) : existingCurrent }
        }
        return { ...goal, current_amount: safeAmount }
      }),
    }))
    markGoalDirty()
  }

  const contributeToGoal = (id: string, amount: number) => {
    if (!userId) return
    const contribution = clampMoney(amount)
    if (!contribution) return
    const record: GoalContribution = {
      id: crypto.randomUUID(),
      goal_id: id,
      user_id: userId,
      amount: contribution,
      created_at: new Date().toISOString(),
    }
    persistLocal((current) => ({
      ...current,
      goals: current.goals.map((goal) => {
        if (goal.id !== id) return goal
        const targetAmount = clampMoney(Number(goal.target_amount ?? 0))
        const nextCurrent = clampMoney(Number(goal.current_amount ?? 0) + contribution)
        return { ...goal, current_amount: targetAmount > 0 ? Math.min(nextCurrent, targetAmount) : nextCurrent }
      }),
      goalContributions: [...current.goalContributions, record],
    }))
    setPendingGoalContributions((current) => [...current, record])
    markGoalDirty()
    notify('Contribution added')
  }

  const deleteGoal = (id: string) => {
    persistLocal((current) => ({
      ...current,
      goals: current.goals.filter((goal) => goal.id !== id),
      goalContributions: current.goalContributions.filter((contribution) => contribution.goal_id !== id),
    }))
    // Server-side cascade removes the rows; just drop any not-yet-synced inserts.
    setPendingGoalContributions((current) => current.filter((contribution) => contribution.goal_id !== id))
    setPendingGoalDeletes((current) => (current.includes(id) ? current : [...current, id]))
    markGoalDirty()
    notify('Goal removed')
  }

  // ---- Assistant-driven actions (confirmed in chat before they run here) ----

  // Category used to record money moved into a goal as an expense, so the amount
  // is reflected as a real deduction from Net (income - expenses) for the period.
  const GOAL_CONTRIB_CATEGORY_NAME = 'Goal Contributions'

  type GoalTransferResult =
    | { ok: true; goalName: string; amount: number; newSaved: number; newNet: number }
    | { ok: false; error: string }

  // Move `amount` into a goal: increase the goal's saved amount by `amount` and
  // record a matching expense so the same Net figure the Dashboard shows drops by
  // exactly `amount`. Local-first (autosaved to Supabase); returns the resulting
  // state so the assistant can confirm it back to the user.
  const transferToGoal = (goalId: string, amount: number): GoalTransferResult => {
    if (!userId) return { ok: false, error: 'You are signed out.' }
    const contribution = clampMoney(Number(amount))
    if (!Number.isFinite(contribution) || contribution <= 0) return { ok: false, error: 'Enter an amount greater than zero.' }
    const goal = data.goals.find((item) => item.id === goalId)
    if (!goal) return { ok: false, error: 'That goal could not be found.' }

    const existingCategory = data.categories.find((category) => category.name.trim().toLowerCase() === GOAL_CONTRIB_CATEGORY_NAME.toLowerCase())
    const nextSort = (data.categories.reduce((max, category) => Math.max(max, category.sort_order ?? 0), 0) || 0) + 1
    const categoryId = existingCategory ? existingCategory.id : crypto.randomUUID()
    const newCategory: Category | null = existingCategory
      ? null
      : {
          id: categoryId,
          user_id: userId,
          name: GOAL_CONTRIB_CATEGORY_NAME,
          color: categoryColorFor({ id: categoryId, name: GOAL_CONTRIB_CATEGORY_NAME, color: null }, nextSort),
          emoji: '📈',
          budget_monthly: 0,
          sort_order: nextSort,
        }

    const expense: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      date: todayIso(),
      type: 'expense',
      category_id: categoryId,
      amount: contribution,
      note: `Moved to ${goal.name}`,
    }

    const newSaved = clampMoney(Number(goal.current_amount ?? 0) + contribution)

    persistLocal((current) => ({
      ...current,
      categories: newCategory ? [...current.categories, newCategory] : current.categories,
      transactions: [expense, ...current.transactions],
      goals: current.goals.map((item) =>
        item.id === goalId ? { ...item, current_amount: clampMoney(Number(item.current_amount ?? 0) + contribution) } : item,
      ),
    }))

    if (newCategory) markCategoryDirty()
    markTransactionDirty()
    markGoalDirty()
    notify(`Moved ${fmtMoney(contribution, data.currency)} to ${goal.name}`)

    // The expense is dated today (current period), so Net drops by exactly `amount`.
    return { ok: true, goalName: goal.name, amount: contribution, newSaved, newNet: net - contribution }
  }

  type BudgetUpdateResult =
    | { ok: true; categoryName: string; newBudget: number; previousBudget: number }
    | { ok: false; error: string }

  // Set a category's monthly budget limit. Local-first (autosaved to Supabase).
  const setCategoryBudget = (categoryId: string, amount: number): BudgetUpdateResult => {
    if (!userId) return { ok: false, error: 'You are signed out.' }
    const value = clampMoney(Number(amount))
    if (!Number.isFinite(value)) return { ok: false, error: 'Enter a valid amount.' }
    const category = data.categories.find((item) => item.id === categoryId)
    if (!category) return { ok: false, error: 'That category could not be found.' }
    const previousBudget = clampMoney(Number(category.budget_monthly ?? 0))
    persistLocal((current) => ({
      ...current,
      categories: current.categories.map((item) => (item.id === categoryId ? { ...item, budget_monthly: value } : item)),
    }))
    markCategoryDirty()
    notify(`Budget for ${category.name} set to ${fmtMoney(value, data.currency)}`)
    return { ok: true, categoryName: category.name, newBudget: value, previousBudget }
  }

  const saveGoals = async () => {
    if (!userId || !goalDirty) return false
    if (!navigator.onLine) {
      setSync('offline')
      return false
    }

    const sanitizedGoals = goals.map((goal) => {
      const targetAmount = clampMoney(Number(goal.target_amount ?? 0))
      const currentAmount = clampMoney(Number(goal.current_amount ?? 0))
      return {
        id: goal.id,
        user_id: userId,
        name: goal.name.trim() || 'Untitled goal',
        emoji: goal.emoji || inferGoalEmoji(goal.name.trim() || 'Goal'),
        target_amount: targetAmount,
        // Saved amount is never capped at the target: moving money into a goal via
        // the assistant may legitimately over-fund it, and the UI clamps display to 100%.
        current_amount: currentAmount,
        target_date: goal.target_date || null,
        note: goal.note?.trim() || null,
      }
    })

    persistLocal((current) => ({ ...current, goals: sanitizedGoals }))
    setSync('syncing')

    try {
      const deleteIds = pendingGoalDeletes.filter((id) => id && !sanitizedGoals.some((goal) => goal.id === id))
      for (const goal of sanitizedGoals) {
        const result = await supabase.from('goals').upsert(goal, { onConflict: 'id' })
        throwIfResultError(result)
      }
      // Persist any new contributions (append-only history) for goals that still exist.
      const contributionsToInsert = pendingGoalContributions.filter((contribution) => sanitizedGoals.some((goal) => goal.id === contribution.goal_id))
      if (contributionsToInsert.length > 0) {
        const result = await supabase.from('goal_contributions').upsert(contributionsToInsert, { onConflict: 'id' })
        throwIfResultError(result)
      }
      for (const id of deleteIds) {
        const result = await supabase.from('goals').delete().eq('id', id).eq('user_id', userId)
        throwIfResultError(result)
      }
      setPendingGoalContributions([])
      setPendingGoalDeletes([])
      setGoalDirty(false)
      setSync(categoryDirty || transactionDirty || recurringDirty ? 'pending' : 'synced')
      notify('Goals updated')
      return true
    } catch (error) {
      console.error('Goals sync failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to save goals.'
      alert(`Goals sync failed: ${message}`)
      setSync('error')
      return false
    }
  }


  const sortedRecurring = useMemo(
    () => [...recurring].sort((left, right) => left.name.localeCompare(right.name) || (left.day_of_month ?? 0) - (right.day_of_month ?? 0)),
    [recurring],
  )

  const addRecurring = (draft?: Partial<Pick<RecurringItem, 'name' | 'category_id' | 'amount' | 'kind' | 'recurrence_type' | 'day_of_month' | 'anchor_date' | 'note'>>) => {
    if (!userId) return null
    const newId = crypto.randomUUID()
    persistLocal((current) => ({
      ...current,
      recurring: [
        ...current.recurring,
        {
          id: newId,
          user_id: userId,
          name: draft?.name?.trim() || 'New Bill',
          category_id: typeof draft?.category_id === 'string' && draft.category_id ? draft.category_id : null,
          amount: Number.isFinite(Number(draft?.amount)) ? clampMoney(Number(draft?.amount)) : 0,
          kind: draft?.kind === 'income' ? 'income' : 'expense',
          recurrence_type: draft?.recurrence_type === 'weekly' || draft?.recurrence_type === 'biweekly' ? draft.recurrence_type : 'monthly',
          day_of_month: Math.max(1, Math.min(31, Number(draft?.day_of_month ?? Math.min(28, new Date().getDate() || 1)))),
          anchor_date: draft?.anchor_date || todayIso(),
          note: typeof draft?.note === 'string' ? draft.note : '',
        },
      ],
    }))
    markRecurringDirty()
    notify('New recurring item added')
    return newId
  }

  const updateRecurringField = (id: string, field: 'name' | 'category_id' | 'amount' | 'day_of_month' | 'note' | 'recurrence_type' | 'anchor_date' | 'kind', value: string) => {
    persistLocal((current) => ({
      ...current,
      recurring: current.recurring.map((item) => {
        if (item.id !== id) return item
        if (field === 'name') return { ...item, name: value }
        if (field === 'category_id') return { ...item, category_id: value || null }
        if (field === 'note') return { ...item, note: value }
        if (field === 'kind') return { ...item, kind: (value === 'income' ? 'income' : 'expense') as RecurringKind }
        if (field === 'recurrence_type') {
          const recurrenceType = (value === 'weekly' || value === 'biweekly' ? value : 'monthly') as RecurrenceType
          return { ...item, recurrence_type: recurrenceType, anchor_date: item.anchor_date || todayIso() }
        }
        if (field === 'anchor_date') return { ...item, anchor_date: value || todayIso() }
        if (field === 'amount') {
          const parsed = Number(value)
          return { ...item, amount: value.trim() === '' ? 0 : clampMoney(Number.isFinite(parsed) ? parsed : item.amount ?? 0) }
        }
        const parsed = Number(value)
        const day = Math.max(1, Math.min(31, Number.isFinite(parsed) ? Math.round(parsed) : item.day_of_month || 1))
        return { ...item, day_of_month: day }
      }),
    }))
    markRecurringDirty()
  }

  const deleteRecurring = (id: string) => {
    persistLocal((current) => ({
      ...current,
      recurring: current.recurring.filter((item) => item.id !== id),
    }))
    setPendingRecurringDeletes((current) => (current.includes(id) ? current : [...current, id]))
    markRecurringDirty()
    notify('Recurring item removed')
  }

  const saveRecurring = async () => {
    if (!userId || !recurringDirty) return false
    if (!navigator.onLine) {
      setSync('offline')
      return false
    }

    // Persist any categories created inline (e.g. income categories) first so the
    // recurring_items.category_id foreign key resolves. Mirrors saveTransactions.
    if (categoryDirty) {
      const categoriesSaved = await saveCategories()
      if (!categoriesSaved) return false
    }

    const validCategoryIds = new Set(categories.map((category) => category.id))
    const sanitizedRecurring = recurring.map((item) => ({
      id: item.id,
      user_id: userId,
      name: item.name.trim() || 'Untitled bill',
      category_id: item.category_id && validCategoryIds.has(item.category_id) ? item.category_id : null,
      amount: clampMoney(Number(item.amount ?? 0)),
      kind: (item.kind === 'income' ? 'income' : 'expense') as RecurringKind,
      recurrence_type: (item.recurrence_type === 'weekly' || item.recurrence_type === 'biweekly' ? item.recurrence_type : 'monthly') as RecurrenceType,
      day_of_month: Math.max(1, Math.min(31, Number(item.day_of_month ?? 1) || 1)),
      anchor_date: item.anchor_date || todayIso(),
      note: item.note?.trim() || null,
    }))

    persistLocal((current) => ({ ...current, recurring: sanitizedRecurring }))
    setSync('syncing')

    try {
      const deleteIds = pendingRecurringDeletes.filter((id) => id && !sanitizedRecurring.some((item) => item.id === id))
      for (const item of sanitizedRecurring) {
        const result = await supabase.from('recurring_items').upsert(item, { onConflict: 'id' })
        throwIfResultError(result)
      }
      for (const id of deleteIds) {
        const result = await supabase.from('recurring_items').delete().eq('id', id).eq('user_id', userId)
        throwIfResultError(result)
      }
      setPendingRecurringDeletes([])
      setRecurringDirty(false)
      setSync(categoryDirty || transactionDirty ? 'pending' : 'synced')
      notify('Recurring updated')
      return true
    } catch (error) {
      console.error('Recurring sync failed:', error)
      const message = error instanceof Error ? error.message : 'Failed to save recurring items.'
      alert(`Recurring sync failed: ${message}`)
      setSync('error')
      return false
    }
  }

  const upcomingRecurringThisMonth = useMemo(() => {
    const now = new Date()
    const windowStart = startOfLocalDay(now)
    const windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + 7)
    const todayStart = windowStart
    const rows: Array<RecurringItem & { dueDateIso: string; dueDay: number; daysAway: number; category: Category | null; recurrenceLabel: string }> = []

    const pushOccurrence = (item: RecurringItem, dueDate: Date, recurrenceLabel: string) => {
      if (dueDate < windowStart || dueDate > windowEnd) return
      const category = item.category_id ? catsById.get(item.category_id) ?? null : null
      const diffDays = Math.max(0, Math.ceil((startOfLocalDay(dueDate).getTime() - todayStart.getTime()) / 86400000))
      rows.push({
        ...item,
        kind: item.kind === 'income' ? 'income' : 'expense',
        dueDateIso: isoAtLocalMidnight(dueDate),
        dueDay: dueDate.getDate(),
        daysAway: diffDays,
        category,
        recurrenceLabel,
      })
    }

    for (const item of sortedRecurring) {
      const recurrenceType = item.recurrence_type === 'weekly' || item.recurrence_type === 'biweekly' ? item.recurrence_type : 'monthly'
      if (recurrenceType === 'monthly') {
        const dueDay = Math.max(1, Math.min(31, Number(item.day_of_month ?? 1) || 1))
        const monthDays = new Date(windowStart.getFullYear(), windowStart.getMonth() + 1, 0).getDate()
        const dueDate = new Date(windowStart.getFullYear(), windowStart.getMonth(), Math.min(dueDay, monthDays))
        if (dueDate < windowStart) {
          const nextMonthDays = new Date(windowStart.getFullYear(), windowStart.getMonth() + 2, 0).getDate()
          dueDate.setMonth(dueDate.getMonth() + 1, Math.min(dueDay, nextMonthDays))
        }
        pushOccurrence(item, dueDate, 'Every month')
        continue
      }

      const anchor = parseIsoLocal(item.anchor_date) ?? windowStart
      const stepDays = recurrenceType === 'weekly' ? 7 : 14
      let occurrence = startOfLocalDay(anchor)
      while (occurrence < windowStart) {
        occurrence = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate() + stepDays)
      }
      while (occurrence <= windowEnd) {
        pushOccurrence(item, occurrence, recurrenceType === 'weekly' ? 'Every week' : 'Every 2 weeks')
        occurrence = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate() + stepDays)
      }
    }

    return rows.sort((left, right) => left.daysAway - right.daysAway || left.name.localeCompare(right.name))
  }, [sortedRecurring, catsById]) as Array<RecurringItem & { dueDateIso: string; dueDay: number; daysAway: number; category: Category | null; recurrenceLabel: string }>

  const sortedCategories = useMemo(
    () => [...categories].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.id.localeCompare(right.id)),
    [categories],
  )

  return {
    sync,
    data,
    categories,
    catsById,
    months,
    activeMonth,
    setActiveMonth,
    txActiveMonth,
    setTxActiveMonth,
    income,
    expenses,
    net,
    prevIncome,
    prevExpenses,
    prevNet,
    prevMonth,
    categoryColorMap,
    byCategory,
    daily,
    monthlyTrend,
    txDraft,
    setTxDraft,
    txSearch,
    setTxSearch,
    txType,
    setTxType,
    filteredTx,
    sortedCategories,
    sortedRecurring,
    sortedGoals,
    upcomingRecurringThisMonth,
    addCategory,
    getOrCreateCategory,
    updateCategoryField,
    deleteCategory,
    saveCategories,
    categoryDirty,
    addRecurring,
    updateRecurringField,
    deleteRecurring,
    saveRecurring,
    recurringDirty,
    addGoal,
    updateGoalField,
    contributeToGoal,
    transferToGoal,
    setCategoryBudget,
    deleteGoal,
    saveGoals,
    goalDirty,
    addTransaction,
    createTransaction,
    updateTransaction,
    duplicateTransaction,
    restoreTransaction,
    deleteTx,
    saveTransactions,
    transactionDirty,
    exportCSV,
    exportJSON,
    importJSON,
    setCurrency: (currency: string) => { persistLocal((current) => ({ ...current, currency })); notify('Currency updated') },
    setAllowTxnInFutureDate,
    setShowCustomizeInDashboard,
    helpers: { fmtMoney, monthLabel },
  }
}
