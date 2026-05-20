import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { getBatchQuotes, searchSecurities, type SecuritySuggestion } from '../services/marketData'

type Account = { id: string; name: string; type: string; provider: string | null }
type Holding = { id: string; account_id: string | null; symbol: string; company_name: string; exchange: string | null; quantity: number; average_cost: number; current_price: number; previous_close: number | null; currency: string; notes: string | null; last_price_updated_at: string | null }
type Snapshot = { date_key: string; total_value: number; total_cost: number }

const RANGE = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 }
const ACCOUNT_TYPES = ['TFSA', 'RRSP', 'FHSA', 'RESP', 'Non-Registered', 'Crypto', 'Other']
const COLORS = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444', '#06b6d4']
const money = (v: number, c = 'CAD') => new Intl.NumberFormat(undefined, { style: 'currency', currency: c === 'USD' ? 'USD' : 'CAD' }).format(Number.isFinite(v) ? v : 0)
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(Number.isFinite(v) ? v : 0).toFixed(2)}%`

export function InvestmentsView() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [accountFilter, setAccountFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Holding | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<SecuritySuggestion[]>([])
  const [selected, setSelected] = useState<SecuritySuggestion | null>(null)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [note, setNote] = useState('')
  const [quantity, setQuantity] = useState('')
  const [averageCost, setAverageCost] = useState('')
  const [accountId, setAccountId] = useState('')
  const [range, setRange] = useState<'1M' | '3M' | '6M' | 'YTD' | '1Y' | 'All'>('1M')
  const [isEstimated, setIsEstimated] = useState(false)
  const [newAccount, setNewAccount] = useState({ type: 'TFSA', name: '', provider: '' })

  const safeHoldings = Array.isArray(holdings) ? holdings : []
  const safeAccounts = Array.isArray(accounts) ? accounts : []
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : []

  const load = async () => {
    const [a, h, s] = await Promise.all([
      supabase.from('investment_accounts').select('*').order('created_at', { ascending: true }),
      supabase.from('investment_holdings').select('*').order('created_at', { ascending: true }),
      supabase.from('investment_value_snapshots').select('*').order('date_key', { ascending: true }),
    ])
    setAccounts((a.data ?? []) as Account[])
    setHoldings((h.data ?? []) as Holding[])
    setSnapshots((s.data ?? []) as Snapshot[])
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { void searchSecurities(search).then(setSuggestions) }, [search])

  const merged = useMemo(() => safeHoldings.map((h) => {
    const totalCost = Math.max(0, h.quantity * h.average_cost)
    const marketValue = Math.max(0, h.quantity * h.current_price)
    const gainLoss = marketValue - totalCost
    const returnPercent = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0
    return { ...h, totalCost, marketValue, gainLoss, returnPercent, account: safeAccounts.find((a) => a.id === h.account_id) || null }
  }), [safeHoldings, safeAccounts])

  const filtered = useMemo(() => merged.filter((h) => accountFilter === 'all' || h.account_id === accountFilter), [merged, accountFilter])
  const totals = useMemo(() => {
    const portfolioValue = filtered.reduce((sum, h) => sum + h.marketValue, 0)
    const portfolioCost = filtered.reduce((sum, h) => sum + h.totalCost, 0)
    const portfolioGainLoss = portfolioValue - portfolioCost
    const portfolioReturnPercent = portfolioCost > 0 ? (portfolioGainLoss / portfolioCost) * 100 : 0
    return { portfolioValue, portfolioCost, portfolioGainLoss, portfolioReturnPercent }
  }, [filtered])

  const chartData = useMemo(() => {
    if (range === 'All') return safeSnapshots
    const now = new Date(); const start = new Date(now)
    if (range === 'YTD') start.setMonth(0, 1); else start.setDate(start.getDate() - RANGE[range])
    return safeSnapshots.filter((x) => new Date(x.date_key) >= start)
  }, [safeSnapshots, range])

  const resetModal = () => { setSearch(''); setSuggestions([]); setSelected(null); setQuantity(''); setAverageCost(''); setAccountId(''); setNote(''); setShowNewAccount(false); setEditing(null) }
  const openEdit = (h: Holding) => { setEditing(h); setOpen(true); setSelected({ symbol: h.symbol, companyName: h.company_name, exchange: h.exchange || '', currency: (h.currency as 'CAD' | 'USD') || 'CAD', fallbackPrice: h.current_price }); setQuantity(String(h.quantity)); setAverageCost(String(h.average_cost)); setAccountId(h.account_id || ''); setNote(h.notes || '') }

  const saveAccount = async () => {
    if (!newAccount.name.trim()) return
    const { data, error } = await supabase.from('investment_accounts').insert({ name: newAccount.name.trim(), type: newAccount.type, provider: newAccount.provider || null }).select('*').single()
    if (error || !data) return window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Failed to save account.' } }))
    setAccounts((cur) => [...cur, data as Account]); setAccountId((data as Account).id); setShowNewAccount(false); setNewAccount({ type: 'TFSA', name: '', provider: '' })
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Account added.' } }))
  }

  const saveHolding = async () => {
    if (!selected || !accountId || Number(quantity) <= 0 || Number(averageCost) < 0) return
    const payload = { account_id: accountId, symbol: selected.symbol, company_name: selected.companyName, exchange: selected.exchange || null, quantity: Number(quantity), average_cost: Number(averageCost), current_price: selected.fallbackPrice, previous_close: null, currency: selected.currency, notes: note || null, last_price_updated_at: new Date().toISOString() }
    const action = editing ? supabase.from('investment_holdings').update(payload).eq('id', editing.id) : supabase.from('investment_holdings').insert(payload)
    const { error } = await action
    if (error) return window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Failed to save holding.' } }))
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: editing ? 'Holding updated.' : 'Holding added.' } })); setOpen(false); resetModal(); void load()
  }

  const deleteHolding = async (id: string) => {
    if (!window.confirm('Delete this holding?\nThis cannot be undone.')) return
    const { error } = await supabase.from('investment_holdings').delete().eq('id', id)
    if (!error) void load()
  }

  const refreshPrices = async () => {
    if (!safeHoldings.length) return
    setRefreshing(true); setIsEstimated(false)
    try {
      const symbols = [...new Set(safeHoldings.map((h) => h.symbol))]
      const result = await getBatchQuotes(symbols)
      if (result.notConfigured) setIsEstimated(true)
      if (result.rateLimited) { window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Price refresh limit reached. Try again later.' } })); setRefreshing(false); return }
      const quoteBy = new Map(result.quotes.map((q) => [q.symbol, q]))
      await Promise.all(safeHoldings.map((h) => { const q = quoteBy.get(h.symbol); if (!q) return Promise.resolve(); if (q.isEstimated) setIsEstimated(true); return supabase.from('investment_holdings').update({ current_price: q.price, previous_close: q.previousClose, last_price_updated_at: q.timestamp }).eq('id', h.id) }))
      const pValue = merged.reduce((sum, h) => sum + (quoteBy.get(h.symbol)?.price ?? h.current_price) * h.quantity, 0)
      const pCost = merged.reduce((sum, h) => sum + h.totalCost, 0); const gain = pValue - pCost; const ret = pCost > 0 ? (gain / pCost) * 100 : 0
      await supabase.from('investment_value_snapshots').upsert({ date_key: new Date().toISOString().slice(0, 10), total_value: pValue, total_cost: pCost, gain_loss: gain, return_percent: ret })
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: result.failed.length ? 'Could not update prices. Showing last saved prices.' : 'Prices updated.' } }))
      await load()
    } catch { window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Could not update prices. Showing last saved prices.' } })) }
    setRefreshing(false)
  }

  return <section className="investmentsPage">
    <div className="card investmentsHeader"><div><h2>Investments</h2><p className="muted">Track your holdings, accounts, and portfolio performance manually.</p></div>
      <div className="investmentsHeaderActions"><select className="input" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}><option value="all">All Accounts</option>{safeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="btn" onClick={() => void refreshPrices()} disabled={refreshing}><RefreshCw size={16} />{refreshing ? 'Refreshing...' : 'Refresh Prices'}</button><button className="btn" onClick={() => { resetModal(); setOpen(true) }}><Plus size={16} />Add Holding</button></div></div>

    <div className="investKpis">{[['Portfolio Value', money(totals.portfolioValue)], ['Total Cost', money(totals.portfolioCost)], ['Total Gain / Loss', money(totals.portfolioGainLoss)], ['Return %', pct(totals.portfolioReturnPercent)], ['Holdings', String(filtered.length)]].map((k) => <div key={k[0]} className="card investKpi"><span>{k[0]}</span><strong className={k[0].includes('Gain') || k[0].includes('Return') ? (totals.portfolioGainLoss > 0 ? 'pos' : totals.portfolioGainLoss < 0 ? 'neg' : '') : ''}>{k[1]}</strong></div>)}</div>
    {isEstimated ? <div className='muted investNote'>Prices are manually tracked or estimated.</div> : null}

    <div className="investGridTop"><div className="card"><h3>Holdings List</h3>{filtered.length === 0 ? <div className="muted">No holdings yet.<br />Add your first holding to start tracking your portfolio.<div style={{ marginTop: 10 }}><button className='btn' onClick={() => setOpen(true)}><Plus size={16} />Add Holding</button></div></div> : <><table className="table investDesktop"><thead><tr><th>Holding</th><th>Account</th><th>Quantity</th><th>Avg Cost</th><th>Current Price</th><th>Market Value</th><th>Gain/Loss</th><th>Return %</th><th>Last Updated</th><th>Actions</th></tr></thead><tbody>{filtered.map((h) => <tr key={h.id}><td><strong>{h.symbol}</strong><div className='muted'>{h.company_name}</div></td><td>{h.account?.name || '—'}</td><td>{h.quantity}</td><td>{money(h.average_cost, h.currency)}</td><td>{money(h.current_price, h.currency)}</td><td>{money(h.marketValue, h.currency)}</td><td className={h.gainLoss > 0 ? 'pos' : h.gainLoss < 0 ? 'neg' : ''}>{money(h.gainLoss, h.currency)}</td><td className={h.returnPercent > 0 ? 'pos' : h.returnPercent < 0 ? 'neg' : ''}>{pct(h.returnPercent)}</td><td>{h.last_price_updated_at ? new Date(h.last_price_updated_at).toLocaleString() : '—'}</td><td><button className='btn tiny' onClick={() => openEdit(h as Holding)}><Pencil size={14} /></button><button className='btn tiny danger' onClick={() => void deleteHolding(h.id)}><Trash2 size={14} /></button></td></tr>)}</tbody></table><div className='investMobileCards'>{filtered.map((h) => <div className='card' key={h.id}><strong>{h.symbol}</strong><div className='muted'>{h.company_name}</div><div>{h.account?.name || '—'}</div><div>{money(h.marketValue, h.currency)}</div><div className={h.gainLoss > 0 ? 'pos' : h.gainLoss < 0 ? 'neg' : ''}>{money(h.gainLoss, h.currency)} · {pct(h.returnPercent)}</div><div className='row gap'><button className='btn tiny' onClick={() => openEdit(h as Holding)}>Edit</button><button className='btn tiny danger' onClick={() => void deleteHolding(h.id)}>Delete</button></div></div>)}</div></>}</div>
      <div className="card"><h3>Portfolio Allocation</h3>{filtered.length === 0 ? <div className='muted'>Portfolio allocation will appear after you add holdings.</div> : <div className='allocWrap'><div className='allocChart'><ResponsiveContainer width="100%" height={240}><PieChart><Pie data={filtered} dataKey='marketValue' nameKey='symbol' innerRadius={55} outerRadius={85}>{filtered.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie></PieChart></ResponsiveContainer><div className='allocCenter'><strong>{money(totals.portfolioValue)}</strong><small>Total Value</small></div></div><div>{filtered.map((h, i) => <div key={h.id} className='legendRow'><span style={{ background: COLORS[i % COLORS.length] }} />{h.symbol} ({((h.marketValue / Math.max(totals.portfolioValue, 1)) * 100).toFixed(1)}%)<strong>{money(h.marketValue, h.currency)}</strong></div>)}</div></div>}</div></div>

    <div className="investGridBottom"><div className='card'><h3>Accounts Summary</h3>{safeAccounts.length === 0 ? <div className='muted'>No investment accounts yet.<br />Create one when adding your first holding.</div> : <table className='table'><thead><tr><th>Account</th><th>Type</th><th>Total Value</th><th># of Holdings</th></tr></thead><tbody>{safeAccounts.map((a) => { const hs = safeHoldings.filter((h) => h.account_id === a.id); return <tr key={a.id}><td>{a.name}</td><td>{a.type}</td><td>{money(hs.reduce((sum, h) => sum + h.quantity * h.current_price, 0))}</td><td>{hs.length}</td></tr> })}</tbody></table>}</div>
      <div className='card'><h3>Portfolio Value Over Time</h3><div className='row gap'>{(['1M', '3M', '6M', 'YTD', '1Y', 'All'] as const).map((r) => <button key={r} className={`btn tiny ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>{r}</button>)}</div>{chartData.length === 0 ? <div className='muted' style={{ marginTop: 12 }}>Portfolio history will appear after you refresh prices over time.</div> : <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey='date_key' /><YAxis /><Tooltip /><Line type='monotone' dataKey='total_value' stroke='#2563eb' strokeWidth={2} dot={false} /><Line type='monotone' dataKey='total_cost' stroke='#94a3b8' strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>}</div></div>

    {open ? <div className='idleModalBackdrop'><div className='card investModal'><div className='row' style={{ justifyContent: 'space-between' }}><h3>{editing ? 'Edit holding' : 'Add holding'}</h3><button className='btn tiny' onClick={() => { setOpen(false); resetModal() }}>✕</button></div>{!selected ? <><input className='input' placeholder='Search for a company or ticker symbol...' value={search} onChange={(e) => setSearch(e.target.value)} /><div className='investSuggestionList'>{suggestions.map((s) => <button key={s.symbol} className='investSuggestion' onClick={() => setSelected(s)}><div><strong>{s.symbol}</strong> — {s.companyName}<div className='muted'>{s.exchange} · {s.currency}</div></div><strong>{money(s.fallbackPrice, s.currency)}</strong></button>)}</div></> : <><div className='investSelected'><strong>{selected.symbol}</strong><div className='muted'>{selected.companyName}</div><div>{money(selected.fallbackPrice, selected.currency)} {selected.exchange ? <span className='muted'>Estimated/manual price</span> : null}</div></div><div className='investFormGrid'><input className='input' placeholder='Quantity' value={quantity} onChange={(e) => setQuantity(e.target.value)} /><input className='input' placeholder='Average Cost / Purchase Price' value={averageCost} onChange={(e) => setAverageCost(e.target.value)} /><select className='input' value={accountId} onChange={(e) => e.target.value === '__new__' ? setShowNewAccount(true) : setAccountId(e.target.value)}><option value=''>Select an account</option>{safeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value='__new__'>+ New Manual Account</option></select><textarea className='input' placeholder='Optional notes...' value={note} onChange={(e) => setNote(e.target.value)} /></div>{showNewAccount ? <div className='card'><h4>New Manual Account</h4><select className='input' value={newAccount.type} onChange={(e) => setNewAccount((c) => ({ ...c, type: e.target.value }))}>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select><input className='input' placeholder='My Investments Account' value={newAccount.name} onChange={(e) => setNewAccount((c) => ({ ...c, name: e.target.value }))} /><input className='input' placeholder='Wealthsimple, Questrade, Bank, Other' value={newAccount.provider} onChange={(e) => setNewAccount((c) => ({ ...c, provider: e.target.value }))} /><div className='row gap'><button className='btn' onClick={() => setShowNewAccount(false)}>Cancel</button><button className='btn' onClick={() => void saveAccount()}>Save Account</button></div></div> : null}<div className='row gap' style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className='btn' onClick={() => { setOpen(false); resetModal() }}>Cancel</button><button className='btn' disabled={!selected || !accountId || Number(quantity) <= 0 || Number(averageCost) < 0} onClick={() => void saveHolding()}>{editing ? 'Save Changes' : 'Save Holding'}</button></div></>}</div></div> : null}
  </section>
}
