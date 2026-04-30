import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type DebtStrategy = 'avalanche' | 'snowball' | 'custom'
export type DebtStatus = 'active' | 'paid_off'
export type DebtType = 'Credit Card' | 'Student Loan' | 'Car Loan' | 'Personal Loan' | 'Line of Credit' | 'Mortgage' | 'Family/Friend' | 'Other'

export type Debt = { id: string; user_id: string; name: string; type: DebtType; lender: string; original_balance: number; current_balance: number; interest_rate: number; minimum_payment: number; payment_frequency: string; due_day_or_date: string | null; note: string | null; status: DebtStatus; created_at?: string; updated_at?: string }
export type DebtPayment = { id: string; debt_id: string; user_id: string; amount: number; payment_date: string; source_type: 'manual'|'linked_transaction'|'recurring'; note: string | null; created_at?: string }

const seedDebts = (userId: string): Debt[] => [
  { id:'seed-rbc', user_id:userId, name:'RBC Visa', type:'Credit Card', lender:'Royal Bank of Canada', original_balance:9050, current_balance:6250, interest_rate:22.99, minimum_payment:120, payment_frequency:'monthly', due_day_or_date:'2026-04-30', note:null, status:'active' },
  { id:'seed-student', user_id:userId, name:'Student Loan', type:'Student Loan', lender:'Canada Student Loans', original_balance:10000, current_balance:7800, interest_rate:6.45, minimum_payment:300, payment_frequency:'monthly', due_day_or_date:'2026-05-01', note:null, status:'active' },
  { id:'seed-car', user_id:userId, name:'Car Loan', type:'Car Loan', lender:'TD Auto Finance', original_balance:11900, current_balance:4400, interest_rate:4.99, minimum_payment:350, payment_frequency:'monthly', due_day_or_date:'2026-05-03', note:null, status:'active' },
  { id:'seed-loc', user_id:userId, name:'Personal Line of Credit', type:'Line of Credit', lender:'Scotiabank', original_balance:3400, current_balance:0, interest_rate:9.99, minimum_payment:0, payment_frequency:'monthly', due_day_or_date:null, note:'Paid off Jan 2026', status:'paid_off' },
]

