import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Banknote, Building2, Car, CreditCard, GraduationCap, Home, Landmark, Layers, Link2, Loader, PiggyBank, Plus, Scale, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Wallet, Pencil, Trash2 } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

type Kind = 'asset' | 'liability'
type NWItem = { id: string; kind: Kind; category: string; name: string; value: number; notes: string | null; linked?: boolean }
type NWSnapshot = { id?: string; date_key: string; total_assets: number; total_liabilities: number; net_worth: number }

const ASSET_CATEGORIES = ['Cash', 'Investments', 'Real Estate', 'Vehicles', 'Retirement', 'Other'] as const
const LIABILITY_CATEGORIES = ['Credit Card', 'Loan', 'Mortgage', 'Student Loan', 'Other'] as const

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Cash: <Banknote size={15} />, Investments: <TrendingUp size={15} />, 'Real Estate': <Home size={15} />,
  Vehicles: <Car size={15} />, Retirement: <PiggyBank size={15} />, Other: <Layers size={15} />,
  'Credit Card': <CreditCard size={15} />, Loan: <Landmark size={15} />, Mortgage: <Building2 size={15} />,
  'Student Loan': <GraduationCap size={15} />,
}

// Fixed-order categorical hues (assigned by identity, never cycled per the dataviz rules).
const COMPOSITION_COLORS = ['#21c97a', '#38bdf8', '#a78bfa', '#f5b544', '#f472b6', '#5eead4']
const RANGE_DAYS = { '3M': 92, '6M': 183, '1Y': 366 } as const
const todayKey = () => new Date().toISOString().slice(0, 10)

const isInvalidRefreshTokenError = (error: unknown) =>
  /invalid refresh token|refresh token not found/i.test(String((error as { message?: string })?.message || error || ''))
const toast = (message: string) => window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))

// Smoothly counts a number up/down when it changes — the fintech "live" feel.
function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    const start = performance.now()
    const dur = 750
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (to - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(display)}</>
}

