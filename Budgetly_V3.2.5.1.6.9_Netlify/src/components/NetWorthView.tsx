import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Info, Landmark, Layers, Pencil, Plus, Scale, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'

type ItemKind = 'asset' | 'liability'
type NetWorthItem = {
  id: string
  user_id?: string
  kind: ItemKind
  category: string
  name: string
  value: number
  notes: string | null
  created_at?: string | null
  updated_at?: string | null
}
type Snapshot = { date_key: string; total_assets: number; total_liabilities: number; net_worth: number }

const ASSET_CATEGORIES = ['Cash', 'Chequing', 'Savings', 'Investments', 'Retirement', 'Real Estate', 'Vehicle', 'Business', 'Crypto', 'Other']
const LIABILITY_CATEGORIES = ['Credit Card', 'Mortgage', 'Student Loan', 'Auto Loan', 'Personal Loan', 'Line of Credit', 'Other']

const ASSET_COLORS = ['#2563eb', '#22c55e', '#7c3aed', '#0ea5e9', '#14b8a6', '#6366f1', '#f59e0b', '#ec4899', '#10b981', '#64748b']
const LIABILITY_COLORS = ['#ef4444', '#f97316', '#f43f5e', '#e11d48', '#dc2626', '#fb7185', '#b91c1c']

const RANGE_DAYS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 } as const

