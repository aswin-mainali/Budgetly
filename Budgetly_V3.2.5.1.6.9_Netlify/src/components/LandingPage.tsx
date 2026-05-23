import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BarChart3, CircleDollarSign, ListChecks, Menu, Moon, Repeat, Search, Shield, Sparkles, Sun, Target, Wallet, X } from 'lucide-react'
import dashboardImage from '../assets/login-budget.png'
import './LandingPage.css'

type LandingPageProps = {
  onNavigateAuth: (mode: 'signin' | 'signup') => void
}

const features = [
  ['Dashboard', <BarChart3 size={18} />], ['Categories', <Wallet size={18} />], ['Transactions', <ListChecks size={18} />], ['Recurring', <Repeat size={18} />], ['Goals', <Target size={18} />], ['Investments', <CircleDollarSign size={18} />], ['Reports', <BarChart3 size={18} />], ['Advice', <Sparkles size={18} />], ['Universal Search', <Search size={18} />], ['Currency Converter', <Repeat size={18} />],
] as const

export default function LandingPage({ onNavigateAuth }: LandingPageProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('budgetly:marketing-theme') === 'dark' ? 'dark' : 'light')
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    document.body.classList.toggle('marketing-dark', theme === 'dark')
    localStorage.setItem('budgetly:marketing-theme', theme)
    return () => document.body.classList.remove('marketing-dark')
  }, [theme])

  useEffect(() => {
    if (reduceMotion) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible')
      })
    }, { threshold: 0.15 })
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [reduceMotion])

  return <div className="landingPage">
    <header className="landingNav">
      <strong>Budgetly</strong>
      <button className="menuBtn" onClick={() => setMobileOpen((v) => !v)}>{mobileOpen ? <X size={18} /> : <Menu size={18} />}</button>
      <nav className={mobileOpen ? 'open' : ''}><a href="#features">Features</a><a href="#how">How It Works</a><a href="#security">Security</a>
        <button className="btn ghost" onClick={() => onNavigateAuth('signin')}>Login</button>
        <button className="btn" onClick={() => onNavigateAuth('signup')}>Sign Up</button>
        <button className="iconBtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      </nav>
    </header>

    <section className="hero reveal"><div><span className="pill">All-in-one personal finance</span><h1>Budget smarter. Spend with confidence.</h1><p>Manage spending, categories, recurring bills, goals, investments, reports, advice, universal search, and currency conversion — all in one clean dashboard.</p><div className="actions"><button className="btn" onClick={() => onNavigateAuth('signup')}>Sign Up <ArrowRight size={16}/></button><button className="btn ghost" onClick={() => onNavigateAuth('signin')}>Login</button></div></div>
      <div className="heroVisual"><img src={dashboardImage} alt="Budgetly dashboard" loading="eager"/><div className="phoneMock"><img src={dashboardImage} alt="Budgetly mobile preview" loading="lazy"/></div></div></section>

    <section id="features" className="featureGrid reveal">{features.map(([label, icon]) => <article key={label} className="featureCard">{icon}<span>{label}</span></article>)}</section>

    <section className="showcase reveal"><h2>See Budgetly in action</h2><p>All your finances, beautifully organized. Explore the tools that keep you in control.</p><div className="showcaseCanvas"><img src={dashboardImage} alt="Budgetly product showcase" loading="lazy"/><div className="mini">Reports</div><div className="mini">Advice</div><div className="mini">Universal Search</div><div className="mini">Currency Converter</div></div></section>

    <section id="how" className="steps reveal"><h2>How it works</h2><div><article><h3>1. Set up your account</h3><p>Create your account and personalize your preferences.</p></article><article><h3>2. Add your finances</h3><p>Add income, expenses, recurring bills, goals, and categories.</p></article><article><h3>3. Track and improve</h3><p>View insights, reports, advice, and progress.</p></article></div></section>

    <section id="security" className="security reveal"><h2>Your privacy. Your money. Your control.</h2><ul><li>Designed with privacy in mind</li><li>You control your data</li><li>Clear and simple experience</li><li>No fake promises. Just clean budgeting.</li></ul></section>
    <section className="cta reveal"><h2>Ready to take control of your money?</h2><p>Start building better money habits with Budgetly.</p><div className="actions"><button className="btn" onClick={() => onNavigateAuth('signup')}>Sign Up</button><button className="btn ghost" onClick={() => onNavigateAuth('signin')}>Login</button></div></section>
    <footer><div><strong>Budgetly</strong><p>Personal finance, organized beautifully.</p></div></footer>
  </div>
}
