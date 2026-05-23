import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, DollarSign, Goal, Layers, ListChecks, Menu, Moon, Repeat, Search, Sparkles, Sun, TrendingUp, X } from 'lucide-react'
import adviceImg from '../assets/landing/advice.png'
import categoryImg from '../assets/landing/category.png'
import currencyImg from '../assets/landing/currency.png'
import dashboardImg from '../assets/landing/dashboard.png'
import goalsImg from '../assets/landing/goals.png'
import investmentImg from '../assets/landing/investment.png'
import recurringImg from '../assets/landing/recurring.png'
import reportsImg from '../assets/landing/reports.png'
import transactionImg from '../assets/landing/transaction.png'

const featureItems = [
  { label: 'Dashboard', icon: BarChart3 },
  { label: 'Categories', icon: Layers },
  { label: 'Transactions', icon: ListChecks },
  { label: 'Recurring', icon: Repeat },
  { label: 'Goals', icon: Goal },
  { label: 'Investments', icon: TrendingUp },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Advice', icon: Sparkles },
  { label: 'Universal Search', icon: Search },
  { label: 'Currency Converter', icon: DollarSign },
]

const showcaseCards = [
  { label: 'Transactions', src: transactionImg },
  { label: 'Categories', src: categoryImg },
  { label: 'Recurring', src: recurringImg },
  { label: 'Goals', src: goalsImg },
  { label: 'Investments', src: investmentImg },
  { label: 'Reports', src: reportsImg },
  { label: 'Advice', src: adviceImg },
  { label: 'Currency', src: currencyImg },
]

export function LandingPage() {
  const [open, setOpen] = useState(false)
  const [light, setLight] = useState(localStorage.getItem('budgetly:landing-theme') !== 'dark')

  useEffect(() => {
    document.body.classList.toggle('landing-light', light)
    document.body.classList.toggle('landing-dark', !light)
    localStorage.setItem('budgetly:landing-theme', light ? 'light' : 'dark')
    return () => document.body.classList.remove('landing-light', 'landing-dark')
  }, [light])

  const actions = useMemo(() => ({ login: '/auth', signup: '/signup' }), [])

  return <div className="landingPage">
    <header className="landingNav">
      <strong>Budgetly</strong>
      <button className='landingMenuBtn' onClick={() => setOpen((v) => !v)} aria-label='Toggle menu'>{open ? <X /> : <Menu />}</button>
      <nav className={open ? 'open' : ''}>
        <a href="#features">Features</a><a href="#how">How It Works</a><a href="#security">Security</a>
        <button onClick={() => setLight((v) => !v)} className='iconBtn' aria-label='Toggle theme'>{light ? <Moon size={16} /> : <Sun size={16} />}</button>
        <a className='btn ghost' href={actions.login}>Login</a><a className='btn primary' href={actions.signup}>Sign Up</a>
      </nav>
    </header>

    <section className='hero'>
      <div>
        <span className='badge'>All-in-one personal finance</span>
        <h1>Budget smarter. Spend with confidence.</h1>
        <p>Manage spending, categories, recurring bills, goals, investments, reports, advice, universal search, and currency conversion — all in one clean dashboard.</p>
        <div className='cta'><a className='btn primary' href={actions.signup}>Sign Up</a><a className='btn ghost' href={actions.login}>Login</a></div>
      </div>
      <div className='heroMedia'>
        <div className='browserFrame'>
          <div className='browserDots'><span /><span /><span /></div>
          <img loading='lazy' src={dashboardImg} alt='Budgetly dashboard' />
        </div>
        <div className='phoneMock'><img loading='lazy' src={currencyImg} alt='Budgetly currency converter' /></div>
      </div>
    </section>

    <section id='features' className='featureGrid'>
      {featureItems.map(({ label, icon: Icon }) => <article key={label}><Icon size={18} /><span>{label}</span></article>)}
    </section>

    <section className='showcase'>
      <h2>See Budgetly in action</h2>
      <p>All your finances, beautifully organized. Explore the tools that keep you in control.</p>
      <div className='showcaseGrid'>
        <img className='center' loading='lazy' src={dashboardImg} alt='Dashboard overview' />
        {showcaseCards.map(({ label, src }) => <figure key={label}><img loading='lazy' src={src} alt={label} /><figcaption>{label}</figcaption></figure>)}
        <article className='universalSearchCard'>
          <header><Search size={16} /><strong>Universal Search</strong></header>
          <p>Search transactions, recurring, categories, goals, reports, and settings instantly.</p>
        </article>
      </div>
    </section>

    <section id='how' className='how'><h3>How it works</h3><div><article><h4>1. Set up your account</h4><p>Create your account and personalize your preferences.</p></article><article><h4>2. Add your finances</h4><p>Add income, expenses, recurring bills, goals, and categories.</p></article><article><h4>3. Track and improve</h4><p>View insights, reports, advice, and progress.</p></article></div></section>
    <section id='security' className='security'><h3>Your privacy. Your money. Your control.</h3><ul><li>Designed with privacy in mind</li><li>You control your data</li><li>Clear and simple experience</li><li>No fake promises. Just clean budgeting.</li></ul></section>
    <section className='finalCta'><h3>Ready to take control of your money?</h3><p>Start building better money habits with Budgetly.</p><div className='cta'><a className='btn primary' href={actions.signup}>Sign Up</a><a className='btn ghost' href={actions.login}>Login</a></div></section>
  </div>
}
