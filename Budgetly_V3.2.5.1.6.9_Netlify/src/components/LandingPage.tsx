import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  LogIn,
  UserPlus,
  BarChart3,
  ListChecks,
  Tags,
  Repeat,
  Target,
  FileBarChart,
  ArrowLeftRight,
  TrendingUp,
  Sparkles,
  ShieldCheck,
  CloudCog,
  Smartphone,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'

import dashboardImg from '../assets/landing/dashboard.png'
import transactionImg from '../assets/landing/transaction.png'
import categoryImg from '../assets/landing/category.png'
import recurringImg from '../assets/landing/recurring.png'
import goalsImg from '../assets/landing/goals.png'
import reportsImg from '../assets/landing/reports.png'
import currencyImg from '../assets/landing/currency.png'
import investmentImg from '../assets/landing/investment.png'
import adviceImg from '../assets/landing/advice.png'

type LandingPageProps = {
  onSignIn: () => void
  onSignUp: () => void
}

type Feature = {
  icon: React.ReactNode
  title: string
  description: string
  image: string
  accent: string
}

const FEATURES: Feature[] = [
  {
    icon: <BarChart3 size={20} />,
    title: 'Dashboard at a glance',
    description: 'See income, expenses, and what is left to spend in one clean overview built for quick decisions.',
    image: dashboardImg,
    accent: 'violet',
  },
  {
    icon: <ListChecks size={20} />,
    title: 'Effortless transactions',
    description: 'Log income and expenses in seconds, search instantly, and keep every dollar accounted for.',
    image: transactionImg,
    accent: 'indigo',
  },
  {
    icon: <Tags size={20} />,
    title: 'Smart categories',
    description: 'Group spending into custom categories with monthly budgets so you always know where money goes.',
    image: categoryImg,
    accent: 'green',
  },
  {
    icon: <Repeat size={20} />,
    title: 'Recurring bills',
    description: 'Track subscriptions and recurring payments so a bill never sneaks up on you again.',
    image: recurringImg,
    accent: 'blue',
  },
  {
    icon: <Target size={20} />,
    title: 'Savings goals',
    description: 'Set goals, contribute over time, and watch your progress climb toward every milestone.',
    image: goalsImg,
    accent: 'gold',
  },
  {
    icon: <FileBarChart size={20} />,
    title: 'Monthly reports',
    description: 'Understand your habits with clear monthly reports and export them whenever you need.',
    image: reportsImg,
    accent: 'violet',
  },
  {
    icon: <ArrowLeftRight size={20} />,
    title: 'Currency converter',
    description: 'Convert between currencies with live exchange rates, perfect for travel and global budgets.',
    image: currencyImg,
    accent: 'blue',
  },
  {
    icon: <TrendingUp size={20} />,
    title: 'Investment tracking',
    description: 'Follow your holdings and portfolio performance to see your net worth grow over time.',
    image: investmentImg,
    accent: 'green',
  },
  {
    icon: <Sparkles size={20} />,
    title: 'Personalized advice',
    description: 'Get tailored insights and tips that help you spend smarter and save more each month.',
    image: adviceImg,
    accent: 'purple',
  },
]

const TRUST_POINTS = [
  { icon: <ShieldCheck size={16} />, label: 'Secure, private sign-in' },
  { icon: <CloudCog size={16} />, label: 'Synced across your devices' },
  { icon: <Smartphone size={16} />, label: 'Installable as an app' },
]

const HIGHLIGHTS = [
  'Free to get started in minutes',
  'Works on desktop, tablet, and mobile',
  'Your data stays yours, always',
]

