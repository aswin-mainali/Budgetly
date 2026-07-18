import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Banknote, Building2, Car, CreditCard, GraduationCap, Home, Landmark, LineChart as LineChartIcon, Link2, Loader, PiggyBank, Plus, Scale, Shield, TrendingDown, TrendingUp, Wallet, Pencil, Trash2, Layers } from 'lucide-react'
import { Area, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

type Kind = 'asset' | 'liability'
type NWItem = { id: string; kind: Kind; category: string; name: string; value: number; notes: string | null; linked?: boolean }
type NWSnapshot = { id?: string; date_key: string; total_assets: number; total_liabilities: number; net_worth: number }

const ASSET_CATEGORIES = ['Cash', 'Investments', 'Real Estate', 'Vehicles', 'Retirement', 'Other'] as const
const LIABILITY_CATEGORIES = ['Credit Card', 'Loan', 'Mortgage', 'Student Loan', 'Other'] as const

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  Cash: <Banknote size={16} />, Investments: <TrendingUp size={16} />, 'Real Estate': <Home size={16} />,
  Vehicles: <Car size={16} />, Retirement: <PiggyBank size={16} />, Other: <Layers size={16} />,
  'Credit Card': <CreditCard size={16} />, Loan: <Landmark size={16} />, Mortgage: <Building2 size={16} />,
  'Student Loan': <GraduationCap size={16} />,
}

// Distinct palettes so assets read green-ish and liabilities read warm/red-ish.
const ASSET_COLORS = ['#21c97a', '#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6']
const LIABILITY_COLORS = ['#f87171', '#fb923c', '#f59e0b', '#e879f9', '#94a3b8']
const RANGE_DAYS = { '3M': 92, '6M': 183, '1Y': 366 } as const
const todayKey = () => new Date().toISOString().slice(0, 10)

const isInvalidRefreshTokenError = (error: unknown) =>
  /invalid refresh token|refresh token not found/i.test(String((error as { message?: string })?.message || error || ''))
