import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, ListChecks, Tags, Settings, Menu, Cloud, Repeat, Headset, Wrench, Sparkles, ChevronDown, ChevronRight, Target, ArrowLeftRight } from 'lucide-react'
import { FeatureAccess, SyncState } from '../types'
import { readCachedUserProfile } from '../lib/userProfile'

export type ViewKey = 'dashboard' | 'transactions' | 'categories' | 'recurring' | 'advice' | 'tools' | 'support' | 'settings' | 'super_admin'

const NAV_ITEMS: Array<{ key: Exclude<ViewKey, 'super_admin'>; label: string; icon: React.ReactNode; visible: (features: FeatureAccess) => boolean }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={18} />, visible: (features) => features.dashboard },
  { key: 'categories', label: 'Categories', icon: <Tags size={18} />, visible: (features) => features.categories },
  { key: 'transactions', label: 'Transactions', icon: <ListChecks size={18} />, visible: (features) => features.transactions },
  { key: 'recurring', label: 'Recurring', icon: <Repeat size={18} />, visible: (features) => features.recurring },
  { key: 'tools', label: 'Utilities', icon: <Wrench size={18} />, visible: () => true },
  { key: 'advice', label: 'Advice', icon: <Sparkles size={18} />, visible: (features) => features.advice },
  { key: 'settings', label: 'Settings', icon: <Settings size={18} />, visible: (features) => features.settings },
]

