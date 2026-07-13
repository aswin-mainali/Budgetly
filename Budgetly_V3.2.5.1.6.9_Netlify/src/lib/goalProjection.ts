import { Goal, GoalContribution } from '../types'

// Average length of a month in ms (365.25 / 12 days). Used so pace and
// projection math is calendar-stable rather than assuming 30-day months.
const AVG_MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000

// Young goals get their elapsed time floored to this many months so a large
// opening deposit can't divide by ~0 and report an impossibly fast pace.
const MIN_ELAPSED_MONTHS = 1

export type GoalStatus = 'completed' | 'on_track' | 'behind' | 'no_contributions'

export type SparkPoint = { index: number; value: number }

export type GoalProjection = {
  goalId: string
  progress: number // 0..100 (clamped for display)
  totalSaved: number
  targetAmount: number
  remaining: number
  hasContributions: boolean
  avgMonthlyPace: number // saved per month over the goal's lifetime so far
  projectedDate: Date | null // estimated hit date; null when un-projectable
  targetDate: Date | null
  status: GoalStatus
  onTrack: boolean // projected completion on/before target date
  extraMonthlyToCatchUp: number // additional per-month deposit to hit target by date
  series: SparkPoint[] // cumulative-saved sparkline series
}

const parseTargetDate = (value?: string | null): Date | null => {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const monthsBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / AVG_MONTH_MS

const addMonths = (from: Date, months: number) => new Date(from.getTime() + months * AVG_MONTH_MS)

/**
 * Compute pace, projected completion and a cumulative sparkline for a single
 * goal from its real contribution history. `now` is injectable for testing.
 */
export function computeGoalProjection(
  goal: Goal,
  contributions: GoalContribution[],
  now: Date = new Date(),
): GoalProjection {
  const targetAmount = Math.max(0, Number(goal.target_amount || 0))
  const totalSaved = Math.max(0, Number(goal.current_amount || 0))
  const remaining = Math.max(0, targetAmount - totalSaved)
  const targetDate = parseTargetDate(goal.target_date)

  const ordered = [...contributions]
    .filter((c) => c.goal_id === goal.id)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  // Cumulative-saved sparkline: start at a 0 baseline so a single contribution
  // still renders as a rising line rather than a lone dot.
  const series: SparkPoint[] = [{ index: 0, value: 0 }]
  let runningTotal = 0
  ordered.forEach((contribution, idx) => {
    runningTotal += Math.max(0, Number(contribution.amount || 0))
    series.push({ index: idx + 1, value: Number(runningTotal.toFixed(2)) })
  })

  const hasContributions = ordered.length > 0
  const progressRaw = targetAmount > 0 ? (totalSaved / targetAmount) * 100 : 0
  const progress = Math.max(0, Math.min(100, Math.round(progressRaw)))

  // Already reached the target — no projection needed.
  if (targetAmount > 0 && totalSaved >= targetAmount) {
    return {
      goalId: goal.id, progress: 100, totalSaved, targetAmount, remaining: 0,
      hasContributions, avgMonthlyPace: 0, projectedDate: null, targetDate,
      status: 'completed', onTrack: true, extraMonthlyToCatchUp: 0, series,
    }
  }

  if (!hasContributions) {
    return {
      goalId: goal.id, progress, totalSaved, targetAmount, remaining,
      hasContributions: false, avgMonthlyPace: 0, projectedDate: null, targetDate,
      status: 'no_contributions', onTrack: false, extraMonthlyToCatchUp: 0, series,
    }
  }

  const firstDate = new Date(ordered[0].created_at)
  const elapsedMonths = Math.max(MIN_ELAPSED_MONTHS, monthsBetween(firstDate, now))
  const avgMonthlyPace = totalSaved / elapsedMonths

  const monthsToComplete = avgMonthlyPace > 0 ? remaining / avgMonthlyPace : Infinity
  const projectedDate = Number.isFinite(monthsToComplete) ? addMonths(now, monthsToComplete) : null

  // Without a target date there's no deadline to be "behind" — treat as on track.
  const onTrack = targetDate ? (projectedDate != null && projectedDate.getTime() <= targetDate.getTime()) : true

  // Extra per-month deposit needed to hit the target by its date.
  let extraMonthlyToCatchUp = 0
  if (targetDate && !onTrack) {
    const monthsUntilTarget = monthsBetween(now, targetDate)
    const requiredMonthly = monthsUntilTarget > 0 ? remaining / monthsUntilTarget : remaining
    extraMonthlyToCatchUp = Math.max(0, requiredMonthly - avgMonthlyPace)
  }

  return {
    goalId: goal.id, progress, totalSaved, targetAmount, remaining,
    hasContributions: true, avgMonthlyPace, projectedDate, targetDate,
    status: onTrack ? 'on_track' : 'behind', onTrack, extraMonthlyToCatchUp, series,
  }
}

export type GoalsInsight = {
  activeCount: number
  onTrackCount: number
  behindCount: number
  completedCount: number
  summary: string
  suggestion: string | null
}

/**
 * Roll per-goal projections into the hero banner headline + a concrete
 * catch-up suggestion naming the 1-2 most behind-pace goals.
 */
export function summarizeGoals(
  goals: Goal[],
  projections: Map<string, GoalProjection>,
  fmtMoney: (amount: number) => string,
): GoalsInsight {
  let onTrackCount = 0
  let behindCount = 0
  let completedCount = 0
  const behindGoals: { goal: Goal; projection: GoalProjection }[] = []

  for (const goal of goals) {
    const projection = projections.get(goal.id)
    if (!projection) continue
    if (projection.status === 'completed') { completedCount += 1; continue }
    if (projection.status === 'behind') {
      behindCount += 1
      behindGoals.push({ goal, projection })
    } else if (projection.status === 'on_track') {
      onTrackCount += 1
    }
    // 'no_contributions' goals count as active but neither on-track nor behind.
  }

  const activeCount = goals.length - completedCount
  // "On pace for X of Y goals" — Y counts goals with a real deadline+pace verdict.
  const pacedTotal = onTrackCount + behindCount
  let summary: string
  if (goals.length === 0) {
    summary = 'Add a goal to start tracking your savings pace.'
  } else if (pacedTotal === 0) {
    summary = completedCount > 0
      ? `All ${completedCount} of your goals are complete. Time to dream bigger.`
      : 'Add some funds to your goals to see your projected pace.'
  } else {
    summary = `You're on pace for ${onTrackCount} of ${pacedTotal} goal${pacedTotal === 1 ? '' : 's'}.`
  }

  let suggestion: string | null = null
  if (behindGoals.length > 0) {
    const ranked = [...behindGoals].sort((a, b) => b.projection.extraMonthlyToCatchUp - a.projection.extraMonthlyToCatchUp)
    const top = ranked.slice(0, 2).filter((entry) => entry.projection.extraMonthlyToCatchUp > 0)
    if (top.length === 1) {
      const { goal, projection } = top[0]
      suggestion = `Add ${fmtMoney(projection.extraMonthlyToCatchUp)}/mo to “${goal.name}” to hit its target on time.`
    } else if (top.length === 2) {
      const names = top.map((entry) => `“${entry.goal.name}”`).join(' and ')
      const total = top.reduce((sum, entry) => sum + entry.projection.extraMonthlyToCatchUp, 0)
      suggestion = `Add about ${fmtMoney(total)}/mo across ${names} to get them back on schedule.`
    } else {
      // Behind, but target dates already passed — no finite catch-up figure.
      const names = ranked.slice(0, 2).map((entry) => `“${entry.goal.name}”`).join(' and ')
      suggestion = `${names} ${ranked.length > 1 ? 'are' : 'is'} past the target date — consider updating the deadline or target.`
    }
  }

  return { activeCount, onTrackCount, behindCount, completedCount, summary, suggestion }
}
