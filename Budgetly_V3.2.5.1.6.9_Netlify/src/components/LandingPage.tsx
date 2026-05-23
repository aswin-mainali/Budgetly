import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BarChart3, DollarSign, Goal, Layers, ListChecks, Menu, Moon, Repeat, Search, Shield, Sparkles, Sun, TrendingUp, Wallet, X } from 'lucide-react'

const featureItems = [
  ['Dashboard', BarChart3, 'dashboard'], ['Categories', Layers, 'categories'], ['Transactions', ListChecks, 'transactions'], ['Recurring', Repeat, 'recurring'], ['Goals', Goal, 'goals'], ['Investments', TrendingUp, 'investments'], ['Reports', BarChart3, 'reports'], ['Advice', Sparkles, 'advice'], ['Universal Search', Search, 'universal-search'], ['Currency Converter', DollarSign, 'currency-converter'],
] as const

const screenshot = (name: string) => `/landing/${name}.png`

export function LandingPage() {
  const [open, setOpen] = useState(false)
  const [light, setLight] = useState(localStorage.getItem('budgetly:landing-theme') !== 'dark')
  useEffect(() => {
    document.body.classList.toggle('landing-light', light)
    document.body.classList.toggle('landing-dark', !light)
    localStorage.setItem('budgetly:landing-theme', light ? 'light' : 'dark')
    return () => {
      document.body.classList.remove('landing-light', 'landing-dark')
    }
  }, [light])

  const actions = useMemo(() => ({ login: '/?auth=signin', signup: '/?auth=signup' }), [])

  return <div className="landingPage">
    <header className="landingNav">
      <strong>Budgetly</strong>
      <button className='landingMenuBtn' onClick={() => setOpen((v) => !v)}>{open ? <X/> : <Menu/>}</button>
      <nav className={open ? 'open' : ''}>
        <a href="#features">Features</a><a href="#how">How It Works</a><a href="#security">Security</a>
        <button onClick={() => setLight((v) => !v)} className='iconBtn'>{light ? <Moon size={16}/> : <Sun size={16}/>}</button>
        <a className='btn ghost' href={actions.login}>Login</a><a className='btn primary' href={actions.signup}>Sign Up</a>
      </nav>
    </header>
    <section className='hero'>
      <div><span className='badge'>All-in-one personal finance</span><h1>Budget smarter. Spend with confidence.</h1><p>Manage spending, categories, recurring bills, goals, investments, reports, advice, universal search, and currency conversion — all in one clean dashboard.</p><div className='cta'><a className='btn primary' href={actions.signup}>Sign Up</a><a className='btn ghost' href={actions.login}>Login</a></div></div>
      <div className='heroMedia'>
        <img loading='lazy' src={screenshot('dashboard')} alt='Budgetly dashboard'/>
      </div>
    </section>
    <section id='features' className='featureGrid'>
      {featureItems.map(([label, Icon]) => <article key={label}><Icon size={18}/><span>{label}</span></article>)}
    </section>
    <section className='showcase'>
      <h2>See Budgetly in action</h2><p>All your finances, beautifully organized. Explore the tools that keep you in control.</p>
      <div className='showcaseGrid'>
        <img className='center' loading='lazy' src={screenshot('dashboard')} alt='Dashboard overview'/>
        {featureItems.filter(([,,k])=>k!=='dashboard').map(([label,,key]) => <figure key={key}><img loading='lazy' src={screenshot(key)} alt={label}/><figcaption>{label}</figcaption></figure>)}
      </div>
    </section>
    <section id='how' className='how'><h3>How it works</h3><div><article><h4>1. Set up your account</h4><p>Create your account and personalize your preferences.</p></article><article><h4>2. Add your finances</h4><p>Add income, expenses, recurring bills, goals, and categories.</p></article><article><h4>3. Track and improve</h4><p>View insights, reports, advice, and progress.</p></article></div></section>
    <section id='security' className='security'><h3>Your privacy. Your money. Your control.</h3><ul><li>Designed with privacy in mind</li><li>You control your data</li><li>Clear and simple experience</li><li>No fake promises. Just clean budgeting.</li></ul></section>
    <section className='finalCta'><h3>Ready to take control of your money?</h3><p>Start building better money habits with Budgetly.</p><div className='cta'><a className='btn primary' href={actions.signup}>Sign Up</a><a className='btn ghost' href={actions.login}>Login</a></div></section>
  </div>
}