export function NetWorthView({ currency, onOpenInvestments }: { currency: string; onOpenInvestments?: () => void }) {
  const [items, setItems] = useState<NWItem[]>([])
  const [snapshots, setSnapshots] = useState<NWSnapshot[]>([])
  const [investmentsValue, setInvestmentsValue] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<'3M' | '6M' | '1Y' | 'All'>('6M')
  const [savingSnapshot, setSavingSnapshot] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [itemToDelete, setItemToDelete] = useState<NWItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Add / edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<NWItem | null>(null)
  const [draftKind, setDraftKind] = useState<Kind>('asset')
  const [draftCategory, setDraftCategory] = useState<string>('Cash')
  const [draftName, setDraftName] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [draftNotes, setDraftNotes] = useState('')

  const money = useCallback((v: number) => fmtMoney(Number.isFinite(v) ? v : 0, currency), [currency])
  const moneyCompact = useCallback((v: number) => {
    const n = Number.isFinite(v) ? v : 0
    const abs = Math.abs(n)
    if (abs >= 1000) {
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n) } catch { /* fall through */ }
    }
    return fmtMoney(n, currency)
  }, [currency])

  const loadInvestments = useCallback(async (uid: string) => {
    try {
      const snap = await supabase.from('investment_value_snapshots').select('total_value, date_key').eq('user_id', uid).order('date_key', { ascending: false }).limit(1)
      const latest = Array.isArray(snap.data) && snap.data.length ? Number((snap.data[0] as { total_value?: number }).total_value || 0) : 0
      if (latest > 0) { setInvestmentsValue(latest); return }
      const holdings = await supabase.from('investment_holdings').select('quantity, current_price').eq('user_id', uid)
      const sum = Array.isArray(holdings.data)
        ? holdings.data.reduce((s, h) => s + Number((h as { quantity?: number }).quantity || 0) * Number((h as { current_price?: number }).current_price || 0), 0)
        : 0
      setInvestmentsValue(Number.isFinite(sum) ? sum : 0)
    } catch { setInvestmentsValue(0) }
  }, [])

  const load = useCallback(async (uid: string) => {
    setLoading(true)
    const [i, s] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('user_id', uid).order('created_at', { ascending: true }),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', uid).order('date_key', { ascending: true }),
    ])
    if (i.error || s.error) {
      if (isInvalidRefreshTokenError(i.error || s.error)) { try { await supabase.auth.signOut({ scope: 'local' }) } catch {} }
      setLoading(false)
      return
    }
    setItems(Array.isArray(i.data) ? (i.data as NWItem[]) : [])
    setSnapshots(Array.isArray(s.data) ? (s.data as NWSnapshot[]) : [])
    await loadInvestments(uid)
    setLoading(false)
  }, [loadInvestments])

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        const id = data.user?.id ?? null
        setUserId(id)
        if (id) await load(id)
      } catch (error) {
        if (!isInvalidRefreshTokenError(error)) console.error('Net worth init failed:', error)
      }
    }
    void init()
  }, [load])

  useEffect(() => {
    const close = () => setOpenMenuId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Manual assets/liabilities plus the auto-linked investments row.
  const allItems = useMemo<NWItem[]>(() => {
    const linked: NWItem[] = investmentsValue > 0
      ? [{ id: 'investments-linked', kind: 'asset', category: 'Investments', name: 'Investments portfolio', value: investmentsValue, notes: null, linked: true }]
      : []
    return [...items, ...linked]
  }, [items, investmentsValue])

  const assets = useMemo(() => allItems.filter((x) => x.kind === 'asset'), [allItems])
  const liabilities = useMemo(() => allItems.filter((x) => x.kind === 'liability'), [allItems])
  const totalAssets = useMemo(() => assets.reduce((s, x) => s + Number(x.value || 0), 0), [assets])
  const totalLiabilities = useMemo(() => liabilities.reduce((s, x) => s + Number(x.value || 0), 0), [liabilities])
  const netWorth = totalAssets - totalLiabilities
  const coverage = totalLiabilities > 0 ? totalAssets / totalLiabilities : Infinity
  const grossTotal = totalAssets + totalLiabilities
  const assetShare = grossTotal > 0 ? (totalAssets / grossTotal) * 100 : 0
  const liabilityShare = grossTotal > 0 ? (totalLiabilities / grossTotal) * 100 : 0

  const groupByCategory = useCallback((list: NWItem[], order: readonly string[]) => {
    const map = new Map<string, { items: NWItem[]; subtotal: number }>()
    for (const it of list) {
      const key = order.includes(it.category) ? it.category : 'Other'
      const bucket = map.get(key) || { items: [], subtotal: 0 }
      bucket.items.push(it); bucket.subtotal += Number(it.value || 0)
      map.set(key, bucket)
    }
    return [...map.entries()].sort((a, b) => b[1].subtotal - a[1].subtotal)
  }, [])

  const assetGroups = useMemo(() => groupByCategory(assets, ASSET_CATEGORIES), [assets, groupByCategory])
  const liabilityGroups = useMemo(() => groupByCategory(liabilities, LIABILITY_CATEGORIES), [liabilities, groupByCategory])
  const donutData = useMemo(() => assetGroups.map(([name, b]) => ({ name, value: b.subtotal })), [assetGroups])

  const history = useMemo(() => snapshots
    .map((s) => ({ date: s.date_key, assets: Number(s.total_assets || 0), liabilities: Number(s.total_liabilities || 0), netWorth: Number(s.net_worth || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date)), [snapshots])

  const chartData = useMemo(() => {
    if (range === 'All') return history
    const start = new Date(); start.setDate(start.getDate() - RANGE_DAYS[range])
    return history.filter((p) => new Date(p.date) >= start)
  }, [history, range])

  const delta = useMemo(() => {
    if (history.length < 2) return null
    const prev = history[history.length - 2]
    const diff = netWorth - prev.netWorth
    const pct = prev.netWorth !== 0 ? (diff / Math.abs(prev.netWorth)) * 100 : 0
    return { diff, pct }
  }, [history, netWorth])

  const upsertSnapshot = useCallback(async (uid: string, a: number, l: number, silent = true) => {
    const key = todayKey()
    const payload = { user_id: uid, date_key: key, total_assets: a, total_liabilities: l, net_worth: a - l, updated_at: new Date().toISOString() }
    // No DB unique constraint on (user_id, date_key), so upsert manually to avoid duplicate rows.
    const existing = snapshots.find((s) => s.date_key === key)
    const res = existing?.id
      ? await supabase.from('net_worth_snapshots').update(payload).eq('id', existing.id).eq('user_id', uid).select('*').single()
      : await supabase.from('net_worth_snapshots').insert(payload).select('*').single()
    if (res.error || !res.data) { if (!silent) toast('Could not save snapshot.'); return }
    const saved = res.data as NWSnapshot
    setSnapshots((cur) => [...cur.filter((s) => s.date_key !== key), saved].sort((x, y) => x.date_key.localeCompare(y.date_key)))
    if (!silent) toast('Snapshot recorded.')
  }, [snapshots])

  const recordSnapshot = async () => {
    if (!userId || savingSnapshot) return
    setSavingSnapshot(true)
    await upsertSnapshot(userId, totalAssets, totalLiabilities, false)
    setSavingSnapshot(false)
  }

  const openAdd = (kind: Kind) => {
    setEditing(null); setDraftKind(kind)
    setDraftCategory(kind === 'asset' ? 'Cash' : 'Credit Card')
    setDraftName(''); setDraftValue(''); setDraftNotes(''); setModalOpen(true)
  }
  const openEdit = (it: NWItem) => {
    setEditing(it); setDraftKind(it.kind); setDraftCategory(it.category)
    setDraftName(it.name); setDraftValue(String(it.value)); setDraftNotes(it.notes || ''); setModalOpen(true)
  }
  const closeModal = () => { setModalOpen(false); setEditing(null) }

  const saveItem = async () => {
    if (!userId) return
    const value = Number(draftValue)
    if (!draftName.trim()) { toast('Enter a name.'); return }
    if (!Number.isFinite(value) || value < 0) { toast('Enter a valid amount.'); return }
    const payload = { user_id: userId, kind: draftKind, category: draftCategory, name: draftName.trim(), value, notes: draftNotes.trim() || null, updated_at: new Date().toISOString() }
    const res = editing
      ? await supabase.from('net_worth_items').update(payload).eq('id', editing.id).eq('user_id', userId).select('*').single()
      : await supabase.from('net_worth_items').insert(payload).select('*').single()
    if (res.error || !res.data) { toast(res.error?.message || 'Could not save entry.'); return }
    const saved = res.data as NWItem
    const nextItems = editing ? items.map((x) => (x.id === editing.id ? saved : x)) : [...items, saved]
    setItems(nextItems)
    closeModal()
    const a = nextItems.filter((x) => x.kind === 'asset').reduce((s, x) => s + Number(x.value || 0), 0) + investmentsValue
    const l = nextItems.filter((x) => x.kind === 'liability').reduce((s, x) => s + Number(x.value || 0), 0)
    await upsertSnapshot(userId, a, l)
    toast(editing ? 'Entry updated.' : 'Entry added.')
  }

  const confirmDelete = async () => {
    if (!itemToDelete || !userId || deleting) return
    setDeleting(true)
    const res = await supabase.from('net_worth_items').delete().eq('id', itemToDelete.id).eq('user_id', userId)
    if (res.error) { toast('Could not delete entry.'); setDeleting(false); return }
    const nextItems = items.filter((x) => x.id !== itemToDelete.id)
    setItems(nextItems)
    const a = nextItems.filter((x) => x.kind === 'asset').reduce((s, x) => s + Number(x.value || 0), 0) + investmentsValue
    const l = nextItems.filter((x) => x.kind === 'liability').reduce((s, x) => s + Number(x.value || 0), 0)
    await upsertSnapshot(userId, a, l)
    setItemToDelete(null); setDeleting(false); toast('Entry deleted.')
  }

  const draftCategories = draftKind === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES
  const hasData = allItems.length > 0
  const netPositive = netWorth >= 0

  const healthLabel = coverage === Infinity ? 'Debt-free' : coverage >= 2 ? 'Strong' : coverage >= 1 ? 'Balanced' : 'Overleveraged'
  const healthColor = coverage === Infinity || coverage >= 2 ? '#21c97a' : coverage >= 1 ? '#f5b544' : '#f87171'
  const gaugeValue = coverage === Infinity ? 5 : Math.max(0, Math.min(coverage, 5))

  const TrendTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    return <div className='nwTooltip'>
      <div className='nwTooltipDate'>{new Date(String(label)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div className='nwTooltipRow'><span>Net worth</span><strong>{money(Number(row?.netWorth || 0))}</strong></div>
      <div className='nwTooltipRow'><span>Assets</span><strong className='pos'>{money(Number(row?.assets || 0))}</strong></div>
      <div className='nwTooltipRow'><span>Liabilities</span><strong className='neg'>{money(Number(row?.liabilities || 0))}</strong></div>
    </div>
  }

  return <section className='netWorthPage nwPro'>
    {/* ---------- Aurora hero ---------- */}
    <div className='nwHero'>
      <div className='nwHeroAurora' aria-hidden='true' />
      <div className='nwHeroGrid' aria-hidden='true' />
      <div className='nwHeroInner'>
        <div className='nwHeroTop'>
          <div className='nwHeroLead'>
            <span className='nwEyebrow'><Scale size={14} /> Net Worth</span>
            <div className={`nwHeroValue ${netPositive ? '' : 'neg'}`}><AnimatedNumber value={netWorth} format={money} /></div>
            <div className='nwHeroMeta'>
              {delta ? (
                <span className={`nwPill ${delta.diff >= 0 ? 'pos' : 'neg'}`}>
                  {delta.diff >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {money(Math.abs(delta.diff))} · {delta.diff >= 0 ? '+' : '−'}{Math.abs(delta.pct).toFixed(1)}%
                </span>
              ) : <span className='nwPill muted'><Sparkles size={13} /> Record snapshots to track change</span>}
              <span className='nwAsOf'>Updated {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
          <div className='nwHeroActions'>
            <button className='nwGhostBtn' onClick={() => void recordSnapshot()} disabled={savingSnapshot || !hasData}>
              {savingSnapshot ? <Loader size={16} className='nwSpin' /> : <Sparkles size={16} />}{savingSnapshot ? 'Saving' : 'Snapshot'}
            </button>
            <button className='nwPrimaryBtn' onClick={() => openAdd('asset')}><Plus size={16} />Add entry</button>
          </div>
        </div>

        <div className='nwHeroSpark'>
          {history.length >= 2 ? (
            <ResponsiveContainer width='100%' height='100%'>
              <AreaChart data={history} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id='nwHeroFill' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0%' stopColor='#21c97a' stopOpacity={0.4} />
                    <stop offset='100%' stopColor='#21c97a' stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgba(255,255,255,.25)' }} />
                <Area type='monotone' dataKey='netWorth' stroke='#3bffb0' strokeWidth={2.5} fill='url(#nwHeroFill)' />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className='nwHeroSparkBaseline' aria-hidden='true' />}
        </div>

        <div className='nwHeroStats'>
          <div className='nwHeroStat'><span>Assets</span><strong className='pos'><AnimatedNumber value={totalAssets} format={moneyCompact} /></strong></div>
          <span className='nwHeroSep' />
          <div className='nwHeroStat'><span>Liabilities</span><strong className='neg'><AnimatedNumber value={totalLiabilities} format={moneyCompact} /></strong></div>
          <span className='nwHeroSep' />
          <div className='nwHeroStat'><span>Coverage</span><strong>{coverage === Infinity ? '∞' : `${coverage.toFixed(1)}×`}</strong></div>
          <span className='nwHeroSep' />
          <div className='nwHeroStat'><span>Health</span><strong style={{ color: healthColor }}>{healthLabel}</strong></div>
        </div>
      </div>
    </div>

    {!hasData && !loading ? (
      <div className='nwTile nwFirstRun'>
        <div className='nwFirstRunIcon'><PiggyBank size={26} /></div>
        <h3>Build your balance sheet</h3>
        <p>Add what you own — cash, property, vehicles — and what you owe. Your Investments portfolio is pulled in automatically.</p>
        <div className='nwFirstRunActions'>
          <button className='nwPrimaryBtn' onClick={() => openAdd('asset')}><Plus size={16} />Add an asset</button>
          <button className='nwGhostBtn' onClick={() => openAdd('liability')}><Plus size={16} />Add a liability</button>
        </div>
      </div>
    ) : (
      <>
        {/* ---------- Radial gauge row ---------- */}
        <div className='nwGauges'>
          <div className='nwTile nwGaugeTile'>
            <div className='nwTileHead'><span className='nwTileLabel'><Wallet size={14} /> Assets</span></div>
            <div className='nwRadialWrap'>
              <ResponsiveContainer width='100%' height={150}>
                <RadialBarChart innerRadius='74%' outerRadius='100%' data={[{ value: Math.max(assetShare, grossTotal > 0 ? 2 : 0) }]} startAngle={90} endAngle={-270}>
                  <defs><linearGradient id='nwGradAssets' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stopColor='#21c97a' /><stop offset='100%' stopColor='#5eead4' /></linearGradient></defs>
                  <PolarAngleAxis type='number' domain={[0, 100]} tick={false} />
                  <RadialBar background={{ fill: 'rgba(148,163,184,.14)' }} dataKey='value' cornerRadius={20} fill='url(#nwGradAssets)' />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className='nwRadialCenter'><strong className='pos'>{moneyCompact(totalAssets)}</strong><small>{assetShare.toFixed(0)}% of total</small></div>
            </div>
          </div>

          <div className='nwTile nwGaugeTile'>
            <div className='nwTileHead'><span className='nwTileLabel'><CreditCard size={14} /> Liabilities</span></div>
            <div className='nwRadialWrap'>
              <ResponsiveContainer width='100%' height={150}>
                <RadialBarChart innerRadius='74%' outerRadius='100%' data={[{ value: Math.max(liabilityShare, grossTotal > 0 && totalLiabilities > 0 ? 2 : 0) }]} startAngle={90} endAngle={-270}>
                  <defs><linearGradient id='nwGradLiab' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stopColor='#f87171' /><stop offset='100%' stopColor='#fb923c' /></linearGradient></defs>
                  <PolarAngleAxis type='number' domain={[0, 100]} tick={false} />
                  <RadialBar background={{ fill: 'rgba(148,163,184,.14)' }} dataKey='value' cornerRadius={20} fill='url(#nwGradLiab)' />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className='nwRadialCenter'><strong className='neg'>{moneyCompact(totalLiabilities)}</strong><small>{liabilityShare.toFixed(0)}% of total</small></div>
            </div>
          </div>

          <div className='nwTile nwGaugeTile'>
            <div className='nwTileHead'><span className='nwTileLabel'><ShieldCheck size={14} /> Financial Health</span></div>
            <div className='nwRadialWrap'>
              <ResponsiveContainer width='100%' height={150}>
                <RadialBarChart innerRadius='74%' outerRadius='100%' data={[{ value: gaugeValue }]} startAngle={220} endAngle={-40}>
                  <defs><linearGradient id='nwGradHealth' x1='0' y1='0' x2='1' y2='0'><stop offset='0%' stopColor={healthColor} stopOpacity={0.65} /><stop offset='100%' stopColor={healthColor} /></linearGradient></defs>
                  <PolarAngleAxis type='number' domain={[0, 5]} tick={false} />
                  <RadialBar background={{ fill: 'rgba(148,163,184,.14)' }} dataKey='value' cornerRadius={20} fill='url(#nwGradHealth)' />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className='nwRadialCenter'><strong style={{ color: healthColor }}>{healthLabel}</strong><small>{coverage === Infinity ? 'No debt' : `${coverage.toFixed(1)}× coverage`}</small></div>
            </div>
          </div>
        </div>

        {/* ---------- Charts bento ---------- */}
        <div className='nwCharts'>
          <div className='nwTile nwTrendTile'>
            <div className='nwTileHead'>
              <span className='nwTileLabel'><TrendingUp size={14} /> Net Worth Trajectory</span>
              <div className='nwRanges'>{(['3M', '6M', '1Y', 'All'] as const).map((r) => (
                <button key={r} className={`nwRange ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>
              ))}</div>
            </div>
            {chartData.length < 2 ? (
              <div className='nwEmpty'><TrendingUp size={26} /><p>{history.length === 0 ? 'Record your first snapshot to start tracking your trajectory.' : 'Not enough history for this range yet — record snapshots over time.'}</p></div>
            ) : (
              <>
                <div className='nwTrendChart'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id='nwTrendFill' x1='0' y1='0' x2='0' y2='1'>
                          <stop offset='0%' stopColor='#21c97a' stopOpacity={0.22} />
                          <stop offset='100%' stopColor='#21c97a' stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray='3 6' stroke='rgba(148,163,184,.14)' vertical={false} />
                      <XAxis dataKey='date' tickFormatter={(v) => new Date(String(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} minTickGap={30} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => moneyCompact(Number(v))} width={64} tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgba(148,163,184,.4)', strokeDasharray: '4 4' }} />
                      <Area type='monotone' dataKey='netWorth' stroke='none' fill='url(#nwTrendFill)' />
                      <Line type='monotone' dataKey='liabilities' stroke='#f87171' strokeWidth={1.75} strokeDasharray='5 5' dot={false} />
                      <Line type='monotone' dataKey='netWorth' stroke='#21c97a' strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className='nwTrendLegend'>
                  <span><i className='solid' />Net worth</span>
                  <span><i className='area' />Assets fill</span>
                  <span><i className='dash' />Liabilities</span>
                </div>
              </>
            )}
          </div>

          <div className='nwTile nwDonutTile'>
            <div className='nwTileHead'><span className='nwTileLabel'><Layers size={14} /> Asset Mix</span></div>
            {donutData.length === 0 ? (
              <div className='nwEmpty'><Wallet size={26} /><p>Add assets to see your allocation.</p></div>
            ) : (
              <>
                <div className='nwDonutWrap'>
                  <ResponsiveContainer width='100%' height={176}>
                    <PieChart>
                      <Pie data={donutData} dataKey='value' innerRadius={58} outerRadius={84} paddingAngle={3} stroke='none' startAngle={90} endAngle={-270}>
                        {donutData.map((_, i) => <Cell key={i} fill={COMPOSITION_COLORS[i % COMPOSITION_COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className='nwDonutCenter'><strong>{moneyCompact(totalAssets)}</strong><small>total assets</small></div>
                </div>
                <div className='nwLegend'>
                  {donutData.map((d, i) => (
                    <div className='nwLegendRow' key={d.name}>
                      <span className='nwDot' style={{ background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length] }} />
                      <span className='nwLegendName'>{d.name}</span>
                      <span className='nwLegendPct'>{totalAssets > 0 ? ((d.value / totalAssets) * 100).toFixed(0) : 0}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---------- Ledger lists ---------- */}
        <div className='nwLists'>
          {([
            { title: 'Assets', kind: 'asset' as Kind, groups: assetGroups, total: totalAssets, accent: 'asset' },
            { title: 'Liabilities', kind: 'liability' as Kind, groups: liabilityGroups, total: totalLiabilities, accent: 'liab' },
          ]).map((panel) => (
            <div className={`nwTile nwLedger nwLedger-${panel.accent}`} key={panel.title}>
              <div className='nwTileHead'>
                <span className='nwTileLabel'>{panel.title}<span className='nwLedgerTotal'>{money(panel.total)}</span></span>
                <button className='nwAddChip' onClick={() => openAdd(panel.kind)}><Plus size={13} />Add</button>
              </div>
              {panel.groups.length === 0 ? (
                <div className='nwEmpty small'><p>No {panel.title.toLowerCase()} yet.</p></div>
              ) : (
                <div className='nwGroups'>
                  {panel.groups.map(([category, bucket]) => (
                    <div className='nwGroup' key={category}>
                      <div className='nwGroupHead'>
                        <span className='nwGroupChip'>{CATEGORY_ICON[category] || <Layers size={15} />}{category}</span>
                        <span className='nwGroupSub'>{money(bucket.subtotal)}</span>
                      </div>
                      {bucket.items.map((it) => (
                        <div className='nwRow' key={it.id}>
                          <span className='nwRowName'>{it.name}{it.linked ? <span className='nwLinked'><Link2 size={11} />Linked</span> : null}</span>
                          <span className={`nwRowValue ${panel.kind === 'asset' ? 'pos' : 'neg'}`}>{money(it.value)}</span>
                          {it.linked ? (
                            onOpenInvestments ? <button className='nwRowIcon' onClick={onOpenInvestments} title='Open Investments'><ArrowUpRight size={14} /></button> : <span className='nwRowSpacer' />
                          ) : (
                            <div className='nwMenuWrap'>
                              <button className='nwRowIcon' onClick={(e) => { e.stopPropagation(); setOpenMenuId((c) => (c === it.id ? null : it.id)) }}>⋯</button>
                              {openMenuId === it.id ? (
                                <div className='nwMenu' onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => { setOpenMenuId(null); openEdit(it) }}><Pencil size={14} /> Edit</button>
                                  <button className='dangerText' onClick={() => { setOpenMenuId(null); setItemToDelete(it) }}><Trash2 size={14} /> Delete</button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    )}

    {/* ---------- Add / edit modal ---------- */}
    {modalOpen ? (
      <div className='deleteConfirmBackdrop' role='presentation' onClick={closeModal}>
        <div className='card nwModal' role='dialog' aria-modal='true' aria-labelledby='nw-modal-title' onClick={(e) => e.stopPropagation()}>
          <h3 id='nw-modal-title'>{editing ? 'Edit entry' : 'Add entry'}</h3>
          <div className='nwSegmented'>
            <button className={draftKind === 'asset' ? 'active asset' : ''} onClick={() => { setDraftKind('asset'); if (!ASSET_CATEGORIES.includes(draftCategory as typeof ASSET_CATEGORIES[number])) setDraftCategory('Cash') }}>Asset</button>
            <button className={draftKind === 'liability' ? 'active liab' : ''} onClick={() => { setDraftKind('liability'); if (!LIABILITY_CATEGORIES.includes(draftCategory as typeof LIABILITY_CATEGORIES[number])) setDraftCategory('Credit Card') }}>Liability</button>
          </div>
          <label className='fieldLabel'>Category</label>
          <select className='input' value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
            {draftCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className='fieldLabel'>Name</label>
          <input className='input' placeholder={draftKind === 'asset' ? 'e.g., Chequing account' : 'e.g., Visa card'} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          <label className='fieldLabel'>{draftKind === 'asset' ? 'Value' : 'Balance owed'} ({currency})</label>
          <input className='input' inputMode='decimal' placeholder='0.00' value={draftValue} onChange={(e) => setDraftValue(e.target.value)} />
          <label className='fieldLabel'>Note (optional)</label>
          <input className='input' placeholder='Add a note' value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
          <div className='nwModalActions'>
            <button className='nwGhostBtn' onClick={closeModal}>Cancel</button>
            <button className='nwPrimaryBtn' onClick={() => void saveItem()}>{editing ? 'Save changes' : 'Add entry'}</button>
          </div>
        </div>
      </div>
    ) : null}

    {itemToDelete ? (
      <div className='deleteConfirmBackdrop' role='presentation'>
        <div className='card deleteConfirmModal' role='dialog' aria-modal='true' aria-labelledby='nw-delete-title'>
          <div className='deleteConfirmIcon' aria-hidden='true'>!</div>
          <h3 id='nw-delete-title'>Delete entry?</h3>
          <p className='muted'>This will permanently remove <strong>{itemToDelete.name}</strong> from your net worth. This cannot be undone.</p>
          <div className='deleteConfirmActions'>
            <button className='btn' onClick={() => !deleting && setItemToDelete(null)} disabled={deleting}>Cancel</button>
            <button className='btn danger' onClick={() => void confirmDelete()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      </div>
    ) : null}
  </section>
}
