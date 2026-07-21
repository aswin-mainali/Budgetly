import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ArrowDownRight, ArrowUpRight, Building2, Car, CreditCard,
  Gem, GraduationCap, Landmark, Minus, Package, Pencil, PiggyBank, Plus,
  Scale, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react'

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
  monthKey: string // YYYY-MM
  date: string // ISO date the snapshot was last written
  assets: number
  liabilities: number
  netWorth: number
}

type CategoryMeta = {
  key: string
  label: string
  kind: NWKind
  color: string
  icon: React.ComponentType<{ size?: number | string }>
}

/* ────────────────────────────────────────────────────────────────────────────
   Category catalogue
   ──────────────────────────────────────────────────────────────────────────── */

const CATEGORIES: CategoryMeta[] = [
  { key: 'cash', label: 'Cash & Bank', kind: 'asset', color: '#22c55e', icon: Wallet },
  { key: 'investments', label: 'Investments', kind: 'asset', color: '#3b82f6', icon: TrendingUp },
  { key: 'retirement', label: 'Retirement', kind: 'asset', color: '#8b5cf6', icon: PiggyBank },
  { key: 'property', label: 'Real Estate', kind: 'asset', color: '#f59e0b', icon: Building2 },
  { key: 'vehicle', label: 'Vehicles', kind: 'asset', color: '#06b6d4', icon: Car },
  { key: 'valuables', label: 'Valuables', kind: 'asset', color: '#ec4899', icon: Gem },
  { key: 'other_asset', label: 'Other Assets', kind: 'asset', color: '#64748b', icon: Package },
  { key: 'mortgage', label: 'Mortgage', kind: 'liability', color: '#ef4444', icon: Building2 },
  { key: 'loan', label: 'Loans', kind: 'liability', color: '#f97316', icon: Landmark },
  { key: 'credit', label: 'Credit Cards', kind: 'liability', color: '#e11d48', icon: CreditCard },
  { key: 'student', label: 'Student Loans', kind: 'liability', color: '#d946ef', icon: GraduationCap },
  { key: 'other_liability', label: 'Other Debts', kind: 'liability', color: '#fb7185', icon: Minus },
]

const LIQUID_CATEGORIES = new Set(['cash', 'investments'])
const catBy = (key: string) => CATEGORIES.find((c) => c.key === key)

/* ────────────────────────────────────────────────────────────────────────────
   Persistence (localStorage, per-user)
   ──────────────────────────────────────────────────────────────────────────── */

const STORE_PREFIX = 'budgetly:networth:v1'
const storeKey = (userId: string | null | undefined) => `${STORE_PREFIX}:${userId || 'guest'}`

type StoreShape = { items: NWItem[]; snapshots: NWSnapshot[] }

const readStore = (userId: string | null | undefined): StoreShape => {
  try {
    const raw = localStorage.getItem(storeKey(userId))
    if (!raw) return { items: [], snapshots: [] }
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    }
  } catch {
    return { items: [], snapshots: [] }
  }
}

