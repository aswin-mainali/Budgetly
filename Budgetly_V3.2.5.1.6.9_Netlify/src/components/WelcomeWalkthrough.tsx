import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  ListChecks,
  Tags,
  Wrench,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  Sparkle,
  ShieldCheck,
} from 'lucide-react'

export type WalkthroughFeatures = {
  dashboard: boolean
  transactions: boolean
  categories: boolean
  recurring: boolean
  advice: boolean
  goals: boolean
}

// Where the tour asks the host app to navigate before a step is shown.
export type TourDestination = 'dashboard' | 'categories' | 'transactions' | 'tools'

type WalkthroughStep = {
  id: string
  feature?: keyof WalkthroughFeatures
  navigate?: TourDestination
  // CSS selectors (in priority order) for the element to spotlight. When none
  // resolve to a visible element, the step falls back to a centered card.
  target?: string[]
  accent: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  body: string
  points?: string[]
  primaryLabel?: string
}

const buildSteps = (userName: string): WalkthroughStep[] => [
  {
    id: 'welcome',
    navigate: 'dashboard',
    accent: 'violet',
    icon: <Sparkle size={26} />,
    eyebrow: 'Welcome to Budgetly',
    title: userName ? `Hi ${userName}, welcome to Budgetly 👋` : "Welcome to Budgetly 👋",
    body: "Let's take a quick guided tour together. I'll move between pages and show you exactly where to start — it takes less than a minute.",
    points: [
      "I'll walk you through each screen step by step",
      'You can skip anytime, or replay it later',
      'Ready? Let\'s go 🚀',
    ],
  },
  {
    id: 'about',
    accent: 'purple',
    icon: <ShieldCheck size={26} />,
    eyebrow: 'What is Budgetly',
    title: 'Your private money workspace',
    body: 'Budgetly brings budgeting, recurring bills, savings goals, investments, and reports into one clean place — so you always know where your money goes.',
    points: [
      '🔒 Encrypted sign-in and bank-grade security',
      '☁️ Synced privately to the cloud — only you can see it',
      '📊 Live insights that update as you go',
    ],
  },
  {
    id: 'categories',
    feature: 'categories',
    navigate: 'categories',
    target: ['[data-tour="nav-categories"]', '[data-tour="m-nav-categories"]'],
    accent: 'gold',
    icon: <Tags size={26} />,
    eyebrow: 'Step 1 · Categories',
    title: 'Start by creating categories',
    body: 'This is the Categories page. Create categories for your expenses first — like Rent, Groceries, or Transport — and give each one a monthly budget.',
  },
  {
    id: 'transactions',
    feature: 'transactions',
    navigate: 'transactions',
    target: ['[data-tour="add-transaction"]', '[data-tour="m-nav-transactions"]'],
    accent: 'green',
    icon: <ListChecks size={26} />,
    eyebrow: 'Step 2 · Transactions',
    title: 'Add your first transaction',
    body: 'Now log money in and out. Use “Add Transaction” to record your first income or expense — it instantly updates your budgets and reports.',
  },
  {
    id: 'dashboard',
    feature: 'dashboard',
    navigate: 'dashboard',
    target: ['[data-tour="nav-dashboard"]', '[data-tour="m-nav-dashboard"]'],
    accent: 'indigo',
    icon: <BarChart3 size={26} />,
    eyebrow: 'Step 3 · Dashboard',
    title: 'Watch it all come together',
    body: 'Back on your Dashboard. As you add transactions, your balance, spending charts, and insights fill in and update here automatically.',
  },
  {
    id: 'explore',
    navigate: 'dashboard',
    target: ['[data-tour="nav-tools"]', '[data-tour="m-nav-tools"]'],
    accent: 'teal',
    icon: <Wrench size={26} />,
    eyebrow: "You're all set 🎉",
    title: 'Explore the rest anytime',
    body: 'Under Utilities you can set up Recurring bills, savings Goals, track Investments, and view Reports. Dive in whenever you\'re ready!',
    primaryLabel: 'Finish',
  },
]

