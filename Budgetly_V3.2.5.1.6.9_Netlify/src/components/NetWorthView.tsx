import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ArrowDownRight, ArrowUpRight, Building2, Car, CreditCard,
  Gem, GraduationCap, Landmark, Loader2, Package, Pencil, PiggyBank, Plus,
  Scale, Sparkles, Trash2, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

type NWKind = 'asset' | 'liability'

type NWItem = {
  id: string
  name: string
  category: string
  kind: NWKind
  value: number
  note?: string
  updatedAt: string
}

type NWSnapshot = {
  date: string // YYYY-MM-DD (date_key)
  assets: number
  liabilities: number
  netWorth: number
}

type IconComp = React.ComponentType<{ size?: number | string }>

/* ────────────────────────────────────────────────────────────────────────────
   Categories — stored as free-text labels (matching the existing data model).
   The modal offers curated suggestions; icons and colours are resolved from the
   category string so any value (typed or legacy) renders consistently.
   ──────────────────────────────────────────────────────────────────────────── */

const SUGGESTED_CATEGORIES: Record<NWKind, string[]> = {
  asset: ['Cash & Bank', 'Savings', 'Investments', 'Retirement', 'Real Estate', 'Vehicle', 'Valuables', 'Business', 'Other'],
  liability: ['Mortgage', 'Auto Loan', 'Student Loan', 'Credit Card', 'Personal Loan', 'Line of Credit', 'Taxes', 'Other'],
}

const COLOR_PALETTE = [
  '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899',
  '#14b8a6', '#a855f7', '#f97316', '#ef4444', '#e11d48', '#d946ef',
]

const ICON_RULES: Array<{ match: RegExp; icon: IconComp }> = [
  { match: /cash|bank|chequ|check|wallet|emergency/i, icon: Wallet },
  { match: /saving/i, icon: PiggyBank },
  { match: /invest|stock|etf|broker|portfolio|crypto|fund|share/i, icon: TrendingUp },
  { match: /retire|rrsp|401|pension|ira|tfsa/i, icon: PiggyBank },
  { match: /home|house|proper|real ?estate|condo|land|apartment/i, icon: Building2 },
  { match: /mortgage/i, icon: Building2 },
  { match: /car|vehicle|auto|truck|motor|bike/i, icon: Car },
  { match: /jewel|valuable|gold|art|collect|watch|gem/i, icon: Gem },
  { match: /student|tuition|educat/i, icon: GraduationCap },
  { match: /credit|card|visa|master|amex/i, icon: CreditCard },
  { match: /loan|debt|owe|line ?of ?credit|financ|payable|tax/i, icon: Landmark },
]

const LIQUID_RE = /cash|bank|chequ|check|saving|invest|money ?market|broker/i

const hashStr = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
const colorForCategory = (cat: string) => COLOR_PALETTE[hashStr(cat.trim().toLowerCase()) % COLOR_PALETTE.length]
const iconForCategory = (cat: string, kind: NWKind): IconComp => {
  const rule = ICON_RULES.find((r) => r.match.test(cat))
  return rule ? rule.icon : kind === 'liability' ? Landmark : Package
}
const isLiquidCategory = (cat: string) => LIQUID_RE.test(cat)

/* ────────────────────────────────────────────────────────────────────────────
   Supabase persistence (synced per-user, RLS-scoped).
   Tables: public.net_worth_items, public.net_worth_snapshots
   (see supabase/add_net_worth_tracker.sql).
   ──────────────────────────────────────────────────────────────────────────── */

type ItemRow = {
  id: string
  name: string
  category: string | null
  kind: NWKind
  value: number | string
  notes: string | null
  created_at?: string | null
  updated_at?: string | null
}
type SnapshotRow = {
  date_key: string
  total_assets: number | string
  total_liabilities: number | string
  net_worth: number | string
}

const mapItem = (r: ItemRow): NWItem => ({
  id: r.id,
  name: r.name,
  category: (r.category && r.category.trim()) || 'Other',
  kind: r.kind === 'liability' ? 'liability' : 'asset',
  value: Number(r.value) || 0,
  note: r.notes || undefined,
  updatedAt: r.updated_at || r.created_at || new Date().toISOString(),
})

const mapSnapshot = (r: SnapshotRow): NWSnapshot => ({
  date: r.date_key,
  assets: Number(r.total_assets) || 0,
  liabilities: Number(r.total_liabilities) || 0,
  netWorth: Number(r.net_worth) || 0,
})

