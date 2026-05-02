import React, { useMemo, useRef, useState } from 'react'
import { Camera, Upload, Search, RotateCw, ZoomIn, Trash2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { extractReceiptDetails } from '../lib/receiptOcrService'
import { ReceiptRecord, ReceiptStatus } from '../receiptsTypes'
import type { Category } from '../types'

type Props = { userId: string; categories: Category[] }
type TabKey = 'inbox' | 'needs_review' | 'linked' | 'archive'
const accepted = '.jpg,.jpeg,.png,.webp,.pdf'
const seed: ReceiptRecord[] = [
  { id:'m1',user_id:'demo',storage_path:'',file_name:'walmart.jpg',mime_type:'image/jpeg',merchant:'Walmart',receipt_date:'2026-04-29',amount:42.18,category:'Groceries',notes:'',type:'expense',status:'needs_review',ocr_confidence:0.71,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
  { id:'m2',user_id:'demo',storage_path:'',file_name:'shell.jpg',mime_type:'image/jpeg',merchant:'Shell',receipt_date:'2026-04-28',amount:76.54,category:'Gas',notes:'',type:'expense',status:'ready_to_add',ocr_confidence:0.88,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
  { id:'m3',user_id:'demo',storage_path:'',file_name:'costco.jpg',mime_type:'image/jpeg',merchant:'Costco',receipt_date:'2026-04-27',amount:128.43,category:'Groceries',notes:'',type:'expense',status:'added',ocr_confidence:0.93,raw_ocr_text:null,transaction_id:'demo-tx',scan_error:null,archived_at:null },
  { id:'m4',user_id:'demo',storage_path:'',file_name:'starbucks.jpg',mime_type:'image/jpeg',merchant:'Starbucks',receipt_date:'2026-04-26',amount:9.85,category:'Dining Out',notes:'',type:'expense',status:'needs_review',ocr_confidence:0.62,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
]

export default function ReceiptManagementView({ userId, categories }: Props) {
  const [rows, setRows] = useState<ReceiptRecord[]>(seed)
  const [activeId, setActiveId] = useState(seed[0].id)
  const [tab, setTab] = useState<TabKey>('inbox')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all'|ReceiptStatus>('all')
  const [cat, setCat] = useState('all')
  const [scanning, setScanning] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const camRef = useRef<HTMLInputElement | null>(null)
  const current = rows.find((r) => r.id === activeId) || null

  const visible = useMemo(() => rows.filter((r) => {
    if (tab === 'archive' && r.status !== 'archived') return false
    if (tab === 'needs_review' && !['needs_review', 'failed'].includes(r.status)) return false
    if (tab === 'linked' && !(r.transaction_id || r.status === 'added')) return false
    if (tab === 'inbox' && r.status === 'archived') return false
    if (q && !(r.merchant || '').toLowerCase().includes(q.toLowerCase())) return false
    if (status !== 'all' && r.status !== status) return false
    if (cat !== 'all' && (r.category || '') !== cat) return false
    return true
  }), [rows, tab, q, status, cat])

  const upload = async (file: File) => {
    setScanning(true)
    const path = `${userId}/${crypto.randomUUID()}-${file.name}`
    await supabase.storage.from('receipt-images').upload(path, file).catch(() => null)
    const extraction = await extractReceiptDetails(file)
    const next: ReceiptRecord = { id: crypto.randomUUID(), user_id: userId, storage_path: path, file_name: file.name, mime_type: file.type, merchant: extraction.merchant || null, receipt_date: extraction.receipt_date, amount: extraction.amount || null, category: extraction.category || null, notes: extraction.notes || null, type: 'expense', status: extraction.failed || extraction.confidence < 0.55 ? 'needs_review' : 'ready_to_add', ocr_confidence: extraction.confidence, raw_ocr_text: extraction.rawText, transaction_id: null, scan_error: extraction.failed ? 'OCR could not confidently parse receipt.' : null, archived_at: null }
    const { data } = await supabase.from('receipts').insert(next).select('*').single().catch(() => ({ data: next }))
    setRows((c) => [data as ReceiptRecord, ...c])
    setActiveId((data as ReceiptRecord).id)
    setScanning(false)
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: extraction.failed ? 'Receipt saved with scan warning' : 'Receipt uploaded and scanned' } }))
  }

  const saveOnly = async () => { if (!current) return; await supabase.from('receipts').upsert(current); window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message:'Receipt saved' } })) }
  const addTx = async () => {
    if (!current) return
    const categoryId = categories.find((c) => c.name.toLowerCase() === (current.category || '').toLowerCase())?.id || null
    const tx = { id: crypto.randomUUID(), user_id: userId, date: current.receipt_date || new Date().toISOString().slice(0,10), type:'expense', amount: Number(current.amount || 0), category_id: categoryId, note: current.notes || current.merchant || 'Receipt expense' }
    const { data: txData } = await supabase.from('transactions').insert(tx).select('id').single()
    const next = { ...current, transaction_id: txData?.id || tx.id, status: 'added' as ReceiptStatus }
    await supabase.from('receipts').upsert(next)
    setRows((c) => c.map((r) => r.id === current.id ? next : r))
    window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message:'Expense transaction created from receipt' } }))
  }

  return <section className="receiptPage"><div className="pageHeader"><div><h2>Receipt Management</h2><p>Upload, scan, review, and convert receipts into expense transactions.</p></div><div className="row gap"><button className="btn" onClick={() => camRef.current?.click()}><Camera size={16}/>Take Photo</button><button className="btn primary" onClick={() => fileRef.current?.click()}><Upload size={16}/>Upload Receipt</button></div></div>
  <input ref={fileRef} type="file" accept={accepted} style={{display:'none'}} onChange={(e)=>{const f=e.target.files?.[0]; if(f) void upload(f)}} />
  <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={(e)=>{const f=e.target.files?.[0]; if(f) void upload(f)}} />
  <div className="receiptKpis">{['Receipts this month','Pending review','Converted to transactions','Scanned expense total'].map((k,i)=><div className="card" key={k}><div className="muted">{k}</div><strong>{i===0?rows.length:i===1?rows.filter(r=>r.status==='needs_review').length:i===2?rows.filter(r=>r.status==='added').length:`CA$${rows.reduce((s,r)=>s+Number(r.amount||0),0).toFixed(2)}`}</strong></div>)}</div>
  <div className="receiptTabs">{[['inbox','Inbox'],['needs_review','Needs Review'],['linked','Linked'],['archive','Archive']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k as TabKey)}>{l}</button>)}</div>
  <div className="receiptWorkspace"><div className="card"><h3>Receipt Inbox</h3><div className="row gap wrap"><div className="searchInput"><Search size={14}/><input placeholder="Search receipts" value={q} onChange={e=>setQ(e.target.value)}/></div><select value={status} onChange={e=>setStatus(e.target.value as any)}><option value="all">All status</option><option value="needs_review">Needs Review</option><option value="ready_to_add">Ready to Add</option><option value="added">Added</option><option value="failed">Failed</option><option value="archived">Archived</option></select><select value={cat} onChange={e=>setCat(e.target.value)}><option value="all">All categories</option>{Array.from(new Set(rows.map(r=>r.category).filter(Boolean))).map(c=><option key={c} value={c!}>{c}</option>)}</select></div>
  <div className="receiptList">{visible.map(r=><button key={r.id} className={`receiptRow ${r.id===activeId?'active':''}`} onClick={()=>setActiveId(r.id)}><div><strong>{r.merchant||'Untitled'}</strong><div className="muted">{r.receipt_date} · CA${Number(r.amount||0).toFixed(2)} · {r.category||'Uncategorized'}</div></div><span className={`statusPill ${r.status}`}>{r.status.replace('_',' ')}</span></button>)}{!visible.length && <div className="emptyState"><p><strong>No receipts yet</strong></p><p>Upload your first receipt to scan and convert it into an expense transaction.</p></div>}</div></div>
  <div className="card">{current ? <><div className="row between"><h3>Receipt Preview</h3><span className="badge">{current.ocr_confidence && current.ocr_confidence>0.8?'High':current.ocr_confidence&&current.ocr_confidence>0.55?'Medium':'Low'} confidence</span></div><div className="receiptPreview">🧾</div><div className="row gap"><button className="btn"><ZoomIn size={14}/>Zoom</button><button className="btn"><RotateCw size={14}/>Rotate</button><button className="btn" onClick={() => fileRef.current?.click()}><RefreshCw size={14}/>Replace image</button><button className="btn danger" onClick={()=>window.confirm('Delete this receipt?')&&setRows(c=>c.filter(x=>x.id!==current.id))}><Trash2 size={14}/>Delete</button></div>
  <h3 style={{marginTop:12}}>Detected Details</h3><p className="muted">Review detected values before adding this receipt as a transaction.</p>{current.scan_error ? <div className="badge warn">{current.scan_error}</div> : null}
  <div className="formGrid"><input value={current.merchant||''} onChange={e=>setRows(c=>c.map(r=>r.id===current.id?{...r,merchant:e.target.value}:r))} placeholder="Merchant"/><input type="date" value={current.receipt_date||''} onChange={e=>setRows(c=>c.map(r=>r.id===current.id?{...r,receipt_date:e.target.value}:r))}/><input type="number" step="0.01" value={current.amount||0} onChange={e=>setRows(c=>c.map(r=>r.id===current.id?{...r,amount:Number(e.target.value)}:r))}/><input value={current.category||''} onChange={e=>setRows(c=>c.map(r=>r.id===current.id?{...r,category:e.target.value}:r))} placeholder="Category"/><input value="Expense" disabled/><textarea value={current.notes||''} onChange={e=>setRows(c=>c.map(r=>r.id===current.id?{...r,notes:e.target.value}:r))} placeholder="Notes"/></div>
  <div className="row gap"><button className="btn" onClick={()=>setRows(c=>c.map(r=>r.id===current.id?{...r,status:'archived',archived_at:new Date().toISOString()}:r))}>Discard</button><button className="btn" onClick={()=>void saveOnly()}>Save Receipt Only</button><button className="btn primary" onClick={()=>void addTx()}>Add as Transaction</button></div></> : <div className="emptyState">Select a receipt to review.</div>}</div></div>{scanning && <div className="badge">Scanning receipt...</div>}</section>
}
