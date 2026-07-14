// Pure analytics for the Advice page: monthly metric series, a blended
// financial health score (0-100), and the month-over-month trend narrative.
// Everything here is derived from real user data (transactions, categories,
// recurring items) — no placeholder numbers. Kept framework-free and pure so it
// is easy to reason about and test.

import { Transaction, Category, RecurringItem } from '../types'

export type MonthMetrics = {
  monthKey: string
  income: number
  expenses: number
  net: number
  savingsRate: number // net / income * 100 (can be negative; 0 when no income)
  spendToRefDay: number // cumulative expenses up to a reference day-of-month (spending pace)
}

export type HealthComponents = {
  savings: number // 0-100
  budget: number | null // 0-100, null when no category budgets are set
  bills: number // 0-100
  trend: number // 0-100 (higher = spending trending favourably vs last month)
}

export type HealthModel = {
  currentKey: string
  refDay: number
  series: MonthMetrics[] // oldest -> newest, includes the current month
  current: MonthMetrics
  previous: MonthMetrics
  components: HealthComponents
  prevComponents: HealthComponents
  score: number
  prevScore: number
  scoreDelta: number
  driver: { key: keyof HealthComponents; delta: number } | null
  trendNote: string
  // supporting numbers used by the insight cards
  budgetAdherencePct: number | null
  categoriesWithBudget: number
  categoriesUnder: number
  recurringMonthlyExpense: number
  pacePct: number | null // this month spending pace vs last month at same point: +faster / -slower
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const round = (n: number) => Math.round(Number.isFinite(n) ? n : 0)
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const monthKeyOf = (iso: string) => String(iso).slice(0, 7)

export const shiftMonthKey = (key: string, delta: number) => {
  const [y, m] = key.split('-').map(Number)
  const date = new Date(y || 1970, (m || 1) - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export const monthShortLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const date = new Date(y || 1970, (m || 1) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'short' })
}

const dayOfMonth = (iso: string) => {
  const d = Number(String(iso).slice(8, 10))
  return Number.isFinite(d) && d > 0 ? d : 1
}

// Component weights for the blended health score. Budget adherence is dropped
// (and the remainder renormalised) when the user has set no category budgets.
const WEIGHTS: Record<keyof HealthComponents, number> = { savings: 0.35, budget: 0.25, bills: 0.2, trend: 0.2 }

export const computeMonthMetrics = (transactions: Transaction[], monthKey: string, refDay: number): MonthMetrics => {
  let income = 0
  let expenses = 0
  let spendToRefDay = 0
  for (const tx of transactions) {
    if (monthKeyOf(tx.date) !== monthKey) continue
    const amount = num(tx.amount)
    if (tx.type === 'income') {
      income += amount
    } else {
      expenses += amount
      if (dayOfMonth(tx.date) <= refDay) spendToRefDay += amount
    }
  }
  const net = income - expenses
  const savingsRate = income > 0 ? (net / income) * 100 : 0
  return { monthKey, income, expenses, net, savingsRate, spendToRefDay }
}

export const buildMonthlySeries = (transactions: Transaction[], currentKey: string, refDay: number, count = 6): MonthMetrics[] => {
  const series: MonthMetrics[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = shiftMonthKey(currentKey, -i)
    // For past full months the whole month counts; only the live month is paced to refDay.
    const dayLimit = i === 0 ? refDay : 31
    series.push(computeMonthMetrics(transactions, key, dayLimit))
  }
  return series
}

// Monthly-equivalent value of a recurring item so weekly/biweekly bills are
// comparable to monthly ones when judging bill coverage.
export const recurringMonthlyEquivalent = (item: RecurringItem): number => {
  const amount = num(item.amount)
  if (item.recurrence_type === 'weekly') return (amount * 52) / 12
  if (item.recurrence_type === 'biweekly') return (amount * 26) / 12
  return amount
}

export const totalRecurringMonthlyExpense = (recurring: RecurringItem[]): number =>
  recurring
    .filter((item) => (item.kind ?? 'expense') !== 'income')
    .reduce((sum, item) => sum + recurringMonthlyEquivalent(item), 0)

// % of budgeted categories whose spend is at/under budget for a given month.
const budgetAdherence = (transactions: Transaction[], categories: Category[], monthKey: string) => {
  const budgeted = categories.filter((c) => num(c.budget_monthly) > 0)
  if (budgeted.length === 0) return { pct: null as number | null, withBudget: 0, under: 0 }
  const spendByCat = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.type !== 'expense' || monthKeyOf(tx.date) !== monthKey || !tx.category_id) continue
    spendByCat.set(tx.category_id, (spendByCat.get(tx.category_id) ?? 0) + num(tx.amount))
  }
  const under = budgeted.filter((c) => (spendByCat.get(c.id) ?? 0) <= num(c.budget_monthly)).length
  return { pct: (under / budgeted.length) * 100, withBudget: budgeted.length, under }
}

const scoreSavings = (savingsRate: number) => clamp((savingsRate / 20) * 100, 0, 100)
const scoreBills = (net: number, recurringMonthlyExpense: number) => {
  if (recurringMonthlyExpense <= 0) return 100
  if (net <= 0) return 0
  return clamp((net / recurringMonthlyExpense) * 100, 0, 100)
}
// paceRatio > 1 means spending faster than the comparison month -> lower score.
const scoreTrend = (paceRatio: number) => clamp(100 - (paceRatio - 1) * 100, 0, 100)