const money = (v: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CAD' }).format(Number.isFinite(v) ? v : 0)
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(Number.isFinite(v) ? v : 0).toFixed(1)}%`
const todayKey = () => new Date().toISOString().slice(0, 10)

export function NetWorthView() {
  const [items, setItems] = useState<NetWorthItem[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'asset' | 'liability'>('all')
  const [range, setRange] = useState<'1M' | '3M' | '6M' | 'YTD' | '1Y' | 'All'>('6M')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [authInvalid, setAuthInvalid] = useState(false)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<NetWorthItem | null>(null)
  const [draftKind, setDraftKind] = useState<ItemKind>('asset')
  const [draftCategory, setDraftCategory] = useState('Cash')
  const [draftName, setDraftName] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [openActionId, setOpenActionId] = useState<string | null>(null)
  const [itemToDelete, setItemToDelete] = useState<NetWorthItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const safeItems = Array.isArray(items) ? items : []
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : []

  const isInvalidRefreshTokenError = (error: unknown) => /invalid refresh token|refresh token not found/i.test(String((error as { message?: string })?.message || error || ''))

  const handleInvalidSession = useCallback(async () => {
    setAuthInvalid(true)
    setItems([])
    setSnapshots([])
    setErrorMsg('Your session expired. Please sign in again.')
    try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Your session expired. Please sign in again.' } }))
  }, [])

  const upsertSnapshot = async (uid: string | null, nextItems: NetWorthItem[]) => {
    if (!uid || authInvalid) return
    const totalAssets = nextItems.filter((i) => i.kind === 'asset').reduce((s, i) => s + Number(i.value || 0), 0)
    const totalLiabilities = nextItems.filter((i) => i.kind === 'liability').reduce((s, i) => s + Number(i.value || 0), 0)
    const netWorth = totalAssets - totalLiabilities
    await supabase.from('net_worth_snapshots').upsert({
      user_id: uid,
      date_key: todayKey(),
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      net_worth: netWorth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date_key' })
  }

  const load = async (uid: string | null = userId) => {
    if (!uid || authInvalid) { setItems([]); setSnapshots([]); return }
    setLoading(true)
    setErrorMsg(null)
    const [i, s] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', uid).order('date_key', { ascending: true }),
    ])
    if (i.error || s.error) {
      const firstError = i.error || s.error
      if (isInvalidRefreshTokenError(firstError)) { await handleInvalidSession(); setLoading(false); return }
      console.error('Failed to load net worth:', firstError)
      setItems([]); setSnapshots([])
      setErrorMsg('Failed to load net worth. Please refresh.')
      setLoading(false)
      return
    }
    const nextItems = Array.isArray(i.data) ? (i.data as NetWorthItem[]) : []
    const nextSnapshots = Array.isArray(s.data) ? (s.data as Snapshot[]) : []
    setItems(nextItems)
    setSnapshots(nextSnapshots)
    if (nextItems.length > 0 && !nextSnapshots.some((snap) => snap.date_key === todayKey())) {
      await upsertSnapshot(uid, nextItems)
    }
    setLoading(false)
  }

  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        const id = data.user?.id ?? null
        setUserId(id)
        if (!id) { setItems([]); setSnapshots([]); return }
        await load(id)
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) { await handleInvalidSession(); return }
        console.error('Failed to initialize net worth auth:', error)
      }
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleInvalidSession])

  const assets = useMemo(() => safeItems.filter((i) => i.kind === 'asset'), [safeItems])
  const liabilities = useMemo(() => safeItems.filter((i) => i.kind === 'liability'), [safeItems])
  const totals = useMemo(() => {
    const totalAssets = assets.reduce((s, i) => s + Number(i.value || 0), 0)
    const totalLiabilities = liabilities.reduce((s, i) => s + Number(i.value || 0), 0)
    return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities }
  }, [assets, liabilities])

  const filtered = useMemo(() => {
    const list = filter === 'all' ? safeItems : safeItems.filter((i) => i.kind === filter)
    return [...list].sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
  }, [safeItems, filter])

  const allocation = useMemo(() => {
    const source = filter === 'liability' ? liabilities : assets
    const byCategory = new Map<string, number>()
    source.forEach((i) => byCategory.set(i.category, (byCategory.get(i.category) || 0) + Number(i.value || 0)))
    const total = Array.from(byCategory.values()).reduce((s, v) => s + v, 0)
    const palette = filter === 'liability' ? LIABILITY_COLORS : ASSET_COLORS
    return {
      total,
      isLiability: filter === 'liability',
      rows: Array.from(byCategory.entries())
        .map(([category, value], idx) => ({ category, value, color: palette[idx % palette.length] }))
        .sort((a, b) => b.value - a.value),
    }
  }, [assets, liabilities, filter])

  const normalizedSnapshots = useMemo(() => safeSnapshots.map((s) => ({
    date: s.date_key,
    assets: Number(s.total_assets || 0),
    liabilities: Number(s.total_liabilities || 0),
    netWorth: Number(s.net_worth ?? (Number(s.total_assets || 0) - Number(s.total_liabilities || 0))),
  })), [safeSnapshots])

  const chartData = useMemo(() => {
    if (range === 'All') return normalizedSnapshots
    const start = new Date()
    if (range === 'YTD') start.setMonth(0, 1)
    else start.setDate(start.getDate() - RANGE_DAYS[range])
    start.setHours(0, 0, 0, 0)
    return normalizedSnapshots.filter((x) => new Date(x.date) >= start)
  }, [range, normalizedSnapshots])

  const chartSeries = useMemo(() => chartData.map((point) => ({ ...point, label: point.date })), [chartData])

  const periodStats = useMemo(() => {
    if (chartSeries.length < 2) return null
    const first = chartSeries[0].netWorth
    const last = chartSeries[chartSeries.length - 1].netWorth
    const change = last - first
    const changePercent = first !== 0 ? (change / Math.abs(first)) * 100 : 0
    return { change, changePercent }
  }, [chartSeries])

  const formatChartDate = (dateKey: string) => {
    const d = new Date(dateKey)
    if (Number.isNaN(d.getTime())) return dateKey
    if (range === '1M') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  }

  const NetWorthTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const netWorth = Number(payload.find((p: any) => p.dataKey === 'netWorth')?.value || 0)
    const assetsVal = Number(payload.find((p: any) => p.dataKey === 'assets')?.value || 0)
    const liabilitiesVal = Number(payload.find((p: any) => p.dataKey === 'liabilities')?.value || 0)
    return <div className='investChartTooltip'>
      <div className='investChartTooltipDate'>{formatChartDate(String(label))}</div>
      <div className='investChartTooltipRow'><span>Net Worth</span><strong className={netWorth >= 0 ? 'pos' : 'neg'}>{money(netWorth)}</strong></div>
      <div className='investChartTooltipRow'><span>Assets</span><strong>{money(assetsVal)}</strong></div>
      <div className='investChartTooltipRow'><span>Liabilities</span><strong>{money(liabilitiesVal)}</strong></div>
    </div>
  }

  const resetModal = () => {
    setEditing(null)
    setDraftKind('asset')
    setDraftCategory('Cash')
    setDraftName('')
    setDraftValue('')
    setDraftNotes('')
  }

  const openAdd = (kind: ItemKind = 'asset') => {
    resetModal()
    setDraftKind(kind)
    setDraftCategory(kind === 'asset' ? ASSET_CATEGORIES[0] : LIABILITY_CATEGORIES[0])
    setOpen(true)
  }

  const openEdit = (item: NetWorthItem) => {
    setEditing(item)
    setDraftKind(item.kind)
    setDraftCategory(item.category)
    setDraftName(item.name)
    setDraftValue(String(item.value))
    setDraftNotes(item.notes || '')
    setOpen(true)
  }

  const changeKind = (kind: ItemKind) => {
    setDraftKind(kind)
    const list = kind === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES
    if (!list.includes(draftCategory)) setDraftCategory(list[0])
  }

  const saveItem = async () => {
    if (!userId || saving) return
    const value = Number(draftValue)
    if (!draftName.trim()) { window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Enter a name for this item.' } })); return }
    if (!Number.isFinite(value) || value < 0) { window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Enter a valid amount (0 or more).' } })); return }
    setSaving(true)
    const payload = {
      user_id: userId,
      kind: draftKind,
      category: draftCategory,
      name: draftName.trim(),
      value,
      notes: draftNotes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editing
      ? await supabase.from('net_worth_items').update(payload).eq('id', editing.id).eq('user_id', userId)
      : await supabase.from('net_worth_items').insert(payload)
    if (error) {
      console.error('Failed to save net worth item:', error)
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: error.message || 'Failed to save item.' } }))
      setSaving(false)
      return
    }
    const nextItem = { ...payload, id: editing?.id || 'temp' } as NetWorthItem
    const nextItems = editing ? safeItems.map((i) => (i.id === editing.id ? nextItem : i)) : [...safeItems, nextItem]
    await upsertSnapshot(userId, nextItems)
    setSaving(false)
    setOpen(false)
    resetModal()
    void load()
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: editing ? 'Item updated.' : 'Item added.' } }))
  }

  const deleteItem = async () => {
    if (!itemToDelete || !userId || deleting) return
    setDeleting(true)
    const { error } = await supabase.from('net_worth_items').delete().eq('id', itemToDelete.id).eq('user_id', userId)
    if (error) {
      console.error('Failed to delete net worth item:', error)
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Failed to delete item.' } }))
      setDeleting(false)
      return
    }
    await upsertSnapshot(userId, safeItems.filter((i) => i.id !== itemToDelete.id))
    setItemToDelete(null)
    setDeleting(false)
    void load()
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Item deleted.' } }))
  }

  const categoryOptions = draftKind === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES

  return <section className='netWorthPage investmentsPage investRef'>
    <header className='investTop'>
      <div>
        <h2>Net Worth</h2>
        <p className='muted'>Track everything you own and owe to see your true financial picture over time.</p>
      </div>
      <div className='investTopActions'>
        <select className='input investControl' value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value='all'>All Items</option>
          <option value='asset'>Assets</option>
          <option value='liability'>Liabilities</option>
        </select>
        <button className='btn investBtnSecondary' onClick={() => openAdd('liability')}><ArrowDownRight size={16} />Add Liability</button>
        <button className='btn investBtnPrimary' onClick={() => openAdd('asset')}><Plus size={16} />Add Asset</button>
      </div>
    </header>

    {errorMsg ? <div className='card refCard netWorthError'>{errorMsg}</div> : null}

    <div className='investKpis netWorthKpis'>
      <div className='card investKpi refCard netWorthKpi feature'>
        <div className='netWorthKpiHead'>
          <div className='investKpiLabel'>Net Worth</div>
          <div className='investKpiBubble nwBubbleIndigo'><Scale size={16} /></div>
        </div>
        <div className={`investKpiValue ${totals.netWorth > 0 ? 'pos' : totals.netWorth < 0 ? 'neg' : ''}`}>{money(totals.netWorth)}</div>
        {periodStats ? (
          <div className={`netWorthKpiTrend ${periodStats.change >= 0 ? 'pos' : 'neg'}`}>
            {periodStats.change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            <span>{pct(periodStats.changePercent)} this period</span>
          </div>
        ) : <div className='muted netWorthKpiSub'>As of {new Date().toLocaleDateString()}</div>}
      </div>
      <div className='card investKpi refCard netWorthKpi'>
        <div className='netWorthKpiHead'>
          <div className='investKpiLabel'>Total Assets</div>
          <div className='investKpiBubble nwBubbleGreen'><TrendingUp size={16} /></div>
        </div>
        <div className='investKpiValue pos'>{money(totals.totalAssets)}</div>
        <div className='muted netWorthKpiSub'>{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</div>
      </div>
      <div className='card investKpi refCard netWorthKpi'>
        <div className='netWorthKpiHead'>
          <div className='investKpiLabel'>Total Liabilities</div>
          <div className='investKpiBubble nwBubbleRed'><TrendingDown size={16} /></div>
        </div>
        <div className='investKpiValue neg'>{money(totals.totalLiabilities)}</div>
        <div className='muted netWorthKpiSub'>{liabilities.length} {liabilities.length === 1 ? 'liability' : 'liabilities'}</div>
      </div>
      <div className='card investKpi refCard netWorthKpi'>
        <div className='netWorthKpiHead'>
          <div className='investKpiLabel'>Debt Ratio</div>
          <div className='investKpiBubble nwBubbleAmber'><Landmark size={16} /></div>
        </div>
        <div className='investKpiValue'>{totals.totalAssets > 0 ? `${((totals.totalLiabilities / totals.totalAssets) * 100).toFixed(0)}%` : '—'}</div>
        <div className='muted netWorthKpiSub'>Liabilities vs assets</div>
      </div>
      <div className='card investKpi refCard netWorthKpi'>
        <div className='netWorthKpiHead'>
          <div className='investKpiLabel'>Items Tracked</div>
          <div className='investKpiBubble nwBubbleViolet'><Layers size={16} /></div>
        </div>
        <div className='investKpiValue'>{safeItems.length}</div>
        <div className='muted netWorthKpiSub'>Across all categories</div>
      </div>
    </div>

    <div className='investGridTop'>
      <div className='card refCard'>
        <h3>{filter === 'asset' ? 'Assets' : filter === 'liability' ? 'Liabilities' : 'Assets & Liabilities'}</h3>
        {loading && safeItems.length === 0 ? <div className='investEmpty'>Loading your net worth…</div> : filtered.length === 0 ? (
          <div className='investEmpty'>No items yet.<br />Add an asset or liability to start tracking your net worth.</div>
        ) : (
          <div className='netWorthTableWrap'>
          <table className='table netWorthTable'>
            <thead><tr><th>Item</th><th>Type</th><th>Category</th><th>Value</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className='holdingCell holdingCellAlign'>
                      <span className={`netWorthGlyph ${item.kind}`}>{item.kind === 'asset' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</span>
                      <div><strong>{item.name}</strong>{item.notes ? <div className='muted'>{item.notes}</div> : null}</div>
                    </div>
                  </td>
                  <td><span className={`netWorthTag ${item.kind}`}>{item.kind === 'asset' ? 'Asset' : 'Liability'}</span></td>
                  <td>{item.category}</td>
                  <td className={item.kind === 'asset' ? 'pos' : 'neg'}>{item.kind === 'liability' ? '−' : ''}{money(item.value)}</td>
                  <td>
                    <div className='actionsMenuWrap'>
                      <button className='btn tiny investAction menuDots' onClick={() => setOpenActionId((c) => (c === item.id ? null : item.id))}>⋯</button>
                      {openActionId === item.id ? (
                        <div className='actionsMenu'>
                          <button onClick={() => { setOpenActionId(null); openEdit(item) }}><Pencil size={14} /> Edit</button>
                          <button className='dangerText' onClick={() => { setOpenActionId(null); setItemToDelete(item) }}><Trash2 size={14} /> Delete</button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className='card refCard'>
        <h3>{allocation.isLiability ? 'Liability Breakdown' : 'Asset Allocation'}</h3>
        {allocation.rows.length === 0 ? (
          <div className='investEmpty'>{allocation.isLiability ? 'Liability breakdown will appear once you add liabilities.' : 'Asset allocation will appear once you add assets.'}</div>
        ) : (
          <div className='allocWrap'>
            <div className='allocChart'>
              <ResponsiveContainer width='100%' height={260}>
                <PieChart>
                  <Pie data={allocation.rows} dataKey='value' nameKey='category' innerRadius={72} outerRadius={102}>
                    {allocation.rows.map((row) => <Cell key={row.category} fill={row.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className='allocCenter'><strong>{money(allocation.total)}</strong><small>{allocation.isLiability ? 'Total Owed' : 'Total Assets'}</small></div>
            </div>
            <div>
              {allocation.rows.map((row) => (
                <div className='allocLegendItem' key={row.category}>
                  <span className='dot' style={{ background: row.color }} />
                  <div><div>{row.category}</div><small>{money(row.value)}</small></div>
                  <strong>{((row.value / Math.max(1, allocation.total)) * 100).toFixed(1)}%</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

    <div className='investGridBottom'>
      <div className='card refCard'>
        <h3>Balance Summary</h3>
        <div className='netWorthSummary'>
          <div className='netWorthSummaryRow'><span><span className='netWorthDot asset' />Total Assets</span><strong className='pos'>{money(totals.totalAssets)}</strong></div>
          <div className='netWorthBar'><div className='netWorthBarFill asset' style={{ width: `${totals.totalAssets + totals.totalLiabilities > 0 ? (totals.totalAssets / (totals.totalAssets + totals.totalLiabilities)) * 100 : 0}%` }} /></div>
          <div className='netWorthSummaryRow'><span><span className='netWorthDot liability' />Total Liabilities</span><strong className='neg'>{money(totals.totalLiabilities)}</strong></div>
          <div className='netWorthBar'><div className='netWorthBarFill liability' style={{ width: `${totals.totalAssets + totals.totalLiabilities > 0 ? (totals.totalLiabilities / (totals.totalAssets + totals.totalLiabilities)) * 100 : 0}%` }} /></div>
          <div className='netWorthSummaryDivider' />
          <div className='netWorthSummaryRow total'><span>Net Worth</span><strong className={totals.netWorth >= 0 ? 'pos' : 'neg'}>{money(totals.netWorth)}</strong></div>
        </div>
      </div>

      <div className='card refCard investTrendCard'>
        <div className='investTrendHead'>
          <div>
            <h3 className='investTrendTitle'>Net Worth Over Time <Info size={14} /></h3>
            {periodStats ? (
              <div className={`investTrendBadge ${periodStats.change >= 0 ? 'pos' : 'neg'}`}>
                {periodStats.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <strong>{money(periodStats.change)} ({pct(periodStats.changePercent)})</strong>
                <span>over selected period</span>
              </div>
            ) : null}
          </div>
          <div className='row gap investTrendRanges'>
            {(['1M', '3M', '6M', 'YTD', '1Y', 'All'] as const).map((r) => (
              <button key={r} className={`btn tiny investRange ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        {chartSeries.length < 2 ? (
          <div className='chartEmpty'><div className='chartGrid' /><p>{chartSeries.length === 0 ? 'No net worth history for this range yet.' : 'Not enough history yet. Your trend builds as you update items over time.'}</p></div>
        ) : (
          <>
            <div style={{ height: 360 }}>
              <ResponsiveContainer width='100%' height='100%'>
                <ComposedChart data={chartSeries}>
                  <defs>
                    <linearGradient id='netWorthArea' x1='0' y1='0' x2='0' y2='1'>
                      <stop offset='5%' stopColor='#2563eb' stopOpacity={0.28} />
                      <stop offset='95%' stopColor='#2563eb' stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray='4 4' stroke='rgba(148,163,184,.35)' />
                  <XAxis dataKey='label' tickFormatter={(v) => formatChartDate(String(v))} minTickGap={24} />
                  <YAxis tickFormatter={(v) => money(Number(v))} width={92} />
                  <Tooltip content={<NetWorthTooltip />} />
                  <Area type='monotone' dataKey='netWorth' stroke='none' fill='url(#netWorthArea)' />
                  <Line type='monotone' dataKey='netWorth' stroke='#1d4ed8' strokeWidth={3} dot={false} />
                  <Line type='monotone' dataKey='assets' stroke='#22c55e' strokeWidth={2} strokeDasharray='6 6' dot={false} />
                  <Line type='monotone' dataKey='liabilities' stroke='#ef4444' strokeWidth={2} strokeDasharray='6 6' dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className='investTrendLegend'>
              <span><i className='solid' />Net Worth</span>
              <span><i className='dash' style={{ borderTopColor: '#22c55e' }} />Assets</span>
              <span><i className='dash' style={{ borderTopColor: '#ef4444' }} />Liabilities</span>
            </div>
          </>
        )}
      </div>
    </div>

    {open ? (
      <div className='idleModalBackdrop'>
        <div className='card investModal refModal mobileAddModal netWorthModal'>
          <div className='addHoldTop'><span /><button className='iconPlain' onClick={() => { setOpen(false); resetModal() }}>✕</button></div>
          <div className='addHoldTitle'>{editing ? 'Edit item' : draftKind === 'asset' ? 'Add asset' : 'Add liability'}</div>

          <div className='netWorthKindToggle'>
            <button type='button' className={draftKind === 'asset' ? 'active' : ''} onClick={() => changeKind('asset')}><ArrowUpRight size={15} /> Asset</button>
            <button type='button' className={draftKind === 'liability' ? 'active' : ''} onClick={() => changeKind('liability')}><ArrowDownRight size={15} /> Liability</button>
          </div>

          <label className='fieldLabel'>Name</label>
          <input className='input' placeholder={draftKind === 'asset' ? 'e.g., Savings Account, Home, Car' : 'e.g., Visa Credit Card, Mortgage'} value={draftName} onChange={(e) => setDraftName(e.target.value)} />

          <label className='fieldLabel'>Category</label>
          <select className='input' value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <label className='fieldLabel'>{draftKind === 'asset' ? 'Current Value' : 'Amount Owed'}</label>
          <div className='currencyWrap'><input className='input' inputMode='decimal' placeholder='0.00' value={draftValue} onChange={(e) => setDraftValue(e.target.value)} /></div>

          <label className='fieldLabel'>Notes (Optional)</label>
          <input className='input' placeholder='Add a note' value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />

          <div className='mobileFooter'>
            <button className='btn' onClick={() => { setOpen(false); resetModal() }}>Cancel</button>
            <button className='btn savePeach' disabled={saving || !draftName.trim() || draftValue.trim() === ''} onClick={() => void saveItem()}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    ) : null}

    {itemToDelete ? (
      <div className='deleteConfirmBackdrop' role='presentation'>
        <div className='card deleteConfirmModal' role='dialog' aria-modal='true' aria-labelledby='net-worth-delete-title'>
          <div className='deleteConfirmIcon' aria-hidden='true'>!</div>
          <h3 id='net-worth-delete-title'>Delete item?</h3>
          <p className='muted'>This will permanently remove this item from your net worth tracker. This cannot be undone.</p>
          <p className='muted'><strong>{itemToDelete.name} — {money(itemToDelete.value)}</strong></p>
          <div className='deleteConfirmActions'>
            <button className='btn' onClick={() => !deleting && setItemToDelete(null)} disabled={deleting}>Cancel</button>
            <button className='btn danger' onClick={() => void deleteItem()} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
          </div>
        </div>
      </div>
    ) : null}
  </section>
}
