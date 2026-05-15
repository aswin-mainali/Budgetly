import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, BarChart3, ListChecks, Tags, Repeat, LifeBuoy, Wrench, Target, Sparkles, ArrowLeftRight, Settings, ChevronRight, CalendarDays, X, CircleHelp, Plus } from 'lucide-react'
import Auth from './components/Auth'
import Sidebar, { ViewKey } from './components/Sidebar'
import { supabase } from './lib/supabase'
import { readCachedUserProfile, syncProfileCacheForUser } from './lib/userProfile'
import { useBudgetApp } from './hooks/useBudgetApp'
import { useSuperAdmin } from './hooks/useSuperAdmin'
import { AdviceView, CategoriesView, CurrencyConverterView, DashboardView, GoalsView, HelpSupportView, RecurringView, ReportsView, SettingsView, TransactionsView } from './components/AppViews'
import { OfflineStatusBanner } from './components/pwa/OfflineStatusBanner'
import { PwaUpdateBanner } from './components/pwa/PwaUpdateBanner'
import UniversalSearch, { CommandItem } from './components/UniversalSearch'

const THEME_KEY = 'raswibudgeting:theme'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const IDLE_WARNING_MS = 60 * 1000
const TAB_CLOSE_TIMEOUT_MS = 5 * 60 * 1000
const LAST_TAB_CLOSED_AT_KEY = 'budgetly:last-tab-closed-at'


