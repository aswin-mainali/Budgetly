import React, { useEffect, useState } from 'react'
import { ArrowRight, ChevronDown, Menu, X, LayoutDashboard, Tags, ListChecks, Repeat, Target, ChartColumnIncreasing, PieChart, Lightbulb, Search, ArrowLeftRight, ShieldCheck, Moon, Sun, UserRound, WalletCards, TrendingUp, CircleArrowRight } from 'lucide-react'
import dashboardImg from '../assets/landing/dashboard.png'
import categoryImg from '../assets/landing/category.png'
import transactionImg from '../assets/landing/transaction.png'
import recurringImg from '../assets/landing/recurring.png'
import goalsImg from '../assets/landing/goals.png'
import investmentImg from '../assets/landing/investment.png'
import reportsImg from '../assets/landing/reports.png'
import adviceImg from '../assets/landing/advice.png'
import currencyImg from '../assets/landing/currency.png'

const features = [
  ['Dashboard', LayoutDashboard], ['Categories', Tags], ['Transactions', ListChecks], ['Recurring', Repeat], ['Goals', Target],
  ['Investments', ChartColumnIncreasing], ['Reports', PieChart], ['Advice', Lightbulb], ['Universal Search', Search], ['Currency Converter', ArrowLeftRight],
] as const

export default function LandingPage({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('budgetly:marketing-theme') === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    document.body.classList.add('marketing-page')
    document.body.classList.toggle('marketing-dark', theme === 'dark')
    localStorage.setItem('budgetly:marketing-theme', theme)
    return () => {
      document.body.classList.remove('marketing-page', 'marketing-dark')
    }
  }, [theme])

  return <div className="landing">
    <header className="landingNavWrap">
      <nav className="landingNav">
        <strong className="wordmark">Budgetly</strong>
        <button className="menuBtn" aria-label="Toggle menu" onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className={`landingLinks ${menuOpen ? 'open' : ''}`}>
          <a href="#features">Features <ChevronDown size={14} /></a>
          <a href="#how">How It Works</a>
          <a href="#security">Security</a>
          <a href="#pricing">Pricing</a>
          <a href="#resources">Resources <ChevronDown size={14} /></a>
          <button className="themePill" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}</button>
          <button className="btn ghost" onClick={onLogin}>Login</button>
          <button className="btn navy" onClick={onSignup}>Sign Up</button>
        </div>
      </nav>
    </header>

    <section className="hero">
      <div className="heroCopy">
        <span className="pill">All-in-one personal finance</span>
        <h1>Budget smarter.<br />Spend with confidence.</h1>
        <p>Manage spending, categories, recurring bills, goals, investments, and reports — all in one place. Plus get personalized advice, universal search, and currency conversion to stay in control.</p>
        <div className="heroBtns"><button className="btn navy" onClick={onSignup}>Sign Up <ArrowRight size={16} /></button><button className="btn ghost" onClick={onLogin}>Login</button></div>
      </div>
      <div className="heroMocks"><div className="laptopFrame"><img loading="lazy" src={dashboardImg} alt="Budgetly dashboard" className="laptop" /></div><div className="phoneFrame"><img loading="lazy" src={currencyImg} alt="Budgetly currency" className="phone" /></div></div>
    </section>

    <section id="features" className="featureGrid">{features.map(([label, Icon]) => <article key={label} className="fCard"><span><Icon size={22} /></span><p>{label}</p></article>)}</section>

    <section className="showcase">
      <span className="pill mint">Explore every feature</span>
      <h2>See Budgetly in action</h2>
      <p>All your finances, beautifully organized. Explore the tools that keep you in control.</p>
      <div className="canvas">
        <img loading="lazy" src={transactionImg} alt="Transactions" className="flt t1" />
        <img loading="lazy" src={recurringImg} alt="Recurring" className="flt t2" />
        <img loading="lazy" src={goalsImg} alt="Goals" className="flt t3" />
        <img loading="lazy" src={categoryImg} alt="Categories" className="flt t4" />
        <img loading="lazy" src={investmentImg} alt="Investments" className="flt t5" />
        <img loading="lazy" src={reportsImg} alt="Reports" className="flt t6" />
        <img loading="lazy" src={adviceImg} alt="Advice" className="flt t7" />
        <img loading="lazy" src={currencyImg} alt="Currency converter" className="flt t8" />
        <img loading="lazy" src={dashboardImg} alt="Budgetly dashboard" className="center" />
        <div className="searchCard"><strong>Universal Search</strong><input value="Search anything..." readOnly /><ul><li>Transactions</li><li>Recurring</li><li>Reports</li><li>Advice</li></ul></div>
      </div>
    </section>

    <section id="how" className="how"><h2>How it works</h2><div className="steps"><article><span><UserRound size={18} /></span><div><h3>Set up your account</h3><p>Create your account and personalize your preferences.</p></div></article><CircleArrowRight className="stepArrow" size={16} /><article><span><WalletCards size={18} /></span><div><h3>Add your finances</h3><p>Add income, expenses, recurring bills, goals, and categories.</p></div></article><CircleArrowRight className="stepArrow" size={16} /><article><span><TrendingUp size={18} /></span><div><h3>Track and improve</h3><p>View insights, reports, advice, and progress.</p></div></article></div></section>

    <section id="security" className="privacy"><article><ShieldCheck size={18} /><h4>Private by design</h4><p>We never sell your data.</p></article><article><ShieldCheck size={18} /><h4>Your data, your control</h4><p>You own your data, always.</p></article><article><ShieldCheck size={18} /><h4>Secure backups</h4><p>Your information is safely backed up.</p></article><article><ShieldCheck size={18} /><h4>Simple and transparent</h4><p>No hidden fees. No surprises.</p></article></section>

    <footer className="footer"><div className="footerBrand"><strong className="wordmark">Budgetly</strong><p>All-in-one personal finance.<br />Built for clarity. Designed for life.</p></div><div className="cols"><div><h5>Product</h5><a>Features</a><a>Pricing</a><a>Security</a><a>Changelog</a></div><div><h5>Company</h5><a>About Us</a><a>Careers</a><a>Blog</a><a>Contact</a></div><div><h5>Support</h5><a>Help Center</a><a>Guides</a><a>FAQs</a><a>Status</a></div><div><h5>Legal</h5><a>Privacy Policy</a><a>Terms of Service</a><a>Data Policy</a><a>Cookie Policy</a></div></div><div className="cta"><h4>Ready to take control of your money?</h4><button className="btn navy" onClick={onSignup}>Get Started for Free</button><small>No credit card required.</small></div></footer>
  </div>
}
