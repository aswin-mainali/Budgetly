import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'

export type ResultGroup = 'pages' | 'actions' | 'transactions' | 'categories' | 'goals' | 'recurring'
export type CommandType = 'page' | 'action' | 'transaction' | 'category' | 'goal' | 'recurring'

export type SubAction = {
  id: string
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  onSelect: () => void
}

export type CommandItem = {
  id: string
  group: ResultGroup
  type: CommandType
  label: string
  description: string
  keywords: string[]
  onSelect: () => void
  icon: React.ReactNode
  iconClassName: string
  /** Optional right-aligned metadata such as an amount or date. */
  meta?: string
  /** Nested actions revealed by pressing the right arrow. */
  subActions?: SubAction[]
}

const RECENTS_KEY = 'budgetly_universal_search_recents'
const RECENTS_LIMIT = 8

const GROUP_ORDER: ResultGroup[] = ['actions', 'pages', 'transactions', 'categories', 'goals', 'recurring']
const GROUP_LABEL: Record<ResultGroup, string> = {
  actions: 'Actions',
  pages: 'Pages',
  transactions: 'Transactions',
  categories: 'Categories',
  goals: 'Goals',
  recurring: 'Recurring',
}
const GROUP_CAP: Record<ResultGroup, number> = {
  actions: 10,
  pages: 14,
  transactions: 6,
  categories: 6,
  goals: 6,
  recurring: 6,
}

type SearchMode = 'all' | 'actions' | 'pages' | 'categories' | 'transactions' | 'date'

const parseQuery = (raw: string): { mode: SearchMode; term: string } => {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('>')) return { mode: 'actions', term: trimmed.slice(1).trim() }
  if (trimmed.startsWith('#')) return { mode: 'categories', term: trimmed.slice(1).trim() }
  if (trimmed.startsWith('@')) return { mode: 'date', term: trimmed.slice(1).trim() }
  if (trimmed.startsWith('$')) return { mode: 'transactions', term: trimmed.slice(1).trim() }
  return { mode: 'all', term: trimmed.trim() }
}

const groupsForMode = (mode: SearchMode): ResultGroup[] | null => {
  switch (mode) {
    case 'actions': return ['actions']
    case 'pages': return ['pages']
    case 'categories': return ['categories']
    case 'transactions':
    case 'date': return ['transactions']
    default: return null
  }
}

const isWordStart = (text: string, index: number) => index === 0 || /[\s/\-_.]/.test(text[index - 1])

type MatchResult = { score: number; ranges: Array<[number, number]> }

// Lightweight fuzzy matcher: exact/substring fast-path, then subsequence with a
// gap penalty. Returns matched character ranges so the label can be highlighted.
const fuzzyMatch = (query: string, text: string): MatchResult | null => {
  if (!query) return { score: 0, ranges: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  const idx = t.indexOf(q)
  if (idx !== -1) {
    const score = idx === 0 ? 0 : (isWordStart(t, idx) ? 4 : 12) + idx
    return { score, ranges: [[idx, idx + q.length]] }
  }

  const ranges: Array<[number, number]> = []
  let qi = 0
  let prev = -2
  let start = -1
  let gaps = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      if (start === -1) start = ti
      else if (ti !== prev + 1) {
        ranges.push([start, prev + 1])
        start = ti
        gaps += 1
      }
      prev = ti
      qi += 1
    }
  }
  if (qi < q.length) return null
  if (start !== -1) ranges.push([start, prev + 1])
  const score = 45 + gaps * 6 + (ranges[0]?.[0] ?? 0)
  return { score, ranges }
}

const scoreItem = (term: string, item: CommandItem): MatchResult | null => {
  const labelMatch = fuzzyMatch(term, item.label)
  let score = labelMatch ? labelMatch.score : Number.POSITIVE_INFINITY
  const ranges = labelMatch ? labelMatch.ranges : []
  const lower = term.toLowerCase()
  if (item.keywords.some((keyword) => keyword.toLowerCase().includes(lower))) score = Math.min(score, 20)
  if (item.meta && item.meta.toLowerCase().includes(lower)) score = Math.min(score, 22)
  if (item.description.toLowerCase().includes(lower)) score = Math.min(score, 28)
  if (!Number.isFinite(score)) return null
  return { score, ranges }
}

