import React, { useMemo, useRef, useState } from 'react'
import { CalendarDays, Camera, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, FolderOpen, ReceiptText, RotateCw, Search, Tag, Trash2, Upload, ZoomIn } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { extractReceiptDetails } from '../lib/receiptOcrService'
import { ReceiptRecord, ReceiptStatus } from '../receiptsTypes'
import type { Category } from '../types'

type Props = { userId: string | null; categories: Category[] }
type TabKey = 'inbox' | 'needs_review' | 'linked' | 'archive'
const ACCEPTED = '.jpg,.jpeg,.png,.webp,.pdf'

const seedRows: ReceiptRecord[] = [
  { id:'m1',user_id:'demo',storage_path:'',file_name:'walmart.jpg',mime_type:'image/jpeg',merchant:'Walmart',receipt_date:'2026-04-29',amount:42.18,category:'Groceries',notes:'Weekly household items',type:'expense',status:'needs_review',ocr_confidence:0.78,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
  { id:'m2',user_id:'demo',storage_path:'',file_name:'shell.jpg',mime_type:'image/jpeg',merchant:'Shell',receipt_date:'2026-04-28',amount:76.54,category:'Gas',notes:'Fuel top-up',type:'expense',status:'ready_to_add',ocr_confidence:0.89,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
  { id:'m3',user_id:'demo',storage_path:'',file_name:'costco.jpg',mime_type:'image/jpeg',merchant:'Costco',receipt_date:'2026-04-27',amount:128.43,category:'Groceries',notes:'Bulk groceries',type:'expense',status:'added',ocr_confidence:0.94,raw_ocr_text:null,transaction_id:'demo-tx',scan_error:null,archived_at:null },
  { id:'m4',user_id:'demo',storage_path:'',file_name:'starbucks.jpg',mime_type:'image/jpeg',merchant:'Starbucks',receipt_date:'2026-04-26',amount:9.85,category:'Dining Out',notes:'Coffee',type:'expense',status:'needs_review',ocr_confidence:0.64,raw_ocr_text:null,transaction_id:null,scan_error:null,archived_at:null },
]

const statusLabel = (status: ReceiptStatus) => ({ needs_review:'Needs Review', ready_to_add:'Ready to Add', added:'Added', failed:'Failed', archived:'Archived' }[status])

export default function ReceiptManagementView({ userId, categories }: Props) {
  const [rows, setRows] = useState(seedRows)
  const [activeId, setActiveId] = useState(seedRows[0]?.id ?? '')
  const [tab, setTab] = useState<TabKey>('inbox')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ReceiptStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [isScanning, setIsScanning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  const active = rows.find((row) => row.id === activeId) ?? null

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (tab === 'archive' && row.status !== 'archived') return false
    if (tab === 'needs_review' && !['needs_review', 'failed'].includes(row.status)) return false
    if (tab === 'linked' && !row.transaction_id && row.status !== 'added') return false
    if (tab === 'inbox' && row.status === 'archived') return false
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (categoryFilter !== 'all' && row.category !== categoryFilter) return false
    if (query && !(row.merchant || '').toLowerCase().includes(query.toLowerCase())) return false
    return true
  }), [rows, tab, statusFilter, categoryFilter, query])

  const notify = (message: string) => window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))

  const updateActive = (patch: Partial<ReceiptRecord>) => {
    if (!active) return
    setRows((current) => current.map((row) => row.id === active.id ? { ...row, ...patch } : row))
  }

  const uploadReceipt = async (file: File) => {
    if (!userId) return
    setIsScanning(true)
    const path = `${userId}/${crypto.randomUUID()}-${file.name}`
    await supabase.storage.from('receipt-images').upload(path, file).catch(() => null)
    const extraction = await extractReceiptDetails(file)
    const record: ReceiptRecord = {
      id: crypto.randomUUID(), user_id: userId, storage_path: path, file_name: file.name, mime_type: file.type,
      merchant: extraction.merchant || null, receipt_date: extraction.receipt_date, amount: extraction.amount || null,
      category: extraction.category || null, notes: extraction.notes || null, type: 'expense',
      status: extraction.failed || extraction.confidence < 0.55 ? 'needs_review' : 'ready_to_add',
      ocr_confidence: extraction.confidence, raw_ocr_text: extraction.rawText, transaction_id: null,
      scan_error: extraction.failed ? 'OCR confidence is low. Please review manually.' : null, archived_at: null,
    }
    const { data } = await supabase.from('receipts').insert(record).select('*').single().catch(() => ({ data: record }))
    const next = data as ReceiptRecord
    setRows((current) => [next, ...current])
    setActiveId(next.id)
    setIsScanning(false)
    notify('Receipt uploaded')
  }

  const saveReceiptOnly = async () => { if (!active) return; await supabase.from('receipts').upsert(active); notify('Receipt saved') }
  const addAsTransaction = async () => {
    if (!active || !userId) return
    const categoryId = categories.find((category) => category.name.toLowerCase() === (active.category || '').toLowerCase())?.id || null
    const tx = { id: crypto.randomUUID(), user_id: userId, date: active.receipt_date || new Date().toISOString().slice(0, 10), amount: Number(active.amount || 0), category_id: categoryId, note: active.notes || active.merchant || 'Receipt expense', type: 'expense' as const }
    const { data } = await supabase.from('transactions').insert(tx).select('id').single().catch(() => ({ data: { id: tx.id } }))
    const next = { ...active, transaction_id: data?.id || tx.id, status: 'added' as ReceiptStatus }
    await supabase.from('receipts').upsert(next)
    setRows((current) => current.map((row) => row.id === active.id ? next : row))
    notify('Transaction created from receipt')
  }

  const confidence = active?.ocr_confidence ?? 0
  const confidenceLabel = confidence >= 0.8 ? 'High' : confidence >= 0.55 ? 'Medium' : 'Low'

  return <section className="receiptManagementPage">
    <div className="receiptHero">
      <div>
        <h2>Receipt Management</h2>
        <p>Upload, scan, review, and convert receipts into expense transactions.</p>
      </div>
      <div className="row gap wrap">
        <button className="btn" onClick={() => cameraInputRef.current?.click()}><Camera size={16} />Take Photo</button>
        <button className="btn primary" onClick={() => fileInputRef.current?.click()}><Upload size={16} />Upload Receipt</button>
      </div>
    </div>

    <input ref={fileInputRef} type="file" accept={ACCEPTED} style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />
    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])} />

    <div className="receiptStatsGrid">
      <div className="receiptStatCard"><span className="ic blue"><ReceiptText size={18}/></span><div><small>Receipts this month</small><strong>{rows.length}</strong></div></div>
      <div className="receiptStatCard"><span className="ic amber"><CalendarDays size={18}/></span><div><small>Pending review</small><strong>{rows.filter((r) => r.status === 'needs_review').length}</strong></div></div>
      <div className="receiptStatCard"><span className="ic green"><CheckCircle2 size={18}/></span><div><small>Converted to transactions</small><strong>{rows.filter((r) => r.status === 'added').length}</strong></div></div>
      <div className="receiptStatCard"><span className="ic violet"><CircleDollarSign size={18}/></span><div><small>Scanned expense total</small><strong>CA${rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)}</strong></div></div>
    </div>

    <div className="receiptMainCard">
      <div className="receiptTabRow">{[['inbox', 'Inbox'], ['needs_review', 'Needs Review'], ['linked', 'Linked'], ['archive', 'Archive']].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key as TabKey)}>{label}</button>)}</div>
      <div className="receiptWorkspaceGrid">
        <section className="receiptPanel">
          <h3>Receipt Inbox</h3>
          <div className="receiptToolbar">
            <label className="search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search receipts" /></label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ReceiptStatus)}><option value="all">All statuses</option><option value="needs_review">Needs Review</option><option value="ready_to_add">Ready to Add</option><option value="added">Added</option><option value="failed">Failed</option><option value="archived">Archived</option></select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="all">All categories</option>{Array.from(new Set(rows.map((row) => row.category).filter(Boolean))).map((category) => <option key={category} value={category!}>{category}</option>)}</select>
            <select><option>Newest first</option><option>Oldest first</option></select>
          </div>
          <div className="receiptRows">
            {filteredRows.map((row) => <button key={row.id} className={`receiptInboxRow ${activeId === row.id ? 'active' : ''}`} onClick={() => setActiveId(row.id)}>
              <div className="receiptThumb" />
              <div className="receiptMeta"><strong>{row.merchant || 'Untitled receipt'}</strong><span><CalendarDays size={13} /> {row.receipt_date}</span><span><Tag size={13} /> Category: {row.category || 'Uncategorized'}</span></div>
              <div className="receiptAmountSide"><strong>CA${Number(row.amount || 0).toFixed(2)}</strong><span className={`status ${row.status}`}>{statusLabel(row.status)}</span></div>
            </button>)}
            {!filteredRows.length ? <div className="emptyState"><h4>No receipts yet</h4><p>Upload your first receipt to scan and convert it into an expense transaction.</p></div> : null}
          </div>
        </section>

        <section className="receiptPanel">
          <h3>Receipt Review</h3>
          {!active ? <div className="emptyState"><h4>No receipt selected</h4><p>Select a receipt from the inbox to review.</p></div> : <>
            <div className="previewBar"><h4>Receipt Preview</h4><div className="row gap"><button className="iconBtn"><ZoomIn size={14} /></button><button className="iconBtn"><Search size={14} /></button><button className="iconBtn"><RotateCw size={14} /></button><button className="iconBtn danger" onClick={() => window.confirm('Delete this receipt?') && setRows((current) => current.filter((row) => row.id !== active.id))}><Trash2 size={14} /></button></div></div>
            <div className="reviewGrid"><div className="receiptPreviewCard"><div className="receiptPaper">{active.merchant}</div></div>
              <div className="receiptFormCard"><div className="row between"><h4>Detected Details</h4><span className={`badge ${confidenceLabel.toLowerCase()}`}>{confidenceLabel}</span></div>
                <label>Merchant<input value={active.merchant || ''} onChange={(e) => updateActive({ merchant: e.target.value })} /></label>
                <label>Date<input type="date" value={active.receipt_date || ''} onChange={(e) => updateActive({ receipt_date: e.target.value })} /></label>
                <label>Amount<input type="number" step="0.01" value={active.amount || 0} onChange={(e) => updateActive({ amount: Number(e.target.value) })} /></label>
                <label>Category<select value={active.category || ''} onChange={(e) => updateActive({ category: e.target.value })}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}</select></label>
                <label>Type<select value="Expense" disabled><option>Expense</option></select></label>
                <label>Notes<input value={active.notes || ''} onChange={(e) => updateActive({ notes: e.target.value })} /></label>
                <p className="hint">Review detected values before adding this receipt as a transaction.</p>
              </div>
            </div>
            <div className="receiptActionRow"><button className="btn" onClick={() => updateActive({ status: 'archived', archived_at: new Date().toISOString() })}><FolderOpen size={15} />Discard</button><button className="btn" onClick={() => void saveReceiptOnly()}><ReceiptText size={15} />Save Receipt Only</button><button className="btn primary" onClick={() => void addAsTransaction()}><CheckCircle2 size={15} />Add as Transaction</button></div>
          </>}
        </section>
      </div>
      <div className="receiptPager"><span>1–{Math.min(4, filteredRows.length || 4)} of {rows.length} receipts</span><div className="row gap"><button className="iconBtn"><ChevronLeft size={14} /></button><button className="page active">1</button><button className="page">2</button><button className="iconBtn"><ChevronRight size={14} /></button></div></div>
    </div>
    {isScanning ? <div className="badge">Scanning receipt…</div> : null}
  </section>
}