const isMissingTableError = (error: unknown) =>
  /relation .*net_worth|does not exist|schema cache|could not find the table/i.test(
    String((error as { message?: string })?.message || error || ''),
  )

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */

const todayKey = () => new Date().toISOString().slice(0, 10)
const clampMoney = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)

const fmt = (n: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  )
const fmtExact = (n: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  )
const fmtCompact = (n: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(
    Number.isFinite(n) ? n : 0,
  )
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${(Number.isFinite(n) ? n : 0).toFixed(1)}%`
const dateLabelOf = (dk: string) => {
  const d = new Date(dk)
  if (Number.isNaN(d.getTime())) return dk
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ────────────────────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────────────────────── */

export function NetWorthView({
  currency = 'CAD',
  theme = 'dark',
  userId,
}: {
  currency?: string
  theme?: 'light' | 'dark'
  userId?: string | null
}) {
  const [items, setItems] = useState<NWItem[]>([])
  const [snapshots, setSnapshots] = useState<NWSnapshot[]>([])
  const [range, setRange] = useState<'6M' | '1Y' | 'ALL'>('1Y')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalKind, setModalKind] = useState<NWKind>('asset')
  const [editing, setEditing] = useState<NWItem | null>(null)
  const [toDelete, setToDelete] = useState<NWItem | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [seedCategory, setSeedCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | 'missing-table' | 'load'>(null)

  const notify = (msg: string) => {
    setFlash(msg)
    window.clearTimeout((notify as any)._t)
    ;(notify as any)._t = window.setTimeout(() => setFlash(null), 2200)
  }

  // ── Snapshot today's totals for a given item set (upsert by date) ─────────
  const persistSnapshot = async (uid: string, list: NWItem[]) => {
    const assets = clampMoney(list.filter((i) => i.kind === 'asset').reduce((s, i) => s + i.value, 0))
    const liabilities = clampMoney(list.filter((i) => i.kind === 'liability').reduce((s, i) => s + i.value, 0))
    const netWorth = clampMoney(assets - liabilities)
    const dk = todayKey()
    try {
      const { error: snapErr } = await supabase.from('net_worth_snapshots').upsert(
        { user_id: uid, date_key: dk, total_assets: assets, total_liabilities: liabilities, net_worth: netWorth, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,date_key' },
      )
      if (snapErr) throw snapErr
    } catch (e) {
      // Snapshot history is best-effort; the ledger itself is the source of truth.
      // eslint-disable-next-line no-console
      console.warn('Net worth snapshot upsert failed', e)
    }
    setSnapshots((prev) => {
      const others = prev.filter((s) => s.date !== dk)
      return [...others, { date: dk, assets, liabilities, netWorth }].sort((a, b) => a.date.localeCompare(b.date))
    })
  }

  // ── Load from Supabase per user ───────────────────────────────────────────
  const load = async (uid: string) => {
    setLoading(true)
    setError(null)
    const [itemsRes, snapsRes] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('user_id', uid).order('value', { ascending: false }),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', uid).order('date_key', { ascending: true }),
    ])
    if (itemsRes.error || snapsRes.error) {
      const firstError = itemsRes.error || snapsRes.error
      if (isMissingTableError(firstError)) {
        setError('missing-table'); setItems([]); setSnapshots([]); setLoading(false); return
      }
      // eslint-disable-next-line no-console
      console.error('Net worth load failed:', firstError)
      setError('load'); setLoading(false); return
    }
    const nextItems = ((itemsRes.data as ItemRow[]) || []).map(mapItem)
    const nextSnaps = ((snapsRes.data as SnapshotRow[]) || []).map(mapSnapshot)
    setItems(nextItems)
    setSnapshots(nextSnaps)
    setLoading(false)
    // Backfill today's snapshot so the trend keeps building over time.
    if (nextItems.length > 0 && !nextSnaps.some((s) => s.date === todayKey())) {
      void persistSnapshot(uid, nextItems)
    }
  }

  useEffect(() => {
    if (!userId) { setItems([]); setSnapshots([]); setLoading(false); return }
    void load(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const assets = items.filter((i) => i.kind === 'asset').reduce((s, i) => s + i.value, 0)
    const liabilities = items.filter((i) => i.kind === 'liability').reduce((s, i) => s + i.value, 0)
    const netWorth = assets - liabilities
    const liquid = items
      .filter((i) => i.kind === 'asset' && isLiquidCategory(i.category))
      .reduce((s, i) => s + i.value, 0)
    const debtRatio = assets > 0 ? (liabilities / assets) * 100 : 0
    return { assets, liabilities, netWorth, liquid, debtRatio }
  }, [items])

  // ── Item CRUD (Supabase-backed) ───────────────────────────────────────────
  const saveItem = async (draft: Omit<NWItem, 'id' | 'updatedAt'> & { id?: string }) => {
    if (!userId || saving) return
    setSaving(true)
    const payload = {
      user_id: userId,
      name: draft.name,
      category: draft.category,
      kind: draft.kind,
      value: clampMoney(draft.value),
      notes: draft.note || null,
      updated_at: new Date().toISOString(),
    }
    try {
      let nextItems: NWItem[]
      if (draft.id) {
        const { data, error: upErr } = await supabase.from('net_worth_items').update(payload).eq('id', draft.id).eq('user_id', userId).select('*').single()
        if (upErr) throw upErr
        const updated = mapItem(data as ItemRow)
        nextItems = items.map((i) => (i.id === draft.id ? updated : i))
      } else {
        const { data, error: inErr } = await supabase.from('net_worth_items').insert(payload).select('*').single()
        if (inErr) throw inErr
        const created = mapItem(data as ItemRow)
        nextItems = [created, ...items]
      }
      setItems(nextItems)
      setModalOpen(false); setEditing(null); setSeedCategory(null)
      notify(draft.id ? 'Updated' : draft.kind === 'asset' ? 'Asset added' : 'Liability added')
      await persistSnapshot(userId, nextItems)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Net worth save failed:', e)
      notify(isMissingTableError(e) ? 'Net worth tables not set up yet.' : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async (item: NWItem) => {
    if (!userId) return
    try {
      const { error: delErr } = await supabase.from('net_worth_items').delete().eq('id', item.id).eq('user_id', userId)
      if (delErr) throw delErr
      const nextItems = items.filter((i) => i.id !== item.id)
      setItems(nextItems)
      setToDelete(null)
      notify('Removed')
      await persistSnapshot(userId, nextItems)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Net worth delete failed:', e)
      notify('Could not remove. Please try again.')
    }
  }

  const openAdd = (kind: NWKind) => {
    setEditing(null)
    setModalKind(kind)
    setModalOpen(true)
  }
  const openEdit = (item: NWItem) => {
    setEditing(item)
    setModalKind(item.kind)
    setModalOpen(true)
  }

  // ── Trend series (daily snapshots) ────────────────────────────────────────
  const trendData = useMemo(() => {
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    const now = new Date()
    const cutoff = range === 'ALL' ? null : new Date(now.getTime() - (range === '6M' ? 183 : 366) * 24 * 60 * 60 * 1000)
    const sliced = cutoff ? sorted.filter((s) => new Date(s.date) >= cutoff) : sorted
    return sliced.map((s) => ({
      key: s.date,
      label: dateLabelOf(s.date),
      netWorth: s.netWorth,
      assets: s.assets,
      liabilities: s.liabilities,
    }))
  }, [snapshots, range])

  const periodDelta = useMemo(() => {
    if (trendData.length < 2) return null
    const first = trendData[0].netWorth
    const last = trendData[trendData.length - 1].netWorth
    const change = last - first
    const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0
    return { change, pct }
  }, [trendData])

  // ── Category breakdown (grouped by free-text category) ────────────────────
  const breakdownFor = (kind: NWKind) => {
    const map = new Map<string, number>()
    items.filter((i) => i.kind === kind).forEach((i) => map.set(i.category, (map.get(i.category) || 0) + i.value))
    return Array.from(map.entries())
      .filter(([, value]) => value > 0)
      .map(([category, value]) => ({ category, value, color: colorForCategory(category), icon: iconForCategory(category, kind) }))
      .sort((a, b) => b.value - a.value)
  }
  const assetBreakdown = useMemo(() => breakdownFor('asset'), [items])

  const assetItems = useMemo(() => items.filter((i) => i.kind === 'asset').sort((a, b) => b.value - a.value), [items])
  const liabilityItems = useMemo(() => items.filter((i) => i.kind === 'liability').sort((a, b) => b.value - a.value), [items])

  // ── Financial health score (0–100) ────────────────────────────────────────
  const health = useMemo(() => {
    if (items.length === 0) return null
    const { netWorth, assets, liabilities, liquid } = totals
    // Positive net worth (up to 40), low leverage (up to 35), liquidity (up to 25)
    let score = 0
    if (netWorth > 0) score += Math.min(40, 15 + (assets > 0 ? (netWorth / assets) * 25 : 0))
    const leverage = assets > 0 ? liabilities / assets : 0
    score += Math.max(0, 35 * (1 - Math.min(1, leverage)))
    const liquidityRatio = assets > 0 ? liquid / assets : 0
    score += Math.min(25, liquidityRatio * 60)
    score = Math.round(Math.max(0, Math.min(100, score)))
    const grade = score >= 80 ? 'Excellent' : score >= 60 ? 'Healthy' : score >= 40 ? 'Fair' : 'Needs work'
    return { score, grade }
  }, [items, totals])

  // ── Largest asset + all-time movement (real data) ─────────────────────────
  const topAsset = useMemo(() => assetItems[0] || null, [assetItems])
  const allTime = useMemo(() => {
    if (snapshots.length < 2) return null
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    return { change: last.netWorth - first.netWorth, since: first.date }
  }, [snapshots])

  const donutData = useMemo(() => {
    if (assetBreakdown.length === 0) return []
    return assetBreakdown.map((c) => ({ name: c.category, value: c.value, color: c.color }))
  }, [assetBreakdown])

  const gridStroke = theme === 'light' ? 'rgba(76,101,145,.18)' : 'rgba(148,163,184,.16)'
  const axisColor = theme === 'light' ? '#52627f' : '#93a7c6'
  const nwPositive = totals.netWorth >= 0

  const hasData = items.length > 0

  // ── Loading / setup states ────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="nwPage">
        <div className="nwLoading"><Loader2 size={24} className="nwSpin" /><span>Loading your net worth…</span></div>
      </section>
    )
  }

  if (error === 'missing-table') {
    return (
      <section className="nwPage">
        <div className="nwEmptyState">
          <div className="nwEmptyIllus" aria-hidden="true"><Scale size={40} /></div>
          <h2>Finish setting up the Net Worth Tracker</h2>
          <p>The database tables for this feature haven’t been created yet. Run the migration in <code>supabase/add_net_worth_tracker.sql</code> against your Supabase project, then reload this page.</p>
          <div className="nwEmptyActions">
            <button className="nwBtn nwBtnAsset" onClick={() => userId && void load(userId)}>Reload</button>
          </div>
        </div>
      </section>
    )
  }

  if (error === 'load') {
    return (
      <section className="nwPage">
        <div className="nwEmptyState">
          <div className="nwEmptyIllus" aria-hidden="true"><Scale size={40} /></div>
          <h2>Couldn’t load your net worth</h2>
          <p>Something went wrong reaching the server. Check your connection and try again.</p>
          <div className="nwEmptyActions">
            <button className="nwBtn nwBtnAsset" onClick={() => userId && void load(userId)}>Retry</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="nwPage">
      {flash ? <div className="nwFlash" role="status">{flash}</div> : null}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="nwHero">
        <div className="nwHeroGlow" aria-hidden="true" />
        <div className="nwHeroMain">
          <div className="nwHeroLead">
            <span className="nwEyebrow"><Scale size={13} /> Net Worth Tracker</span>
            <div className="nwHeroValueRow">
              <h1 className={`nwHeroValue ${nwPositive ? '' : 'neg'}`}>{fmtExact(totals.netWorth, currency)}</h1>
              {periodDelta ? (
                <span className={`nwHeroDelta ${periodDelta.change >= 0 ? 'pos' : 'neg'}`}>
                  {periodDelta.change >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                  {fmt(Math.abs(periodDelta.change), currency)} ({fmtPct(periodDelta.pct)})
                </span>
              ) : null}
            </div>
            <p className="nwHeroSub">
              {hasData
                ? `Your total wealth across ${assetItems.length} asset${assetItems.length === 1 ? '' : 's'} and ${liabilityItems.length} liabilit${liabilityItems.length === 1 ? 'y' : 'ies'}.`
                : 'Add your assets and debts to reveal your complete financial picture.'}
            </p>
          </div>
          <div className="nwHeroActions">
            <button className="nwBtn nwBtnAsset" onClick={() => openAdd('asset')}><Plus size={16} /> Add asset</button>
            <button className="nwBtn nwBtnLiability" onClick={() => openAdd('liability')}><Plus size={16} /> Add liability</button>
          </div>
        </div>

        <div className="nwHeroBars">
          <div className="nwHeroBar">
            <div className="nwHeroBarTop"><span><TrendingUp size={14} /> Assets</span><strong>{fmt(totals.assets, currency)}</strong></div>
            <div className="nwHeroBarTrack"><div className="nwHeroBarFill asset" style={{ width: `${totals.assets + totals.liabilities > 0 ? (totals.assets / (totals.assets + totals.liabilities)) * 100 : 0}%` }} /></div>
          </div>
          <div className="nwHeroBar">
            <div className="nwHeroBarTop"><span><TrendingDown size={14} /> Liabilities</span><strong>{fmt(totals.liabilities, currency)}</strong></div>
            <div className="nwHeroBarTrack"><div className="nwHeroBarFill liability" style={{ width: `${totals.assets + totals.liabilities > 0 ? (totals.liabilities / (totals.assets + totals.liabilities)) * 100 : 0}%` }} /></div>
          </div>
        </div>
      </header>

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="nwKpis">
        <div className="nwKpi">
          <div className="nwKpiIcon" style={{ background: 'rgba(34,197,94,.14)', color: '#22c55e' }}><Wallet size={18} /></div>
          <div><span className="nwKpiLabel">Liquid assets</span><strong className="nwKpiValue">{fmt(totals.liquid, currency)}</strong><small className="nwKpiHint">Cash & investments</small></div>
        </div>
        <div className="nwKpi">
          <div className="nwKpiIcon" style={{ background: 'rgba(239,68,68,.14)', color: '#ef4444' }}><Scale size={18} /></div>
          <div><span className="nwKpiLabel">Debt-to-asset</span><strong className="nwKpiValue">{totals.debtRatio.toFixed(0)}%</strong><small className="nwKpiHint">{totals.debtRatio < 40 ? 'Low leverage' : totals.debtRatio < 70 ? 'Moderate' : 'High leverage'}</small></div>
        </div>
        <div className="nwKpi">
          <div className="nwKpiIcon" style={{ background: 'rgba(139,92,246,.14)', color: '#8b5cf6' }}><Sparkles size={18} /></div>
          <div>
            <span className="nwKpiLabel">Health score</span>
            {health ? <strong className="nwKpiValue">{health.score}<small className="nwScoreMax">/100</small></strong> : <strong className="nwKpiValue">—</strong>}
            <small className="nwKpiHint">{health ? health.grade : 'Add data'}</small>
          </div>
        </div>
        <div className="nwKpi">
          <div className="nwKpiIcon" style={{ background: 'rgba(59,130,246,.14)', color: '#3b82f6' }}><TrendingUp size={18} /></div>
          <div>
            <span className="nwKpiLabel">Largest asset</span>
            <strong className="nwKpiValue">{topAsset ? fmtCompact(topAsset.value, currency) : '—'}</strong>
            <small className="nwKpiHint">{topAsset ? `${topAsset.name} · ${totals.assets > 0 ? ((topAsset.value / totals.assets) * 100).toFixed(0) : 0}% of assets` : 'No assets yet'}</small>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="nwEmptyState">
          <div className="nwEmptyIllus" aria-hidden="true"><Scale size={40} /></div>
          <h2>Start tracking your net worth</h2>
          <p>Add everything you own and owe. Budgetly turns it into a live dashboard with trends, allocation, and a financial health score — synced securely to your account.</p>
          <div className="nwEmptyActions">
            <button className="nwBtn nwBtnAsset" onClick={() => openAdd('asset')}><Plus size={16} /> Add your first asset</button>
            <button className="nwBtn nwBtnGhost" onClick={() => openAdd('liability')}><Plus size={16} /> Add a liability</button>
          </div>
          <div className="nwEmptyChips">
            {SUGGESTED_CATEGORIES.asset.slice(0, 5).map((label) => {
              const Icon = iconForCategory(label, 'asset')
              return (
                <button key={label} className="nwSeedChip" onClick={() => { setEditing(null); setModalKind('asset'); setSeedCategory(label); setModalOpen(true) }}>
                  <Icon size={14} /> {label}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          {/* ── Charts row ────────────────────────────────────────────────── */}
          <div className="nwChartRow">
            <div className="nwCard nwTrendCard">
              <div className="nwCardHead">
                <div>
                  <h3>Net worth over time</h3>
                  <p className="nwCardSub">Snapshots recorded automatically as you update your figures.</p>
                </div>
                <div className="nwRangeToggle">
                  {(['6M', '1Y', 'ALL'] as const).map((r) => (
                    <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r === 'ALL' ? 'All' : r}</button>
                  ))}
                </div>
              </div>
              {trendData.length < 2 ? (
                <div className="nwChartEmpty">
                  <div className="nwChartEmptyGrid" aria-hidden="true" />
                  <p>Your net worth trend builds over time.<br />Come back next month — or update your figures — to grow the chart.</p>
                </div>
              ) : (
                <div className="nwChartWrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trendData} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="nwNetGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke={gridStroke} vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={16} />
                      <YAxis tickFormatter={(v) => fmtCompact(Number(v), currency)} tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
                      <Tooltip content={<TrendTooltip currency={currency} />} />
                      <Area type="monotone" dataKey="netWorth" stroke="#22c55e" strokeWidth={3} fill="url(#nwNetGrad)" dot={false} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="nwCard nwAllocCard">
              <div className="nwCardHead"><div><h3>Asset allocation</h3><p className="nwCardSub">Where your wealth sits.</p></div></div>
              {donutData.length === 0 ? (
                <div className="nwChartEmpty small"><p>Add assets to see your allocation.</p></div>
              ) : (
                <>
                  <div className="nwDonutWrap">
                    <ResponsiveContainer width="100%" height={210}>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                          {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip content={<AllocTooltip currency={currency} total={totals.assets} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="nwDonutCenter">
                      <small>Total assets</small>
                      <strong>{fmtCompact(totals.assets, currency)}</strong>
                    </div>
                  </div>
                  <div className="nwAllocLegend">
                    {assetBreakdown.map((c) => (
                      <div className="nwAllocLegendItem" key={c.category}>
                        <span className="nwDot" style={{ background: c.color }} />
                        <span className="nwAllocName">{c.category}</span>
                        <span className="nwAllocPct">{totals.assets > 0 ? ((c.value / totals.assets) * 100).toFixed(0) : 0}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Composition bar (assets vs liabilities over time) ─────────── */}
          {trendData.length >= 2 ? (
            <div className="nwCard">
              <div className="nwCardHead"><div><h3>Assets vs liabilities</h3><p className="nwCardSub">Composition across recent snapshots.</p></div></div>
              <div className="nwChartWrap">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={trendData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={4}>
                    <CartesianGrid strokeDasharray="4 4" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={16} />
                    <YAxis tickFormatter={(v) => fmtCompact(Number(v), currency)} tick={{ fill: axisColor, fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip content={<TrendTooltip currency={currency} showSplit />} cursor={{ fill: theme === 'light' ? 'rgba(15,23,42,.04)' : 'rgba(255,255,255,.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: axisColor }} iconType="circle" />
                    <Bar dataKey="assets" name="Assets" fill="#22c55e" radius={[5, 5, 0, 0]} maxBarSize={34} />
                    <Bar dataKey="liabilities" name="Liabilities" fill="#ef4444" radius={[5, 5, 0, 0]} maxBarSize={34} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {/* ── Holdings columns ──────────────────────────────────────────── */}
          <div className="nwLedgerRow">
            <ItemColumn
              title="Assets" kind="asset" accent="#22c55e"
              items={assetItems} total={totals.assets} currency={currency}
              onAdd={() => openAdd('asset')} onEdit={openEdit} onDelete={setToDelete}
            />
            <ItemColumn
              title="Liabilities" kind="liability" accent="#ef4444"
              items={liabilityItems} total={totals.liabilities} currency={currency}
              onAdd={() => openAdd('liability')} onEdit={openEdit} onDelete={setToDelete}
            />
          </div>

          {/* ── Insight strip ─────────────────────────────────────────────── */}
          <div className="nwInsightStrip">
            <div className="nwInsight">
              <Sparkles size={16} className="nwInsightGlyph" />
              <div>
                <strong>{health ? `${health.grade} financial health` : 'Financial health'}</strong>
                <p>
                  {totals.debtRatio < 40
                    ? 'Your leverage is low — debts are a small share of what you own.'
                    : totals.debtRatio < 70
                      ? 'Moderate leverage. Paying down high-interest debt will lift your score.'
                      : 'High leverage — liabilities are a large share of your assets. Prioritise debt reduction.'}
                </p>
              </div>
            </div>
            <div className="nwInsight">
              <Wallet size={16} className="nwInsightGlyph" />
              <div>
                <strong>{totals.assets > 0 ? `${((totals.liquid / totals.assets) * 100).toFixed(0)}% liquid` : 'Liquidity'}</strong>
                <p>{totals.assets > 0 && totals.liquid / totals.assets < 0.15 ? 'Most of your wealth is tied up in non-liquid assets. Keep an emergency buffer.' : 'You hold a healthy cushion of cash and investments you can access quickly.'}</p>
              </div>
            </div>
            <div className="nwInsight">
              {allTime && allTime.change < 0 ? <TrendingDown size={16} className="nwInsightGlyph" /> : <TrendingUp size={16} className="nwInsightGlyph" />}
              <div>
                <strong>{allTime ? `${allTime.change >= 0 ? 'Up' : 'Down'} ${fmtCompact(Math.abs(allTime.change), currency)} tracked` : 'Your history builds here'}</strong>
                <p>{allTime ? `Net worth has ${allTime.change >= 0 ? 'grown' : 'fallen'} by ${fmt(Math.abs(allTime.change), currency)} since you started tracking on ${new Date(allTime.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.` : 'Update your figures over time and this shows how far your net worth has moved.'}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Add / edit modal ──────────────────────────────────────────────── */}
      {modalOpen ? (
        <ItemModal
          kind={modalKind}
          editing={editing}
          currency={currency}
          seedCategory={seedCategory}
          busy={saving}
          onClose={() => { if (!saving) { setModalOpen(false); setSeedCategory(null) } }}
          onSave={(draft) => { void saveItem(draft) }}
        />
      ) : null}

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      {toDelete ? (
        <div className="nwModalBackdrop" role="presentation" onClick={() => setToDelete(null)}>
          <div className="nwConfirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nwConfirmIcon"><Trash2 size={20} /></div>
            <h3>Remove “{toDelete.name}”?</h3>
            <p>This {toDelete.kind} will be removed from your net worth. This can’t be undone.</p>
            <div className="nwConfirmActions">
              <button className="nwBtn nwBtnGhost" onClick={() => setToDelete(null)}>Cancel</button>
              <button className="nwBtn nwBtnDanger" onClick={() => { void deleteItem(toDelete) }}>Remove</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Sub-components
   ──────────────────────────────────────────────────────────────────────────── */

function ItemColumn({
  title, kind, accent, items, total, currency, onAdd, onEdit, onDelete,
}: {
  title: string
  kind: NWKind
  accent: string
  items: NWItem[]
  total: number
  currency: string
  onAdd: () => void
  onEdit: (i: NWItem) => void
  onDelete: (i: NWItem) => void
}) {
  return (
    <div className="nwCard nwLedgerCard">
      <div className="nwLedgerHead">
        <div className="nwLedgerTitle">
          <span className="nwLedgerDot" style={{ background: accent }} />
          <h3>{title}</h3>
          <span className="nwLedgerCount">{items.length}</span>
        </div>
        <div className="nwLedgerTotal" style={{ color: accent }}>{fmt(total, currency)}</div>
      </div>
      {items.length === 0 ? (
        <button className="nwLedgerAddEmpty" onClick={onAdd}>
          <Plus size={16} /> Add {kind === 'asset' ? 'an asset' : 'a liability'}
        </button>
      ) : (
        <>
          <ul className="nwLedgerList">
            {items.map((i) => {
              const color = colorForCategory(i.category)
              const Icon = iconForCategory(i.category, i.kind)
              const share = total > 0 ? (i.value / total) * 100 : 0
              return (
                <li key={i.id} className="nwLedgerItem">
                  <span className="nwLedgerItemIcon" style={{ background: `${color}22`, color }}><Icon size={17} /></span>
                  <div className="nwLedgerItemBody">
                    <div className="nwLedgerItemTop">
                      <strong className="nwLedgerItemName">{i.name}</strong>
                      <span className="nwLedgerItemValue">{fmtExact(i.value, currency)}</span>
                    </div>
                    <div className="nwLedgerItemMeta">
                      <span className="nwLedgerItemCat">{i.category}</span>
                      {i.note ? <span className="nwLedgerItemNote">· {i.note}</span> : null}
                      <span className="nwLedgerItemShare">{share.toFixed(0)}%</span>
                    </div>
                    <div className="nwLedgerItemTrack"><div style={{ width: `${share}%`, background: color }} /></div>
                  </div>
                  <div className="nwLedgerItemActions">
                    <button aria-label="Edit" onClick={() => onEdit(i)}><Pencil size={14} /></button>
                    <button aria-label="Remove" className="danger" onClick={() => onDelete(i)}><Trash2 size={14} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
          <button className="nwLedgerAdd" onClick={onAdd}><Plus size={15} /> Add {kind === 'asset' ? 'asset' : 'liability'}</button>
        </>
      )}
    </div>
  )
}

function ItemModal({
  kind, editing, currency, seedCategory, busy, onClose, onSave,
}: {
  kind: NWKind
  editing: NWItem | null
  currency: string
  seedCategory: string | null
  busy?: boolean
  onClose: () => void
  onSave: (draft: Omit<NWItem, 'id' | 'updatedAt'> & { id?: string }) => void
}) {
  const suggestions = SUGGESTED_CATEGORIES[kind]
  const [name, setName] = useState(editing?.name || '')
  const [category, setCategory] = useState(editing?.category || seedCategory || suggestions[0] || 'Other')
  const [value, setValue] = useState(editing ? String(editing.value) : '')
  const [note, setNote] = useState(editing?.note || '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const numeric = Number(value)
  const valid = name.trim().length > 0 && Number.isFinite(numeric) && numeric > 0 && category.trim().length > 0

  const submit = () => {
    if (!valid || busy) return
    onSave({ id: editing?.id, name: name.trim(), category: category.trim(), kind, value: numeric, note: note.trim() || undefined })
  }

  return (
    <div className="nwModalBackdrop" role="presentation" onClick={onClose}>
      <div className="nwModal" role="dialog" aria-modal="true" aria-label={`${editing ? 'Edit' : 'Add'} ${kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="nwModalHead">
          <div>
            <span className={`nwModalTag ${kind}`}>{kind === 'asset' ? 'Asset' : 'Liability'}</span>
            <h3>{editing ? 'Edit' : 'Add'} {kind === 'asset' ? 'asset' : 'liability'}</h3>
          </div>
          <button className="nwModalClose" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <label className="nwField">
          <span>Name</span>
          <input ref={inputRef} className="nwInput" placeholder={kind === 'asset' ? 'e.g. Chequing account' : 'e.g. Car loan'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>

        <div className="nwField">
          <span>Category</span>
          <input className="nwInput" placeholder="e.g. Savings, Real Estate, Auto Loan…" value={category} onChange={(e) => setCategory(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <div className="nwCatChips">
            {suggestions.map((label) => {
              const Icon = iconForCategory(label, kind)
              const active = category.trim().toLowerCase() === label.toLowerCase()
              const color = colorForCategory(label)
              return (
                <button
                  key={label}
                  type="button"
                  className={`nwCatChip ${active ? 'active' : ''}`}
                  style={active ? { borderColor: color, background: `${color}18`, color } : undefined}
                  onClick={() => setCategory(label)}
                >
                  <Icon size={14} /> {label}
                </button>
              )
            })}
          </div>
        </div>

        <label className="nwField">
          <span>Value</span>
          <div className="nwInputMoney">
            <span className="nwInputPrefix">{fmt(0, currency).replace(/[\d.,\s]/g, '') || '$'}</span>
            <input className="nwInput" type="number" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
        </label>

        <label className="nwField">
          <span>Note <em>(optional)</em></span>
          <input className="nwInput" placeholder="e.g. Wealthsimple, 5.4% APR…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>

        <div className="nwModalFooter">
          <button className="nwBtn nwBtnGhost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`nwBtn ${kind === 'asset' ? 'nwBtnAsset' : 'nwBtnLiability'}`} disabled={!valid || busy} onClick={submit}>
            {busy ? <><Loader2 size={15} className="nwSpin" /> Saving…</> : editing ? 'Save changes' : `Add ${kind === 'asset' ? 'asset' : 'liability'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function TrendTooltip({ active, payload, label, currency, showSplit }: any) {
  if (!active || !payload?.length) return null
  const net = payload.find((p: any) => p.dataKey === 'netWorth')?.value
  const assets = payload.find((p: any) => p.dataKey === 'assets')?.value
  const liabilities = payload.find((p: any) => p.dataKey === 'liabilities')?.value
  return (
    <div className="nwTooltip">
      <div className="nwTooltipDate">{label}</div>
      {net != null ? <div className="nwTooltipRow"><span>Net worth</span><strong>{fmtExact(Number(net), currency)}</strong></div> : null}
      {showSplit || assets != null ? (
        <>
          {assets != null ? <div className="nwTooltipRow"><span className="nwTt pos">Assets</span><strong>{fmtExact(Number(assets), currency)}</strong></div> : null}
          {liabilities != null ? <div className="nwTooltipRow"><span className="nwTt neg">Liabilities</span><strong>{fmtExact(Number(liabilities), currency)}</strong></div> : null}
        </>
      ) : null}
    </div>
  )
}

function AllocTooltip({ active, payload, currency, total }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  const share = total > 0 ? (Number(d.value) / total) * 100 : 0
  return (
    <div className="nwTooltip">
      <div className="nwTooltipRow"><span className="nwDot" style={{ background: d.payload.color }} />{d.name}</div>
      <div className="nwTooltipRow"><strong>{fmtExact(Number(d.value), currency)}</strong><span>{share.toFixed(1)}%</span></div>
    </div>
  )
}