export function useDebtPayoff(userId: string | null){
  const [debts, setDebts] = useState<Debt[]>([])
  const [payments, setPayments] = useState<DebtPayment[]>([])
  const [strategy, setStrategy] = useState<DebtStrategy>('avalanche')
  const [extraMonthlyPayment, setExtraMonthlyPayment] = useState(100)
  const [debtDirty, setDebtDirty] = useState(false)
  const [deletedDebtIds, setDeletedDebtIds] = useState<string[]>([])
  const setDebtDirtyWithSignal = (dirty: boolean) => {
    setDebtDirty(dirty)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('budgetly:debt-sync-status', { detail: { sync: dirty ? 'pending' : 'synced' } }))
    }
  }

  useEffect(() => { if (!userId) return; (async()=>{
    const debtRes = await supabase.from('debts').select('*').eq('user_id', userId).order('created_at', { ascending: true })
    const payRes = await supabase.from('debt_payments').select('*').eq('user_id', userId).order('payment_date', { ascending: false })
    const settingsRes = await supabase.from('debt_settings').select('*').eq('user_id', userId).maybeSingle()
    if (!debtRes.error && debtRes.data && debtRes.data.length) setDebts(debtRes.data as Debt[])
    else setDebts(seedDebts(userId))
    setDebtDirtyWithSignal(false)
    setDeletedDebtIds([])
    if (!payRes.error && payRes.data) setPayments(payRes.data as DebtPayment[])
    if (!settingsRes.error && settingsRes.data) { setStrategy((settingsRes.data.strategy_type || 'avalanche') as DebtStrategy); setExtraMonthlyPayment(Number(settingsRes.data.extra_monthly_payment || 100)) }
  })() }, [userId])

  const activeDebts = useMemo(()=>debts.filter(d=>d.status==='active' && d.current_balance>0),[debts])
  const totalDebt = useMemo(()=>activeDebts.reduce((s,d)=>s+d.current_balance,0),[activeDebts])
  const minimumMonthly = useMemo(()=>activeDebts.reduce((s,d)=>s+d.minimum_payment,0),[activeDebts])
  const highestInterest = useMemo(()=>[...activeDebts].sort((a,b)=>b.interest_rate-a.interest_rate)[0] || null,[activeDebts])
  const focusDebtId = useMemo(()=>{
    if (!activeDebts.length) return null
    if (strategy==='snowball') return [...activeDebts].sort((a,b)=>a.current_balance-b.current_balance)[0].id
    return [...activeDebts].sort((a,b)=>b.interest_rate-a.interest_rate)[0].id
  },[activeDebts,strategy])

  const recordPayment = async (debtId:string, amount:number, paymentDate:string, note:string) => {
    if (!userId || amount<=0) return
    const debt = debts.find(d=>d.id===debtId); if (!debt) return
    const nextBalance = Math.max(0, debt.current_balance - amount)
    const nextStatus: DebtStatus = nextBalance <= 0 ? 'paid_off' : 'active'
    setDebts(curr=>curr.map(d=>d.id===debtId?{...d,current_balance:nextBalance,status:nextStatus}:d))
    setDebtDirtyWithSignal(true)
    const payload = { debt_id: debtId, user_id: userId, amount, payment_date: paymentDate, source_type:'manual', note }
    await supabase.from('debt_payments').insert(payload)
    await supabase.from('debts').update({ current_balance: nextBalance, status: nextStatus }).eq('id', debtId).eq('user_id', userId)
  }

  const addDebt = async (payload: Omit<Debt, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
    if (!userId) return
    const tempId = `tmp-${Date.now()}`
    const row: Debt = { ...payload, id: tempId, user_id: userId }
    setDebts((curr) => [row, ...curr])
    setDebtDirtyWithSignal(true)
    // Saved on explicit "Update Debt"
  }

  const updateDebt = async (id: string, payload: Partial<Omit<Debt, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
    if (!userId) return
    setDebts((curr) => curr.map((d) => d.id === id ? { ...d, ...payload } as Debt : d))
    setDebtDirtyWithSignal(true)
    // Saved on explicit "Update Debt"
  }

  const deleteDebt = async (id: string) => {
    if (!userId) return
    setDebts((curr) => curr.filter((d) => d.id !== id))
    if (!id.startsWith('tmp-')) setDeletedDebtIds((curr) => [...curr, id])
    setDebtDirtyWithSignal(true)
    // Saved on explicit "Update Debt"
  }

  const saveDebts = async () => {
    if (!userId) return
    if (deletedDebtIds.length > 0) {
      const delResult = await supabase.from('debts').delete().eq('user_id', userId).in('id', deletedDebtIds)
      if (delResult.error) throw delResult.error
    }

    const existingRows = debts
      .filter((d) => !d.id.startsWith('tmp-'))
      .map(({ id, user_id, created_at, updated_at, ...rest }) => ({ id, user_id, ...rest }))
    if (existingRows.length > 0) {
      const upsertExisting = await supabase.from('debts').upsert(existingRows as any, { onConflict: 'id' })
      if (upsertExisting.error) throw upsertExisting.error
    }

    const newRows = debts
      .filter((d) => d.id.startsWith('tmp-'))
      .map(({ id, user_id, created_at, updated_at, ...rest }) => ({ user_id, ...rest }))
    if (newRows.length > 0) {
      const insertNew = await supabase.from('debts').insert(newRows as any)
      if (insertNew.error) throw insertNew.error
    }

    const refreshed = await supabase.from('debts').select('*').eq('user_id', userId).order('created_at', { ascending: true })
    if (refreshed.error) throw refreshed.error
    setDebts((refreshed.data || []) as Debt[])
    setDeletedDebtIds([])
    setDebtDirtyWithSignal(false)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message: 'Debt changes saved' } }))
    }
  }

  return { debts, payments, activeDebts, strategy, setStrategy, extraMonthlyPayment, setExtraMonthlyPayment, totalDebt, minimumMonthly, highestInterest, focusDebtId, recordPayment, addDebt, updateDebt, deleteDebt, debtDirty, saveDebts }
}