export default function LandingPage({ onSignIn, onSignUp }: LandingPageProps) {
  const [activeFeature, setActiveFeature] = useState(0)

  // Gently rotate the highlighted preview so the page feels alive without
  // demanding any interaction from a first-time visitor.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveFeature((current) => (current + 1) % FEATURES.length)
    }, 4500)
    return () => window.clearInterval(timer)
  }, [])

  // --- Interactive 3D feature showcase --------------------------------------
  const [showcaseIndex, setShowcaseIndex] = useState(0)
  const [showcasePaused, setShowcasePaused] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const total = FEATURES.length
  const prevIndex = (showcaseIndex - 1 + total) % total
  const nextIndex = (showcaseIndex + 1) % total

  const selectShowcase = useCallback((index: number) => {
    setShowcaseIndex(((index % total) + total) % total)
  }, [total])

  // Auto-advance the showcase, pausing while the visitor is interacting with it.
  useEffect(() => {
    if (showcasePaused) return
    const timer = window.setInterval(() => {
      setShowcaseIndex((current) => (current + 1) % total)
    }, 3800)
    return () => window.clearInterval(timer)
  }, [showcasePaused, total])

  // Tilt the whole 3D stage toward the pointer for a parallax, hands-on feel.
  const handleStagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    stage.style.setProperty('--rx', `${(-py * 6).toFixed(2)}deg`)
    stage.style.setProperty('--ry', `${(px * 9).toFixed(2)}deg`)
    stage.style.setProperty('--px', `${(px * 16).toFixed(1)}px`)
    stage.style.setProperty('--py', `${(py * 12).toFixed(1)}px`)
  }, [])

  const resetStageTilt = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.style.setProperty('--rx', '0deg')
    stage.style.setProperty('--ry', '0deg')
    stage.style.setProperty('--px', '0px')
    stage.style.setProperty('--py', '0px')
  }, [])

  const active = FEATURES[showcaseIndex]

  return (
    <div className="landingWrap">
      <div className="landingBackdrop" aria-hidden="true">
        <span className="landingGlow landingGlowOne" />
        <span className="landingGlow landingGlowTwo" />
        <span className="landingGridMask" />
      </div>

      <header className="landingNav">
        <div className="landingBrand">
          <span className="landingBrandMark">Budgetly</span>
          <span className="landingBrandDot" aria-hidden="true" />
        </div>
        <nav className="landingNavActions">
          <button type="button" className="landingNavSignIn" onClick={onSignIn}>
            <LogIn size={16} /> Sign in
          </button>
          <button type="button" className="landingNavSignUp" onClick={onSignUp}>
            <UserPlus size={16} /> Sign up
          </button>
        </nav>
      </header>

      <main className="landingMain">
        <section className="landingHero">
          <div className="landingHeroCopy">
            <span className="landingKicker">
              <Sparkles size={14} /> Smart money, simplified
            </span>
            <h1 className="landingHeroTitle">
              Take control of your money with <span>Budgetly</span>.
            </h1>
            <p className="landingHeroSubtitle">
              Budgetly is your all-in-one personal finance workspace. Track spending, plan budgets,
              set savings goals, follow investments, and get personalized advice — all in one clean,
              beautiful place.
            </p>

            <div className="landingHeroCtas">
              <button type="button" className="landingPrimaryBtn" onClick={onSignUp}>
                <UserPlus size={18} /> Create your free account
              </button>
              <button type="button" className="landingSecondaryBtn" onClick={onSignIn}>
                <LogIn size={18} /> I already have an account
              </button>
            </div>

            <ul className="landingHighlights">
              {HIGHLIGHTS.map((point) => (
                <li key={point}>
                  <CheckCircle2 size={16} /> {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="landingHeroPreview">
            <div className="landingPreviewCard">
              <div className="landingPreviewFrame">
                {FEATURES.map((feature, index) => (
                  <img
                    key={feature.title}
                    src={feature.image}
                    alt={feature.title}
                    className={index === activeFeature ? 'landingPreviewImg active' : 'landingPreviewImg'}
                    loading={index === 0 ? 'eager' : 'lazy'}
                  />
                ))}
              </div>
              <div className="landingPreviewCaption">
                <span className={`landingFeatureIcon ${FEATURES[activeFeature].accent}`}>
                  {FEATURES[activeFeature].icon}
                </span>
                <div>
                  <strong>{FEATURES[activeFeature].title}</strong>
                  <p>{FEATURES[activeFeature].description}</p>
                </div>
              </div>
              <div className="landingPreviewDots" role="tablist" aria-label="Feature previews">
                {FEATURES.map((feature, index) => (
                  <button
                    key={feature.title}
                    type="button"
                    role="tab"
                    aria-selected={index === activeFeature}
                    aria-label={feature.title}
                    className={index === activeFeature ? 'active' : ''}
                    onClick={() => setActiveFeature(index)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="landingTrustRow">
          {TRUST_POINTS.map((point) => (
            <div key={point.label} className="landingTrustItem">
              {point.icon}
              <span>{point.label}</span>
            </div>
          ))}
        </div>

        <section className="landingShowcase" id="features">
          <div className="landingSectionHead">
            <span className="landingSectionEyebrow">Everything you need</span>
            <h2>One app for your whole financial life</h2>
            <p>From day-to-day spending to long-term goals and investments, Budgetly brings it all together — explore it live below.</p>
          </div>

          <div
            className="landingShowcaseInner"
            onMouseEnter={() => setShowcasePaused(true)}
            onMouseLeave={() => setShowcasePaused(false)}
          >
            <div className="landingShowcaseRail" role="tablist" aria-label="Budgetly features">
              {FEATURES.map((feature, index) => {
                const isActive = index === showcaseIndex
                return (
                  <button
                    key={feature.title}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={isActive ? 'landingRailItem active' : 'landingRailItem'}
                    onClick={() => selectShowcase(index)}
                    onFocus={() => selectShowcase(index)}
                  >
                    <span className={`landingFeatureIcon ${feature.accent}`}>{feature.icon}</span>
                    <span className="landingRailText">
                      <strong>{feature.title}</strong>
                      <small>{feature.description}</small>
                    </span>
                    <span className="landingRailProgress" aria-hidden="true">
                      <span
                        className="landingRailProgressBar"
                        style={{ animationPlayState: isActive && !showcasePaused ? 'running' : 'paused' }}
                      />
                    </span>
                  </button>
                )
              })}
            </div>

            <div
              className="landingStage"
              ref={stageRef}
              onPointerMove={handleStagePointerMove}
              onPointerLeave={resetStageTilt}
            >
              <span className={`landingStageGlow ${active.accent}`} aria-hidden="true" />

              <div className="landingStageScene">
                <div className={`landingStageCard peek prev ${FEATURES[prevIndex].accent}`} aria-hidden="true">
                  <img src={FEATURES[prevIndex].image} alt="" loading="lazy" />
                </div>
                <div className={`landingStageCard peek next ${FEATURES[nextIndex].accent}`} aria-hidden="true">
                  <img src={FEATURES[nextIndex].image} alt="" loading="lazy" />
                </div>

                <div className="landingStageCard landingStageMain">
                  <div className="landingStageChrome" aria-hidden="true">
                    <span /><span /><span />
                  </div>
                  <div className="landingStageShots">
                    {FEATURES.map((feature, index) => (
                      <img
                        key={feature.title}
                        src={feature.image}
                        alt={feature.title}
                        className={index === showcaseIndex ? 'landingStageShot active' : 'landingStageShot'}
                        loading={index < 2 ? 'eager' : 'lazy'}
                      />
                    ))}
                  </div>
                  <div className="landingStageCaption">
                    <span className={`landingFeatureIcon ${active.accent}`}>{active.icon}</span>
                    <div>
                      <strong>{active.title}</strong>
                      <p>{active.description}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="landingStageDots" role="tablist" aria-label="Choose a feature">
                {FEATURES.map((feature, index) => (
                  <button
                    key={feature.title}
                    type="button"
                    role="tab"
                    aria-selected={index === showcaseIndex}
                    aria-label={feature.title}
                    className={index === showcaseIndex ? 'active' : ''}
                    onClick={() => selectShowcase(index)}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="landingCta">
          <div className="landingCtaInner">
            <h2>Ready to make budgeting effortless?</h2>
            <p>Join Budgetly today and start building healthier money habits in minutes.</p>
            <div className="landingCtaButtons">
              <button type="button" className="landingPrimaryBtn" onClick={onSignUp}>
                Get started free <ArrowRight size={18} />
              </button>
              <button type="button" className="landingSecondaryBtn" onClick={onSignIn}>
                Sign in
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <span className="landingBrandMark">Budgetly</span>
        <span className="landingFooterCopy">© {new Date().getFullYear()} Budgetly. Smart money, simplified.</span>
      </footer>
    </div>
  )
}
