import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Search, Download, Upload, X, MoreVertical, Pencil, Copy, Trash2, Repeat,
  Check, RotateCcw, TrendingUp, TrendingDown, Activity, ReceiptText, RefreshCw,
  Inbox, AlertTriangle, CalendarDays, Tag, ChevronDown,
} from 'lucide-react'
import { Transaction, TxType } from '../types'
import { useBudgetApp } from '../hooks/useBudgetApp'
import { fmtMoney, monthKey, monthLabel, safeCsv, download } from '../lib/utils'
import '../styles/transactions.css'

type Budget = ReturnType<typeof useBudgetApp>

const INCOME_CATEGORY_OPTIONS = [
  { id: 'income:salary', name: 'Salary', emoji: '💵' },
  { id: 'income:tips', name: 'Tips', emoji: '💵' },
  { id: 'income:freelance', name: 'Freelance', emoji: '💵' },
  { id: 'income:business_income', name: 'Business Income', emoji: '💵' },
  { id: 'income:refund', name: 'Refund', emoji: '💵' },
  { id: 'income:other_income', name: 'Other Income', emoji: '💵' },
] as const

const INCOME_NAME_BY_ID = new Map<string, string>(INCOME_CATEGORY_OPTIONS.map((c) => [c.id, c.name]))
const INCOME_EMOJI_BY_ID = new Map<string, string>(INCOME_CATEGORY_OPTIONS.map((c) => [c.id, c.emoji]))

const NOTE_MAX = 120

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The transactions table has a single `note` column. We losslessly pack the
 *  "Merchant / Description" and the optional "Note" into it using a newline so
 *  both fields round-trip cleanly on edit without a schema change. */
const splitNote = (note: string | null | undefined) => {
  const raw = note ?? ''
  const idx = raw.indexOf('\n')
  if (idx === -1) return { merchant: raw.trim(), noteText: '' }
  return { merchant: raw.slice(0, idx).trim(), noteText: raw.slice(idx + 1).trim() }
}
const joinNote = (merchant: string, noteText: string) => {
  const m = merchant.trim()
  const n = noteText.trim()
  if (m && n) return `${m}\n${n}`
  return m || n || ''
}

const currencySymbol = (currency: string) => {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? '$'
  } catch {
    return '$'
  }
}

const hexToRgba = (hex: string | null | undefined, alpha: number) => {
  if (!hex) return `rgba(148,163,184,${alpha})`
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const int = parseInt(h, 16)
  if (Number.isNaN(int) || h.length !== 6) return `rgba(148,163,184,${alpha})`
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}

const parseLocalDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const fullDateLabel = (iso: string) => {
  const d = parseLocalDate(iso)
  if (!d) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const dateGroupLabel = (iso: string) => {
  const d = parseLocalDate(iso)
  if (!d) return { primary: iso, secondary: '' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000)
  const full = fullDateLabel(iso)
  if (diffDays === 0) return { primary: 'Today', secondary: full }
  if (diffDays === 1) return { primary: 'Yesterday', secondary: full }
  return { primary: full, secondary: '' }
}

export function TransactionsView({ budget }: { budget: Budget }) {
  const {
    data, categories, catsById, months, txActiveMonth, setTxActiveMonth,
    txSearch, setTxSearch, txType, setTxType,
    createTransaction, updateTransaction, duplicateTransaction, restoreTransaction, deleteTx, addRecurring,
    saveTransactions, transactionDirty, sync,
  } = budget

  const currency = data.currency || 'CAD'
  const symbol = currencySymbol(currency)

  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null)
  const [lastDeleted, setLastDeleted] = useState<Transaction | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const undoTimerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)

  const selectedMonth = txActiveMonth

  // ---- Autosave: persist to Supabase shortly after any local change ----
  useEffect(() => {
    if (!transactionDirty) return
    const timer = window.setTimeout(() => { void saveTransactions() }, 400)
    return () => window.clearTimeout(timer)
  }, [transactionDirty, saveTransactions])

  // ---- Open drawer from the global command palette action ----
  useEffect(() => {
    const openAdd = () => openAddDrawer()
    window.addEventListener('budgetly:focus-add-transaction', openAdd)
    return () => window.removeEventListener('budgetly:focus-add-transaction', openAdd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current) }, [])

  const categoryNameFor = useCallback((tx: Transaction) => {
    if (tx.type === 'income') {
      if (tx.category_id) return INCOME_NAME_BY_ID.get(tx.category_id) ?? catsById.get(tx.category_id)?.name ?? 'Income'
      return 'Income'
    }
    if (tx.category_id) return catsById.get(tx.category_id)?.name ?? 'Uncategorized'
    return 'Uncategorized'
  }, [catsById])

  const categoryEmojiFor = useCallback((tx: Transaction) => {
    if (tx.type === 'income') return INCOME_EMOJI_BY_ID.get(tx.category_id ?? '') ?? '💵'
    return catsById.get(tx.category_id ?? '')?.emoji ?? '🏷️'
  }, [catsById])

  const categoryColorFor = useCallback((tx: Transaction) => {
    if (tx.type === 'income') return '#16A36A'
    return catsById.get(tx.category_id ?? '')?.color ?? '#8B5CF6'
  }, [catsById])

  const monthTx = useMemo(
    () => data.transactions.filter((tx) => monthKey(tx.date) === selectedMonth),
    [data.transactions, selectedMonth],
  )

  const summary = useMemo(() => {
    let income = 0
    let expenses = 0
    for (const tx of monthTx) {
      const amt = Number(tx.amount || 0)
      if (tx.type === 'income') income += amt
      else expenses += amt
    }
    return { income, expenses, net: income - expenses, count: monthTx.length }
  }, [monthTx])

  const visibleTx = useMemo(() => {
    const q = txSearch.trim().toLowerCase()
    return monthTx.filter((tx) => {
      if (txType !== 'all' && tx.type !== txType) return false
      if (categoryFilter !== 'all') {
        const cid = tx.category_id ?? ''
        if (categoryFilter === 'uncat') { if (cid) return false }
        else if (cid !== categoryFilter) return false
      }
      if (q) {
        const { merchant, noteText } = splitNote(tx.note)
        const hay = `${merchant} ${noteText} ${categoryNameFor(tx)} ${tx.amount} ${tx.date} ${tx.type}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [monthTx, txType, categoryFilter, txSearch, categoryNameFor])

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    const sorted = [...visibleTx].sort((a, b) =>
      b.date.localeCompare(a.date) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    for (const tx of sorted) {
      const arr = map.get(tx.date) ?? []
      arr.push(tx)
      map.set(tx.date, arr)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [visibleTx])

  const categoryOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: 'all', label: 'All Categories' }]
    for (const c of [...categories].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      opts.push({ value: c.id, label: `${c.emoji ?? '🏷️'} ${c.name}` })
    }
    for (const c of INCOME_CATEGORY_OPTIONS) opts.push({ value: c.id, label: `${c.emoji} ${c.name}` })
    opts.push({ value: 'uncat', label: '📁 Uncategorized' })
    return opts
  }, [categories])

  const filtersActive =
    txType !== 'all' || categoryFilter !== 'all' || accountFilter !== 'all' ||
    txSearch.trim() !== '' || selectedMonth !== monthKey(new Date().toISOString())

  const resetFilters = () => {
    setTxSearch('')
    setTxType('all')
    setCategoryFilter('all')
    setAccountFilter('all')
    setTxActiveMonth(monthKey(new Date().toISOString()))
  }

  // ---- Drawer control ----
  const openAddDrawer = () => {
    setEditingId(null)
    setDrawerOpen(true)
  }
  const openEditDrawer = (tx: Transaction) => {
    setEditingId(tx.id)
    setDrawerOpen(true)
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingId(null)
    window.setTimeout(() => addButtonRef.current?.focus(), 0)
  }

  const editingTx = useMemo(
    () => (editingId ? data.transactions.find((tx) => tx.id === editingId) ?? null : null),
    [editingId, data.transactions],
  )

  // ---- Delete + undo ----
  const confirmDelete = () => {
    if (!pendingDelete) return
    const tx = pendingDelete
    deleteTx(tx.id)
    setPendingDelete(null)
    setLastDeleted(tx)
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = window.setTimeout(() => setLastDeleted(null), 8000)
  }
  const handleUndo = () => {
    if (!lastDeleted) return
    restoreTransaction(lastDeleted)
    setLastDeleted(null)
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
  }

  // ---- Export / Import ----
  const handleExport = () => {
    setExporting(true)
    try {
      const header = ['date', 'type', 'category', 'merchant', 'note', 'amount']
      const rows = visibleTx
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((tx) => {
          const { merchant, noteText } = splitNote(tx.note)
          return [
            safeCsv(tx.date), safeCsv(tx.type), safeCsv(categoryNameFor(tx)),
            safeCsv(merchant), safeCsv(noteText), safeCsv(Number(tx.amount ?? 0)),
          ].join(',')
        })
      download(`budgetly_transactions_${selectedMonth}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv')
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Transactions exported' } }))
    } finally {
      setExporting(false)
    }
  }

  const parseCsvLine = (line: string) => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 1 } else inQuotes = false
        } else cur += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out
  }

  const handleImportFile = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
      if (lines.length < 2) throw new Error('empty')
      const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
      const idx = (name: string) => header.indexOf(name)
      const di = idx('date'); const ti = idx('type'); const ci = idx('category')
      const mi = idx('merchant'); const ni = idx('note'); const ai = idx('amount')
      if (di === -1 || ai === -1) throw new Error('columns')

      const expenseByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
      const incomeByName = new Map(INCOME_CATEGORY_OPTIONS.map((c) => [c.name.trim().toLowerCase(), c.id]))

      let created = 0
      for (const line of lines.slice(1, 1001)) {
        const cols = parseCsvLine(line)
        const date = (cols[di] ?? '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        const type: TxType = (cols[ti] ?? '').trim().toLowerCase() === 'income' ? 'income' : 'expense'
        const amount = Number((cols[ai] ?? '').replace(/[^0-9.-]/g, ''))
        if (!Number.isFinite(amount) || amount <= 0) continue
        const catName = (ci >= 0 ? cols[ci] ?? '' : '').trim().toLowerCase()
        const category_id = type === 'income'
          ? incomeByName.get(catName) ?? null
          : expenseByName.get(catName) ?? null
        if (type === 'expense' && !category_id) continue
        const merchant = mi >= 0 ? (cols[mi] ?? '').trim() : ''
        const noteText = ni >= 0 ? (cols[ni] ?? '').trim() : ''
        const note = joinNote(merchant, noteText) || null
        const err = createTransaction({ date, type, category_id, amount, note })
        if (!err) created += 1
      }
      window.dispatchEvent(new CustomEvent('budgetly:toast', {
        detail: { message: created ? `Imported ${created} transaction${created === 1 ? '' : 's'}` : 'No transactions imported' },
      }))
    } catch {
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Could not read that CSV file' } }))
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const isInitialLoading = sync === 'syncing' && data.transactions.length === 0
  const isError = sync === 'error' && data.transactions.length === 0

  const saveStatus: { label: string; tone: 'ok' | 'saving' | 'offline' | 'error' } =
    sync === 'syncing' ? { label: 'Saving changes…', tone: 'saving' }
    : sync === 'pending' || transactionDirty ? { label: 'Saving changes…', tone: 'saving' }
    : sync === 'offline' ? { label: 'Offline — changes saved on this device', tone: 'offline' }
    : sync === 'error' ? { label: 'Could not sync changes', tone: 'error' }
    : { label: 'All changes saved', tone: 'ok' }

  return (
    <div className="txp">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f) }}
      />

      {/* ---------------- Header ---------------- */}
      <header className="txp-header">
        <div className="txp-header-text">
          <h1>Transactions</h1>
          <p>Track your income and expenses in one place.</p>
        </div>
        <div className="txp-header-actions">
          <button
            type="button"
            className="txp-btn txp-btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <Upload size={16} aria-hidden="true" />
            <span className="txp-btn-label">{importing ? 'Importing…' : 'Import'}</span>
          </button>
          <button
            type="button"
            className="txp-btn txp-btn-ghost"
            onClick={handleExport}
            disabled={exporting || visibleTx.length === 0}
          >
            <Download size={16} aria-hidden="true" />
            <span className="txp-btn-label">Export</span>
          </button>
          <button
            ref={addButtonRef}
            type="button"
            className="txp-btn txp-btn-primary"
            onClick={openAddDrawer}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Add Transaction</span>
          </button>
        </div>
      </header>

      {/* ---------------- Summary cards ---------------- */}
      <section className="txp-summary" aria-label="Monthly summary">
        <SummaryCard
          tone="income" label="Income" icon={<TrendingUp size={18} aria-hidden="true" />}
          value={fmtMoney(summary.income, currency)} hint="This month"
        />
        <SummaryCard
          tone="expense" label="Expenses" icon={<TrendingDown size={18} aria-hidden="true" />}
          value={`-${fmtMoney(summary.expenses, currency)}`} hint="This month"
        />
        <SummaryCard
          tone="net" label="Net Cash Flow" icon={<Activity size={18} aria-hidden="true" />}
          value={`${summary.net < 0 ? '-' : ''}${fmtMoney(Math.abs(summary.net), currency)}`} hint="This month"
        />
        <SummaryCard
          tone="count" label="Transactions" icon={<ReceiptText size={18} aria-hidden="true" />}
          value={String(summary.count)} hint="This month"
        />
      </section>

      {/* ---------------- Filter toolbar ---------------- */}
      <section className="txp-toolbar" aria-label="Search and filters">
        <div className="txp-toolbar-controls">
          <div className="txp-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Search transactions, merchants, notes..."
              aria-label="Search transactions"
            />
          </div>

          <ToolbarSelect
            label="Month" icon={<CalendarDays size={15} aria-hidden="true" />}
            value={selectedMonth} onChange={setTxActiveMonth}
            options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          />
          <ToolbarSelect
            label="Type"
            value={txType} onChange={(v) => setTxType(v as TxType | 'all')}
            options={[
              { value: 'all', label: 'All' },
              { value: 'income', label: 'Income' },
              { value: 'expense', label: 'Expense' },
            ]}
          />
          <ToolbarSelect
            label="Category" icon={<Tag size={15} aria-hidden="true" />}
            value={categoryFilter} onChange={setCategoryFilter}
            options={categoryOptions}
          />
          <ToolbarSelect
            label="Account"
            value={accountFilter} onChange={setAccountFilter}
            options={[{ value: 'all', label: 'All Accounts' }]}
          />

          <button type="button" className="txp-reset" onClick={resetFilters} disabled={!filtersActive}>
            <RotateCcw size={15} aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>

        <div className="txp-chips">
          <span className="txp-chips-label">Active filters:</span>
          <FilterChip label={`Month: ${monthLabel(selectedMonth)}`} onRemove={() => setTxActiveMonth(monthKey(new Date().toISOString()))} />
          <FilterChip label={`Type: ${txType === 'all' ? 'All' : txType === 'income' ? 'Income' : 'Expense'}`} onRemove={() => setTxType('all')} />
          {categoryFilter !== 'all' ? (
            <FilterChip
              label={`Category: ${categoryOptions.find((o) => o.value === categoryFilter)?.label ?? 'All'}`}
              onRemove={() => setCategoryFilter('all')}
            />
          ) : null}
          <FilterChip label={`Account: ${accountFilter === 'all' ? 'All' : accountFilter}`} onRemove={() => setAccountFilter('all')} />
          {txSearch.trim() ? (
            <FilterChip label={`Search: “${txSearch.trim()}”`} onRemove={() => setTxSearch('')} />
          ) : null}
          <button type="button" className="txp-clear-all" onClick={resetFilters} disabled={!filtersActive}>Clear all</button>
        </div>
      </section>

      {/* ---------------- List ---------------- */}
      <section className="txp-list" aria-label="Transactions list">
        {isInitialLoading ? (
          <ListSkeleton />
        ) : isError ? (
          <div className="txp-state">
            <div className="txp-state-icon txp-state-icon-error"><AlertTriangle size={26} aria-hidden="true" /></div>
            <h3>Couldn’t load transactions</h3>
            <p>Something went wrong while syncing. Check your connection and try again.</p>
            <button type="button" className="txp-btn txp-btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={16} aria-hidden="true" /> <span>Retry</span>
            </button>
          </div>
        ) : groups.length === 0 ? (
          filtersActive ? (
            <div className="txp-state">
              <div className="txp-state-icon"><Search size={26} aria-hidden="true" /></div>
              <h3>No matching transactions</h3>
              <p>Try adjusting your search or filters to find what you’re looking for.</p>
              <button type="button" className="txp-btn txp-btn-ghost" onClick={resetFilters}>
                <RotateCcw size={16} aria-hidden="true" /> <span>Clear filters</span>
              </button>
            </div>
          ) : (
            <div className="txp-state">
              <div className="txp-state-icon"><Inbox size={26} aria-hidden="true" /></div>
              <h3>No transactions yet</h3>
              <p>Add your first transaction for {monthLabel(selectedMonth)} to start tracking your money.</p>
              <button type="button" className="txp-btn txp-btn-primary" onClick={openAddDrawer}>
                <Plus size={16} aria-hidden="true" /> <span>Add Transaction</span>
              </button>
            </div>
          )
        ) : (
          <>
            {groups.map(([date, items]) => {
              const { primary, secondary } = dateGroupLabel(date)
              const dayTotal = items.reduce((s, t) => s + (t.type === 'income' ? Number(t.amount || 0) : -Number(t.amount || 0)), 0)
              return (
                <div key={date} className="txp-group">
                  <div className="txp-group-head">
                    <div className="txp-group-date">
                      <strong>{primary}</strong>
                      {secondary ? <span> · {secondary}</span> : null}
                    </div>
                    <div className={`txp-group-total ${dayTotal >= 0 ? 'pos' : 'neg'}`}>
                      {dayTotal >= 0 ? '+' : '-'}{fmtMoney(Math.abs(dayTotal), currency)}
                    </div>
                  </div>
                  <div className="txp-group-rows">
                    {items.map((tx) => (
                      <TransactionRow
                        key={tx.id}
                        tx={tx}
                        currency={currency}
                        categoryName={categoryNameFor(tx)}
                        categoryEmoji={categoryEmojiFor(tx)}
                        categoryColor={categoryColorFor(tx)}
                        onEdit={() => openEditDrawer(tx)}
                        onDuplicate={() => duplicateTransaction(tx.id)}
                        onMakeRecurring={() => {
                          const { merchant } = splitNote(tx.note)
                          const day = parseLocalDate(tx.date)?.getDate() ?? new Date().getDate()
                          addRecurring({
                            name: merchant || categoryNameFor(tx),
                            category_id: tx.category_id,
                            amount: Number(tx.amount || 0),
                            kind: tx.type,
                            recurrence_type: 'monthly',
                            day_of_month: day,
                            note: splitNote(tx.note).noteText,
                          })
                        }}
                        onDelete={() => setPendingDelete(tx)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="txp-savestatus">
              <span className={`txp-savestatus-pill tone-${saveStatus.tone}`}>
                {saveStatus.tone === 'ok' ? <Check size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" className={saveStatus.tone === 'saving' ? 'txp-spin' : undefined} />}
                {saveStatus.label}
              </span>
              {lastDeleted ? (
                <button type="button" className="txp-undo" onClick={handleUndo}>
                  <RotateCcw size={13} aria-hidden="true" /> Undo
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      {/* ---------------- Drawer ---------------- */}
      <AddTransactionDrawer
        open={drawerOpen}
        editingTx={editingTx}
        categories={categories}
        currencySymbol={symbol}
        allowFuture={data.settings.allowTxnInFutureDate}
        onClose={closeDrawer}
        onCreate={createTransaction}
        onUpdate={updateTransaction}
        onCreateRecurring={addRecurring}
      />

      {/* ---------------- Delete confirm ---------------- */}
      {pendingDelete ? (
        <ConfirmDelete
          label={(() => { const { merchant } = splitNote(pendingDelete.note); return merchant || `${pendingDelete.type} transaction` })()}
          amount={`${pendingDelete.type === 'income' ? '+' : '-'}${fmtMoney(Number(pendingDelete.amount || 0), currency)}`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  )
}

/* ============================ Summary Card ============================ */
function SummaryCard({ tone, label, value, hint, icon }: {
  tone: 'income' | 'expense' | 'net' | 'count'
  label: string
  value: string
  hint: string
  icon: React.ReactNode
}) {
  return (
    <div className={`txp-card txp-card-${tone}`}>
      <div className="txp-card-body">
        <span className="txp-card-label">{label}</span>
        <span className="txp-card-value" title={value}>{value}</span>
        <span className="txp-card-hint">{hint}</span>
      </div>
      <span className="txp-card-icon" aria-hidden="true">{icon}</span>
    </div>
  )
}

/* ============================ Toolbar Select ============================ */
function ToolbarSelect({ label, icon, value, onChange, options }: {
  label: string
  icon?: React.ReactNode
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="txp-field">
      <span className="txp-field-label">{label}</span>
      <span className="txp-select">
        {icon ? <span className="txp-select-icon">{icon}</span> : null}
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={15} className="txp-select-chevron" aria-hidden="true" />
      </span>
    </label>
  )
}

/* ============================ Filter Chip ============================ */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="txp-chip">
      <span className="txp-chip-text">{label}</span>
      <button type="button" className="txp-chip-x" onClick={onRemove} aria-label={`Remove ${label}`}>
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

/* ============================ Transaction Row ============================ */
function TransactionRow({ tx, currency, categoryName, categoryEmoji, categoryColor, onEdit, onDuplicate, onMakeRecurring, onDelete }: {
  tx: Transaction
  currency: string
  categoryName: string
  categoryEmoji: string
  categoryColor: string
  onEdit: () => void
  onDuplicate: () => void
  onMakeRecurring: () => void
  onDelete: () => void
}) {
  const { merchant, noteText } = splitNote(tx.note)
  const title = merchant || categoryName
  const amount = `${tx.type === 'income' ? '+' : '-'}${fmtMoney(Number(tx.amount || 0), currency)}`

  return (
    <div className="txp-row">
      <span className="txp-row-icon" style={{ background: hexToRgba(categoryColor, 0.14), color: categoryColor }} aria-hidden="true">
        <span className="txp-row-emoji">{categoryEmoji}</span>
      </span>

      <div className="txp-row-main">
        <div className="txp-row-titleline">
          <span className="txp-row-title" title={title}>{title}</span>
          <span className={`txp-badge txp-badge-${tx.type}`}>{tx.type === 'income' ? 'Income' : 'Expense'}</span>
        </div>
        {noteText ? <span className="txp-row-sub" title={noteText}>{noteText}</span> : null}
      </div>

      <div className="txp-row-meta">
        <span className="txp-row-metaitem" title={categoryName}>
          <span className="txp-row-metaemoji" aria-hidden="true">{categoryEmoji}</span>
          <span className="txp-row-metatext">{categoryName}</span>
        </span>
      </div>

      <div className="txp-row-right">
        <span className={`txp-row-amount ${tx.type}`}>{amount}</span>
        <RowActionsMenu onEdit={onEdit} onDuplicate={onDuplicate} onMakeRecurring={onMakeRecurring} onDelete={onDelete} />
      </div>
    </div>
  )
}

/* ============================ Row Actions Menu ============================ */
function RowActionsMenu({ onEdit, onDuplicate, onMakeRecurring, onDelete }: {
  onEdit: () => void
  onDuplicate: () => void
  onMakeRecurring: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useLayoutEffect(() => {
    if (!open) return
    const sync = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuW = 210
      const menuH = 196
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = rect.right - menuW
      if (left < 8) left = 8
      if (left + menuW > vw - 8) left = vw - 8 - menuW
      const openUp = rect.bottom + menuH > vh - 12 && rect.top > menuH
      const top = openUp ? Math.max(8, rect.top - menuH - 6) : rect.bottom + 6
      setStyle({ position: 'fixed', left, top, width: menuW })
    }
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (fn: () => void) => { setOpen(false); fn() }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`txp-row-menu-btn ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Transaction actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div className="txp-menu" ref={menuRef} style={style} role="menu">
          <button type="button" role="menuitem" className="txp-menu-item" onClick={() => run(onEdit)}>
            <Pencil size={15} aria-hidden="true" /> Edit
          </button>
          <button type="button" role="menuitem" className="txp-menu-item" onClick={() => run(onDuplicate)}>
            <Copy size={15} aria-hidden="true" /> Duplicate
          </button>
          <button type="button" role="menuitem" className="txp-menu-item" onClick={() => run(onMakeRecurring)}>
            <Repeat size={15} aria-hidden="true" /> Make recurring
          </button>
          <div className="txp-menu-divider" role="separator" />
          <button type="button" role="menuitem" className="txp-menu-item danger" onClick={() => run(onDelete)}>
            <Trash2 size={15} aria-hidden="true" /> Delete
          </button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

/* ============================ Confirm Delete ============================ */
function ConfirmDelete({ label, amount, onCancel, onConfirm }: {
  label: string; amount: string; onCancel: () => void; onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="txp-modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="txp-modal" role="dialog" aria-modal="true" aria-labelledby="txp-del-title" onClick={(e) => e.stopPropagation()}>
        <div className="txp-modal-icon"><Trash2 size={20} aria-hidden="true" /></div>
        <h3 id="txp-del-title">Delete transaction?</h3>
        <p>This permanently removes <strong>{label}</strong> ({amount}). You can undo it for a few seconds afterwards.</p>
        <div className="txp-modal-actions">
          <button type="button" className="txp-btn txp-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="txp-btn txp-btn-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ============================ Skeleton ============================ */
function ListSkeleton() {
  return (
    <div className="txp-group" aria-hidden="true">
      <div className="txp-group-head">
        <div className="txp-skel txp-skel-line" style={{ width: 140 }} />
      </div>
      <div className="txp-group-rows">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="txp-row txp-row-skel">
            <span className="txp-skel txp-skel-circle" />
            <div className="txp-row-main">
              <div className="txp-skel txp-skel-line" style={{ width: '46%' }} />
              <div className="txp-skel txp-skel-line" style={{ width: '30%', marginTop: 8 }} />
            </div>
            <div className="txp-skel txp-skel-line" style={{ width: 90 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================ Drawer ============================ */
type DrawerForm = {
  type: TxType
  amount: string
  category_id: string
  date: string
  merchant: string
  note: string
  recurring: boolean
}

function AddTransactionDrawer({
  open, editingTx, categories, currencySymbol: symbol, allowFuture, onClose, onCreate, onUpdate, onCreateRecurring,
}: {
  open: boolean
  editingTx: Transaction | null
  categories: Budget['categories']
  currencySymbol: string
  allowFuture: boolean
  onClose: () => void
  onCreate: Budget['createTransaction']
  onUpdate: Budget['updateTransaction']
  onCreateRecurring: Budget['addRecurring']
}) {
  const isEdit = !!editingTx
  const [form, setForm] = useState<DrawerForm>({
    type: 'expense', amount: '', category_id: '', date: todayIso(), merchant: '', note: '', recurring: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const [mounted, setMounted] = useState(false)

  // Keep drawer mounted through the close animation.
  useEffect(() => {
    if (open) { setMounted(true); return }
    const t = window.setTimeout(() => setMounted(false), 240)
    return () => window.clearTimeout(t)
  }, [open])

  // Populate form when opening.
  useEffect(() => {
    if (!open) return
    if (editingTx) {
      const { merchant, noteText } = splitNote(editingTx.note)
      setForm({
        type: editingTx.type,
        amount: String(editingTx.amount ?? ''),
        category_id: editingTx.category_id ?? '',
        date: editingTx.date,
        merchant, note: noteText, recurring: false,
      })
    } else {
      setForm((prev) => ({ type: 'expense', amount: '', category_id: '', date: prev.date || todayIso(), merchant: '', note: '', recurring: false }))
    }
    setError(null)
    window.setTimeout(() => firstFieldRef.current?.focus(), 60)
  }, [open, editingTx])

  // Escape + focus trap + background scroll lock while open.
  useEffect(() => {
    if (!open) return
    document.body.classList.add('txp-drawer-lock')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab') return
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'))
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('txp-drawer-lock')
    }
  }, [open, onClose])

  const drawerCategories = useMemo(() => {
    if (form.type === 'income') return INCOME_CATEGORY_OPTIONS.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))
    return [...categories]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((c) => ({ id: c.id, name: c.name, emoji: c.emoji ?? '🏷️' }))
  }, [form.type, categories])

  const setType = (type: TxType) => setForm((p) => ({ ...p, type, category_id: '' }))

  const validate = (): string | null => {
    const amount = Number(form.amount)
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
    if (form.type === 'expense' && !form.category_id) return 'Choose a category for this expense.'
    if (!form.date) return 'Pick a date.'
    if (!allowFuture && form.date > todayIso()) return 'Future-dated transactions are turned off in Settings.'
    return null
  }

  const persist = (): string | null => {
    const amount = Number(form.amount)
    const note = joinNote(form.merchant, form.note) || null
    if (isEdit && editingTx) {
      return onUpdate(editingTx.id, { type: form.type, amount, category_id: form.category_id || null, date: form.date, note })
    }
    const err = onCreate({ date: form.date, type: form.type, category_id: form.category_id || null, amount, note })
    if (!err && form.recurring) {
      onCreateRecurring({
        name: form.merchant.trim() || (drawerCategories.find((c) => c.id === form.category_id)?.name ?? 'Recurring'),
        category_id: form.category_id || null,
        amount,
        kind: form.type,
        recurrence_type: 'monthly',
        day_of_month: parseLocalDate(form.date)?.getDate() ?? new Date().getDate(),
        note: form.note,
      })
    }
    return err
  }

  const handleSave = (addAnother: boolean) => {
    const invalid = validate()
    if (invalid) { setError(invalid); return }
    setSaving(true)
    const err = persist()
    setSaving(false)
    if (err) { setError(err); return }
    if (addAnother && !isEdit) {
      setForm((p) => ({ ...p, amount: '', merchant: '', note: '', recurring: false }))
      setError(null)
      window.setTimeout(() => firstFieldRef.current?.focus(), 30)
    } else {
      onClose()
    }
  }

  if (!mounted && !open) return null

  const amountInvalidSign = form.amount.includes('-')

  return createPortal(
    <div className={`txp-drawer-root ${open ? 'open' : 'closing'}`}>
      <div className="txp-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="txp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="txp-drawer-title"
        ref={panelRef}
      >
        <header className="txp-drawer-head">
          <h2 id="txp-drawer-title">{isEdit ? 'Edit Transaction' : 'Add Transaction'}</h2>
          <button type="button" className="txp-drawer-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="txp-drawer-body">
          <div className="txp-typeseg" role="tablist" aria-label="Transaction type">
            <button
              type="button" role="tab" aria-selected={form.type === 'expense'}
              className={`txp-typeseg-btn expense ${form.type === 'expense' ? 'active' : ''}`}
              onClick={() => setType('expense')}
            >Expense</button>
            <button
              type="button" role="tab" aria-selected={form.type === 'income'}
              className={`txp-typeseg-btn income ${form.type === 'income' ? 'active' : ''}`}
              onClick={() => setType('income')}
            >Income</button>
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-amount">Amount</label>
            <div className={`txp-amount-input ${amountInvalidSign ? 'invalid' : ''}`}>
              <span className="txp-amount-prefix">{symbol}</span>
              <input
                id="txp-amount"
                ref={firstFieldRef}
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9.]/g, '')
                  setForm((p) => ({ ...p, amount: cleaned }))
                }}
              />
            </div>
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-category">Category</label>
            <div className="txp-drawer-select">
              <select
                id="txp-category"
                value={form.category_id}
                onChange={(e) => setForm((p) => ({ ...p, category_id: e.target.value }))}
              >
                <option value="">Select a category</option>
                {drawerCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                ))}
              </select>
              <ChevronDown size={16} className="txp-select-chevron" aria-hidden="true" />
            </div>
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-account">Account</label>
            <div className="txp-drawer-select">
              <select id="txp-account" value="" disabled>
                <option value="">No accounts yet</option>
              </select>
              <ChevronDown size={16} className="txp-select-chevron" aria-hidden="true" />
            </div>
            <span className="txp-field-hint">Accounts aren’t set up on this workspace yet.</span>
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-date">Date</label>
            <input
              id="txp-date"
              className="txp-date-input"
              type="date"
              value={form.date}
              max={allowFuture ? undefined : todayIso()}
              onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            />
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-merchant">Merchant / Description</label>
            <input
              id="txp-merchant"
              className="txp-text-input"
              placeholder="e.g. Starbucks, Rent, Salary"
              value={form.merchant}
              maxLength={80}
              onChange={(e) => setForm((p) => ({ ...p, merchant: e.target.value }))}
            />
          </div>

          <div className="txp-form-field">
            <label htmlFor="txp-note">Note (optional)</label>
            <textarea
              id="txp-note"
              className="txp-textarea"
              placeholder="Add a note..."
              value={form.note}
              maxLength={NOTE_MAX}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value.slice(0, NOTE_MAX) }))}
            />
            <span className="txp-charcount">{form.note.length}/{NOTE_MAX}</span>
          </div>

          {!isEdit ? (
            <div className="txp-recurring-row">
              <div className="txp-recurring-text">
                <span className="txp-recurring-title">Recurring</span>
                <span className="txp-recurring-sub">Make this a recurring transaction</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.recurring}
                className={`txp-switch ${form.recurring ? 'on' : ''}`}
                onClick={() => setForm((p) => ({ ...p, recurring: !p.recurring }))}
              >
                <span className="txp-switch-knob" />
              </button>
            </div>
          ) : null}

          {error ? <div className="txp-drawer-error" role="alert">{error}</div> : null}
        </div>

        <footer className="txp-drawer-foot">
          <button type="button" className="txp-btn txp-btn-primary txp-btn-block" disabled={saving} onClick={() => handleSave(false)}>
            {isEdit ? 'Save Changes' : 'Save Transaction'}
          </button>
          {!isEdit ? (
            <button type="button" className="txp-btn txp-btn-ghost txp-btn-block" disabled={saving} onClick={() => handleSave(true)}>
              Save &amp; Add Another
            </button>
          ) : null}
        </footer>
      </aside>
    </div>,
    document.body,
  )
}