type ToastItem = { id: number; message: string }

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
  const [toolsSection, setToolsSection] = useState<'goals' | 'reports' | 'converter' | 'debt'>('goals')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'))
  const [idleWarningOpen, setIdleWarningOpen] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState(Math.ceil(IDLE_WARNING_MS / 1000))
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [universalSearchOpen, setUniversalSearchOpen] = useState(false)
  const warningTimerRef = useRef<number | null>(null)
  const signOutTimerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)

  const budget = useBudgetApp(userId)
  const admin = useSuperAdmin(userId, email)

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

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
    }
  }, [view, toolsSection, admin.visibleFeatures])

  const handleViewChange = (nextView: ViewKey) => {
    setView(nextView)
    if (nextView === 'tools') {
      setToolsSection((current) => current || 'goals')
    }
    if (isMobile) setCollapsed(true)
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
  if (!userId) return <Auth />
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

  const commandItems: CommandItem[] = [
    { id: 'page-dashboard', type: 'page', label: 'Dashboard', description: 'View your financial overview and key insights', keywords: ['home', 'overview', 'summary'], onSelect: () => handleViewChange('dashboard'), iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'page-transactions', type: 'page', label: 'Transactions', description: 'View and manage your transactions', keywords: ['transactions', 'income', 'expense'], onSelect: () => handleViewChange('transactions'), iconClassName: 'indigo', icon: <ListChecks size={16} /> },
    { id: 'page-categories', type: 'page', label: 'Categories', description: 'Manage your budget categories', keywords: ['budget', 'tags', 'category'], onSelect: () => handleViewChange('categories'), iconClassName: 'green', icon: <Tags size={16} /> },
    { id: 'page-recurring', type: 'page', label: 'Recurring', description: 'View and manage recurring transactions', keywords: ['recurring', 'schedule', 'repeat'], onSelect: () => handleViewChange('recurring'), iconClassName: 'blue', icon: <Repeat size={16} /> },
    { id: 'page-advice', type: 'page', label: 'Advice', description: 'Get personalized financial insights and tips', keywords: ['advice', 'tips', 'insights'], onSelect: () => handleViewChange('advice'), iconClassName: 'purple', icon: <Sparkles size={16} /> },
    { id: 'page-goals', type: 'page', label: 'Goals', description: 'Track and manage your savings goals', keywords: ['goals', 'savings', 'targets'], onSelect: () => { setToolsSection('goals'); handleViewChange('tools') }, iconClassName: 'gold', icon: <Target size={16} /> },
    { id: 'page-reports', type: 'page', label: 'Reports', description: 'View monthly insights and summaries', keywords: ['reports', 'summary', 'analytics'], onSelect: () => { setToolsSection('reports'); handleViewChange('tools') }, iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'page-settings', type: 'page', label: 'Settings', description: 'Manage account and app preferences', keywords: ['settings', 'preferences', 'account', 'general'], onSelect: () => handleViewChange('settings'), iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'page-support', type: 'page', label: 'Help & Support', description: 'Get help and contact support', keywords: ['help', 'support', 'contact'], onSelect: () => handleViewChange('support'), iconClassName: 'teal', icon: <CircleHelp size={16} /> },
    { id: 'action-add-transaction', type: 'action', label: 'Add transaction', description: 'Create a new income or expense transaction', keywords: ['add', 'transaction', 'expense', 'income', 'new', 'quick add'], onSelect: () => { handleViewChange('transactions'); window.setTimeout(() => window.dispatchEvent(new CustomEvent('budgetly:focus-add-transaction')), 0) }, iconClassName: 'indigo', icon: <Plus size={16} /> },
    { id: 'action-theme-toggle', type: 'action', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', description: 'Change Budgetly appearance', keywords: ['theme', 'dark', 'light', 'appearance', 'mode'], onSelect: handleThemeToggle, iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'action-export-report', type: 'action', label: 'Export report', description: 'Open reports export options', keywords: ['export', 'report', 'pdf', 'download', 'summary'], onSelect: () => { setToolsSection('reports'); handleViewChange('tools') }, iconClassName: 'violet', icon: <BarChart3 size={16} /> },
    { id: 'action-open-settings', type: 'action', label: 'Open settings', description: 'Manage account and app preferences', keywords: ['settings', 'preferences', 'account', 'general'], onSelect: () => handleViewChange('settings'), iconClassName: 'slate', icon: <Settings size={16} /> },
    { id: 'action-go-this-month', type: 'action', label: 'Go to this month', description: 'Return Budgetly views to the current month', keywords: ['this month', 'current month', 'today', 'reset month'], onSelect: () => { handleViewChange('dashboard'); window.dispatchEvent(new CustomEvent('budgetly:go-to-current-month')) }, iconClassName: 'violet', icon: <CalendarDays size={16} /> },
    { id: 'action-view-goals', type: 'action', label: 'View goals', description: 'Track and manage your savings goals', keywords: ['goals', 'savings', 'targets'], onSelect: () => { setToolsSection('goals'); handleViewChange('tools') }, iconClassName: 'gold', icon: <Target size={16} /> },
  ].filter((item) => {
    if (item.id.includes('dashboard')) return admin.visibleFeatures.dashboard
    if (item.id.includes('transactions') || item.id.includes('add-transaction')) return admin.visibleFeatures.transactions
    if (item.id.includes('categories')) return admin.visibleFeatures.categories
    if (item.id.includes('recurring')) return admin.visibleFeatures.recurring
    if (item.id.includes('advice')) return admin.visibleFeatures.advice
    if (item.id.includes('goals') || item.id.includes('view-goals')) return admin.visibleFeatures.goals
    if (item.id.includes('reports') || item.id.includes('export-report')) return admin.visibleFeatures.reports
    if (item.id.includes('settings') || item.id.includes('theme-toggle')) return admin.visibleFeatures.settings
    if (item.id.includes('support')) return admin.visibleFeatures.support
    return true
  })

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
        />
      </div>

      <main className={`main ${isMobile ? 'mainMobile' : ''}`}>
        {isMobile ? (
          <header className="mobileTopBar">
            <button className="mobileIconBtn" onClick={() => setCollapsed(false)} aria-label="Open menu"><Menu size={22} /></button>
            <div className="mobileWordmark">
              <strong>Hi, {profileName} 👋</strong><small>{timeGreeting}</small>
            </div>
            <button className="mobileAvatarBtn" onClick={() => handleViewChange('settings')} aria-label="Open settings">
              {profileImage ? <img src={profileImage} alt="Profile" /> : <span>{profileName.charAt(0).toUpperCase()}</span>}
            </button>
          </header>
        ) : null}

        {view === 'dashboard' && admin.visibleFeatures.dashboard ? <DashboardView budget={budget} theme={theme} onOpenTransactionsByType={handleOpenTransactionsByType} /> : null}
        {view === 'transactions' && admin.visibleFeatures.transactions ? <TransactionsView budget={budget} /> : null}
        {view === 'categories' && admin.visibleFeatures.categories ? <CategoriesView budget={budget} /> : null}
        {view === 'recurring' && admin.visibleFeatures.recurring ? <RecurringView budget={budget} /> : null}
        {view === 'advice' && admin.visibleFeatures.advice ? <AdviceView budget={budget} /> : null}
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
            </section>
          ) : (
          <div className={`toolsPageShell toolsPageShellFixed ${toolsSection === 'converter' ? 'toolsShellConverter' : ''}`}>
            <div className={`toolsPageBody ${toolsSection === 'converter' ? 'toolsPageBodyConverter' : ''}`}>
              {toolsSection === 'goals' ? <GoalsView budget={budget} /> : null}
              {toolsSection === 'reports' ? <ReportsView budget={budget} email={email} /> : null}
              {toolsSection === 'converter' ? <CurrencyConverterView budget={budget} theme={theme} /> : null}
            </div>
          </div>
          )
        ) : null}
        {view === 'support' && admin.visibleFeatures.support ? <HelpSupportView email={email} userId={userId} admin={admin} /> : null}
        {view === 'settings' && admin.visibleFeatures.settings ? <SettingsView budget={budget} theme={theme} email={email} userId={userId} onThemeToggle={handleThemeToggle} admin={admin} onSignOut={() => void signOut()} /> : null}

        {isMobile ? (
          <nav className="mobileTabBar mobileTabBarPlus" aria-label="Mobile navigation">
            {admin.visibleFeatures.dashboard ? <button className={view === 'dashboard' ? 'active' : ''} onClick={() => handleViewChange('dashboard')}><BarChart3 size={18} /><span>Dashboard</span></button> : null}
            {admin.visibleFeatures.categories ? <button className={view === 'categories' ? 'active' : ''} onClick={() => handleViewChange('categories')}><Tags size={18} /><span>Categories</span></button> : null}
            <button className={`mobilePlusTab ${view === 'transactions' ? 'active' : ''}`} onClick={() => handleViewChange('transactions')} aria-label="Add transaction"><Plus size={24} /><span>Add</span></button>
            <button className={(view === 'utilities_hub' || view === 'tools') ? 'active' : ''} onClick={() => setView('utilities_hub')}><Wrench size={18} /><span>Utilities</span></button>
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
      <UniversalSearch isOpen={universalSearchOpen} onClose={() => setUniversalSearchOpen(false)} commands={commandItems} />
    </div>
  )
}