const writeStore = (userId: string | null | undefined, store: StoreShape) => {
  try {
    localStorage.setItem(storeKey(userId), JSON.stringify(store))
  } catch (err) {
    // Non-fatal: local cache write failed (quota / private mode).
    // eslint-disable-next-line no-console
    console.warn('NetWorth: could not persist locally', err)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */

const uid = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `nw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
const monthLabelOf = (mk: string) => {
  const [y, m] = mk.split('-').map(Number)
  if (!y || !m) return mk
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
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
  const [hydrated, setHydrated] = useState(false)

  // ── Load once per user ────────────────────────────────────────────────────
  useEffect(() => {
    setHydrated(false)
    const store = readStore(userId)
    setItems(store.items)
    setSnapshots(store.snapshots)
    setHydrated(true)
  }, [userId])

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const assets = items.filter((i) => i.kind === 'asset').reduce((s, i) => s + i.value, 0)
    const liabilities = items.filter((i) => i.kind === 'liability').reduce((s, i) => s + i.value, 0)
    const netWorth = assets - liabilities
    const liquid = items
      .filter((i) => i.kind === 'asset' && LIQUID_CATEGORIES.has(i.category))
      .reduce((s, i) => s + i.value, 0)
    const debtRatio = assets > 0 ? (liabilities / assets) * 100 : 0
    return { assets, liabilities, netWorth, liquid, debtRatio }
  }, [items])

  // ── Persist + auto-snapshot current month whenever data changes ───────────
  useEffect(() => {
    if (!hydrated) return
    const mk = monthKeyOf(new Date())
    const nextSnap: NWSnapshot = {
      monthKey: mk,
      date: new Date().toISOString().slice(0, 10),
      assets: clampMoney(totals.assets),
      liabilities: clampMoney(totals.liabilities),
      netWorth: clampMoney(totals.netWorth),
    }
    setSnapshots((prev) => {
      const hasItems = items.length > 0
      const others = prev.filter((s) => s.monthKey !== mk)
      // Only keep a live snapshot for the current month when there is data to record.
      const next = hasItems ? [...others, nextSnap].sort((a, b) => a.monthKey.localeCompare(b.monthKey)) : others
      writeStore(userId, { items, snapshots: next })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hydrated])

  const notify = (msg: string) => {
    setFlash(msg)
    window.clearTimeout((notify as any)._t)
    ;(notify as any)._t = window.setTimeout(() => setFlash(null), 2200)
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  const upsertItem = (draft: Omit<NWItem, 'id' | 'updatedAt'> & { id?: string }) => {
    setItems((prev) => {
      const now = new Date().toISOString()
      if (draft.id) {
        return prev.map((i) => (i.id === draft.id ? { ...i, ...draft, value: clampMoney(draft.value), updatedAt: now } as NWItem : i))
      }
      const created: NWItem = {
        id: uid(),
        name: draft.name,
        category: draft.category,
        kind: draft.kind,
        value: clampMoney(draft.value),
        note: draft.note,
        updatedAt: now,
      }
      return [created, ...prev]
    })
  }

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id))

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

  // ── Trend series ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const sorted = [...snapshots].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    const sliced =
      range === 'ALL' ? sorted : sorted.slice(-(range === '6M' ? 6 : 12))
    return sliced.map((s) => ({
      key: s.monthKey,
      label: monthLabelOf(s.monthKey),
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

  // ── Category breakdown ────────────────────────────────────────────────────
  const assetBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    items.filter((i) => i.kind === 'asset').forEach((i) => map.set(i.category, (map.get(i.category) || 0) + i.value))
    return CATEGORIES.filter((c) => c.kind === 'asset' && (map.get(c.key) || 0) > 0)
      .map((c) => ({ ...c, value: map.get(c.key) || 0 }))
      .sort((a, b) => b.value - a.value)
  }, [items])

  const liabilityBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    items.filter((i) => i.kind === 'liability').forEach((i) => map.set(i.category, (map.get(i.category) || 0) + i.value))
    return CATEGORIES.filter((c) => c.kind === 'liability' && (map.get(c.key) || 0) > 0)
      .map((c) => ({ ...c, value: map.get(c.key) || 0 }))
      .sort((a, b) => b.value - a.value)
  }, [items])

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

  // ── Projection (12mo, from average monthly change) ────────────────────────
  const projection = useMemo(() => {
    if (snapshots.length < 2) return null
    const sorted = [...snapshots].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    const deltas: number[] = []
    for (let i = 1; i < sorted.length; i++) deltas.push(sorted[i].netWorth - sorted[i - 1].netWorth)
    const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length
    if (avg <= 0) return { avg, projected: null as number | null }
    return { avg, projected: totals.netWorth + avg * 12 }
  }, [snapshots, totals.netWorth])

  const donutData = useMemo(() => {
    if (assetBreakdown.length === 0) return []
    return assetBreakdown.map((c) => ({ name: c.label, value: c.value, color: c.color }))
  }, [assetBreakdown])

  const gridStroke = theme === 'light' ? 'rgba(76,101,145,.18)' : 'rgba(148,163,184,.16)'
  const axisColor = theme === 'light' ? '#52627f' : '#93a7c6'
  const nwPositive = totals.netWorth >= 0

  const hasData = items.length > 0

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
          <div className="nwKpiIcon" style={{ background: 'rgba(59,130,246,.14)', color: '#3b82f6' }}><Target size={18} /></div>
          <div>
            <span className="nwKpiLabel">12-mo projection</span>
            <strong className="nwKpiValue">{projection?.projected != null ? fmtCompact(projection.projected, currency) : '—'}</strong>
            <small className="nwKpiHint">{projection?.projected != null ? `${fmt(projection.avg, currency)}/mo pace` : 'Needs 2+ months'}</small>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="nwEmptyState">
          <div className="nwEmptyIllus" aria-hidden="true"><Scale size={40} /></div>
          <h2>Start tracking your net worth</h2>
          <p>Add everything you own and owe. Budgetly turns it into a live dashboard with trends, allocation, and a financial health score — all stored privately on your device.</p>
          <div className="nwEmptyActions">
            <button className="nwBtn nwBtnAsset" onClick={() => openAdd('asset')}><Plus size={16} /> Add your first asset</button>
            <button className="nwBtn nwBtnGhost" onClick={() => openAdd('liability')}><Plus size={16} /> Add a liability</button>
          </div>
          <div className="nwEmptyChips">
            {CATEGORIES.filter((c) => c.kind === 'asset').slice(0, 5).map((c) => (
              <button key={c.key} className="nwSeedChip" onClick={() => { setEditing(null); setModalKind('asset'); setModalOpen(true); setSeedCategory(c.key) }}>
                <c.icon size={14} /> {c.label}
              </button>
            ))}
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
                  <p className="nwCardSub">Monthly snapshots, recorded automatically as you update.</p>
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
                      <div className="nwAllocLegendItem" key={c.key}>
                        <span className="nwDot" style={{ background: c.color }} />
                        <span className="nwAllocName">{c.label}</span>
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
              <Target size={16} className="nwInsightGlyph" />
              <div>
                <strong>{projection?.projected != null ? `On track for ${fmtCompact(projection.projected, currency)}` : 'Build your trend'}</strong>
                <p>{projection?.projected != null ? `At your current pace of ${fmt(projection.avg, currency)}/month, here's where you'll be in a year.` : 'Two or more monthly snapshots unlock a personalised projection.'}</p>
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
          onClose={() => { setModalOpen(false); setSeedCategory(null) }}
          onSave={(draft) => {
            upsertItem(draft)
            notify(editing ? 'Updated' : draft.kind === 'asset' ? 'Asset added' : 'Liability added')
            setModalOpen(false)
            setSeedCategory(null)
          }}
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
              <button className="nwBtn nwBtnDanger" onClick={() => { removeItem(toDelete.id); notify('Removed'); setToDelete(null) }}>Remove</button>
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
              const meta = catBy(i.category)
              const Icon = meta?.icon || Package
              const share = total > 0 ? (i.value / total) * 100 : 0
              return (
                <li key={i.id} className="nwLedgerItem">
                  <span className="nwLedgerItemIcon" style={{ background: `${meta?.color || '#64748b'}22`, color: meta?.color || '#64748b' }}><Icon size={17} /></span>
                  <div className="nwLedgerItemBody">
                    <div className="nwLedgerItemTop">
                      <strong className="nwLedgerItemName">{i.name}</strong>
                      <span className="nwLedgerItemValue">{fmtExact(i.value, currency)}</span>
                    </div>
                    <div className="nwLedgerItemMeta">
                      <span className="nwLedgerItemCat">{meta?.label || 'Other'}</span>
                      {i.note ? <span className="nwLedgerItemNote">· {i.note}</span> : null}
                      <span className="nwLedgerItemShare">{share.toFixed(0)}%</span>
                    </div>
                    <div className="nwLedgerItemTrack"><div style={{ width: `${share}%`, background: meta?.color || accent }} /></div>
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
  kind, editing, currency, seedCategory, onClose, onSave,
}: {
  kind: NWKind
  editing: NWItem | null
  currency: string
  seedCategory: string | null
  onClose: () => void
  onSave: (draft: Omit<NWItem, 'id' | 'updatedAt'> & { id?: string }) => void
}) {
  const options = CATEGORIES.filter((c) => c.kind === kind)
  const [name, setName] = useState(editing?.name || '')
  const [category, setCategory] = useState(editing?.category || seedCategory || options[0]?.key || '')
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
  const valid = name.trim().length > 0 && Number.isFinite(numeric) && numeric > 0 && category

  const submit = () => {
    if (!valid) return
    onSave({ id: editing?.id, name: name.trim(), category, kind, value: numeric, note: note.trim() || undefined })
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
          <div className="nwCatGrid">
            {options.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`nwCatChip ${category === c.key ? 'active' : ''}`}
                style={category === c.key ? { borderColor: c.color, background: `${c.color}18`, color: c.color } : undefined}
                onClick={() => setCategory(c.key)}
              >
                <c.icon size={15} /> {c.label}
              </button>
            ))}
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
          <button className="nwBtn nwBtnGhost" onClick={onClose}>Cancel</button>
          <button className={`nwBtn ${kind === 'asset' ? 'nwBtnAsset' : 'nwBtnLiability'}`} disabled={!valid} onClick={submit}>
            {editing ? 'Save changes' : `Add ${kind === 'asset' ? 'asset' : 'liability'}`}
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