type Props = {
  userName?: string
  features?: Partial<WalkthroughFeatures>
  onNavigate: (dest: TourDestination) => void
  onClose: () => void
  onFinish: () => void
}

const SPOTLIGHT_PADDING = 8

const isElementVisible = (el: Element): boolean => {
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  // Must be at least partially on screen (off-canvas mobile drawer fails this).
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
}

const resolveTarget = (selectors: string[]): HTMLElement | null => {
  for (const selector of selectors) {
    const matches = Array.from(document.querySelectorAll(selector))
    const visible = matches.find(isElementVisible)
    if (visible) return visible as HTMLElement
  }
  return null
}

type Placement = 'center' | 'top' | 'bottom' | 'left' | 'right'
type Position = { top: number; left: number; placement: Placement }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const computePosition = (rect: DOMRect, tipWidth: number, tipHeight: number): Position => {
  const pad = 14
  const gap = 16
  const vw = window.innerWidth
  const vh = window.innerHeight

  let placement: Placement
  let top: number
  let left: number

  const spaceRight = vw - rect.right
  const spaceLeft = rect.left

  if (spaceRight >= tipWidth + gap + pad) {
    placement = 'right'
    left = rect.right + gap
    top = rect.top + rect.height / 2 - tipHeight / 2
  } else if (spaceLeft >= tipWidth + gap + pad) {
    placement = 'left'
    left = rect.left - gap - tipWidth
    top = rect.top + rect.height / 2 - tipHeight / 2
  } else if (vh - rect.bottom >= tipHeight + gap + pad) {
    placement = 'bottom'
    top = rect.bottom + gap
    left = rect.left + rect.width / 2 - tipWidth / 2
  } else {
    placement = 'top'
    top = rect.top - gap - tipHeight
    left = rect.left + rect.width / 2 - tipWidth / 2
  }

  return {
    placement,
    top: clamp(top, pad, Math.max(pad, vh - tipHeight - pad)),
    left: clamp(left, pad, Math.max(pad, vw - tipWidth - pad)),
  }
}

