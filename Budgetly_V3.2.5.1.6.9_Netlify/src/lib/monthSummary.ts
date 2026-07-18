import { Category, RecurringItem, Transaction, TxType } from '../types'
import { monthKey } from './utils'

export type MonthSummaryActivity = {
  id: string
  date: string
  type: TxType
  label: string
  amount: number
}

export type MonthEndSummary = {
  monthKey: string
  monthTitle: string
  transactionCount: number
  income: number
  expenses: number
  net: number
  largestExpense: { label: string; amount: number } | null
  topCategory: { name: string; emoji: string; total: number } | null
  recurringProcessed: number
  addedFinalWeek: number
  recentActivity: MonthSummaryActivity[]
}

const parseIsoLocal = (value?: string | null): Date | null => {
  if (!value) return null
  const [y, m, d] = String(value).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

// Count how many times a recurring item was scheduled to run between `start`
// and `end` (inclusive) — used for the "recurring items processed" stat.
const countRecurringOccurrences = (item: RecurringItem, start: Date, end: Date): number => {
  if (end < start) return 0
  const recurrenceType = item.recurrence_type === 'weekly' || item.recurrence_type === 'biweekly' ? item.recurrence_type : 'monthly'

  if (recurrenceType === 'monthly') {
    const monthDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    const dueDay = Math.max(1, Math.min(monthDays, Number(item.day_of_month ?? 1) || 1))
    const due = new Date(start.getFullYear(), start.getMonth(), dueDay)
    return due >= start && due <= end ? 1 : 0
  }

  const anchor = parseIsoLocal(item.anchor_date) ?? start
  const stepDays = recurrenceType === 'weekly' ? 7 : 14
  let occurrence = startOfLocalDay(anchor)
  while (occurrence < start) occurrence = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate() + stepDays)
  let count = 0
  while (occurrence <= end) {
    count += 1
    occurrence = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate() + stepDays)
  }
  return count
}

const activityLabel = (tx: Transaction, catsById: Map<string, Category>): string => {
  const note = (tx.note ?? '').trim()
  if (note) return note
  const category = tx.category_id ? catsById.get(tx.category_id)?.name : null
  return category || 'Uncategorized'
}

// Build the "month-end summary" shown on the last day of a month. All figures are
// derived from the transactions already dated within `targetMonth` (YYYY-MM), so it
// works for the current (in-progress) month and any completed month alike.
export const buildMonthEndSummary = (
  transactions: Transaction[],
  catsById: Map<string, Category>,
  recurring: RecurringItem[],
  targetMonth: string,
  now: Date = new Date(),
): MonthEndSummary => {
  const [year, month] = targetMonth.split('-').map(Number)
  const monthStart = new Date(year, (month || 1) - 1, 1)
  const monthEnd = new Date(year, (month || 1) - 1, new Date(year, month || 1, 0).getDate())
  const monthTitle = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const monthTx = transactions.filter((tx) => monthKey(tx.date) === targetMonth)

  const income = monthTx.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const expenses = monthTx.filter((tx) => tx.type === 'expense').reduce((sum, tx) => sum + Number(tx.amount || 0), 0)

  // Largest single expense of the month.
  let largestExpense: MonthEndSummary['largestExpense'] = null
  monthTx.forEach((tx) => {
    if (tx.type !== 'expense') return
    const amount = Number(tx.amount || 0)
    if (!largestExpense || amount > largestExpense.amount) {
      largestExpense = { label: activityLabel(tx, catsById), amount }
    }
  })

  // Category with the most expense spending.
  const categoryTotals = new Map<string, number>()
  monthTx.forEach((tx) => {
    if (tx.type !== 'expense') return
    const key = tx.category_id ?? 'uncategorized'
    categoryTotals.set(key, (categoryTotals.get(key) ?? 0) + Number(tx.amount || 0))
  })
  let topCategory: MonthEndSummary['topCategory'] = null
  categoryTotals.forEach((total, key) => {
    if (topCategory && total <= topCategory.total) return
    const category = key === 'uncategorized' ? null : catsById.get(key) ?? null
    topCategory = {
      name: category?.name ?? 'Uncategorized',
      emoji: category?.emoji ?? '📁',
      total,
    }
  })

  // Recurring items that were scheduled to run during the elapsed part of the month.
  const rangeEnd = startOfLocalDay(now) < monthEnd ? startOfLocalDay(now) : monthEnd
  const recurringProcessed = recurring.reduce((count, item) => count + (countRecurringOccurrences(item, monthStart, rangeEnd) > 0 ? 1 : 0), 0)

  // Transactions dated in the final 7 calendar days of the month.
  const finalWeekStart = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate() - 6)
  const addedFinalWeek = monthTx.filter((tx) => {
    const date = parseIsoLocal(tx.date)
    return date ? date >= finalWeekStart && date <= monthEnd : false
  }).length

  const recentActivity: MonthSummaryActivity[] = [...monthTx]
    .sort((left, right) => right.date.localeCompare(left.date) || (right.created_at ?? '').localeCompare(left.created_at ?? ''))
    .slice(0, 4)
    .map((tx) => ({
      id: tx.id,
      date: tx.date,
      type: tx.type,
      label: activityLabel(tx, catsById),
      amount: Number(tx.amount || 0),
    }))

  return {
    monthKey: targetMonth,
    monthTitle,
    transactionCount: monthTx.length,
    income,
    expenses,
    net: income - expenses,
    largestExpense,
    topCategory,
    recurringProcessed,
    addedFinalWeek,
    recentActivity,
  }
}

// Given "today", decide which month (if any) should have its end-of-month summary
// surfaced. Returns the YYYY-MM key on the last day of a month, and — as a grace
// window — on the first two days of the next month (for anyone who didn't open the
// app on the exact last day). Returns null on all other days.
export const monthSummaryTargetFor = (now: Date = new Date()): string | null => {
  const day = now.getDate()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const asKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

  if (day === lastDay) return asKey(now)
  if (day <= 2) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return asKey(prev)
  }
  return null
}