export default function Sidebar(props: {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  view: ViewKey
  setView: (v: ViewKey) => void
  toolsSection: 'goals' | 'reports' | 'converter' | 'debt' | 'investments'
  setToolsSection: (v: 'goals' | 'reports' | 'converter' | 'debt' | 'investments') => void
  sync: SyncState
  email?: string | null
  features: FeatureAccess
}) {
  const { collapsed, setCollapsed, view, setView, toolsSection, setToolsSection, sync, email, features } = props
  const [now, setNow] = useState(() => new Date())
  const [toolsExpanded, setToolsExpanded] = useState(view === 'tools')
  const [floatingToolsPos, setFloatingToolsPos] = useState<{ top: number; left: number } | null>(null)
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [storedProfile, setStoredProfile] = useState<{ firstName: string; lastName: string; image: string }>({ firstName: '', lastName: '', image: '' })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!toolsExpanded || collapsed) {
      setFloatingToolsPos(null)
      return
    }

    const updatePosition = () => {
      if (!toolsButtonRef.current) return
      const rect = toolsButtonRef.current.getBoundingClientRect()
      setFloatingToolsPos({
        top: rect.top,
        left: rect.right + 12,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [toolsExpanded, collapsed])

  useEffect(() => {
    if (!toolsExpanded) return

    const onPointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null
      const clickedButton = !!(targetNode && toolsButtonRef.current?.contains(targetNode))
      const submenuElement = document.getElementById('utilities-submenu')
      const clickedSubmenu = !!(targetNode && submenuElement?.contains(targetNode))
      if (!clickedButton && !clickedSubmenu) setToolsExpanded(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [toolsExpanded])

  useEffect(() => {
    const readProfile = () => {
      setStoredProfile(readCachedUserProfile())
    }

    readProfile()
    window.addEventListener('budgetly:profile-updated', readProfile)
    return () => {
      window.removeEventListener('budgetly:profile-updated', readProfile)
    }
  }, [])

  const clock = useMemo(() => {
    const hour = now.getHours()
    const minute = now.getMinutes().toString().padStart(2, '0')
    const meridiem = hour >= 12 ? 'PM' : 'AM'
    const hour12 = hour % 12 || 12
    const weekday = now.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()
    const day = now.getDate().toString().padStart(2, '0')
    return {
      meridiem,
      time: `${hour12}:${minute}`,
      weekday,
      day,
    }
  }, [now])

  const syncLabel =
    sync === 'synced' ? 'Synced' :
    sync === 'syncing' ? 'Syncing…' :
    sync === 'pending' ? 'Unsaved changes' :
    sync === 'offline' ? 'Offline' : 'Sync error'

  const visibleItems = NAV_ITEMS.filter((item) => item.visible(features))
  const fallbackName = (email || 'User').split('@')[0].replace(/[._-]+/g, ' ').trim()
  const name = `${storedProfile.firstName} ${storedProfile.lastName}`.trim() || fallbackName
  const profileInitials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U'
  const openSettingsGeneral = () => {
    window.dispatchEvent(new Event('budgetly:open-settings-general'))
    setView('settings')
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="brandTitle">
          <strong>Budgetly</strong>
        </div>
        <button className="btn" onClick={() => setCollapsed(!collapsed)} title="Collapse sidebar">
          <Menu size={18} />
        </button>
      </div>

      <div className="sidebarClock" aria-label="Current date and time">
        <div className="clockMain">
          <span className="clockMeridiem">{clock.meridiem}</span>
          <span className="clockTime">{clock.time}</span>
        </div>
        <div className="clockDate">
          <span>{clock.weekday}</span>
          <strong>{clock.day}</strong>
        </div>
      </div>

      <div className="nav">
        {visibleItems.map((item) => {
          const isActive = item.key === 'tools' ? (view === 'tools' || toolsExpanded) : view === item.key
          if (item.key === 'tools') {
            const hasAnyTool = features.goals || features.reports || features.converter || true
            return (
              <div key={item.key} className="toolsNavItem">
                <button
                  ref={toolsButtonRef}
                  className={`toolsNavButton ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setToolsExpanded((current) => !current)
                  }}
                  aria-expanded={toolsExpanded}
                  aria-controls="utilities-submenu"
                >
                  {item.icon} <span className="navLabel">{item.label}</span>
                  <span className="toolsChevron">{toolsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                </button>
                {toolsExpanded && !collapsed && hasAnyTool && floatingToolsPos ? createPortal(
                  <div className="toolsSubNav floating" id="utilities-submenu" style={{ position: 'fixed', top: floatingToolsPos.top, left: floatingToolsPos.left }}>
                    {features.goals ? (
                      <button className={toolsSection === 'goals' ? 'active' : ''} onClick={() => { setView('tools'); setToolsSection('goals'); setToolsExpanded(false) }}>
                        <Target size={16} /> <span className="navLabel">Goals</span>
                      </button>
                    ) : null}
                    {features.reports ? (
                      <button className={toolsSection === 'reports' ? 'active' : ''} onClick={() => { setView('tools'); setToolsSection('reports'); setToolsExpanded(false) }}>
                        <BarChart3 size={16} /> <span className="navLabel">Reports</span>
                      </button>
                    ) : null}
                    {features.converter ? (
                      <button className={toolsSection === 'converter' ? 'active' : ''} onClick={() => { setView('tools'); setToolsSection('converter'); setToolsExpanded(false) }}>
                        <ArrowLeftRight size={16} /> <span className="navLabel">Currency Converter</span>
                      </button>
                    ) : null}
                  {true ? (
                      <button className={toolsSection === 'investments' ? 'active' : ''} onClick={() => { setView('tools'); setToolsSection('investments'); setToolsExpanded(false) }}><BarChart3 size={16} /> <span className='navLabel'>Investments</span></button>
                    ) : null}
                  </div>,
                  document.body
                ) : null}
              </div>
            )
          }
          return (
          <button key={item.key} className={isActive ? 'active' : ''} onClick={() => setView(item.key)}>
            {item.icon} <span className="navLabel">{item.label}</span>
          </button>
        )})}
      </div>

      <div className="sidebarFooter">
        <span className="pill">
          <Cloud size={14} /> {syncLabel}
        </span>
        {features.support ? (
          <button className={`btn support ${view === 'support' ? 'active' : ''}`} onClick={() => setView('support')}>
            <Headset size={18} /> <span className="navLabel">Help & Support</span>
          </button>
        ) : null}
        <button className={`sidebarUserCard ${view === 'settings' ? 'active' : ''}`} onClick={openSettingsGeneral}>
          <div className="sidebarUserAvatar">
            {storedProfile.image ? <img src={storedProfile.image} alt="User profile" /> : <span>{profileInitials}</span>}
          </div>
          <div className="sidebarUserMeta">
            <strong>{name}</strong>
            <small>{email || 'No email'}</small>
          </div>
          <ChevronDown size={16} />
        </button>
      </div>
    </aside>
  )
}
