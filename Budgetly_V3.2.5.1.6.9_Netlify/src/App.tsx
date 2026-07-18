import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, BarChart3, ListChecks, Tags, Repeat, LifeBuoy, Wrench, Target, Sparkles, ArrowLeftRight, Settings, ChevronRight, CalendarDays, X, CircleHelp, Plus, Bell, Search, Copy, Trash2, Pencil, ShieldCheck, ScrollText, Download, Upload, KeyRound, TrendingUp } from 'lucide-react'
import Auth from './components/Auth'
import LandingPage from './components/LandingPage'
import Sidebar, { ViewKey } from './components/Sidebar'
import { supabase } from './lib/supabase'
import { readCachedUserProfile, syncProfileCacheForUser, loadProfileFromTable, markWalkthroughCompleted } from './lib/userProfile'
import { monthKey } from './lib/utils'
import { useBudgetApp } from './hooks/useBudgetApp'
import { useSuperAdmin } from './hooks/useSuperAdmin'
import { AdviceView, CategoriesView, CurrencyConverterView, DashboardView, GoalsView, HelpSupportView, RecurringView, ReportsView, SettingsView, TransactionsView, type AdviceNavTarget } from './components/AppViews'
import { InvestmentsView } from './components/InvestmentsView'
import { OfflineStatusBanner } from './components/pwa/OfflineStatusBanner'
import { PwaUpdateBanner } from './components/pwa/PwaUpdateBanner'
import UniversalSearch, { CommandItem } from './components/UniversalSearch'
import WelcomeWalkthrough, { TourDestination } from './components/WelcomeWalkthrough'
import MonthEndSummary from './components/MonthEndSummary'
import { monthSummaryTargetFor } from './lib/monthSummary'

const THEME_KEY = 'raswibudgeting:theme'
const MONTH_SUMMARY_SEEN_KEY = 'budgetly:month-summary-seen'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const IDLE_WARNING_MS = 60 * 1000
const TAB_CLOSE_TIMEOUT_MS = 5 * 60 * 1000
const LAST_TAB_CLOSED_AT_KEY = 'budgetly:last-tab-closed-at'


type ToastItem = { id: number; message: string }