const toast = (message: string) => window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))

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
  const coverage = totalLiabilities > 0 ? totalAssets / totalLiabilities : 0

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

  // Snapshot history + month-over-month delta.
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
    // Keep today's snapshot in sync with the new totals.
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

  return <section className='netWorthPage'>
    <header className='nwTop'>
      <div>
        <h2>Net Worth</h2>
        <p className='muted'>Everything you own, minus everything you owe.</p>
      </div>
      <div className='nwTopActions'>
        <span className='nwCurrencyPill'>{currency}</span>
        <button className='btn nwBtnSecondary' onClick={() => void recordSnapshot()} disabled={savingSnapshot || !hasData}>
          {savingSnapshot ? <Loader size={16} className='nwSpin' /> : <LineChartIcon size={16} />}{savingSnapshot ? 'Saving…' : 'Record snapshot'}
        </button>
        <button className='btn nwBtnPrimary' onClick={() => openAdd('asset')}><Plus size={16} />Add entry</button>
      </div>
    </header>

    <div className='nwKpis'>
      <div className='card nwKpi nwKpiHero'>
        <div className='nwKpiLabel'><Scale size={15} /> Net Worth</div>
        <div className='nwKpiHeroValue'>{money(netWorth)}</div>
        {delta ? (
          <div className={`nwDelta ${delta.diff >= 0 ? 'pos' : 'neg'}`}>
            {delta.diff >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            {money(Math.abs(delta.diff))} ({delta.diff >= 0 ? '+' : '−'}{Math.abs(delta.pct).toFixed(1)}%) <span className='muted'>since last snapshot</span>
          </div>
        ) : <div className='nwDelta muted'>Record snapshots to track your trend</div>}
      </div>
      <div className='card nwKpi'>
        <div className='nwKpiLabel'><Wallet size={15} /> Total Assets</div>
        <div className='nwKpiValue pos'>{money(totalAssets)}</div>
        <div className='muted'>{assets.length} {assets.length === 1 ? 'item' : 'items'}</div>
      </div>
      <div className='card nwKpi'>
        <div className='nwKpiLabel'><CreditCard size={15} /> Total Liabilities</div>
        <div className='nwKpiValue neg'>{money(totalLiabilities)}</div>
        <div className='muted'>{liabilities.length} {liabilities.length === 1 ? 'item' : 'items'}</div>
      </div>
      <div className='card nwKpi'>
        <div className='nwKpiLabel'><Shield size={15} /> Health</div>
        <div className='nwKpiValue'>{totalLiabilities > 0 ? `${coverage.toFixed(1)}×` : '∞'}</div>
        <div className='muted'>{totalLiabilities > 0 ? 'assets cover debts' : 'no liabilities'}</div>
      </div>
    </div>

    <div className='nwGridTop'>
      <div className='card nwCard nwTrendCard'>
        <div className='nwCardHead'>
          <h3>Net Worth Over Time</h3>
          <div className='nwRanges'>
            {(['3M', '6M', '1Y', 'All'] as const).map((r) => (
              <button key={r} className={`btn tiny nwRange ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        {chartData.length < 2 ? (
          <div className='nwEmpty'>
            <LineChartIcon size={28} />
            <p>{history.length === 0 ? 'Record your first snapshot to start your net-worth trend.' : 'Not enough history for this range yet. Record snapshots over time to build your trend.'}</p>
          </div>
        ) : (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width='100%' height='100%'>
              <ComposedChart data={chartData}>
                <defs>
                  <linearGradient id='nwAssetsArea' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='5%' stopColor='#21c97a' stopOpacity={0.25} />
                    <stop offset='95%' stopColor='#21c97a' stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray='4 4' stroke='rgba(148,163,184,.25)' />
                <XAxis dataKey='date' tickFormatter={(v) => new Date(String(v)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} minTickGap={28} />
                <YAxis tickFormatter={(v) => money(Number(v))} width={92} />
                <Tooltip content={<TrendTooltip />} />
                <Area type='monotone' dataKey='assets' stroke='none' fill='url(#nwAssetsArea)' />
                <Line type='monotone' dataKey='liabilities' stroke='#f87171' strokeWidth={2} strokeDasharray='6 6' dot={false} />
                <Line type='monotone' dataKey='netWorth' stroke='#21c97a' strokeWidth={3} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className='nwTrendLegend'>
          <span><i className='solid' />Net worth</span>
          <span><i className='area' />Assets</span>
          <span><i className='dash' />Liabilities</span>
        </div>
      </div>

      <div className='card nwCard nwCompositionCard'>
        <h3>Asset Composition</h3>
        {donutData.length === 0 ? (
          <div className='nwEmpty'><Wallet size={28} /><p>Add assets to see how your wealth is allocated.</p></div>
        ) : (
          <>
            <div className='nwDonutWrap'>
              <ResponsiveContainer width='100%' height={200}>
                <PieChart>
                  <Pie data={donutData} dataKey='value' innerRadius={62} outerRadius={90} paddingAngle={2} stroke='none'>
                    {donutData.map((_, i) => <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className='nwDonutCenter'><strong>{money(netWorth)}</strong><small>Net worth</small></div>
            </div>
            <div className='nwLegend'>
              {donutData.map((d, i) => (
                <div className='nwLegendItem' key={d.name}>
                  <span className='nwDot' style={{ background: ASSET_COLORS[i % ASSET_COLORS.length] }} />
                  <span className='nwLegendName'>{d.name}</span>
                  <strong>{totalAssets > 0 ? ((d.value / totalAssets) * 100).toFixed(0) : 0}%</strong>
                </div>
              ))}
            </div>
            <div className='nwSplitBar' aria-hidden='true'>
              <div className='nwSplitAssets' style={{ flex: Math.max(totalAssets, 0.001) }} />
              <div className='nwSplitLiab' style={{ flex: Math.max(totalLiabilities, 0.001) }} />
            </div>
            <div className='nwSplitLegend'><span className='pos'>Assets {money(totalAssets)}</span><span className='neg'>Liabilities {money(totalLiabilities)}</span></div>
          </>
        )}
      </div>
    </div>

    <div className='nwGridBottom'>
      {([
        { title: 'Assets', kind: 'asset' as Kind, groups: assetGroups, colors: ASSET_COLORS },
        { title: 'Liabilities', kind: 'liability' as Kind, groups: liabilityGroups, colors: LIABILITY_COLORS },
      ]).map((panel) => (
        <div className='card nwCard nwListCard' key={panel.title}>
          <div className='nwCardHead'>
            <h3>{panel.title} <span className='nwListTotal'>{money(panel.kind === 'asset' ? totalAssets : totalLiabilities)}</span></h3>
            <button className='btn tiny nwAddSmall' onClick={() => openAdd(panel.kind)}><Plus size={14} />Add</button>
          </div>
          {panel.groups.length === 0 ? (
            <div className='nwEmpty small'><p>No {panel.title.toLowerCase()} yet.</p></div>
          ) : (
            <div className='nwGroups'>
              {panel.groups.map(([category, bucket]) => (
                <div className='nwGroup' key={category}>
                  <div className='nwGroupHead'>
                    <span className='nwGroupIcon'>{CATEGORY_ICON[category] || <Layers size={16} />}</span>
                    <span className='nwGroupName'>{category}</span>
                    <span className='nwGroupSub'>{money(bucket.subtotal)}</span>
                  </div>
                  {bucket.items.map((it) => (
                    <div className='nwRow' key={it.id}>
                      <div className='nwRowMain'>
                        <span className='nwRowName'>{it.name}{it.linked ? <span className='nwLinkedBadge'><Link2 size={11} />Linked</span> : null}</span>
                      </div>
                      <span className={`nwRowValue ${panel.kind === 'asset' ? 'pos' : 'neg'}`}>{money(it.value)}</span>
                      {it.linked ? (
                        onOpenInvestments ? <button className='btn tiny nwRowLink' onClick={onOpenInvestments} title='Open Investments'><ArrowUpRight size={14} /></button> : <span className='nwRowSpacer' />
                      ) : (
                        <div className='nwMenuWrap'>
                          <button className='btn tiny nwMenuDots' onClick={() => setOpenMenuId((c) => (c === it.id ? null : it.id))}>⋯</button>
                          {openMenuId === it.id ? (
                            <div className='nwMenu'>
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

    {!hasData && !loading ? (
      <div className='card nwFirstRun'>
        <PiggyBank size={30} />
        <h3>Start tracking your net worth</h3>
        <p className='muted'>Add what you own (cash, property, vehicles) and what you owe (loans, cards). Your Investments portfolio is pulled in automatically.</p>
        <div className='nwFirstRunActions'>
          <button className='btn nwBtnPrimary' onClick={() => openAdd('asset')}><Plus size={16} />Add an asset</button>
          <button className='btn nwBtnSecondary' onClick={() => openAdd('liability')}><Plus size={16} />Add a liability</button>
        </div>
      </div>
    ) : null}

    {modalOpen ? (
      <div className='deleteConfirmBackdrop' role='presentation' onClick={closeModal}>
        <div className='card nwModal' role='dialog' aria-modal='true' aria-labelledby='nw-modal-title' onClick={(e) => e.stopPropagation()}>
          <h3 id='nw-modal-title'>{editing ? 'Edit entry' : 'Add entry'}</h3>
          <div className='nwSegmented'>
            <button className={draftKind === 'asset' ? 'active' : ''} onClick={() => { setDraftKind('asset'); if (!ASSET_CATEGORIES.includes(draftCategory as typeof ASSET_CATEGORIES[number])) setDraftCategory('Cash') }}>Asset</button>
            <button className={draftKind === 'liability' ? 'active' : ''} onClick={() => { setDraftKind('liability'); if (!LIABILITY_CATEGORIES.includes(draftCategory as typeof LIABILITY_CATEGORIES[number])) setDraftCategory('Credit Card') }}>Liability</button>
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
            <button className='btn' onClick={closeModal}>Cancel</button>
            <button className='btn nwBtnPrimary' onClick={() => void saveItem()}>{editing ? 'Save changes' : 'Add entry'}</button>
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