const readRecents = (): string[] => {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const recordRecent = (id: string) => {
  try {
    const next = [id, ...readRecents().filter((entry) => entry !== id)].slice(0, RECENTS_LIMIT)
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* ignore storage failures */
  }
}

const Highlight = ({ text, ranges }: { text: string; ranges: Array<[number, number]> }) => {
  if (!ranges.length) return <>{text}</>
  const nodes: React.ReactNode[] = []
  let cursor = 0
  ranges.forEach(([from, to], rangeIndex) => {
    if (from > cursor) nodes.push(text.slice(cursor, from))
    nodes.push(<mark key={rangeIndex} className="universalSearchMark">{text.slice(from, to)}</mark>)
    cursor = to
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

type ScoredItem = { item: CommandItem; ranges: Array<[number, number]> }

type RenderEntry =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; item: ScoredItem; selectableIndex: number }
  | { kind: 'subaction'; key: string; parentId: string; action: SubAction; selectableIndex: number }

export default function UniversalSearch({
  isOpen,
  onClose,
  commands,
  shortcutLabel,
  quickAdd,
}: {
  isOpen: boolean
  onClose: () => void
  commands: CommandItem[]
  shortcutLabel?: string
  quickAdd?: (term: string) => CommandItem | null
}) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const prevFocusedRef = useRef<HTMLElement | null>(null)
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map())

  const deferredQuery = useDeferredValue(query)
  const { mode, term } = useMemo(() => parseQuery(deferredQuery), [deferredQuery])
  const hasQuery = term.length > 0

  const commandsById = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])

  const quickAddItem = useMemo(() => {
    if (!hasQuery || !quickAdd || (mode !== 'all' && mode !== 'transactions')) return null
    return quickAdd(term)
  }, [hasQuery, quickAdd, mode, term])

  // Grouped, scored results for the active query.
  const grouped = useMemo(() => {
    if (!hasQuery) return [] as Array<{ group: ResultGroup; items: ScoredItem[] }>
    const allowedGroups = groupsForMode(mode)
    const buckets = new Map<ResultGroup, Array<ScoredItem & { score: number }>>()
    commands.forEach((command) => {
      if (allowedGroups && !allowedGroups.includes(command.group)) return
      const match = scoreItem(term, command)
      if (!match) return
      const bucket = buckets.get(command.group) ?? []
      bucket.push({ item: command, ranges: match.ranges, score: match.score })
      buckets.set(command.group, bucket)
    })
    return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => {
      const items = (buckets.get(group) ?? [])
        .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
        .slice(0, GROUP_CAP[group])
        .map(({ item, ranges }) => ({ item, ranges }))
      return { group, items }
    })
  }, [commands, hasQuery, mode, term])

  // Recent selections shown when the query is empty.
  const recentItems = useMemo<ScoredItem[]>(() => {
    if (hasQuery) return []
    return recents
      .map((id) => commandsById.get(id))
      .filter((item): item is CommandItem => Boolean(item))
      .slice(0, RECENTS_LIMIT)
      .map((item) => ({ item, ranges: [] }))
  }, [hasQuery, recents, commandsById])

  // Flatten into headers + selectable rows for keyboard navigation.
  const { entries, selectableCount } = useMemo(() => {
    const rows: RenderEntry[] = []
    let selectable = 0
    const pushItem = (scored: ScoredItem) => {
      const selectableIndex = selectable
      rows.push({ kind: 'item', key: scored.item.id, item: scored, selectableIndex })
      selectable += 1
      if (expandedId === scored.item.id && scored.item.subActions?.length) {
        scored.item.subActions.forEach((action) => {
          rows.push({ kind: 'subaction', key: `${scored.item.id}:${action.id}`, parentId: scored.item.id, action, selectableIndex: selectable })
          selectable += 1
        })
      }
    }

    if (quickAddItem) {
      rows.push({ kind: 'header', key: 'header-quick', label: 'Quick add' })
      pushItem({ item: quickAddItem, ranges: [] })
    }

    if (!hasQuery) {
      if (recentItems.length) {
        rows.push({ kind: 'header', key: 'header-recent', label: 'Recent' })
        recentItems.forEach(pushItem)
      }
    } else {
      grouped.forEach(({ group, items }) => {
        rows.push({ kind: 'header', key: `header-${group}`, label: GROUP_LABEL[group] })
        items.forEach(pushItem)
      })
    }
    return { entries: rows, selectableCount: selectable }
  }, [quickAddItem, hasQuery, recentItems, grouped, expandedId])

  const selectableEntries = useMemo(
    () => entries.filter((entry): entry is Extract<RenderEntry, { kind: 'item' | 'subaction' }> => entry.kind !== 'header'),
    [entries],
  )
  const activeEntry = selectableEntries[selectedIndex]
  const activeDescendantId = activeEntry ? `universalSearchOption-${selectedIndex}` : undefined

  useEffect(() => {
    if (!isOpen) return
    setRecents(readRecents())
    prevFocusedRef.current = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = ''
      setQuery('')
      setSelectedIndex(0)
      setExpandedId(null)
      prevFocusedRef.current?.focus?.()
    }
  }, [isOpen])

  useEffect(() => {
    setSelectedIndex(0)
    setExpandedId(null)
  }, [deferredQuery])

  // Keep the selected index in range as results change.
  useEffect(() => {
    setSelectedIndex((current) => {
      if (selectableCount === 0) return 0
      return Math.min(current, selectableCount - 1)
    })
  }, [selectableCount])

  // Scroll the highlighted row into view during keyboard navigation.
  useEffect(() => {
    const node = rowRefs.current.get(selectedIndex)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, entries])

  const runSelection = (entry: Extract<RenderEntry, { kind: 'item' | 'subaction' }>) => {
    if (entry.kind === 'item') {
      recordRecent(entry.item.item.id)
      entry.item.item.onSelect()
    } else {
      entry.action.onSelect()
    }
    onClose()
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return

      if (event.key === 'Escape') {
        event.preventDefault()
        if (expandedId) setExpandedId(null)
        else onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (selectableCount) setSelectedIndex((current) => (current + 1) % selectableCount)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (selectableCount) setSelectedIndex((current) => (current - 1 + selectableCount) % selectableCount)
        return
      }
      if (event.key === 'ArrowRight') {
        if (activeEntry?.kind === 'item' && activeEntry.item.item.subActions?.length) {
          event.preventDefault()
          setExpandedId(activeEntry.item.item.id)
        }
        return
      }
      if (event.key === 'ArrowLeft') {
        if (expandedId) {
          event.preventDefault()
          setExpandedId(null)
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (activeEntry) runSelection(activeEntry)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, expandedId, selectableCount, activeEntry, onClose])

  if (!isOpen) return null

  const statusMessage = hasQuery
    ? `${selectableCount} result${selectableCount === 1 ? '' : 's'}`
    : recentItems.length ? `${recentItems.length} recent` : ''

  return (
    <div className="universalSearchBackdrop" onMouseDown={onClose}>
      <div className="universalSearchDialog" role="dialog" aria-modal="true" aria-label="Universal search" onMouseDown={(event) => event.stopPropagation()}>
        <div className="universalSearchInputRow">
          <Search size={18} className="muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search everything. Try >actions, #category, $amount, @date"
            aria-label="Search pages, actions, and your data"
            role="combobox"
            aria-expanded
            aria-controls="universalSearchListbox"
            aria-activedescendant={activeDescendantId}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="keyPill">esc</span>
        </div>

        <div className="universalSearchSrOnly" aria-live="polite">{statusMessage}</div>

        <div className="universalSearchList" id="universalSearchListbox" role="listbox" aria-label="Search results" ref={listRef}>
          {entries.length ? entries.map((entry) => {
            if (entry.kind === 'header') {
              return <div key={entry.key} className="universalSearchGroupHeader" role="presentation">{entry.label}</div>
            }
            if (entry.kind === 'item') {
              const { item, ranges } = entry.item
              const isActive = entry.selectableIndex === selectedIndex
              const isExpanded = expandedId === item.id
              const hasSub = !!item.subActions?.length
              return (
                <button
                  key={entry.key}
                  id={`universalSearchOption-${entry.selectableIndex}`}
                  ref={(node) => { if (node) rowRefs.current.set(entry.selectableIndex, node); else rowRefs.current.delete(entry.selectableIndex) }}
                  role="option"
                  aria-selected={isActive}
                  aria-expanded={hasSub ? isExpanded : undefined}
                  className={`universalSearchItem ${isActive ? 'active' : ''}`}
                  onMouseMove={() => setSelectedIndex(entry.selectableIndex)}
                  onClick={() => runSelection(entry)}
                >
                  <span className={`universalSearchIcon ${item.iconClassName}`}>{item.icon}</span>
                  <span className="universalSearchCopy">
                    <strong><Highlight text={item.label} ranges={ranges} /></strong>
                    <small>{item.description}</small>
                  </span>
                  {item.meta ? <span className="universalSearchMeta">{item.meta}</span> : null}
                  {hasSub ? <span className="universalSearchSubHint" aria-hidden="true">{isExpanded ? '◂' : '▸'}</span> : null}
                  <span className="resultTypePill">{GROUP_LABEL[item.group].replace(/s$/, '')}</span>
                </button>
              )
            }
            const isActive = entry.selectableIndex === selectedIndex
            return (
              <button
                key={entry.key}
                id={`universalSearchOption-${entry.selectableIndex}`}
                ref={(node) => { if (node) rowRefs.current.set(entry.selectableIndex, node); else rowRefs.current.delete(entry.selectableIndex) }}
                role="option"
                aria-selected={isActive}
                className={`universalSearchSubItem ${isActive ? 'active' : ''} ${entry.action.destructive ? 'destructive' : ''}`}
                onMouseMove={() => setSelectedIndex(entry.selectableIndex)}
                onClick={() => runSelection(entry)}
              >
                <span className="universalSearchSubGlyph" aria-hidden="true">{entry.action.icon ?? <CornerDownLeft size={14} />}</span>
                <span>{entry.action.label}</span>
              </button>
            )
          }) : (
            <div className="universalSearchEmpty">
              {hasQuery ? 'No matching page, action, or record found' : 'Type to search pages, actions, transactions, categories, and goals.'}
            </div>
          )}
        </div>

        <div className="universalSearchFooter">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>→</kbd> actions</span>
          <span><kbd>esc</kbd> close</span>
          {shortcutLabel ? <span className="universalSearchFooterShortcut">Open with {shortcutLabel}</span> : null}
        </div>
      </div>
    </div>
  )
}
