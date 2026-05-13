import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CircleHelp, Cog, Goal, Home, Lightbulb, ListChecks, RefreshCcw, Search, Tags } from 'lucide-react'

export type SearchPage = { label: string; description: string; shortcut: string; onSelect: () => void; icon: React.ReactNode; iconClassName: string }

const isEditableTarget = (target: EventTarget | null) => {
  const node = target as HTMLElement | null
  if (!node) return false
  const tag = node.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable || !!node.closest('[contenteditable="true"], .modal form, [role="textbox"]')
}

export const UNIVERSAL_SEARCH_PAGES_META = {
  icons: { Home, ListChecks, Tags, RefreshCcw, Lightbulb, Goal, Cog, CircleHelp, BarChart3 },
}

export default function UniversalSearch({ isOpen, onClose, pages }: { isOpen: boolean; onClose: () => void; pages: SearchPage[] }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const prevFocusedRef = useRef<HTMLElement | null>(null)

  const filteredPages = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return pages
    return pages.filter((page) => page.label.toLowerCase().includes(value) || page.description.toLowerCase().includes(value))
  }, [pages, query])

  useEffect(() => {
    if (!isOpen) return
    prevFocusedRef.current = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = ''
      setQuery('')
      setSelectedIndex(0)
      prevFocusedRef.current?.focus?.()
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isOpenShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space'
      if (isOpenShortcut && !isEditableTarget(event.target)) {
        event.preventDefault()
      }
      if (!isOpen) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (!filteredPages.length) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % filteredPages.length)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => (current - 1 + filteredPages.length) % filteredPages.length)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        filteredPages[selectedIndex]?.onSelect()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filteredPages, isOpen, onClose, selectedIndex])

  if (!isOpen) return null

  return (
    <div className="universalSearchBackdrop" onMouseDown={onClose}>
      <div className="universalSearchDialog" role="dialog" aria-modal="true" aria-label="Universal search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="universalSearchInputRow">
          <Search size={18} className="muted" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages. eg. Goals, Report" aria-label="Search pages" />
          <span className="keyPill">esc</span>
        </div>
        <div className="universalSearchList">
          {filteredPages.length ? filteredPages.map((page, index) => (
            <button key={page.label} className={`universalSearchItem ${selectedIndex === index ? 'active' : ''}`} onClick={() => { page.onSelect(); onClose() }}>
              <span className={`universalSearchIcon ${page.iconClassName}`}>{page.icon}</span>
              <span className="universalSearchCopy"><strong>{page.label}</strong><small>{page.description}</small></span>
              <span className="shortcutPill">{page.shortcut}</span>
            </button>
          )) : <div className="universalSearchEmpty">No matching page found</div>}
        </div>
        <div className="universalSearchFooter">Tip: Press <span className="keyPill">Ctrl</span> + <span className="keyPill">Shift</span> + <span className="keyPill">Space</span> to open this menu anywhere</div>
      </div>
    </div>
  )
}
