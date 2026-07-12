import React, { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  ListChecks,
  Tags,
  Repeat,
  Target,
  Sparkles,
  Wrench,
  ArrowRight,
  ArrowLeft,
  Check,
  X,
  Sparkle,
} from 'lucide-react'

export type WalkthroughFeatures = {
  dashboard: boolean
  transactions: boolean
  categories: boolean
  recurring: boolean
  advice: boolean
  goals: boolean
}

type WalkthroughStep = {
  id: string
  feature?: keyof WalkthroughFeatures
  accent: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  body: string
  points: string[]
}

const buildSteps = (userName: string): WalkthroughStep[] => [
  {
    id: 'welcome',
    accent: 'violet',
    icon: <Sparkle size={26} />,
    eyebrow: 'Welcome to Budgetly',
    title: userName ? `Hi ${userName}, let's get you set up 👋` : "Welcome aboard, let's get you set up 👋",
    body: 'Budgetly is your clean, private workspace for tracking money, planning budgets, and staying ahead of your goals. This quick tour takes less than a minute.',
    points: [
      'Everything syncs securely to the cloud',
      'Works on desktop and as an installable app',
      'You can replay this tour anytime from Help & Support',
    ],
  },
  {
    id: 'dashboard',
    feature: 'dashboard',
    accent: 'indigo',
    icon: <BarChart3 size={26} />,
    eyebrow: 'Step 1',
    title: 'Your dashboard, at a glance',
    body: 'The dashboard is your financial home base. See income, spending, and balance for the month, plus insights and notifications.',
    points: [
      'Track spending vs. income each month',
      'Spot trends with clean, live charts',
      'Jump straight to what needs attention',
    ],
  },
  {
    id: 'transactions',
    feature: 'transactions',
    accent: 'green',
    icon: <ListChecks size={26} />,
    eyebrow: 'Step 2',
    title: 'Add your income & expenses',
    body: 'Log transactions in seconds. Every entry keeps your budgets and reports up to date automatically.',
    points: [
      'Record income and expenses with notes',
      'Search, filter, and edit past entries',
      'Tip: press Ctrl + Alt + T to jump here fast',
    ],
  },
  {
    id: 'categories',
    feature: 'categories',
    accent: 'gold',
    icon: <Tags size={26} />,
    eyebrow: 'Step 3',
    title: 'Set budgets with categories',
    body: 'Group your spending into categories and give each one a monthly budget. Budgetly shows you how much room is left.',
    points: [
      'Create categories with emojis and colors',
      'Set a monthly budget per category',
      'See at a glance where your money goes',
    ],
  },
  {
    id: 'recurring',
    feature: 'recurring',
    accent: 'blue',
    icon: <Repeat size={26} />,
    eyebrow: 'Step 4',
    title: 'Never miss a recurring bill',
    body: 'Add rent, subscriptions, and paychecks once. Budgetly keeps track of what repeats and when.',
    points: [
      'Track weekly, monthly, or yearly items',
      'Stay ahead of upcoming due dates',
      'Keep your forecasts accurate',
    ],
  },
  {
    id: 'tools',
    feature: 'goals',
    accent: 'teal',
    icon: <Target size={26} />,
    eyebrow: 'Step 5',
    title: 'Goals & utilities',
    body: 'Set savings goals and watch your progress grow. The Utilities area also holds reports, a currency converter, and investments.',
    points: [
      'Create savings goals and track progress',
      'Export monthly reports as PDF',
      'Convert currencies with live rates',
    ],
  },
  {
    id: 'advice',
    feature: 'advice',
    accent: 'purple',
    icon: <Sparkles size={26} />,
    eyebrow: 'Step 6',
    title: 'Personalized insights',
    body: 'Head to Advice for tailored tips based on your spending, so you can make smarter money decisions over time.',
    points: [
      'Get insights drawn from your own data',
      'Spot opportunities to save',
      'Build better habits month over month',
    ],
  },
  {
    id: 'finish',
    accent: 'green',
    icon: <Check size={26} />,
    eyebrow: "You're all set",
    title: 'Ready to take control 🎉',
    body: 'That\'s the tour! The best first step is to add your very first transaction. Explore at your own pace — help is always in the Help & Support tab.',
    points: [
      'Add your first transaction to get started',
      'Set up a category budget when you\'re ready',
      'Replay this tour anytime from Help & Support',
    ],
  },
]

type Props = {
  userName?: string
  features?: Partial<WalkthroughFeatures>
  onClose: () => void
  onFinish: () => void
  onAddTransaction?: () => void
}

export default function WelcomeWalkthrough({ userName = '', features, onClose, onFinish, onAddTransaction }: Props) {
  const steps = useMemo(() => {
    const all = buildSteps(userName.trim())
    return all.filter((step) => {
      if (!step.feature) return true
      if (!features) return true
      return features[step.feature] !== false
    })
  }, [userName, features])

  const [index, setIndex] = useState(0)
  const current = steps[Math.min(index, steps.length - 1)]
  const isFirst = index === 0
  const isLast = index >= steps.length - 1

  const goNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1))
  const goBack = () => setIndex((i) => Math.max(i - 1, 0))

  const finish = () => onFinish()
  const finishAndAdd = () => {
    onFinish()
    onAddTransaction?.()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (!isLast) goNext()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (!isFirst) goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFirst, isLast, onClose])

  if (!current) return null

  return (
    <div className="walkthroughBackdrop" role="presentation">
      <div
        className="card walkthroughModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
      >
        <button className="walkthroughClose" type="button" onClick={onClose} aria-label="Close walkthrough">
          <X size={18} />
        </button>

        <div className={`walkthroughIcon walkthroughIcon-${current.accent}`} aria-hidden="true">
          {current.icon}
        </div>

        <span className="walkthroughEyebrow">{current.eyebrow}</span>
        <h2 id="walkthrough-title" className="walkthroughTitle">{current.title}</h2>
        <p className="walkthroughBody">{current.body}</p>

        <ul className="walkthroughPoints">
          {current.points.map((point) => (
            <li key={point}>
              <span className={`walkthroughCheck walkthroughCheck-${current.accent}`}><Check size={13} /></span>
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="walkthroughDots" role="tablist" aria-label="Tour progress">
          {steps.map((step, dotIndex) => (
            <button
              key={step.id}
              type="button"
              className={`walkthroughDot ${dotIndex === index ? 'active' : ''} ${dotIndex < index ? 'done' : ''}`}
              onClick={() => setIndex(dotIndex)}
              aria-label={`Go to step ${dotIndex + 1}`}
              aria-selected={dotIndex === index}
              role="tab"
            />
          ))}
        </div>

        <div className="walkthroughFooter">
          {isFirst ? (
            <button className="btn ghost walkthroughSkip" type="button" onClick={onClose}>
              Skip tour
            </button>
          ) : (
            <button className="btn ghost" type="button" onClick={goBack}>
              <ArrowLeft size={16} /> Back
            </button>
          )}

          <div className="walkthroughFooterRight">
            <span className="walkthroughStepCount">{index + 1} / {steps.length}</span>
            {isLast ? (
              onAddTransaction ? (
                <button className="btn primary" type="button" onClick={finishAndAdd}>
                  Add first transaction <ArrowRight size={16} />
                </button>
              ) : (
                <button className="btn primary" type="button" onClick={finish}>
                  Get started <Check size={16} />
                </button>
              )
            ) : (
              <button className="btn primary" type="button" onClick={goNext}>
                Next <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
