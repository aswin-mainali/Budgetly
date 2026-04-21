import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, BarChart3, ListChecks, Tags, Repeat, PanelLeftClose, LifeBuoy, Wrench, Target, Sparkles, ArrowLeftRight } from 'lucide-react'
import Auth from './components/Auth'
import Sidebar, { ViewKey } from './components/Sidebar'
import { supabase } from './lib/supabase'
import { useBudgetApp } from './hooks/useBudgetApp'
import { useSuperAdmin } from './hooks/useSuperAdmin'
import { AdviceView, CategoriesView, CurrencyConverterView, DashboardView, GoalsView, HelpSupportView, RecurringView, ReportsView, SettingsView, TransactionsView } from './components/AppViews'

const THEME_KEY = 'raswibudgeting:theme'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const IDLE_WARNING_MS = 60 * 1000


type ToastItem = { id: number; message: string }

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
  const [view, setView] = useState<ViewKey>('dashboard')
  const [toolsSection, setToolsSection] = useState<'goals' | 'reports' | 'converter'>('goals')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'))
  const [idleWarningOpen, setIdleWarningOpen] = useState(false)
  const [idleCountdown, setIdleCountdown] = useState(Math.ceil(IDLE_WARNING_MS / 1000))
  const [toasts, setToasts] = useState<ToastItem[]>([])
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
    const mediaQuery = window.matchMedia('(max-width: 960px)')
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
      const user = sessionData.session?.user ?? null
      setUserId(user?.id ?? null)
      setEmail(user?.email ?? null)
      setSessionChecked(true)
    }

    void boot()

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setUserId(user?.id ?? null)
      setEmail(user?.email ?? null)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
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
    if (view !== 'tools') return
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

  const handleViewChange = (nextView: ViewKey) => {
    setView(nextView)
    if (nextView === 'tools') {
      setToolsSection((current) => current || 'goals')
    }
    if (isMobile) setCollapsed(true)
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

  return (
    <div className="container appWrap">
      {isMobile && !collapsed ? <div className="mobileOverlay" onClick={() => setCollapsed(true)} aria-hidden="true" /> : null}

      <div className={`sidebarContainer ${isMobile ? 'mobile' : ''} ${collapsed ? 'closed' : 'open'}`}>
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          view={view}
          setView={handleViewChange}
          sync={budget.sync}
          onSignOut={signOut}
          email={email}
          features={admin.visibleFeatures}
        />
      </div>

      <main className={`main ${isMobile ? 'mainMobile' : ''}`}>
        {isMobile ? (
          <button className="mobileMenuBtn" onClick={() => setCollapsed((current) => !current)} aria-label="Menu" title="Menu">
            <Menu size={18} />
          </button>
        ) : null}

        {view === 'dashboard' && admin.visibleFeatures.dashboard ? <DashboardView budget={budget} theme={theme} onOpenTransactionsByType={handleOpenTransactionsByType} /> : null}
        {view === 'transactions' && admin.visibleFeatures.transactions ? <TransactionsView budget={budget} /> : null}
        {view === 'categories' && admin.visibleFeatures.categories ? <CategoriesView budget={budget} /> : null}
        {view === 'recurring' && admin.visibleFeatures.recurring ? <RecurringView budget={budget} /> : null}
        {view === 'advice' && admin.visibleFeatures.advice ? <AdviceView budget={budget} /> : null}
        {view === 'tools' ? (
          <div className={`toolsPageShell toolsPageShellFixed ${toolsSection === 'converter' ? 'toolsShellConverter' : ''}`}>
            <div className="card settingsTopCard settingsTopCardFull toolsTopTabsOnly">
              <div className="settingsTopTabs toolsTopTabs" role="tablist" aria-label="Tools sections">
                <button className={`settingsNavBtn settingsTopNavBtn ${toolsSection === 'goals' ? 'active' : ''}`} onClick={() => setToolsSection('goals')}>Goals</button>
                <button className={`settingsNavBtn settingsTopNavBtn ${toolsSection === 'reports' ? 'active' : ''}`} onClick={() => setToolsSection('reports')}>Reports</button>
                <button className={`settingsNavBtn settingsTopNavBtn ${toolsSection === 'converter' ? 'active' : ''}`} onClick={() => setToolsSection('converter')}>Currency Converter</button>
              </div>
            </div>
            <div className={`toolsPageBody ${toolsSection === 'converter' ? 'toolsPageBodyConverter' : ''}`}>
              {toolsSection === 'goals' ? <GoalsView budget={budget} /> : null}
              {toolsSection === 'reports' ? <ReportsView budget={budget} email={email} /> : null}
              {toolsSection === 'converter' ? <CurrencyConverterView budget={budget} theme={theme} /> : null}
            </div>
          </div>
        ) : null}
        {view === 'support' && admin.visibleFeatures.support ? <HelpSupportView email={email} userId={userId} admin={admin} /> : null}
        {view === 'settings' && admin.visibleFeatures.settings ? <SettingsView budget={budget} theme={theme} email={email} onThemeToggle={() => { const nextTheme = theme === 'dark' ? 'light' : 'dark'; setTheme(nextTheme); showToast(nextTheme === 'dark' ? 'Dark mode enabled' : 'Light mode enabled') }} admin={admin} /> : null}

        {isMobile ? (
          <nav className="mobileTabBar" aria-label="Mobile navigation">
            {admin.visibleFeatures.dashboard ? <button className={view === 'dashboard' ? 'active' : ''} onClick={() => handleViewChange('dashboard')}><BarChart3 size={18} /><span>Home</span></button> : null}
            {admin.visibleFeatures.transactions ? <button className={view === 'transactions' ? 'active' : ''} onClick={() => handleViewChange('transactions')}><ListChecks size={18} /><span>Txns</span></button> : null}
            {admin.visibleFeatures.categories ? <button className={view === 'categories' ? 'active' : ''} onClick={() => handleViewChange('categories')}><Tags size={18} /><span>Cats</span></button> : null}
            {admin.visibleFeatures.recurring ? <button className={view === 'recurring' ? 'active' : ''} onClick={() => handleViewChange('recurring')}><Repeat size={18} /><span>Recurring</span></button> : null}
            {admin.visibleFeatures.advice ? <button className={view === 'advice' ? 'active' : ''} onClick={() => handleViewChange('advice')}><Sparkles size={18} /><span>Advice</span></button> : null}
            <button className={view === 'tools' ? 'active' : ''} onClick={() => handleViewChange('tools')}><Wrench size={18} /><span>Utilities</span></button>
            {admin.visibleFeatures.support ? <button className={view === 'support' ? 'active' : ''} onClick={() => handleViewChange('support')}><LifeBuoy size={18} /><span>Support</span></button> : null}
            <button className={collapsed ? '' : 'active'} onClick={() => setCollapsed((current) => !current)}><PanelLeftClose size={18} /><span>More</span></button>
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
    </div>
  )
}
