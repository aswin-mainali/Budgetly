import React, { useEffect, useState } from 'react'
import {
  LogIn,
  UserPlus,
  Sparkles,
  ArrowRight,
  Check,
  BarChart3,
  ListChecks,
  Tags,
  Repeat,
  Target,
  FileBarChart,
  ArrowLeftRight,
  TrendingUp,
  Lightbulb,
  ShieldCheck,
  Zap,
  RefreshCw,
  Wallet,
  Sun,
  Moon,
} from 'lucide-react'

import dashboardImg from '../assets/landing/dashboard.png'
import transactionImg from '../assets/landing/transaction.png'
import goalsImg from '../assets/landing/goals.png'
import reportsImg from '../assets/landing/reports.png'
import investmentImg from '../assets/landing/investment.png'
import categoryImg from '../assets/landing/category.png'

type LandingPageProps = {
  onSignIn: () => void
  onSignUp: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

// The single animated preview cycles through a curated set of real screenshots.
const SHOWCASE = [
  { img: dashboardImg, label: 'Dashboard' },
  { img: transactionImg, label: 'Transactions' },
  { img: goalsImg, label: 'Goals' },
  { img: reportsImg, label: 'Reports' },
  { img: investmentImg, label: 'Investments' },
  { img: categoryImg, label: 'Categories' },
]

type Feature = {
  icon: React.ReactNode
  title: string
  description: string
  accent: string
  variant?: 'hero'
}

// DOM order is tuned for the bento auto-flow: the hero card fills a 2×2 block,
// the next four sit beside it, and the final four form the bottom row.
const FEATURES: Feature[] = [
  {
    icon: <BarChart3 size={22} />,
    title: 'A dashboard that actually makes sense',
    description:
      'Income, expenses, and what is left to spend — surfaced in one clean overview with live charts so you always know where you stand.',
    accent: 'violet',
    variant: 'hero',
  },
  {
    icon: <Target size={20} />,
    title: 'Savings goals',
    description: 'Set targets, contribute over time, and watch your progress climb.',
    accent: 'gold',
  },
  {
    icon: <FileBarChart size={20} />,
    title: 'Monthly reports',
    description: 'Clear breakdowns of your habits, ready to export any time.',
    accent: 'violet',
  },
  {
    icon: <Lightbulb size={20} />,
    title: 'Personalized advice',
    description: 'Tailored tips that help you spend smarter and save more.',
    accent: 'purple',
  },
  {
    icon: <TrendingUp size={20} />,
    title: 'Investment tracking',
    description: 'Follow your holdings and watch your net worth grow.',
    accent: 'green',
  },
  {
    icon: <ListChecks size={20} />,
    title: 'Effortless transactions',
    description: 'Log income and expenses in seconds and search instantly.',
    accent: 'indigo',
  },
  {
    icon: <Tags size={20} />,
    title: 'Smart categories',
    description: 'Custom categories with monthly budgets you control.',
    accent: 'green',
  },
  {
    icon: <Repeat size={20} />,
    title: 'Recurring bills',
    description: 'Never let a subscription or bill sneak up on you again.',
    accent: 'blue',
  },
  {
    icon: <ArrowLeftRight size={20} />,
    title: 'Currency converter',
    description: 'Live exchange rates for travel and global budgets.',
    accent: 'blue',
  },
]

const STATS = [
  { icon: <Wallet size={18} />, value: '9-in-1', label: 'tools in one app' },
  { icon: <ShieldCheck size={18} />, value: 'Private', label: 'your data stays yours' },
  { icon: <RefreshCw size={18} />, value: 'Live', label: 'synced across devices' },
  { icon: <Zap size={18} />, value: 'Free', label: 'to get started' },
]

const STEPS = [
  {
    icon: <UserPlus size={20} />,
    title: 'Create your account',
    description: 'Sign up in under a minute — just your name, email, and a password.',
  },
  {
    icon: <ListChecks size={20} />,
    title: 'Add your money',
    description: 'Log income, expenses, bills, and goals. Import a backup if you have one.',
  },
  {
    icon: <TrendingUp size={20} />,
    title: 'Watch it grow',
    description: 'Get a live picture of your finances and personalized advice to improve.',
  },
]

const HERO_POINTS = ['Free to start', 'No credit card', 'Works on every device']

export default function LandingPage({ onSignIn, onSignUp, theme, onToggleTheme }: LandingPageProps) {
  const isDark = theme === 'dark'
  const [shot, setShot] = useState(0)
  const [paused, setPaused] = useState(false)

  // The hero preview is the page's single moving element — a gentle auto-cycle
  // through real product screenshots, pausable on hover.
  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => {
      setShot((current) => (current + 1) % SHOWCASE.length)
    }, 3200)
    return () => window.clearInterval(timer)
  }, [paused])

  return (
    <div className="lp">
      <div className="lpAurora" aria-hidden="true">
        <span className="lpAuroraBlob lpAuroraOne" />
        <span className="lpAuroraBlob lpAuroraTwo" />
        <span className="lpAuroraBlob lpAuroraThree" />
        <span className="lpGrid" />
      </div>

      <header className="lpNav">
        <a className="lpBrand" href="#top">
          <span className="lpBrandMark">Budgetly</span>
        </a>
        <nav className="lpNavLinks">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="lpNavCtas">
          <button
            type="button"
            className="lpThemeToggle"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button type="button" className="lpBtnGhost" onClick={onSignIn}>
            <LogIn size={16} /> Sign in
          </button>
          <button type="button" className="lpBtnPrimary" onClick={onSignUp}>
            <UserPlus size={16} /> Sign up
          </button>
        </div>
      </header>

      <main className="lpMain" id="top">
        {/* HERO ---------------------------------------------------------- */}
        <section className="lpHero">
          <h1 className="lpHeroTitle">
            Take control of your money,<br />
            <span>all in one place.</span>
          </h1>
          <p className="lpHeroSub">
            Budgetly is the personal finance workspace for budgets, bills, goals, investments, and
            advice — beautifully organized so you can spend with confidence and save on autopilot.
          </p>

          <div className="lpHeroCtas">
            <button type="button" className="lpBtnPrimary lpBtnLg" onClick={onSignUp}>
              <UserPlus size={18} /> Create your free account
            </button>
            <button type="button" className="lpBtnOutline lpBtnLg" onClick={onSignIn}>
              <LogIn size={18} /> Sign in
            </button>
          </div>

          <ul className="lpHeroPoints">
            {HERO_POINTS.map((point) => (
              <li key={point}>
                <Check size={15} /> {point}
              </li>
            ))}
          </ul>

          {/* The one moving image */}
          <div
            className="lpShowcase"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="lpShowcaseGlow" aria-hidden="true" />

            <div className="lpWindow">
              <div className="lpWindowBar" aria-hidden="true">
                <span className="lpDot lpDotRed" />
                <span className="lpDot lpDotYellow" />
                <span className="lpDot lpDotGreen" />
                <span className="lpWindowPill">budgetly.app — {SHOWCASE[shot].label}</span>
              </div>
              <div className="lpWindowBody">
                {SHOWCASE.map((item, index) => (
                  <img
                    key={item.label}
                    src={item.img}
                    alt={`Budgetly ${item.label}`}
                    className={index === shot ? 'lpShot active' : 'lpShot'}
                    loading={index === 0 ? 'eager' : 'lazy'}
                  />
                ))}
              </div>
            </div>

            <div className="lpFloatCard lpFloatOne" aria-hidden="true">
              <span className="lpFloatIcon green"><TrendingUp size={16} /></span>
              <div>
                <strong>+18.2%</strong>
                <small>Net worth this year</small>
              </div>
            </div>
            <div className="lpFloatCard lpFloatTwo" aria-hidden="true">
              <span className="lpRing" style={{ ['--pct' as string]: '62%' }}>
                <span>62%</span>
              </span>
              <div>
                <strong>Goal: New car</strong>
                <small>On track for Sep</small>
              </div>
            </div>

            <div className="lpShowcaseDots" role="tablist" aria-label="Preview screens">
              {SHOWCASE.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="tab"
                  aria-selected={index === shot}
                  aria-label={item.label}
                  className={index === shot ? 'active' : ''}
                  onClick={() => setShot(index)}
                />
              ))}
            </div>
          </div>
        </section>

        {/* STATS --------------------------------------------------------- */}
        <section className="lpStats">
          {STATS.map((stat) => (
            <div key={stat.label} className="lpStat">
              <span className="lpStatIcon">{stat.icon}</span>
              <div>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            </div>
          ))}
        </section>

        {/* FEATURES BENTO ------------------------------------------------ */}
        <section className="lpSection" id="features">
          <div className="lpSectionHead">
            <span className="lpEyebrow">Everything you need</span>
            <h2>One app for your whole financial life</h2>
            <p>From daily spending to long-term goals and investments — Budgetly brings it all together.</p>
          </div>

          <div className="lpBento">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className={`lpCard ${feature.variant === 'hero' ? 'lpCardHero' : ''}`}
              >
                <span className={`lpCardIcon ${feature.accent}`}>{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>

                {feature.variant === 'hero' ? (
                  <div className="lpCardVisual" aria-hidden="true">
                    <div className="lpVizBars">
                      <span style={{ height: 46 }} />
                      <span style={{ height: 78 }} />
                      <span style={{ height: 58 }} />
                      <span style={{ height: 104 }} />
                      <span style={{ height: 70 }} />
                      <span style={{ height: 90 }} />
                    </div>
                    <div className="lpVizDonut" />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        {/* HOW IT WORKS -------------------------------------------------- */}
        <section className="lpSection" id="how">
          <div className="lpSectionHead">
            <span className="lpEyebrow">Get started in minutes</span>
            <h2>Up and running in three simple steps</h2>
          </div>

          <div className="lpSteps">
            {STEPS.map((step, index) => (
              <div key={step.title} className="lpStep">
                <span className="lpStepNum">{index + 1}</span>
                <span className="lpStepIcon">{step.icon}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA ----------------------------------------------------------- */}
        <section className="lpCta">
          <div className="lpCtaInner">
            <span className="lpBadge lpBadgeOnDark">
              <Sparkles size={14} /> Start today, it's free
            </span>
            <h2>Ready to make budgeting effortless?</h2>
            <p>Join Budgetly and start building healthier money habits in minutes.</p>
            <div className="lpHeroCtas lpCtaButtons">
              <button type="button" className="lpBtnPrimary lpBtnLg" onClick={onSignUp}>
                Get started free <ArrowRight size={18} />
              </button>
              <button type="button" className="lpBtnOutline lpBtnLg" onClick={onSignIn}>
                Sign in
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="lpFooter">
        <div className="lpFooterBrand">
          <span className="lpBrandMark">Budgetly</span>
          <p>Smart money, simplified.</p>
        </div>
        <div className="lpFooterActions">
          <button type="button" className="lpBtnGhost" onClick={onSignIn}>Sign in</button>
          <button type="button" className="lpBtnPrimary" onClick={onSignUp}>Sign up</button>
        </div>
        <span className="lpFooterCopy">© {new Date().getFullYear()} Budgetly. All rights reserved.</span>
      </footer>
    </div>
  )
}
