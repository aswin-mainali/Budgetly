import React, { useMemo, useState } from 'react'
import {
  Users, Heart, Plus, Send, Check, X, ArrowRight, Handshake, Trash2, LogOut,
  Mail, ReceiptText, Wallet, Sparkles, ChevronDown,
} from 'lucide-react'
import { fmtMoney } from '../lib/utils'
import { useSharedBudgeting } from '../hooks/useSharedBudgeting'
import { SharedSplitType } from '../types'

type Props = {
  userId: string | null
  email: string | null
  hasFeature: boolean
  currency?: string
}

const SPLIT_OPTIONS: Array<{ id: SharedSplitType; label: string; hint: string }> = [
  { id: 'equal', label: '50 / 50', hint: 'Split evenly' },
  { id: 'percent', label: 'Custom %', hint: 'Choose the split' },
  { id: 'payer_full', label: 'I cover it', hint: 'No one owes you' },
  { id: 'other_full', label: 'They owe it all', hint: 'Full amount owed back' },
]

const EMOJI_CHOICES = ['🛒', '🏠', '🍜', '✈️', '🎬', '⚡', '🚗', '🎁', '🧾', '☕', '🐶', '💊']

const initials = (label: string) => label.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U'

export function SharedBudgetingView({ userId, email, hasFeature, currency = 'CAD' }: Props) {
  const s = useSharedBudgeting(userId, email, hasFeature)
  const cur = s.activeSpace?.currency || currency
  const money = (n: number) => fmtMoney(n, cur)

  // Create-space form
  const [newName, setNewName] = useState('')
  const [newPartner, setNewPartner] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  // Add-expense form
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [emoji, setEmoji] = useState<string>('🛒')
  const [paidByMe, setPaidByMe] = useState(true)
  const [splitType, setSplitType] = useState<SharedSplitType>('equal')
  const [payerShare, setPayerShare] = useState(50)
  const [expenseDate, setExpenseDate] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // Settle-up modal
  const [settleOpen, setSettleOpen] = useState(false)
  const [settleAmount, setSettleAmount] = useState('')
  const [invitePartnerEmail, setInvitePartnerEmail] = useState('')

  const otherLabel = s.otherMember ? s.labelFor(s.otherMember.user_id) : 'your partner'

  // Merged, date-sorted activity feed (expenses + settlements).
  const activity = useMemo(() => {
    type Row =
      | { kind: 'expense'; id: string; date: string; created: string; data: (typeof s.spaceExpenses)[number] }
      | { kind: 'settlement'; id: string; date: string; created: string; data: (typeof s.spaceSettlements)[number] }
    const rows: Row[] = [
      ...s.spaceExpenses.map((e) => ({ kind: 'expense' as const, id: e.id, date: e.date, created: e.created_at ?? e.date, data: e })),
      ...s.spaceSettlements.map((x) => ({ kind: 'settlement' as const, id: x.id, date: x.date, created: x.created_at ?? x.date, data: x })),
    ]
    return rows.sort((a, b) => (b.date.localeCompare(a.date) || b.created.localeCompare(a.created)))
  }, [s.spaceExpenses, s.spaceSettlements])

  const submitExpense = async () => {
    const value = parseFloat(amount)
    if (!Number.isFinite(value) || value <= 0) return
    const paidBy = paidByMe ? (userId as string) : (s.otherMember?.user_id as string)
    if (!paidBy) return
    const res = await s.addExpense({
      amount: value, paidBy, note, emoji, date: expenseDate, splitType,
      payerShare: paidByMe ? payerShare : 100 - payerShare,
    })
    if (res.ok) { setAmount(''); setNote(''); setSplitType('equal'); setPayerShare(50) }
  }

  const submitSettle = async () => {
    const value = parseFloat(settleAmount)
    if (!Number.isFinite(value) || value <= 0) return
    const res = await s.settleUp(value)
    if (res.ok) { setSettleOpen(false); setSettleAmount('') }
  }

  // ------------------------------------------------------------------ feature off
  if (!hasFeature) {
    return (
      <section className="sharedView">
        <div className="card sharedLockedCard">
          <div className="sharedLockIcon"><Users size={26} /></div>
          <h2>Shared budgeting isn't enabled</h2>
          <p className="muted">This is a limited feature. Ask an administrator to turn on <strong>Shared budgeting</strong> for your account to split expenses with a partner.</p>
        </div>
      </section>
    )
  }

  if (s.loading) {
    return <section className="sharedView"><div className="card"><h2>Loading Together…</h2><div className="muted">Fetching your shared spaces.</div></div></section>
  }

  // ------------------------------------------------------------------ empty / invites
  if (!s.activeSpace) {
    return (
      <section className="sharedView">
        <header className="sharedHero">
          <span className="badge"><Heart size={14} /> Together</span>
          <h1>Share a budget with your partner</h1>
          <p className="muted">Pool the money you spend together, split every expense your way, and keep an honest running tally of who owes whom — all without merging your private budgets.</p>
        </header>

        {s.incomingInvites.length > 0 ? (
          <div className="card sharedInviteCard">
            <h3><Mail size={17} /> You've been invited</h3>
            <div className="grid" style={{ gap: 10, marginTop: 10 }}>
              {s.incomingInvites.map((inv) => (
                <div key={inv.id} className="sharedInviteRow">
                  <div>
                    <strong>A partner wants to share a budget</strong>
                    <div className="muted">Invitation sent to {inv.invitee_email}</div>
                  </div>
                  <div className="row gap">
                    <button className="btn" onClick={() => void s.declineInvite(inv.id)} disabled={s.busy}><X size={15} /> Decline</button>
                    <button className="btn primary" onClick={() => void s.acceptInvite(inv.id)} disabled={s.busy}><Check size={15} /> Accept &amp; join</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card sharedCreateCard">
          <h3><Plus size={17} /> Start a shared space</h3>
          <p className="muted">Name your space and invite your partner by their Budgetly email. If they're not on Budgetly yet, they can join and the invite will be waiting.</p>
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <label className="field">
              <span>Space name</span>
              <input className="input" placeholder="Our Household" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="field">
              <span>Partner's email <span className="muted">(optional)</span></span>
              <input className="input" type="email" placeholder="partner@email.com" value={newPartner} onChange={(e) => setNewPartner(e.target.value)} />
            </label>
            <div>
              <button className="btn primary" disabled={s.busy} onClick={async () => {
                const res = await s.createSpace(newName || 'Our Household', cur, newPartner)
                if (res.ok) { setNewName(''); setNewPartner('') }
              }}><Handshake size={16} /> Create shared space</button>
            </div>
          </div>
          {s.error ? <div className="supportNotice" style={{ marginTop: 12 }}>{s.error}</div> : null}
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------------ active space
  const net = s.balance.net
  const settled = Math.abs(net) < 0.01
  const myPaid = s.paidTotals[userId as string] ?? 0
  const otherPaid = s.otherMember ? (s.paidTotals[s.otherMember.user_id] ?? 0) : 0
  const myPct = s.totalShared > 0 ? Math.round((myPaid / s.totalShared) * 100) : 0
  const partnerPending = !s.otherMember && s.outgoingInvites.length > 0

  return (
    <section className="sharedView">
      <header className="sharedTopBar">
        <div className="sharedSpaceIdentity">
          <div className="sharedAvatarStack">
            <span className="sharedAva me">{initials(s.labelFor(userId))}</span>
            {s.otherMember ? <span className="sharedAva them">{initials(otherLabel)}</span> : <span className="sharedAva pending"><Plus size={14} /></span>}
          </div>
          <div>
            <h1>{s.activeSpace.name}</h1>
            <div className="muted">
              {s.otherMember
                ? <>You &amp; {otherLabel} · <span className="sharedLive">● connected</span></>
                : partnerPending ? 'Waiting for your partner to accept' : 'Just you so far'}
            </div>
          </div>
        </div>
        <div className="row gap">
          {s.spaces.length > 1 ? (
            <label className="field sharedSpacePicker">
              <select className="select" value={s.activeSpaceId ?? ''} onChange={(e) => s.setActiveSpaceId(e.target.value)}>
                {s.spaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="btn sharedLeaveBtn" disabled={s.busy} onClick={() => { if (confirm('Leave this shared space? Your shared history stays for the other member.')) void s.leaveSpace(s.activeSpace!.id) }}>
            <LogOut size={15} /> Leave
          </button>
        </div>
      </header>

      {partnerPending ? (
        <div className="card sharedPendingBanner">
          <div><Send size={16} /> Invite sent to <strong>{s.outgoingInvites[0].invitee_email}</strong>. They'll appear here once they accept. You can still log shared expenses now — the split is tracked and reconciles when they join.</div>
        </div>
      ) : null}

      {!s.otherMember && !partnerPending ? (
        <div className="card sharedInlineInvite">
          <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div><strong>Invite your partner</strong><div className="muted">Add their Budgetly email to start splitting together.</div></div>
            <div className="row gap">
              <input className="input" type="email" placeholder="partner@email.com" value={invitePartnerEmail} onChange={(e) => setInvitePartnerEmail(e.target.value)} />
              <button className="btn primary" disabled={s.busy || !invitePartnerEmail.trim()} onClick={async () => {
                const res = await s.invitePartner(s.activeSpace!.id, invitePartnerEmail)
                if (res.ok) setInvitePartnerEmail('')
              }}><Send size={15} /> Send invite</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Balance hero */}
      <div className={`sharedSettle ${settled ? 'isSettled' : net > 0 ? 'owedToMe' : 'iOwe'}`}>
        <div className="sharedSettleWho">
          <div className="sharedSettleLabel">
            {settled ? 'You’re all square' : net > 0 ? `${otherLabel} owes you` : `You owe ${otherLabel}`}
          </div>
          <div className="sharedSettleBig tnum">{settled ? money(0) : money(Math.abs(net))}</div>
        </div>
        {!settled && s.otherMember ? (
          <button className="btn primary sharedSettleBtn" onClick={() => { setSettleAmount(String(Math.abs(net).toFixed(2))); setSettleOpen(true) }}>
            <Handshake size={16} /> Settle up
          </button>
        ) : <span className="sharedSettleCheck"><Check size={16} /> Nothing to settle</span>}
      </div>

      {/* Dashboard KPIs */}
      <div className="sharedKpis">
        <div className="card sharedKpi a"><span className="k">Shared total</span><strong className="tnum">{money(s.totalShared)}</strong><span className="muted">{s.spaceExpenses.length} expense{s.spaceExpenses.length === 1 ? '' : 's'}</span></div>
        <div className="card sharedKpi b"><span className="k">You paid</span><strong className="tnum">{money(myPaid)}</strong><span className="muted">{myPct}% of shared</span></div>
        <div className="card sharedKpi c"><span className="k">{s.otherMember ? `${otherLabel} paid` : 'Partner paid'}</span><strong className="tnum">{money(otherPaid)}</strong><span className="muted">{s.totalShared > 0 ? 100 - myPct : 0}% of shared</span></div>
        <div className={`card sharedKpi ${net >= 0 ? 'd' : 'e'}`}><span className="k">Net balance</span><strong className={`tnum ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>{net > 0 ? '+' : net < 0 ? '−' : ''}{money(Math.abs(net))}</strong><span className="muted">{settled ? 'settled' : net > 0 ? 'in your favor' : 'you owe'}</span></div>
      </div>

      {/* Who paid what bar */}
      {s.totalShared > 0 ? (
        <div className="card sharedSplitBar">
          <div className="row between" style={{ marginBottom: 8 }}><strong>Who's paid what</strong><span className="muted">Target 50 / 50</span></div>
          <div className="sharedBar"><span className="me" style={{ width: `${myPct}%` }} /><span className="them" style={{ width: `${100 - myPct}%` }} /></div>
          <div className="sharedBarLegend">
            <span><i className="me" /> You · {money(myPaid)}</span>
            <span><i className="them" /> {s.otherMember ? otherLabel : 'Partner'} · {money(otherPaid)}</span>
          </div>
        </div>
      ) : null}

      {/* Add shared expense */}
      <div className="card sharedAddCard">
        <h3><ReceiptText size={17} /> Add a shared expense</h3>
        <div className="sharedAddGrid">
          <label className="field sharedEmojiField">
            <span>Icon</span>
            <div className="sharedEmojiRow">
              {EMOJI_CHOICES.map((em) => (
                <button key={em} type="button" className={`sharedEmojiBtn ${emoji === em ? 'active' : ''}`} onClick={() => setEmoji(em)}>{em}</button>
              ))}
            </div>
          </label>
          <label className="field">
            <span>Amount</span>
            <input className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span>What for?</span>
            <input className="input" placeholder="Groceries, rent, dinner…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </label>
        </div>

        <div className="sharedWhoPaid">
          <span className="muted">Paid by</span>
          <div className="sharedToggle">
            <button className={paidByMe ? 'active' : ''} onClick={() => setPaidByMe(true)}>You</button>
            <button className={!paidByMe ? 'active' : ''} onClick={() => setPaidByMe(false)} disabled={!s.otherMember}>{s.otherMember ? otherLabel : 'Partner'}</button>
          </div>
        </div>

        <div className="sharedSplitPicker">
          {SPLIT_OPTIONS.map((opt) => (
            <button key={opt.id} type="button" className={`sharedSplitOpt ${splitType === opt.id ? 'active' : ''}`} onClick={() => setSplitType(opt.id)}>
              <strong>{opt.label}</strong><span>{opt.hint}</span>
            </button>
          ))}
        </div>

        {splitType === 'percent' ? (
          <div className="sharedPercentRow">
            <span className="muted">You cover</span>
            <input type="range" min={0} max={100} step={5} value={payerShare} onChange={(e) => setPayerShare(Number(e.target.value))} />
            <span className="sharedPercentVal tnum">{payerShare}%</span>
            <span className="muted">· {s.otherMember ? otherLabel : 'partner'} {100 - payerShare}%</span>
          </div>
        ) : null}

        <div className="row between" style={{ marginTop: 12 }}>
          <span className="muted sharedSplitPreview">
            {amount && parseFloat(amount) > 0 ? previewLine(parseFloat(amount), splitType, payerShare, paidByMe, otherLabel, money) : 'Enter an amount to see the split'}
          </span>
          <button className="btn primary" disabled={s.busy || !amount || parseFloat(amount) <= 0} onClick={() => void submitExpense()}><Plus size={16} /> Add expense</button>
        </div>
      </div>

      {/* Activity ledger */}
      <div className="card sharedActivityCard">
        <div className="row between" style={{ marginBottom: 6 }}><h3 style={{ margin: 0 }}><Wallet size={17} /> Activity</h3><span className="muted">{activity.length} item{activity.length === 1 ? '' : 's'}</span></div>
        {activity.length === 0 ? (
          <div className="sharedEmptyActivity"><Sparkles size={18} /><strong>No shared activity yet</strong><span className="muted">Add your first shared expense above.</span></div>
        ) : (
          <div className="sharedLedger">
            {activity.map((row) => {
              if (row.kind === 'settlement') {
                const st = row.data
                const iPaid = st.from_user === userId
                return (
                  <div key={`s-${row.id}`} className="sharedLrow settlement">
                    <div className="sharedLicon settle"><Handshake size={16} /></div>
                    <div className="sharedLmain">
                      <strong>Settlement</strong>
                      <span className="muted">{iPaid ? `You paid ${s.labelFor(st.to_user)}` : `${s.labelFor(st.from_user)} paid you`} · {formatDate(st.date)}</span>
                    </div>
                    <span className="badge sharedSettledTag">settled</span>
                    <span className="sharedAmt tnum">{money(st.amount)}</span>
                    <button className="sharedDel" title="Remove" onClick={() => void s.deleteSettlement(st.id)}><Trash2 size={14} /></button>
                  </div>
                )
              }
              const e = row.data
              const paidByMeRow = e.paid_by === userId
              const otherOwed = e.amount * Math.min(1, Math.max(0, (100 - e.payer_share) / 100))
              const delta = paidByMeRow ? otherOwed : -otherOwed
              return (
                <div key={`e-${row.id}`} className="sharedLrow">
                  <div className="sharedLicon">{e.emoji || '🧾'}</div>
                  <div className="sharedLmain">
                    <strong>{e.note || 'Shared expense'}</strong>
                    <span className="muted">{s.labelFor(e.paid_by)} paid {money(e.amount)} · {formatDate(e.date)}</span>
                  </div>
                  <span className="sharedSplitLabel">{splitLabel(e.split_type, e.payer_share, paidByMeRow, otherLabel)}</span>
                  <span className={`sharedAmt tnum ${delta > 0 ? 'owed' : delta < 0 ? 'owe' : ''}`}>
                    {delta > 0 ? '+' : delta < 0 ? '−' : ''}{money(Math.abs(delta))}
                  </span>
                  <button className="sharedDel" title="Delete" onClick={() => void s.deleteExpense(e.id)}><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {s.error ? <div className="supportNotice">{s.error}</div> : null}

      {/* Settle-up modal */}
      {settleOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setSettleOpen(false)}>
          <div className="card sharedModal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div><span className="badge"><Handshake size={14} /> Settle up</span><h2 style={{ marginTop: 10 }}>{net > 0 ? `${otherLabel} pays you` : `You pay ${otherLabel}`}</h2></div>
              <button className="btn iconBtn" onClick={() => setSettleOpen(false)}><X size={16} /></button>
            </div>
            <p className="muted">Record a repayment to clear the balance. This logs a settlement both of you can see.</p>
            <label className="field">
              <span>Amount</span>
              <input className="input" inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} />
            </label>
            <div className="row gap" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setSettleOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={s.busy || !settleAmount || parseFloat(settleAmount) <= 0} onClick={() => void submitSettle()}><Check size={15} /> Record settlement</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

// Compact label describing a single expense's split, from my perspective.
function splitLabel(type: SharedSplitType, payerShare: number, paidByMe: boolean, otherLabel: string): string {
  if (type === 'payer_full') return paidByMe ? 'you covered' : `${otherLabel} covered`
  if (type === 'other_full') return paidByMe ? `${otherLabel} owes all` : 'you owe all'
  if (type === 'equal') return 'split 50/50'
  const other = 100 - payerShare
  return paidByMe ? `you ${payerShare} / ${otherLabel} ${other}` : `${otherLabel} ${payerShare} / you ${other}`
}

// One-line preview of what the split means before saving.
function previewLine(amount: number, type: SharedSplitType, payerShare: number, paidByMe: boolean, otherLabel: string, money: (n: number) => string): string {
  if (type === 'payer_full') return paidByMe ? `You cover the full ${money(amount)}` : `${otherLabel} covers the full ${money(amount)}`
  const payerPct = type === 'equal' ? 50 : type === 'other_full' ? 0 : payerShare
  const otherOwed = amount * ((100 - payerPct) / 100)
  if (otherOwed <= 0) return `No one owes anything`
  return paidByMe ? `${otherLabel} will owe you ${money(otherOwed)}` : `You'll owe ${otherLabel} ${money(otherOwed)}`
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default SharedBudgetingView