export default function WelcomeWalkthrough({ userName = '', features, onNavigate, onClose, onFinish }: Props) {
  const steps = useMemo(() => {
    const all = buildSteps(userName.trim())
    return all.filter((step) => {
      if (!step.feature) return true
      if (!features) return true
      return features[step.feature] !== false
    })
  }, [userName, features])

  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)

  const boundedIndex = Math.min(index, steps.length - 1)
  const current = steps[boundedIndex]
  const isFirst = boundedIndex === 0
  const isLast = boundedIndex >= steps.length - 1

  const goNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1))
  const goBack = () => setIndex((i) => Math.max(i - 1, 0))
  const finish = () => onFinish()

  // Navigate for the current step, then locate its spotlight target (polling
  // until the destination view has mounted). Falls back to a centered card.
  useEffect(() => {
    const step = steps[boundedIndex]
    if (!step) return
    setPos(null)
    if (step.navigate) onNavigate(step.navigate)

    if (!step.target) {
      setRect(null)
      return
    }

    let cancelled = false
    let raf = 0
    let tries = 0
    const timers: number[] = []

    const remeasure = () => {
      if (cancelled) return
      const el = resolveTarget(step.target!)
      if (el) setRect(el.getBoundingClientRect())
    }

    const attempt = () => {
      if (cancelled) return
      const el = resolveTarget(step.target!)
      if (el) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* noop */ }
        setRect(el.getBoundingClientRect())
        // Re-measure shortly after in case layout settles post-navigation.
        timers.push(window.setTimeout(remeasure, 250))
        timers.push(window.setTimeout(remeasure, 550))
      } else if (tries++ < 60) {
        raf = window.requestAnimationFrame(attempt)
      } else {
        setRect(null)
      }
    }

    attempt()
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      timers.forEach((t) => window.clearTimeout(t))
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('scroll', remeasure, true)
    }
    // onNavigate is intentionally excluded — it may be a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundedIndex, steps])

  // Position the tooltip once we know the target rect and the tooltip's size.
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip) return
    if (!rect) {
      setPos({ top: 0, left: 0, placement: 'center' })
      return
    }
    const { width, height } = tip.getBoundingClientRect()
    setPos(computePosition(rect, width, height))
  }, [rect, boundedIndex])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); if (!isLast) goNext(); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); if (!isFirst) goBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFirst, isLast, onClose])

  if (!current) return null

  const placement = pos?.placement ?? 'center'
  const isCentered = placement === 'center' || !rect

  const holeStyle: React.CSSProperties | undefined = rect ? {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  } : undefined

  // When a target is spotlighted, cut a hole out of the blurred overlay so the
  // highlighted element stays crisp while everything else is dimmed and blurred.
  const overlayStyle: React.CSSProperties | undefined = rect ? (() => {
    const p = SPOTLIGHT_PADDING
    const hx = rect.left - p
    const hy = rect.top - p
    const hr = rect.right + p
    const hb = rect.bottom + p
    const clip = `polygon(evenodd, 0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px, ${hx}px ${hy}px, ${hr}px ${hy}px, ${hr}px ${hb}px, ${hx}px ${hb}px, ${hx}px ${hy}px)`
    return { clipPath: clip, WebkitClipPath: clip }
  })() : undefined

  const tooltipStyle: React.CSSProperties = isCentered
    ? {}
    : { top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }

  return (
    <div className="tourRoot" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Blurred, dimmed full-screen overlay. Blocks interaction with the app,
          and (for spotlight steps) has a clip-path hole over the target. */}
      <div className="tourOverlay" style={overlayStyle} onClick={(e) => e.stopPropagation()} />
      {rect ? <div className="tourRing" style={holeStyle} /> : null}

      <div
        ref={tipRef}
        className={`card tourTooltip ${isCentered ? 'tourTooltipCentered' : `tourTooltipAnchored tourPlacement-${placement}`}`}
        style={tooltipStyle}
      >
        <button className="walkthroughClose" type="button" onClick={onClose} aria-label="Close tour">
          <X size={18} />
        </button>

        <div className={`walkthroughIcon walkthroughIcon-${current.accent}`} aria-hidden="true">
          {current.icon}
        </div>

        <span className="walkthroughEyebrow">{current.eyebrow}</span>
        <h2 id="tour-title" className="walkthroughTitle">{current.title}</h2>
        <p className="walkthroughBody">{current.body}</p>

        {current.points ? (
          <ul className="walkthroughPoints">
            {current.points.map((point) => (
              <li key={point}>
                <span className={`walkthroughCheck walkthroughCheck-${current.accent}`}><Check size={13} /></span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="walkthroughDots" role="tablist" aria-label="Tour progress">
          {steps.map((step, dotIndex) => (
            <button
              key={step.id}
              type="button"
              className={`walkthroughDot ${dotIndex === boundedIndex ? 'active' : ''} ${dotIndex < boundedIndex ? 'done' : ''}`}
              onClick={() => setIndex(dotIndex)}
              aria-label={`Go to step ${dotIndex + 1}`}
              aria-selected={dotIndex === boundedIndex}
              role="tab"
            />
          ))}
        </div>

        <div className="walkthroughFooter">
          {isFirst ? (
            <button className="btn ghost walkthroughSkip" type="button" onClick={onClose}>Skip tour</button>
          ) : (
            <button className="btn ghost" type="button" onClick={goBack}><ArrowLeft size={16} /> Back</button>
          )}

          <div className="walkthroughFooterRight">
            <span className="walkthroughStepCount">{boundedIndex + 1} / {steps.length}</span>
            {isLast ? (
              <button className="btn primary" type="button" onClick={finish}>
                {current.primaryLabel ?? 'Finish'} <Check size={16} />
              </button>
            ) : (
              <button className="btn primary" type="button" onClick={goNext}>Next <ArrowRight size={16} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
