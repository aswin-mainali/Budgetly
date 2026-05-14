import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CircleHelp, Cog, Goal, Home, Lightbulb, ListChecks, RefreshCcw, Search, Tags } from 'lucide-react'

export type CommandItem = { id: string; type: 'page' | 'action'; label: string; description: string; keywords: string[]; onSelect: () => void; icon: React.ReactNode; iconClassName: string }

const isEditableTarget = (target: EventTarget | null) => {
  const node = target as HTMLElement | null
  if (!node) return false
  const tag = node.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable || !!node.closest('[contenteditable="true"], .modal form, [role="textbox"]')
}

export const UNIVERSAL_SEARCH_PAGES_META = {
  icons: { Home, ListChecks, Tags, RefreshCcw, Lightbulb, Goal, Cog, CircleHelp, BarChart3 },
}

export default function UniversalSearch({ isOpen, onClose, commands }: { isOpen: boolean; onClose: () => void; commands: CommandItem[] }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const prevFocusedRef = useRef<HTMLElement | null>(null)

  const safeCommands = Array.isArray(commands) ? commands : []

  const filteredCommands = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return []
    const scored = safeCommands.map((command) => {
      const label = command.label.toLowerCase()
      const description = command.description.toLowerCase()
      const keywords = Array.isArray(command.keywords) ? command.keywords.map((keyword) => keyword.toLowerCase()) : []
      let score = Number.POSITIVE_INFINITY
      if (label === value) score = 0
      else if (label.startsWith(value)) score = 1
      else if (keywords.some((keyword) => keyword.includes(value))) score = 2
      else if (description.includes(value) || label.includes(value)) score = 3
      return { command, score }
    }).filter((item) => Number.isFinite(item.score))
    scored.sort((a, b) => a.score - b.score || a.command.label.localeCompare(b.command.label))
    return scored.map((item) => item.command)
  }, [safeCommands, query])

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
      if (!filteredCommands.length) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % filteredCommands.length)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        filteredCommands[selectedIndex]?.onSelect()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filteredCommands, isOpen, onClose, selectedIndex])

  if (!isOpen) return null

  return (
    <div className="universalSearchBackdrop" onMouseDown={onClose}>
      <div className="universalSearchDialog" role="dialog" aria-modal="true" aria-label="Universal search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="universalSearchInputRow">
          <Search size={18} className="muted" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Pages. Eg. Goals, Report" aria-label="Search pages" />
          <span className="keyPill">esc</span>
        </div>
        {query.trim() ? (
          <div className="universalSearchList">
            {filteredCommands.length ? filteredCommands.map((command, index) => (
              <button key={command.id} className={`universalSearchItem ${selectedIndex === index ? 'active' : ''}`} onClick={() => { command.onSelect(); onClose() }}>
                <span className={`universalSearchIcon ${command.iconClassName}`}>{command.icon}</span>
                <span className="universalSearchCopy"><strong>{command.label}</strong><small>{command.description}</small></span>
                <span className="resultTypePill">{command.type === 'action' ? 'Action' : 'Page'}</span>
              </button>
            )) : <div className="universalSearchEmpty">No matching page or action found</div>}
          </div>
        ) : null}
      </div>
    </div>
  )
}