// Storage access can throw (private mode, browser tracking prevention). These
// helpers keep those failures from bubbling up as uncaught errors.
const safeStorageGet = (key: string): string | null => {
  try { return localStorage.getItem(key) } catch { return null }
}
const safeStorageSet = (key: string, value: string) => {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

const getTimeGreeting = (date = new Date()) => {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const getDisplayName = (firstName: string, lastName: string, email: string | null) => {
  const fullName = `${firstName} ${lastName}`.trim()
  if (fullName) return fullName
  return (email || 'User').split('@')[0]
}

const showToast = (message: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('budgetly:toast', { detail: { message } }))
}

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [view, setView] = useState<ViewKey | 'utilities_hub'>('dashboard')
  const [toolsSection, setToolsSection] = useState<'goals' | 'reports' | 'converter' | 'debt' | 'investments'>('goals')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'))
  const [idleWarningOpen, setIdleWarningOpen] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState(Math.ceil(IDLE_WARNING_MS / 1000))
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [universalSearchOpen, setUniversalSearchOpen] = useState(false)
  const [mobileUnreadCount, setMobileUnreadCount] = useState(0)
  const [showWalkthrough, setShowWalkthrough] = useState(false)
  const [monthSummaryTarget, setMonthSummaryTarget] = useState<string | null>(null)
  // Controls the logged-out experience: the marketing landing page first, then
  // the sign-in / sign-up form once the visitor chooses to continue.
  const [authEntry, setAuthEntry] = useState<'landing' | 'signin' | 'signup'>('landing')
  const warningTimerRef = useRef<number | null>(null)
  const signOutTimerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)

  const budget = useBudgetApp(userId)
  const admin = useSuperAdmin(userId, email)

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Fade out the instant boot splash (declared in index.html) once the session
  // check is done and the app is about to paint real content.
  useEffect(() => {
    if (!sessionChecked) return
    const splash = document.getElementById('boot-splash')
    if (!splash) return
    const fadeId = window.setTimeout(() => {
      splash.classList.add('boot-splash--hide')
      window.setTimeout(() => splash.remove(), 450)
    }, 60)
    return () => window.clearTimeout(fadeId)
  }, [sessionChecked])

  useEffect(() => {
    document.body.classList.toggle('mobile-app', isMobile)
    return () => document.body.classList.remove('mobile-app')
  }, [isMobile])

  useEffect(() => {
    const isAuthPage = !userId
    document.body.classList.toggle('auth-active', isAuthPage)
    return () => document.body.classList.remove('auth-active')
  }, [userId])

  useEffect(() => {
    const onUnread = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      setMobileUnreadCount(Math.max(0, Number(detail?.count ?? 0)))
    }
    window.addEventListener('budgetly:notif-unread', onUnread as EventListener)
    return () => window.removeEventListener('budgetly:notif-unread', onUnread as EventListener)
  }, [])


  useEffect(() => {
    let sequence = 0
    const handleToast = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>
      const message = custom.detail?.message?.trim()
      if (!message) return
      const id = Date.now() + sequence++
      setToasts((current) => [...current, { id, message }].slice(-4))
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 2600)
    }

    window.addEventListener('budgetly:toast', handleToast as EventListener)
    return () => window.removeEventListener('budgetly:toast', handleToast as EventListener)
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const onChange = () => {
      const mobile = mediaQuery.matches
      setIsMobile(mobile)
      if (mobile) setCollapsed(true)
    }

    onChange()

    if ('addEventListener' in mediaQuery) {
      mediaQuery.addEventListener('change', onChange)
      return () => mediaQuery.removeEventListener('change', onChange)
    }

    mediaQuery.addListener(onChange)
    return () => mediaQuery.removeListener(onChange)
  }, [])

  useEffect(() => {
    const boot = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const session = sessionData.session
      const lastTabClosedAtRaw = localStorage.getItem(LAST_TAB_CLOSED_AT_KEY)
      const lastTabClosedAt = lastTabClosedAtRaw ? Number(lastTabClosedAtRaw) : NaN
      const isSessionExpiredFromTabClose = Number.isFinite(lastTabClosedAt) && Date.now() - lastTabClosedAt > TAB_CLOSE_TIMEOUT_MS

      if (session && isSessionExpiredFromTabClose) {
        await supabase.auth.signOut()
        localStorage.removeItem(LAST_TAB_CLOSED_AT_KEY)
        setUserId(null)
        setEmail(null)
        setSessionChecked(true)
        return
      }

      const user = session?.user ?? null
      setUserId(user?.id ?? null)
      setEmail(user?.email ?? null)
      await syncProfileCacheForUser(user)
      if (user) localStorage.removeItem(LAST_TAB_CLOSED_AT_KEY)
      setSessionChecked(true)
    }

    void boot()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setUserId(user?.id ?? null)
      setEmail(user?.email ?? null)
      void syncProfileCacheForUser(user)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const markTabClosed = () => {
      localStorage.setItem(LAST_TAB_CLOSED_AT_KEY, String(Date.now()))
    }

    window.addEventListener('pagehide', markTabClosed)
    return () => window.removeEventListener('pagehide', markTabClosed)
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(LAST_TAB_CLOSED_AT_KEY)
    setUserId(null)
    setEmail(null)
  }

  useEffect(() => {
    return () => {
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
      if (signOutTimerRef.current) window.clearTimeout(signOutTimerRef.current)
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      setIdleWarningOpen(false)
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
      if (signOutTimerRef.current) window.clearTimeout(signOutTimerRef.current)
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
      return
    }

    const resetIdleTimers = () => {
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
      if (signOutTimerRef.current) window.clearTimeout(signOutTimerRef.current)
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
      setIdleWarningOpen(false)
      setIdleCountdown(Math.ceil(IDLE_WARNING_MS / 1000))

      warningTimerRef.current = window.setTimeout(() => {
        setIdleWarningOpen(true)
        setIdleCountdown(Math.ceil(IDLE_WARNING_MS / 1000))
        countdownTimerRef.current = window.setInterval(() => {
          setIdleCountdown((current) => (current <= 1 ? 0 : current - 1))
        }, 1000)
      }, IDLE_TIMEOUT_MS - IDLE_WARNING_MS)

      signOutTimerRef.current = window.setTimeout(() => {
        if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
        setIdleWarningOpen(false)
        void signOut()
      }, IDLE_TIMEOUT_MS)
    }

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    const handleActivity = () => resetIdleTimers()

    resetIdleTimers()
    activityEvents.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }))

    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, handleActivity))
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
      if (signOutTimerRef.current) window.clearTimeout(signOutTimerRef.current)
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
    }
  }, [userId])

  const staySignedIn = () => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
    if (signOutTimerRef.current) window.clearTimeout(signOutTimerRef.current)
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
    setIdleWarningOpen(false)
    setIdleCountdown(Math.ceil(IDLE_WARNING_MS / 1000))
    showToast('Session continued')
    window.dispatchEvent(new Event('mousemove'))
  }

  // Show the first-time walkthrough once per user, after their account
  // role/feature access has loaded and the account is active. The completion
  // flag is persisted on the user's profile so the tour only shows once
  // across every device and browser.
  useEffect(() => {
    if (!userId || admin.loading) return
    if (admin.profile && !admin.profile.is_active) return
    let cancelled = false
    void (async () => {
      try {
        const profile = await loadProfileFromTable(userId)
        if (!cancelled && !profile.walkthroughCompleted) setShowWalkthrough(true)
      } catch {
        /* If the flag can't be read, don't block the app or nag the user. */
      }
    })()
    return () => { cancelled = true }
  }, [userId, admin.loading, admin.profile])

  // Let other views (e.g. Help & Support) replay the walkthrough on demand.
  useEffect(() => {
    const replay = () => setShowWalkthrough(true)
    window.addEventListener('budgetly:start-walkthrough', replay)
    return () => window.removeEventListener('budgetly:start-walkthrough', replay)
  }, [])

  const dismissWalkthrough = () => {
    setShowWalkthrough(false)
    if (userId) void markWalkthroughCompleted(userId).catch(() => { /* best-effort persistence */ })
  }

  // Surface the month-end summary once, on the last day of a month (with a short
  // grace window into the next month). It's remembered per user + month in
  // localStorage so it never nags after being dismissed. Only shown when the
  // month actually has recorded activity — an empty recap isn't worth a popup.
  useEffect(() => {
    if (!userId || admin.loading) return
    if (admin.profile && !admin.profile.is_active) return
    if (showWalkthrough) return
    const target = monthSummaryTargetFor()
    if (!target) return
    const seenKey = `${MONTH_SUMMARY_SEEN_KEY}:${userId}`
    if (safeStorageGet(seenKey) === target) return
    const hasActivity = budget.data.transactions.some((tx) => monthKey(tx.date) === target)
    if (!hasActivity) return
    setMonthSummaryTarget(target)
  }, [userId, admin.loading, admin.profile, showWalkthrough, budget.data.transactions])

  const dismissMonthSummary = () => {
    if (userId && monthSummaryTarget) {
      safeStorageSet(`${MONTH_SUMMARY_SEEN_KEY}:${userId}`, monthSummaryTarget)
    }
    setMonthSummaryTarget(null)
  }

  // Let other surfaces (e.g. a menu action) reopen the latest month's summary on demand.
  useEffect(() => {
    const replay = () => {
      const target = monthSummaryTargetFor() ?? monthKey(new Date().toISOString())
      setMonthSummaryTarget(target)
    }
    window.addEventListener('budgetly:show-month-summary', replay)
    return () => window.removeEventListener('budgetly:show-month-summary', replay)
  }, [])

  const orderedViews = useMemo<ViewKey[]>(() => ['dashboard', 'transactions', 'categories', 'recurring', 'advice', 'tools', 'settings', 'support'], [])
  const firstAllowedView = useMemo(() => {
    if (admin.isSuperAdmin) return 'dashboard' as ViewKey
    return orderedViews.find((candidate) => {
      if (candidate === 'dashboard') return admin.visibleFeatures.dashboard
      if (candidate === 'transactions') return admin.visibleFeatures.transactions
      if (candidate === 'categories') return admin.visibleFeatures.categories
      if (candidate === 'recurring') return admin.visibleFeatures.recurring
      if (candidate === 'advice') return admin.visibleFeatures.advice
      if (candidate === 'tools') return true
      if (candidate === 'settings') return admin.visibleFeatures.settings
      if (candidate === 'support') return admin.visibleFeatures.support
      return false
    }) ?? 'settings'
  }, [admin.isSuperAdmin, admin.visibleFeatures, orderedViews])

  useEffect(() => {
    if (!userId || admin.loading) return
    if (admin.profile && !admin.profile.is_active) return
    if (view === 'super_admin') {
      setView('settings')
      return
    }
    const allowed =
      view === 'dashboard' ? admin.visibleFeatures.dashboard :
      view === 'transactions' ? admin.visibleFeatures.transactions :
      view === 'categories' ? admin.visibleFeatures.categories :
      view === 'recurring' ? admin.visibleFeatures.recurring :
      view === 'advice' ? admin.visibleFeatures.advice :
      view === 'tools' ? true :
      view === 'settings' ? admin.visibleFeatures.settings :
      view === 'support' ? admin.visibleFeatures.support :
      true
    if (!allowed) setView(firstAllowedView)
  }, [userId, admin.loading, admin.profile, admin.isSuperAdmin, admin.visibleFeatures, view, firstAllowedView])

  useEffect(() => {
    if (view !== 'tools' && view !== 'utilities_hub') return
    if (toolsSection === 'goals' && !admin.visibleFeatures.goals) {
      if (admin.visibleFeatures.reports) setToolsSection('reports')
      else if (admin.visibleFeatures.converter) setToolsSection('converter')
    }
    if (toolsSection === 'reports' && !admin.visibleFeatures.reports) {
      if (admin.visibleFeatures.goals) setToolsSection('goals')
      else if (admin.visibleFeatures.converter) setToolsSection('converter')
    }
    if (toolsSection === 'converter' && !admin.visibleFeatures.converter) {
      if (admin.visibleFeatures.goals) setToolsSection('goals')
      else if (admin.visibleFeatures.reports) setToolsSection('reports')
      else if (admin.visibleFeatures.investments) setToolsSection('investments')
    }
    if (toolsSection === 'investments' && !admin.visibleFeatures.investments) {
      if (admin.visibleFeatures.goals) setToolsSection('goals')
      else if (admin.visibleFeatures.reports) setToolsSection('reports')
      else if (admin.visibleFeatures.converter) setToolsSection('converter')
    }
  }, [view, toolsSection, admin.visibleFeatures])

  const handleViewChange = (nextView: ViewKey) => {
    setView(nextView)
    if (nextView === 'tools') {
      setToolsSection((current) => current || 'goals')
    }
    if (isMobile) setCollapsed(true)
  }

  // Navigation used by the guided walkthrough as it moves between pages.
  const handleTourNavigate = (dest: TourDestination) => {
    if (dest === 'tools') {
      setToolsSection('goals')
      handleViewChange('tools')
      return
    }
    handleViewChange(dest)
  }

  // Route a clicked notification (action_target) to the right view / tools section.
  const handleNotificationNavigate = (target: string) => {
    if (target === 'goals') { setToolsSection('goals'); handleViewChange('tools'); return }
    if (target === 'utilities/investments') { setToolsSection('investments'); handleViewChange('tools'); return }
    if (target === 'utilities/reports') { setToolsSection('reports'); handleViewChange('tools'); return }
    const direct = ['dashboard', 'transactions', 'categories', 'recurring', 'advice', 'tools', 'settings', 'support'] as const
    if ((direct as readonly string[]).includes(target)) handleViewChange(target as ViewKey)
  }

  const isEditableTarget = (target: EventTarget | null) => {
    const node = target as HTMLElement | null
    if (!node) return false
    const tag = node.tagName?.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable || !!node.closest('[contenteditable="true"], [role="textbox"], .modal form')
  }

  const getUniversalSearchShortcut = () => {
    const saved = window.localStorage.getItem('budgetly_universal_search_shortcut')?.trim()
    return saved || 'Ctrl + Shift + Space'
  }

  // Live records (transactions, categories, goals, recurring) surfaced in the command palette.
  const dataCommandItems = useMemo<CommandItem[]>(() => {
    const currency = budget.data.currency || 'CAD'
    const money = (n: number) => budget.helpers.fmtMoney(n, currency)
    const categoryName = (id: string | null) => (id ? budget.catsById.get(id)?.name ?? 'Uncategorized' : 'Uncategorized')
    const formatDate = (iso: string) => {
      const parsed = new Date(`${iso}T00:00:00`)
      return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    }
    const items: CommandItem[] = []

    if (admin.visibleFeatures.transactions) {
      budget.data.transactions.forEach((tx) => {
        const category = categoryName(tx.category_id)
        const note = (tx.note ?? '').trim()
        const label = note || category || (tx.type === 'income' ? 'Income' : 'Expense')
        const sign = tx.type === 'income' ? '+' : '-'
        items.push({
          id: `tx-${tx.id}`,
          group: 'transactions',
          type: 'transaction',
          label,
          description: `${category} • ${formatDate(tx.date)}`,
          keywords: [category, tx.type, tx.date, note, String(tx.amount)].filter(Boolean) as string[],
          meta: `${sign}${money(tx.amount)}`,
          iconClassName: tx.type === 'income' ? 'green' : 'indigo',
          icon: <ListChecks size={16} />,
          onSelect: () => {
            budget.setTxType('all')
            budget.setTxActiveMonth(monthKey(tx.date))
            budget.setTxSearch(note || category)
            handleViewChange('transactions')
          },
          subActions: [
            { id: 'edit', label: 'Edit transaction', icon: <Pencil size={14} />, onSelect: () => { handleViewChange('transactions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:edit-transaction', { detail: { id: tx.id } })), 0) } },
            { id: 'duplicate', label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => budget.duplicateTransaction(tx.id) },
            { id: 'delete', label: 'Delete transaction', icon: <Trash2 size={14} />, destructive: true, onSelect: () => { handleViewChange('transactions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:delete-transaction', { detail: { id: tx.id } })), 0) } },
          ],
        })
      })
    }

    if (admin.visibleFeatures.categories) {
      budget.data.categories.forEach((category) => {
        items.push({
          id: `cat-${category.id}`,
          group: 'categories',
          type: 'category',
          label: `${category.emoji ? `${category.emoji} ` : ''}${category.name}`,
          description: category.budget_monthly ? `Monthly budget ${money(category.budget_monthly)}` : 'Budget category',
          keywords: [category.name, 'category', 'budget'],
          meta: category.budget_monthly ? money(category.budget_monthly) : undefined,
          iconClassName: 'green',
          icon: <Tags size={16} />,
          onSelect: () => handleViewChange('categories'),
        })
      })
    }

    if (admin.visibleFeatures.goals) {
      budget.data.goals.forEach((goal) => {
        const pct = goal.target_amount > 0 ? Math.round((goal.current_amount / goal.target_amount) * 100) : 0
        items.push({
          id: `goal-${goal.id}`,
          group: 'goals',
          type: 'goal',
          label: `${goal.emoji ? `${goal.emoji} ` : ''}${goal.name}`,
          description: `${money(goal.current_amount)} of ${money(goal.target_amount)} • ${pct}% saved`,
          keywords: [goal.name, 'goal', 'savings', 'target'],
          meta: `${pct}%`,
          iconClassName: 'gold',
          icon: <Target size={16} />,
          onSelect: () => { setToolsSection('goals'); handleViewChange('tools') },
        })
      })
    }

    if (admin.visibleFeatures.recurring) {
      budget.data.recurring.forEach((item) => {
        items.push({
          id: `rec-${item.id}`,
          group: 'recurring',
          type: 'recurring',
          label: item.name,
          description: `${item.recurrence_type} • ${money(item.amount)}`,
          keywords: [item.name, 'recurring', item.recurrence_type, item.kind ?? 'expense'],
          meta: money(item.amount),
          iconClassName: 'blue',
          icon: <Repeat size={16} />,
          onSelect: () => handleViewChange('recurring'),
        })
      })
    }

    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget.data.transactions, budget.data.categories, budget.data.goals, budget.data.recurring, budget.data.currency, budget.catsById, admin.visibleFeatures])

  const parseQuickAdd = (raw: string): CommandItem | null => {
    if (!admin.visibleFeatures.transactions) return null
    const text = raw.trim()
    const amountMatch = text.match(/(?:^|\s)\$?(\d+(?:[.,]\d{1,2})?)(?=\s|$)/)
    if (!amountMatch) return null
    const amount = parseFloat(amountMatch[1].replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) return null
    const description = text.replace(amountMatch[0], ' ').replace(/\$/g, '').replace(/\s+/g, ' ').trim()
    const isIncome = /\b(income|salary|paid|payday|deposit|refund|bonus)\b/i.test(description)
    const money = budget.helpers.fmtMoney(amount, budget.data.currency || 'CAD')
    return {
      id: 'quickadd-transaction',
      group: 'actions',
      type: 'action',
      label: `Add ${isIncome ? 'income' : 'expense'}: ${money}${description ? ` — ${description}` : ''}`,
      description: 'Create a transaction pre-filled from your search',
      keywords: ['add', 'quick', 'new', 'transaction'],
      iconClassName: 'indigo',
      icon: <Plus size={16} />,
      onSelect: () => {
        handleViewChange('transactions')
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:focus-add-transaction', {
          detail: { amount: String(amount), note: description, type: isIncome ? 'income' : 'expense' },
        })), 0)
      },
    }
  }

  const formatShortcutFromEvent = (event: KeyboardEvent) => {
    const key = event.key
    const normalizedKey = key.length === 1 ? key.toUpperCase() : key
    const displayKey = normalizedKey === ' ' || normalizedKey === 'Spacebar' || event.code === 'Space' ? 'Space'
      : normalizedKey === '/' || event.code === 'Slash' ? 'Slash'
      : normalizedKey === '.' || event.code === 'Period' ? 'Period'
      : normalizedKey === ',' || event.code === 'Comma' ? 'Comma'
      : normalizedKey === '-' || event.code === 'Minus' ? 'Minus'
      : normalizedKey === '=' || event.code === 'Equal' ? 'Equal'
      : normalizedKey
    const modifiers: string[] = []
    if (event.ctrlKey) modifiers.push('Ctrl')
    if (event.metaKey) modifiers.push('Cmd')
    if (event.altKey) modifiers.push('Alt')
    if (event.shiftKey) modifiers.push('Shift')
    return [...modifiers, displayKey].join(' + ')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const currentShortcut = getUniversalSearchShortcut()
      const pressedShortcut = formatShortcutFromEvent(event)
      const isOpenSearchShortcut = pressedShortcut === currentShortcut
      if (isOpenSearchShortcut && !isEditableTarget(event.target)) {
        event.preventDefault()
        setUniversalSearchOpen(true)
        return
      }
      if (!event.ctrlKey && !event.metaKey) return
      if (event.shiftKey || event.metaKey) return

      if (event.altKey && event.key.toLowerCase() === 't' && admin.visibleFeatures.transactions) {
        event.preventDefault()
        event.stopPropagation()
        handleViewChange('transactions')
        return
      }
      if (event.altKey) return

      if (isEditableTarget(event.target)) return

      const key = event.key.toLowerCase()
      const goTo = (nextView: ViewKey, tools?: 'goals' | 'reports' | 'converter' | 'debt') => {
        event.preventDefault()
        if (tools) setToolsSection(tools)
        handleViewChange(nextView)
      }

      if (key === 'd' && admin.visibleFeatures.dashboard) goTo('dashboard')

      if (key === 'c' && admin.visibleFeatures.categories) goTo('categories')
      if (key === 'r' && admin.visibleFeatures.recurring) goTo('recurring')
      if (key === 'a' && admin.visibleFeatures.advice) goTo('advice')
      if (key === 'g' && admin.visibleFeatures.goals) goTo('tools', 'goals')
      if (key === 's' && admin.visibleFeatures.settings) goTo('settings')
      if (key === 'h' && admin.visibleFeatures.support) goTo('support')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [admin.visibleFeatures, isMobile])

  if (!sessionChecked) return null
  if (!userId) {
    if (authEntry === 'landing') {
      return (
        <LandingPage
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          onSignIn={() => setAuthEntry('signin')}
          onSignUp={() => setAuthEntry('signup')}
        />
      )
    }
    return <Auth initialMode={authEntry} onBack={() => setAuthEntry('landing')} />
  }
  if (admin.loading) return <div className="appStatusScreen"><div className="card"><h2>Loading workspace</h2><div className="muted">Checking your account role, feature access, and workspace permissions.</div></div></div>
  if (admin.profile && !admin.profile.is_active) {
    return (
      <div className="appStatusScreen">
        <div className="card statusCard">
          <span className="badge">Access paused</span>
          <h2>Your account is inactive</h2>
          <p className="muted">A Super Admin has disabled this account. Contact support or an administrator to restore access.</p>
          <div className="row gap" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => window.location.assign('mailto:codeversesolutions@gmail.com?subject=Budgetly%20Account%20Reactivation')}>Contact support</button>
            <button className="btn danger" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }

  const profile = readCachedUserProfile()
  const profileName = getDisplayName(profile.firstName, profile.lastName, email)
  const timeGreeting = getTimeGreeting()
  const profileImage = profile.image

  const handleAdviceNavigate = (target: AdviceNavTarget) => {
    if (target.view === 'goals') {
      setToolsSection('goals')
      handleViewChange('tools')
      return
    }
    if (target.view === 'transactions') {
      if (target.txType) {
        budget.setTxType(target.txType)
        budget.setTxSearch('')
      }
      handleViewChange('transactions')
      return
    }
    handleViewChange(target.view as ViewKey)
  }

  const handleOpenTransactionsByType = (type: 'income' | 'expense') => {
    budget.setTxType(type)
    budget.setTxSearch('')
    budget.setTxDraft((current) => ({
      ...current,
      type,
      category_id: type === 'income' ? current.category_id : current.category_id,
    }))
    handleViewChange('transactions')
  }

  const handleThemeToggle = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    showToast(nextTheme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled')
  }

  const goToTools = (section: 'goals' | 'reports' | 'converter' | 'investments') => {
    setToolsSection(section)
    handleViewChange('tools')
  }

  const goToSettingsSection = (section: 'general' | 'data' | 'account' | 'admin' | 'audit' | 'bugs') => {
    handleViewChange('settings')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:open-settings-section', { detail: { section } })), 0)
  }

  const staticCommandItems: Array<Omit<CommandItem, 'group'>> = [
    { id: 'page-dashboard', type: 'page', label: 'Dashboard', description: 'View your financial overview and key insights', keywords: ['home', 'overview', 'summary'], onSelect: () => handleViewChange('dashboard'), iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'page-transactions', type: 'page', label: 'Transactions', description: 'View and manage your transactions', keywords: ['transactions', 'income', 'expense'], onSelect: () => handleViewChange('transactions'), iconClassName: 'indigo', icon: <ListChecks size={16} /> },
    { id: 'page-categories', type: 'page', label: 'Categories', description: 'Manage your budget categories', keywords: ['budget', 'tags', 'category'], onSelect: () => handleViewChange('categories'), iconClassName: 'green', icon: <Tags size={16} /> },
    { id: 'page-recurring', type: 'page', label: 'Recurring', description: 'View and manage recurring transactions', keywords: ['recurring', 'schedule', 'repeat'], onSelect: () => handleViewChange('recurring'), iconClassName: 'blue', icon: <Repeat size={16} /> },
    { id: 'page-advice', type: 'page', label: 'Insights', description: 'Get personalized financial insights and tips', keywords: ['advice', 'tips', 'insights'], onSelect: () => handleViewChange('advice'), iconClassName: 'purple', icon: <Sparkles size={16} /> },
    { id: 'page-goals', type: 'page', label: 'Goals', description: 'Track and manage your savings goals', keywords: ['goals', 'savings', 'targets'], onSelect: () => { setToolsSection('goals'); handleViewChange('tools') }, iconClassName: 'gold', icon: <Target size={16} /> },
    { id: 'page-reports', type: 'page', label: 'Reports', description: 'View monthly insights and summaries', keywords: ['reports', 'summary', 'analytics'], onSelect: () => { setToolsSection('reports'); handleViewChange('tools') }, iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'page-settings', type: 'page', label: 'Settings', description: 'Manage account and app preferences', keywords: ['settings', 'preferences', 'account', 'general'], onSelect: () => handleViewChange('settings'), iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'page-support', type: 'page', label: 'Help & Support', description: 'Get help and contact support', keywords: ['help', 'support', 'contact'], onSelect: () => handleViewChange('support'), iconClassName: 'teal', icon: <CircleHelp size={16} /> },
    { id: 'action-add-transaction', type: 'action', label: 'Add transaction', description: 'Create a new income or expense transaction', keywords: ['add', 'transaction', 'expense', 'income', 'new', 'quick add'], onSelect: () => { handleViewChange('transactions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:focus-add-transaction')), 0) }, iconClassName: 'indigo', icon: <Plus size={16} /> },
    { id: 'action-theme-toggle', type: 'action', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', description: 'Change Budgetly appearance', keywords: ['theme', 'dark', 'light', 'appearance', 'mode'], onSelect: handleThemeToggle, iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'action-export-report', type: 'action', label: 'Export report', description: 'Open reports export options', keywords: ['export', 'report', 'pdf', 'download', 'summary'], onSelect: () => { setToolsSection('reports'); handleViewChange('tools') }, iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'action-open-settings', type: 'action', label: 'Open settings', description: 'Manage account and app preferences', keywords: ['settings', 'preferences', 'account', 'general'], onSelect: () => handleViewChange('settings'), iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'action-go-this-month', type: 'action', label: 'Go to this month', description: 'Return Budgetly views to the current month', keywords: ['this month', 'current month', 'today', 'reset month'], onSelect: () => { handleViewChange('dashboard'); window.dispatchEvent(new CustomEvent('budgetly:go-to-current-month')) }, iconClassName: 'violet', icon: <CalendarDays size={16} /> },
    { id: 'action-view-goals', type: 'action', label: 'View goals', description: 'Track and manage your savings goals', keywords: ['goals', 'savings', 'targets'], onSelect: () => goToTools('goals'), iconClassName: 'gold', icon: <Target size={16} /> },
    // Utilities sub-pages
    { id: 'page-converter', type: 'page', label: 'Currency Converter', description: 'Convert currencies with live exchange rates', keywords: ['currency', 'converter', 'convert', 'exchange', 'fx', 'rates', 'utilities'], onSelect: () => goToTools('converter'), iconClassName: 'blue', icon: <ArrowLeftRight size={16} /> },
    { id: 'page-investments', type: 'page', label: 'Investments', description: 'Track manual holdings and portfolio performance', keywords: ['investments', 'portfolio', 'holdings', 'stocks', 'assets', 'net worth', 'utilities'], onSelect: () => goToTools('investments'), iconClassName: 'green', icon: <TrendingUp size={16} /> },
    // Settings sub-pages
    { id: 'page-settings-general', type: 'page', label: 'Settings: General', description: 'Currency, theme, notifications, and shortcuts', keywords: ['settings', 'general', 'preferences', 'currency', 'theme', 'notifications'], onSelect: () => goToSettingsSection('general'), iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'page-settings-data', type: 'page', label: 'Settings: Data & Backup', description: 'Export and import your Budgetly data', keywords: ['settings', 'data', 'backup', 'export', 'import', 'csv', 'json', 'download'], onSelect: () => goToSettingsSection('data'), iconClassName: 'slate', icon: <Download size={16} /> },
    { id: 'page-settings-account', type: 'page', label: 'Settings: Account', description: 'Manage your profile and password', keywords: ['settings', 'account', 'profile', 'password', 'email', 'name'], onSelect: () => goToSettingsSection('account'), iconClassName: 'slate', icon: <KeyRound size={16} /> },
    { id: 'page-settings-admin', type: 'page', label: 'Super Admin', description: 'Manage users, roles, and workspace access', keywords: ['super admin', 'admin', 'users', 'roles', 'permissions', 'access', 'workspace'], onSelect: () => goToSettingsSection('admin'), iconClassName: 'violet', icon: <ShieldCheck size={16} /> },
    { id: 'page-settings-audit', type: 'page', label: 'Audit Log', description: 'Time-stamped history of Super Admin changes', keywords: ['audit', 'audit log', 'history', 'logs', 'activity', 'changes'], onSelect: () => goToSettingsSection('audit'), iconClassName: 'slate', icon: <ScrollText size={16} /> },
    { id: 'page-settings-bugs', type: 'page', label: 'Bugs & Fixes', description: 'Review reported bugs and their status', keywords: ['bugs', 'fixes', 'reports', 'issues', 'support'], onSelect: () => goToSettingsSection('bugs'), iconClassName: 'slate', icon: <Wrench size={16} /> },
    // Deep actions
    { id: 'action-change-password', type: 'action', label: 'Change password', description: 'Update your account password', keywords: ['password', 'change password', 'security', 'account'], onSelect: () => goToSettingsSection('account'), iconClassName: 'slate', icon: <KeyRound size={16} /> },
    { id: 'action-notification-settings', type: 'action', label: 'Notification settings', description: 'Choose which alerts Budgetly sends you', keywords: ['notifications', 'alerts', 'reminders', 'preferences'], onSelect: () => goToSettingsSection('general'), iconClassName: 'slate', icon: <Bell size={16} /> },
    { id: 'action-search-shortcut', type: 'action', label: 'Customize search shortcut', description: 'Change the universal search keyboard shortcut', keywords: ['shortcut', 'keyboard', 'search', 'hotkey', 'universal search'], onSelect: () => goToSettingsSection('general'), iconClassName: 'slate', icon: <Search size={16} /> },
    { id: 'action-export-csv', type: 'action', label: 'Export transactions (CSV)', description: 'Download this month as a CSV file', keywords: ['export', 'csv', 'download', 'transactions', 'spreadsheet', 'data'], onSelect: () => budget.exportCSV(), iconClassName: 'violet', icon: <Download size={16} /> },
    { id: 'action-export-json', type: 'action', label: 'Export backup (JSON)', description: 'Download a full backup of your data', keywords: ['export', 'json', 'backup', 'download', 'data'], onSelect: () => budget.exportJSON(), iconClassName: 'violet', icon: <Download size={16} /> },
    { id: 'action-import-data', type: 'action', label: 'Import data', description: 'Restore data from a backup file', keywords: ['import', 'restore', 'backup', 'upload', 'data'], onSelect: () => goToSettingsSection('data'), iconClassName: 'violet', icon: <Upload size={16} /> },
  ]
  const featureGate: Record<string, boolean> = {
    'page-dashboard': admin.visibleFeatures.dashboard,
    'action-go-this-month': admin.visibleFeatures.dashboard,
    'page-transactions': admin.visibleFeatures.transactions,
    'action-add-transaction': admin.visibleFeatures.transactions,
    'page-categories': admin.visibleFeatures.categories,
    'page-recurring': admin.visibleFeatures.recurring,
    'page-advice': admin.visibleFeatures.advice,
    'page-goals': admin.visibleFeatures.goals,
    'action-view-goals': admin.visibleFeatures.goals,
    'page-reports': admin.visibleFeatures.reports,
    'action-export-report': admin.visibleFeatures.reports,
    'page-converter': admin.visibleFeatures.converter,
    'page-investments': admin.visibleFeatures.investments,
    'page-support': admin.visibleFeatures.support,
    'page-settings': admin.visibleFeatures.settings,
    'action-open-settings': admin.visibleFeatures.settings,
    'action-theme-toggle': admin.visibleFeatures.settings,
    'page-settings-general': admin.visibleFeatures.settings,
    'page-settings-data': admin.visibleFeatures.settings,
    'page-settings-account': admin.visibleFeatures.settings,
    'action-change-password': admin.visibleFeatures.settings,
    'action-notification-settings': admin.visibleFeatures.settings,
    'action-search-shortcut': admin.visibleFeatures.settings,
    'action-export-csv': admin.visibleFeatures.settings,
    'action-export-json': admin.visibleFeatures.settings,
    'action-import-data': admin.visibleFeatures.settings,
    'page-settings-admin': admin.isSuperAdmin,
    'page-settings-audit': admin.isSuperAdmin,
    'page-settings-bugs': admin.isSuperAdmin,
  }
  const commandItems: CommandItem[] = staticCommandItems
    .filter((item) => featureGate[item.id] !== false)
    .map((item) => ({ ...item, group: item.type === 'page' ? 'pages' : 'actions' }) as CommandItem)
    .concat(dataCommandItems)

  return (
    <div className="container appWrap">
      <OfflineStatusBanner />
      <PwaUpdateBanner />
      {isMobile && !collapsed ? <div className="mobileOverlay" onClick={() => setCollapsed(true)} aria-hidden="true" /> : null}

      <div className={`sidebarContainer ${isMobile ? 'mobile' : ''} ${collapsed ? 'closed' : 'open'}`}>
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          view={view}
          setView={handleViewChange}
          toolsSection={toolsSection}
          setToolsSection={setToolsSection}
          sync={budget.sync}
          email={email}
          features={admin.visibleFeatures}
          theme={theme}
          onThemeToggle={handleThemeToggle}
          onSignOut={() => void signOut()}
        />
      </div>

      <main className={`main ${isMobile ? 'mainMobile' : ''}`}>
        {isMobile ? (
          <header className="mobileTopBar">
            <button className="mobileIconBtn" onClick={() => setCollapsed(false)} aria-label="Open menu"><Menu size={22} /></button>
            <div className="mobileWordmark">
              <strong>Hi, {profileName} 👋</strong><small>{timeGreeting}</small>
            </div>
            <button className="mobileIconBtn mobileSearchBtn" onClick={() => setUniversalSearchOpen(true)} aria-label="Open search">
              <Search size={20} />
            </button>
            {view === 'dashboard' ? (
              <button className="notifBellBtn mobileTopNotifBell" onClick={() => window.dispatchEvent(new Event('budgetly:toggle-notif-panel'))} aria-label="Open notifications">
                <Bell size={19} />
                {mobileUnreadCount > 0 ? <span className="notifBellBadge">{mobileUnreadCount > 99 ? '99+' : mobileUnreadCount}</span> : null}
              </button>
            ) : null}
            <button className="mobileAvatarBtn" onClick={() => handleViewChange('settings')} aria-label="Open settings">
              {profileImage ? <img src={profileImage} alt="Profile" /> : <span>{profileName.charAt(0).toUpperCase()}</span>}
            </button>
          </header>
        ) : null}

        {view === 'dashboard' && admin.visibleFeatures.dashboard ? <DashboardView budget={budget} theme={theme} onOpenTransactionsByType={handleOpenTransactionsByType} onNavigate={handleNotificationNavigate} email={email} userId={userId} /> : null}
        {view === 'transactions' && admin.visibleFeatures.transactions ? <TransactionsView budget={budget} /> : null}
        {view === 'categories' && admin.visibleFeatures.categories ? <CategoriesView budget={budget} /> : null}
        {view === 'recurring' && admin.visibleFeatures.recurring ? <RecurringView budget={budget} /> : null}
        {view === 'advice' && admin.visibleFeatures.advice ? <AdviceView budget={budget} userId={userId} onNavigate={handleAdviceNavigate} /> : null}
        {(view === 'tools' || view === 'utilities_hub') ? (
          view === 'utilities_hub' ? (
            <section className="mobileUtilitiesHub">
              <div className="mobileUtilitiesHero">
                <h1>Utilities</h1>
                <p>Tools to plan, track, and improve your finances.</p>
              </div>
              <button className="utilityCard" onClick={() => { setToolsSection('goals'); setView('tools') }}><Target size={22} /><div><strong>Goals</strong><p>Set financial goals and track your progress.</p></div><ChevronRight size={18} /></button>
              <button className="utilityCard" onClick={() => { setToolsSection('reports'); setView('tools') }}><BarChart3 size={22} /><div><strong>Reports</strong><p>View insights and reports for this month.</p></div><ChevronRight size={18} /></button>
              <button className="utilityCard" onClick={() => { setToolsSection('converter'); setView('tools') }}><ArrowLeftRight size={22} /><div><strong>Currency Converter</strong><p>Convert currencies with live exchange rates.</p></div><ChevronRight size={18} /></button>
              {admin.visibleFeatures.investments ? <button className="utilityCard" onClick={() => { setToolsSection('investments'); setView('tools') }}><BarChart3 size={22} /><div><strong>Investments</strong><p>Track manual holdings and portfolio performance.</p></div><ChevronRight size={18} /></button> : null}
            </section>
          ) : (
          <div className={`toolsPageShell toolsPageShellFixed ${toolsSection === 'converter' ? 'toolsShellConverter' : ''}`}>
            <div className={`toolsPageBody ${toolsSection === 'converter' ? 'toolsPageBodyConverter' : ''}`}>
              {toolsSection === 'goals' ? <GoalsView budget={budget} /> : null}
              {toolsSection === 'reports' ? <ReportsView budget={budget} email={email} /> : null}
              {toolsSection === 'converter' ? <CurrencyConverterView budget={budget} theme={theme} /> : null}
              {toolsSection === 'investments' && admin.visibleFeatures.investments ? <InvestmentsView /> : null}
            </div>
          </div>
          )
        ) : null}
        {view === 'support' && admin.visibleFeatures.support ? <HelpSupportView email={email} userId={userId} admin={admin} /> : null}
        {view === 'settings' && admin.visibleFeatures.settings ? <SettingsView budget={budget} theme={theme} email={email} userId={userId} onThemeToggle={handleThemeToggle} admin={admin} onSignOut={() => void signOut()} /> : null}

        {isMobile ? (
          <nav className="mobileTabBar mobileTabBarPlus" aria-label="Mobile navigation">
            {admin.visibleFeatures.dashboard ? <button data-tour="m-nav-dashboard" className={view === 'dashboard' ? 'active' : ''} onClick={() => handleViewChange('dashboard')}><BarChart3 size={18} /><span>Dashboard</span></button> : null}
            {admin.visibleFeatures.categories ? <button data-tour="m-nav-categories" className={view === 'categories' ? 'active' : ''} onClick={() => handleViewChange('categories')}><Tags size={18} /><span>Categories</span></button> : null}
            <button data-tour="m-nav-transactions" className={`mobilePlusTab ${view === 'transactions' ? 'active' : ''}`} onClick={() => handleViewChange('transactions')} aria-label="Add transaction"><Plus size={24} /><span>Add</span></button>
            <button data-tour="m-nav-tools" className={(view === 'utilities_hub' || view === 'tools') ? 'active' : ''} onClick={() => setView('utilities_hub')}><Wrench size={18} /><span>Utilities</span></button>
            {admin.visibleFeatures.settings ? <button className={view === 'settings' ? 'active' : ''} onClick={() => handleViewChange('settings')}><Settings size={18} /><span>Settings</span></button> : null}
          </nav>
        ) : null}
      </main>

      <div className="toastStack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className="toastMessage">{toast.message}</div>
        ))}
      </div>

      {idleWarningOpen ? (
        <div className="idleModalBackdrop" role="presentation">
          <div className="card idleModal" role="dialog" aria-modal="true" aria-labelledby="idle-timeout-title">
            <span className="badge warn">Session timeout</span>
            <h2 id="idle-timeout-title">Still there?</h2>
            <p className="muted">For security, Budgetly will sign you out after 30 minutes of inactivity. Your session will expire in <strong>{idleCountdown}s</strong>.</p>
            <div className="row gap" style={{ marginTop: 14 }}>
              <button className="btn" onClick={staySignedIn}>Stay signed in</button>
              <button className="btn danger" onClick={() => void signOut()}>Sign out now</button>
            </div>
          </div>
        </div>
      ) : null}
      {showWalkthrough ? (
        <WelcomeWalkthrough
          userName={profileName}
          features={{
            dashboard: admin.visibleFeatures.dashboard,
            transactions: admin.visibleFeatures.transactions,
            categories: admin.visibleFeatures.categories,
            recurring: admin.visibleFeatures.recurring,
            advice: admin.visibleFeatures.advice,
            goals: admin.visibleFeatures.goals,
          }}
          onNavigate={handleTourNavigate}
          onClose={dismissWalkthrough}
          onFinish={dismissWalkthrough}
        />
      ) : null}
      {monthSummaryTarget ? (
        <MonthEndSummary
          budget={budget}
          monthKey={monthSummaryTarget}
          onClose={dismissMonthSummary}
          onViewReport={() => {
            dismissMonthSummary()
            if (admin.visibleFeatures.reports) {
              setToolsSection('reports')
              handleViewChange('tools')
            }
          }}
        />
      ) : null}
      <UniversalSearch isOpen={universalSearchOpen} onClose={() => setUniversalSearchOpen(false)} commands={commandItems} shortcutLabel={getUniversalSearchShortcut()} quickAdd={parseQuickAdd} />
    </div>
  )
}
