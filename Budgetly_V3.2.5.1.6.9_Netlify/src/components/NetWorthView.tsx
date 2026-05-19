import React, { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowUpRight, ChevronRight, Landmark, Plus, TrendingUp, Wallet, CreditCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { monthLabel } from '../lib/utils'

type Asset = { id: string; name: string; type: string; amount: number; notes?: string | null }
type Debt = { id: string; name: string; type: string; balance: number; interest_rate: number; minimum_payment?: number | null; notes?: string | null }
type Snapshot = { month_key: string; total_assets: number; total_debts: number; net_worth: number }

const fmt = (n: number, showSign = false) => `${showSign && n > 0 ? '+' : ''}${n < 0 ? '-' : ''}CA$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export function NetWorthView() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [assets, setAssets] = useState<Asset[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [assetEdit, setAssetEdit] = useState<Asset | null>(null)
  const [debtEdit, setDebtEdit] = useState<Debt | null>(null)

  const totalAssets = useMemo(() => assets.reduce((s, a) => s + Number(a.amount || 0), 0), [assets])
  const totalDebts = useMemo(() => debts.reduce((s, d) => s + Number(d.balance || 0), 0), [debts])
  const netWorth = totalAssets - totalDebts

  const fetchAll = async () => {
    const [{ data: a }, { data: d }, { data: s }] = await Promise.all([
      supabase.from('net_worth_assets').select('*').order('created_at'),
      supabase.from('net_worth_debts').select('*').order('created_at'),
      supabase.from('net_worth_snapshots').select('*').order('month_key'),
    ])
    setAssets((a as Asset[]) || [])
    setDebts((d as Debt[]) || [])
    setSnapshots((s as Snapshot[]) || [])
  }

  useEffect(() => { void fetchAll() }, [])
  useEffect(() => {
    const upsert = async () => {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) return
      await supabase.from('net_worth_snapshots').upsert({ user_id: userId, month_key: month, total_assets: totalAssets, total_debts: totalDebts, net_worth: netWorth }, { onConflict: 'user_id,month_key' })
      const { data } = await supabase.from('net_worth_snapshots').select('*').order('month_key')
      setSnapshots((data as Snapshot[]) || [])
    }
    void upsert()
  }, [month, totalAssets, totalDebts, netWorth])

  const denominator = totalAssets + totalDebts
  const assetPercent = denominator > 0 ? (totalAssets / denominator) * 100 : 0
  const debtPercent = denominator > 0 ? (totalDebts / denominator) * 100 : 0
  const monthSeries = snapshots.slice(-6).map((s) => ({ label: monthLabel(s.month_key), net: Number(s.net_worth) }))

  return <section className="netWorthPage">
    <div className="row space netWorthHeader"><div><h1>Net Worth Tracker</h1><p className="muted">Track your financial position and progress over time.</p></div><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} /></div>
    <div className="netWorthKpis">
      <article className="card netWorthKpi"><Wallet/><div><small>Net Worth</small><h3 className={netWorth<0?'neg':'pos'}>{fmt(netWorth)}</h3><p className="muted">{netWorth<0?`You are ${fmt(Math.abs(netWorth))} away from positive net worth.`:'Positive net worth achieved.'}</p></div></article>
      <article className="card netWorthKpi"><Landmark/><div><small>Total Assets</small><h3 className="pos">{fmt(totalAssets)}</h3></div></article>
      <article className="card netWorthKpi"><CreditCard/><div><small>Total Debts</small><h3 className="neg">{fmt(totalDebts)}</h3></div></article>
      <article className="card netWorthKpi"><TrendingUp/><div><small>This Month's Change</small><h3 className="pos">{fmt((monthSeries.at(-1)?.net||0)-(monthSeries.at(-2)?.net||0),true)}</h3></div></article>
    </div>
    <div className="netWorthGrid2">
      <div className="card"><div className="row space"><h3>Assets</h3><button className="btn" onClick={()=>setAssetEdit({ id:'', name:'', type:'Cash', amount:0 })}><Plus size={14}/> Add Asset</button></div>{assets.length===0?<p className='muted'>No assets added yet. Add your first asset to start tracking your net worth.</p>:assets.map(a=><button key={a.id} className='netWorthRow' onClick={()=>setAssetEdit(a)}><span>{a.name}</span><strong>{fmt(a.amount)}</strong><ChevronRight size={14}/></button>)}<div className='netWorthTotal pos'>Total Assets <strong>{fmt(totalAssets)}</strong></div></div>
      <div className="card"><div className="row space"><h3>Debts</h3><button className="btn danger" onClick={()=>setDebtEdit({ id:'', name:'', type:'Credit Card', balance:0, interest_rate:0 })}><Plus size={14}/> Add Debt</button></div>{debts.length===0?<p className='muted'>No debts added yet. Add debts to get an accurate net worth picture.</p>:debts.map(d=><button key={d.id} className='netWorthRow' onClick={()=>setDebtEdit(d)}><span>{d.name}</span><strong>{fmt(d.balance)}</strong><em>{Number(d.interest_rate||0).toFixed(2)}%</em><ChevronRight size={14}/></button>)}<div className='netWorthTotal neg'>Total Debts <strong>{fmt(totalDebts)}</strong></div></div>
    </div>
    <div className='netWorthGrid2'>
      <div className='card'><div className='row space'><h3>Net Worth Over Time</h3><span className='badge'>Last 6 months</span></div><div style={{height:250}}>{monthSeries.length===0?<p className='muted'>Net worth history will appear after monthly snapshots are created.</p>:<ResponsiveContainer><AreaChart data={monthSeries}><XAxis dataKey='label'/><YAxis/><Tooltip formatter={(v:number)=>fmt(v)} /><Area type='monotone' dataKey='net' stroke='#16a34a' fill='rgba(34,197,94,.18)'/></AreaChart></ResponsiveContainer>}</div></div>
      <div className='card'><h3>Assets vs Debts</h3><div style={{height:250}}><ResponsiveContainer><PieChart><Pie data={[{name:'Assets',value:totalAssets},{name:'Debts',value:totalDebts}]} innerRadius={64} outerRadius={90} dataKey='value'>{[0,1].map((i)=><Cell key={i} fill={i===0?'#22c55e':'#ef4444'} />)}</Pie></PieChart></ResponsiveContainer></div><div className='row space'><span>Assets {assetPercent.toFixed(1)}%</span><strong>{fmt(totalAssets)}</strong></div><div className='row space'><span>Debts {debtPercent.toFixed(1)}%</span><strong>{fmt(totalDebts)}</strong></div></div>
    </div>

    {[assetEdit,debtEdit].some(Boolean)?<div className='modalWrap' onClick={()=>{setAssetEdit(null);setDebtEdit(null)}}><div className='card' onClick={(e)=>e.stopPropagation()}>{assetEdit?<EditorAsset item={assetEdit} onClose={()=>setAssetEdit(null)} onSaved={fetchAll} month={month} />:<EditorDebt item={debtEdit!} onClose={()=>setDebtEdit(null)} onSaved={fetchAll} month={month} />}</div></div>:null}
  </section>
}

function EditorAsset({ item, onClose, onSaved }: any) { const [state,setState]=useState(item); const save=async()=>{ if(!state.name.trim()||!(Number(state.amount)>=0)) return; if(state.id) await supabase.from('net_worth_assets').update(state).eq('id',state.id); else await supabase.from('net_worth_assets').insert(state); await onSaved(); onClose() }; const del=async()=>{if(state.id){await supabase.from('net_worth_assets').delete().eq('id',state.id); await onSaved()} onClose()}; return <div><h3>{state.id?'Edit Asset':'Add Asset'}</h3><input placeholder='Asset name' value={state.name} onChange={e=>setState({...state,name:e.target.value})}/><input placeholder='Asset type' value={state.type} onChange={e=>setState({...state,type:e.target.value})}/><input type='number' placeholder='Amount' value={state.amount} onChange={e=>setState({...state,amount:Number(e.target.value)})}/><textarea placeholder='Notes optional' value={state.notes||''} onChange={e=>setState({...state,notes:e.target.value})}/><div className='row gap'><button className='btn' onClick={onClose}>Cancel</button><button className='btn' onClick={save}>Save Asset</button>{state.id?<button className='btn danger' onClick={del}>Delete</button>:null}</div></div> }
function EditorDebt({ item, onClose, onSaved }: any) { const [state,setState]=useState(item); const save=async()=>{ if(!state.name.trim()||!(Number(state.balance)>=0)||!(Number(state.interest_rate)>=0)) return; if(state.id) await supabase.from('net_worth_debts').update(state).eq('id',state.id); else await supabase.from('net_worth_debts').insert(state); await onSaved(); onClose() }; const del=async()=>{if(state.id){await supabase.from('net_worth_debts').delete().eq('id',state.id); await onSaved()} onClose()}; return <div><h3>{state.id?'Edit Debt':'Add Debt'}</h3><input placeholder='Debt name' value={state.name} onChange={e=>setState({...state,name:e.target.value})}/><input placeholder='Debt type' value={state.type} onChange={e=>setState({...state,type:e.target.value})}/><input type='number' placeholder='Balance' value={state.balance} onChange={e=>setState({...state,balance:Number(e.target.value)})}/><input type='number' placeholder='Interest rate' value={state.interest_rate} onChange={e=>setState({...state,interest_rate:Number(e.target.value)})}/><textarea placeholder='Notes optional' value={state.notes||''} onChange={e=>setState({...state,notes:e.target.value})}/><div className='row gap'><button className='btn' onClick={onClose}>Cancel</button><button className='btn' onClick={save}>Save Debt</button>{state.id?<button className='btn danger' onClick={del}>Delete</button>:null}</div></div> }
