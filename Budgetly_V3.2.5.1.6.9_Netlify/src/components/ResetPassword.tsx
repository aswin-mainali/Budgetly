import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasRecoveryTokens = useMemo(() => {
    const hash = window.location.hash
    const query = window.location.search
    return /access_token=|refresh_token=|type=recovery|code=/.test(`${hash}&${query}`)
  }, [])

  useEffect(() => {
    let mounted = true

    const boot = async () => {
      setError(null)
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (!mounted) return

      if (sessionError) {
        setError(sessionError.message)
        return
      }

      if (data.session?.user) {
        setReady(true)
        return
      }

      if (!hasRecoveryTokens) {
        setError('This reset link is invalid or expired. Request a new password reset email and open the latest link.')
      }
    }

    void boot()

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' || Boolean(session?.user)) {
        setReady(true)
        setError(null)
        setMsg(null)
      }
    })

    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [hasRecoveryTokens])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setError(null)

    if (!ready) {
      setError('Open the latest reset link from your email first.')
      return
    }

    if (!password || !confirmPassword) {
      setError('Enter your new password in both fields.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      await supabase.auth.signOut()
      setPassword('')
      setConfirmPassword('')
      setReady(false)
      setMsg('Password changed successfully. Redirecting you to sign in…')
      window.setTimeout(() => {
        window.location.replace('/')
      }, 1400)
    } catch (err: any) {
      setError(err?.message ?? 'Could not reset password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authWrap">
      <div style={{ maxWidth: 560, margin: '7vh auto', padding: 16 }}>
        <div className="card authCardModern authCardEnhanced" style={{ minHeight: 'auto' }}>
          <div className="authPanelHeader authPanelHeaderEnhanced">
            <div>
              <small className="authEyebrow">Secure account recovery</small>
              <h1 className="authTitle">Reset your password</h1>
              <p className="authSubtitle">Create a new password, confirm it, and then sign back in with the updated password.</p>
            </div>
            <span className="badge authModeBadge"><ShieldCheck size={14} /> Recovery</span>
          </div>

          <form onSubmit={onSubmit} className="authFormModern authFormEnhanced" style={{ gap: 14 }}>
            <div className="authMessage" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.2)' }}>
              Password requirements: at least 8 characters.
            </div>

            <label className="authField">
              <small>New password</small>
              <div className="authInputWrap authInputWrapEnhanced">
                <Lock size={16} />
                <input
                  className="input authInputModern"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
            </label>

            <label className="authField">
              <small>Confirm new password</small>
              <div className="authInputWrap authInputWrapEnhanced">
                <KeyRound size={16} />
                <input
                  className="input authInputModern"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  type="password"
                  autoComplete="new-password"
                />
              </div>
            </label>

            <button className="btn primary authPrimaryButton" type="submit" disabled={busy || !ready}>
              {busy ? 'Updating password…' : 'Reset Password'}
            </button>

            <button
              className="btn ghost authSecondaryWide"
              type="button"
              onClick={() => window.location.replace('/')}
              disabled={busy}
            >
              <ArrowLeft size={16} /> Back to sign in
            </button>

            {!ready && !error ? (
              <div className="authMessage" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.2)' }}>
                Open the latest password reset link from your email to activate this page.
              </div>
            ) : null}

            {error ? (
              <div className="authMessage" style={{ background: 'rgba(127, 29, 29, 0.18)', border: '1px solid rgba(248, 113, 113, 0.35)' }}>
                {error}
              </div>
            ) : null}

            {msg ? (
              <div className="authMessage" style={{ background: 'rgba(22, 101, 52, 0.18)', border: '1px solid rgba(74, 222, 128, 0.35)' }}>
                <CheckCircle2 size={16} style={{ marginRight: 8, verticalAlign: 'text-bottom' }} />
                {msg}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  )
}
