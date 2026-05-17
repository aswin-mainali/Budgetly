import React, { useMemo, useRef, useState } from 'react'
import { authenticateBiometricCredential, biometricSupported, PASSKEY_LOGIN_ENABLED_KEY, PASSKEY_LOGIN_USER_EMAIL_KEY, PASSKEY_LOGIN_USER_ID_KEY } from '../lib/biometricUnlock'
import { supabase } from '../lib/supabase'
import {
  Mail,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  Eye,
  EyeOff,
  CheckCircle2,
  BadgeCheck,
  Download,
} from 'lucide-react'
import { usePwaInstall } from '../hooks/usePwaInstall'


function FaceIdIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 11h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8.8 14.5c.8 1.1 1.9 1.7 3.2 1.7 1.3 0 2.4-.6 3.2-1.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
      <circle cx="15" cy="9" r="1" fill="currentColor" />
    </svg>
  )
}

type AuthProps = {
  pendingBiometricUser?: { id: string; email: string | null } | null
  onBiometricUnlockSuccess?: (user: { id: string; email: string | null }) => void
}

export default function Auth({ pendingBiometricUser = null, onBiometricUnlockSuccess }: AuthProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const [biometricError, setBiometricError] = useState('')
  const biometricEnabled = typeof window !== 'undefined' && localStorage.getItem(PASSKEY_LOGIN_ENABLED_KEY) === 'true'
  const markerUserId = typeof window !== 'undefined' ? localStorage.getItem(PASSKEY_LOGIN_USER_ID_KEY) : null
  const markerEmail = typeof window !== 'undefined' ? localStorage.getItem(PASSKEY_LOGIN_USER_EMAIL_KEY) : null
  const biometricTargetUser = pendingBiometricUser ?? (markerUserId ? { id: markerUserId, email: markerEmail } : null)
  const installWrapRef = useRef<HTMLDivElement | null>(null)
  const { canInstall, showInstallButton, install, isIosSafari } = usePwaInstall()

  const title = useMemo(() => {
    if (mode === 'signup') return 'Create your account'
    if (mode === 'forgot') return 'Reset your password'
    return 'Welcome back'
  }, [mode])

  const subtitle = useMemo(() => {
    if (mode === 'signup') return 'Start using a cleaner finance workspace for budgets, recurring bills, goals, and reports.'
    if (mode === 'forgot') return 'Enter your email and we will send you a secure reset link.'
    return ''
  }, [mode])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBiometricError('')
    setMsg(null)
    setBusy(true)
    try {
      if (!email) throw new Error('Email required.')
      if (mode !== 'forgot' && !password) throw new Error('Email + password required.')
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMsg('Account created. Now sign in.')
        setMode('signin')
      } else if (mode === 'forgot') {
        const redirectTo = new URL('/reset-password', window.location.origin).toString()
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw error
        setMsg('Password reset email sent. Open the link in your email inbox.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err: any) {
      setMsg(err?.message ?? 'Auth failed.')
    } finally {
      setBusy(false)
    }
  }



  const handleBiometricSignIn = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (!biometricTargetUser?.id) {
      setBiometricError('Biometric setup was not found on this device. Please sign in with password and set it up again.')
      return
    }

    setBiometricError('')
    setBusy(true)
    try {
      if (!biometricSupported()) throw new Error('unsupported')

      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setBiometricError('Please sign in with password once to refresh your session.')
        return
      }

      await authenticateBiometricCredential(biometricTargetUser.id)
      onBiometricUnlockSuccess?.(biometricTargetUser)
    } catch (error: any) {
      console.error('Biometric sign-in failed', error)
      const errorName = String(error?.name || '').toLowerCase()
      if (errorName.includes('notallowed')) {
        setBiometricError('Biometric sign-in cancelled. You can still sign in with password.')
      } else if (String(error?.message || '').toLowerCase().includes('no passkey')) {
        setBiometricError('Biometric setup was not found on this device. Please sign in with password and set it up again.')
      } else {
        setBiometricError('Biometric sign-in cancelled or failed. You can still sign in with password.')
      }
    } finally {
      setBusy(false)
    }
  }

  const modeLabel = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Recovery'

  const onInstallClick = () => {
    if (canInstall) {
      setShowIosInstallHelp(false)
      void install()
      return
    }

    if (isIosSafari) {
      setShowIosInstallHelp((v) => !v)
    }
  }

  return (
    <div className="authWrap">
      <div className="authShell authShellEnhanced">
        <section className="authVisual authVisualPremium card">
          <div className="authVisualBackdrop" aria-hidden="true">
            <span className="authGlow authGlowOne" />
            <span className="authGlow authGlowTwo" />
            <span className="authGridMask" />
            <span className="authRing authRingOne" />
            <span className="authRing authRingTwo" />
          </div>

          <div className="authVisualTop authVisualTopPremium">
            <div>
              <div className="authBrandMark">Budgetly</div>
              <div className="authBrandSubtle">Smart money, simplified</div>
            </div>
          </div>

          <div className="authVisualContent authVisualContentEnhanced authVisualContentPremium">
            <div className="authVisualCopy authVisualCopyPremium">
              <span className="authKicker">Premium personal finance</span>
              <h2>Money control that feels polished.</h2>
              <p>One clean workspace for budgeting, planning, and staying ahead.</p>
            </div>

            <div className="authHeroPanel" aria-hidden="true">
              <div className="authHeroMiniGraph">
                <span className="authHeroMiniGlow authHeroMiniGlowOne" />
                <span className="authHeroMiniGlow authHeroMiniGlowTwo" />
                <div className="authHeroMiniGrid" />
                <div className="authHeroMiniLine authHeroMiniLineOne" />
                <div className="authHeroMiniLine authHeroMiniLineTwo" />
                <span className="authHeroMiniNode authHeroMiniNodeOne" />
                <span className="authHeroMiniNode authHeroMiniNodeTwo" />
                <span className="authHeroMiniNode authHeroMiniNodeThree" />
              </div>
            </div>

            <div className="authTrustRow authTrustRowPremium">
              <div className="authTrustItem"><BadgeCheck size={14} /><span>Secure sign-in</span></div>
              <div className="authTrustItem"><ShieldCheck size={14} /><span>Cloud synced</span></div>
              <div className="authTrustItem"><Sparkles size={14} /><span>Live insights</span></div>
            </div>
          </div>
        </section>

        <section className="card authCardModern authCardEnhanced">
          <div className="authPanelHeader authPanelHeaderEnhanced">
            <div>
              <small className="authEyebrow">Personal finance workspace</small>
              <h1 className="authTitle">{title}</h1>
              {subtitle ? <p className="authSubtitle">{subtitle}</p> : null}
            </div>
            <span className="badge authModeBadge"><LogIn size={14}/> {modeLabel}</span>
          </div>

          <div className="authSwitchRow authSwitchRowEnhanced">
            <span>
              {mode === 'signin'
                ? 'Need an account?'
                : mode === 'signup'
                ? 'Already have an account?'
                : 'Remembered your password?'}
            </span>
            <button
              className="authTextButton"
              type="button"
              onClick={() => {
                setMsg(null)
                setPassword('')
                setMode(mode === 'signin' ? 'signup' : 'signin')
              }}
              disabled={busy}
            >
              {mode === 'signin' ? 'Create account' : 'Sign in'}
            </button>
          </div>

          <form onSubmit={onSubmit} className="authFormModern authFormEnhanced">
            <label className="authField">
              <small>Email</small>
              <div className="authInputWrap authInputWrapEnhanced">
                <Mail size={16} />
                <input
                  className="input authInputModern"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                />
              </div>
            </label>

            {mode !== 'forgot' ? (
              <label className="authField">
                <div className="row between authPasswordLabelRow">
                  <small>Password</small>
                  {mode === 'signin' ? (
                    <button
                      className="authInlineLink"
                      type="button"
                      onClick={() => {
                        setMsg(null)
                        setPassword('')
                        setMode('forgot')
                      }}
                      disabled={busy}
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </div>
                <div className="authInputWrap authInputWrapEnhanced">
                  <Lock size={16} />
                  <input
                    className="input authInputModern"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                  <button
                    type="button"
                    className="authVisibilityButton"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            ) : null}

            <button className="btn primary authPrimaryButton" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset email' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>

            {mode === 'signin' && biometricEnabled ? (
              <button className="btn authBiometricInlineBtn" type="button" onClick={(event) => void handleBiometricSignIn(event)} disabled={busy}>
                <span>{busy ? 'Checking…' : 'Use Biometrics'}</span>
                <FaceIdIcon className="authBiometricInlineIcon" />
              </button>
            ) : null}
            {mode === 'signin' && biometricEnabled && biometricError ? <small className="authBiometricInlineError">{biometricError}</small> : null}

            {mode === 'signin' && showInstallButton ? (
              <div className="authInstallRow" ref={installWrapRef}>
                <button className="btn primary authInstallButton" type="button" onClick={onInstallClick} aria-label="Install Budgetly" aria-expanded={showIosInstallHelp}>
                  <Download size={14} />
                  <span>Install Budgetly</span>
                </button>
                {showIosInstallHelp && isIosSafari ? (
                  <div className="authInstallHelp" role="dialog" aria-label="Install Budgetly on iPhone">
                    <div className="authInstallHelpTitle">Install Budgetly on iPhone</div>
                    <ol>
                      <li>Tap the Share button in Safari</li>
                      <li>Scroll down</li>
                      <li>Tap "Add to Home Screen"</li>
                    </ol>
                    <button className="authInstallHelpClose" type="button" onClick={() => setShowIosInstallHelp(false)}>Close</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="authActionRow authActionRowEnhanced">
              {mode === 'forgot' ? (
                <button
                  className="btn ghost authSecondaryWide"
                  type="button"
                  onClick={() => {
                    setMsg(null)
                    setMode('signin')
                  }}
                  disabled={busy}
                >
                  Back to sign in
                </button>
              ) : null}
            </div>

            {msg ? <div className="authMessage">{msg}</div> : null}
          </form>
        </section>
      </div>
    </div>
  )
}
