import React, { useEffect, useMemo } from 'react'
import { CalendarDays, X, ArrowDown, ArrowUp, Home, RefreshCw } from 'lucide-react'
import { useBudgetApp } from '../hooks/useBudgetApp'
import { buildMonthEndSummary } from '../lib/monthSummary'

type Props = {
  budget: ReturnType<typeof useBudgetApp>
  monthKey: string
  onClose: () => void
  onViewReport: () => void
}

export default function MonthEndSummary({ budget, monthKey, onClose, onViewReport }: Props) {
  const currency = budget.data.currency || 'CAD'
  const money = (n: number) => budget.helpers.fmtMoney(n, currency)

  const summary = useMemo(
    () => buildMonthEndSummary(budget.data.transactions, budget.catsById, budget.data.recurring, monthKey),
    [budget.data.transactions, budget.catsById, budget.data.recurring, monthKey],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const formatDay = (iso: string) => {
    const parsed = new Date(`${iso}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
  }

  const netPositive = summary.net >= 0

  return (
    <div className="monthSummaryBackdrop" role="presentation" onClick={onClose}>
      <div
        className="card monthSummaryModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="month-summary-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="monthSummaryClose" type="button" onClick={onClose} aria-label="Close summary">
          <X size={18} />
        </button>

        <div className="monthSummaryHead">
          <span className="monthSummaryEyebrow"><CalendarDays size={14} /> Month-end summary</span>
          <h2 id="month-summary-title">{summary.monthTitle} summary</h2>
          <p>Here's a quick view of all activity recorded this month.</p>
        </div>

        <div className="monthSummaryStats">
          <div className="monthSummaryStat">
            <span>Transactions</span>
            <strong>{summary.transactionCount}</strong>
          </div>
          <div className="monthSummaryStat income">
            <span>Income</span>
            <strong>{money(summary.income)}</strong>
          </div>
          <div className="monthSummaryStat expenses">
            <span>Expenses</span>
            <strong>{money(summary.expenses)}</strong>
          </div>
          <div className="monthSummaryStat net">
            <span>Net</span>
            <strong>{netPositive ? '' : '-'}{money(Math.abs(summary.net))}</strong>
          </div>
        </div>

        <section className="monthSummarySection">
          <h3>What happened this month</h3>
          <ul className="monthSummaryFacts">
            <li>
              <span className="monthSummaryFactIcon rose"><ArrowDown size={16} /></span>
              <span className="monthSummaryFactLabel">Largest expense</span>
              <span className="monthSummaryFactValue">
                {summary.largestExpense
                  ? <>{summary.largestExpense.label} · {money(summary.largestExpense.amount)}</>
                  : 'No expenses yet'}
              </span>
            </li>
            <li>
              <span className="monthSummaryFactIcon blue"><Home size={16} /></span>
              <span className="monthSummaryFactLabel">Top spending category</span>
              <span className="monthSummaryFactValue">
                {summary.topCategory ? summary.topCategory.name : '—'}
              </span>
            </li>
            <li>
              <span className="monthSummaryFactIcon green"><RefreshCw size={16} /></span>
              <span className="monthSummaryFactLabel">Recurring items processed</span>
              <span className="monthSummaryFactValue">{summary.recurringProcessed}</span>
            </li>
            <li>
              <span className="monthSummaryFactIcon violet"><CalendarDays size={16} /></span>
              <span className="monthSummaryFactLabel">Transactions added in final 7 days</span>
              <span className="monthSummaryFactValue">{summary.addedFinalWeek}</span>
            </li>
          </ul>
        </section>

        {summary.recentActivity.length > 0 ? (
          <section className="monthSummarySection">
            <h3>Recent activity</h3>
            <ul className="monthSummaryActivity">
              {summary.recentActivity.map((item) => (
                <li key={item.id}>
                  <span className={`monthSummaryActivityIcon ${item.type === 'income' ? 'income' : 'expense'}`}>
                    {item.type === 'income' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                  </span>
                  <span className="monthSummaryActivityMeta">
                    <span className="monthSummaryActivityDate">{formatDay(item.date)}</span>
                    <span className="monthSummaryActivityDot" aria-hidden="true">·</span>
                    <span className="monthSummaryActivityType">{item.type === 'income' ? 'Income' : 'Expense'}</span>
                    <span className="monthSummaryActivityDot" aria-hidden="true">·</span>
                    <span className="monthSummaryActivityLabel">{item.label}</span>
                  </span>
                  <span className={`monthSummaryActivityAmount ${item.type === 'income' ? 'income' : 'expense'}`}>
                    {item.type === 'income' ? '+' : '-'}{money(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="monthSummaryFooter">
          <button className="btn monthSummaryCloseBtn" type="button" onClick={onClose}>Close</button>
          <button className="btn monthSummaryReportBtn" type="button" onClick={onViewReport}>View full report</button>
        </div>
      </div>
    </div>
  )
}