const blend = (c: HealthComponents) => {
  let weighted = 0
  let total = 0
  const add = (key: keyof HealthComponents, value: number | null) => {
    if (value == null) return
    weighted += WEIGHTS[key] * value
    total += WEIGHTS[key]
  }
  add('savings', c.savings)
  add('budget', c.budget)
  add('bills', c.bills)
  add('trend', c.trend)
  return total > 0 ? weighted / total : 0
}

const componentsForMonth = (
  transactions: Transaction[],
  categories: Category[],
  recurringMonthlyExpense: number,
  monthKey: string,
  refDay: number,
): HealthComponents => {
  const metrics = computeMonthMetrics(transactions, monthKey, refDay)
  const prevMetrics = computeMonthMetrics(transactions, shiftMonthKey(monthKey, -1), 31)
  // Pace: for a paced month compare spend-to-refDay against the prior month's
  // spend over the same window; for full months compare full totals.
  const prevComparable = refDay >= 31 ? prevMetrics.expenses : computeMonthMetrics(transactions, shiftMonthKey(monthKey, -1), refDay).spendToRefDay
  const thisComparable = refDay >= 31 ? metrics.expenses : metrics.spendToRefDay
  const paceRatio = prevComparable > 0 ? thisComparable / prevComparable : 1
  const adherence = budgetAdherence(transactions, categories, monthKey)
  return {
    savings: scoreSavings(metrics.savingsRate),
    budget: adherence.pct,
    bills: scoreBills(metrics.net, recurringMonthlyExpense),
    trend: scoreTrend(paceRatio),
  }
}

const DRIVER_ORDER: Array<keyof HealthComponents> = ['savings', 'budget', 'bills', 'trend']

const driverPhrase = (key: keyof HealthComponents, direction: 'up' | 'down') => {
  const up = direction === 'up'
  switch (key) {
    case 'savings':
      return up ? 'a higher savings rate' : 'a lower savings rate'
    case 'budget':
      return up ? 'better budget adherence' : 'more categories going over budget'
    case 'bills':
      return up ? 'stronger cover for upcoming bills' : 'thinner cover for upcoming bills'
    case 'trend':
    default:
      return up ? 'a slower spending pace' : 'a faster spending pace'
  }
}

export const buildHealthModel = (
  transactions: Transaction[],
  categories: Category[],
  recurring: RecurringItem[],
  currentKey: string,
  refDay: number,
): HealthModel => {
  const recurringMonthlyExpense = totalRecurringMonthlyExpense(recurring)
  const series = buildMonthlySeries(transactions, currentKey, refDay, 6)
  const current = series[series.length - 1]
  const previous = computeMonthMetrics(transactions, shiftMonthKey(currentKey, -1), 31)

  const components = componentsForMonth(transactions, categories, recurringMonthlyExpense, currentKey, refDay)
  const prevComponents = componentsForMonth(transactions, categories, recurringMonthlyExpense, shiftMonthKey(currentKey, -1), 31)

  const score = round(blend(components))
  const prevScore = round(blend(prevComponents))
  const scoreDelta = score - prevScore

  // Whichever component moved the most (in absolute points) is named as the driver.
  let driver: HealthModel['driver'] = null
  let best = 0
  for (const key of DRIVER_ORDER) {
    const cur = components[key]
    const prev = prevComponents[key]
    if (cur == null || prev == null) continue
    const delta = cur - prev
    if (Math.abs(delta) > best + 0.5) {
      best = Math.abs(delta)
      driver = { key, delta }
    }
  }

  const adherence = budgetAdherence(transactions, categories, currentKey)
  const prevComparablePace = computeMonthMetrics(transactions, shiftMonthKey(currentKey, -1), refDay).spendToRefDay
  const pacePct = prevComparablePace > 0 ? ((current.spendToRefDay - prevComparablePace) / prevComparablePace) * 100 : null

  let trendNote: string
  if (previous.income === 0 && previous.expenses === 0) {
    trendNote = 'Your first tracked month — keep logging to unlock month-over-month trends.'
  } else if (scoreDelta === 0 || !driver) {
    trendNote = 'Holding steady versus last month.'
  } else {
    const direction = scoreDelta > 0 ? 'Up' : 'Down'
    const driverDir = driver.delta >= 0 ? 'up' : 'down'
    const points = Math.abs(scoreDelta)
    trendNote = `${direction} ${points} point${points === 1 ? '' : 's'} since last month, driven by ${driverPhrase(driver.key, driverDir)}.`
  }

  return {
    currentKey,
    refDay,
    series,
    current,
    previous,
    components,
    prevComponents,
    score,
    prevScore,
    scoreDelta,
    driver,
    trendNote,
    budgetAdherencePct: adherence.pct,
    categoriesWithBudget: adherence.withBudget,
    categoriesUnder: adherence.under,
    recurringMonthlyExpense,
    pacePct,
  }
}

export const healthBand = (score: number): { label: string; tone: 'good' | 'caution' | 'warn' } => {
  if (score >= 75) return { label: 'Healthy', tone: 'good' }
  if (score >= 50) return { label: 'Fair', tone: 'caution' }
  return { label: 'Needs attention', tone: 'warn' }
}
