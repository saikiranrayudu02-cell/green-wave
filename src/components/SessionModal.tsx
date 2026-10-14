import { useEffect, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { X, LogIn, ShieldCheck, LogOut, UserRound, Lock, MailCheck, UserPlus, PlayCircle } from 'lucide-react'
import { cn } from '../lib/cn'
import { MicroLabel, Led } from './ui'
import { DEMO_OPERATORS, type OperatorSession } from '../backend/session'
import type { OpRole } from '../backend/types'
import { supabaseConfigured, ENV } from '../backend/config'

interface Props {
  /** gate is always open while signed out; panel is open on demand */
  open: boolean
  session: OperatorSession | null
  /** session resolution / auth call in flight */
  busy?: boolean
  onClose: () => void
  onSignInDemo: (operator: string, role: OpRole) => void
  /** one-click demo entry — offered only when demoEntryEnabled */
  demoEntryEnabled?: boolean
  onEnterDemo?: () => void
  onSignInSupabase: (email: string, password: string) => Promise<string | null>
  onSignUpSupabase: (email: string, password: string, displayName: string) => Promise<{ ok: boolean; requiresConfirmation?: boolean; error?: string }>
  onSignOut: () => void
}

const inputCls =
  'h-9 w-full rounded-[4px] border border-white/10 bg-night-950/80 px-3 font-mono text-[11.5px] tracking-[0.04em] text-slate-100 placeholder:text-slate-700 outline-none transition-colors focus:border-ops-cyan/60 focus:bg-night-950'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1 text-slate-600">{label}</MicroLabel>
      {children}
    </label>
  )
}

type AuthTab = 'signin' | 'signup'

export default function SessionModal({
  open,
  session,
  busy,
  onClose,
  onSignInDemo,
  demoEntryEnabled: demoEntry = false,
  onEnterDemo,
  onSignInSupabase,
  onSignUpSupabase,
  onSignOut,
}: Props) {
  const gate = session === null
  const [tab, setTab] = useState<AuthTab>('signin')
  const [role, setRole] = useState<OpRole>('EMERGENCY_DISPATCHER')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // reset transient state when the gate opens again
  useEffect(() => {
    if (open && gate) {
      setTab('signin')
      setError(null)
      setNotice(null)
    }
  }, [open, gate])

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    const err = await onSignInSupabase(email.trim(), password)
    setSubmitting(false)
    if (err) setError(err)
  }

  const submitSignUp = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const res = await onSignUpSupabase(email.trim(), password, name.trim())
    setSubmitting(false)
    if (!res.ok) {
      setError(res.error ?? 'Unable to create the operator account.')
      return
    }
    if (res.requiresConfirmation) {
      setNotice(`Confirmation email sent to ${email.trim()}. Confirm it, then sign in.`)
      setTab('signin')
      setPassword('')
      setConfirm('')
      return
    }
    // auto-confirmed project — session already active, gate closes via App
  }

  const chosen = DEMO_OPERATORS.find((o) => o.role === role) ?? DEMO_OPERATORS[0]
  const cloud = supabaseConfigured

  return (
    /* The scrim is a PLAIN div OUTSIDE AnimatePresence so its pointer-events
       always follow the CURRENT `open` value. A child inside AnimatePresence
       replays stale `open=true` props during exit — if that exit frame is ever
       throttled, an invisible full-screen overlay would swallow app clicks
       (observed live in this webview). The scrim fade is CSS-driven. */
    <div
      /* Inline styles, not classes/transitions: deterministic in throttled
         webviews where CSS transitions may freeze mid-flight. */
      style={{ pointerEvents: open ? 'auto' : 'none', opacity: open ? 1 : 0 }}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-night-950/85 backdrop-blur-[3px]"
      onClick={() => session && onClose()}
    >
      {/* No AnimatePresence / exit animation: an rAF-throttled exit freezes
          the panel on screen (observed live). Mount animation only — unmount
          is instant and deterministic. */}
      {open && (
          <motion.div
            key="session"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[400px] overflow-hidden rounded-md border border-white/[0.09] bg-night-900 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
          >
            {/* header */}
            <header className="relative flex h-11 items-center justify-between border-b border-white/[0.06] px-4">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-ops-cyan" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-100">
                  {gate ? 'Municipal Operations Portal' : 'Operator Session'}
                </span>
              </div>
              {session && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[3px] p-1 text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              )}
            </header>

            {gate && (
              <div className="flex h-9 items-center justify-center border-b border-white/[0.05] bg-night-950/60">
                <span className="font-mono text-[7.5px] tracking-[0.2em] text-slate-500">
                  {ENV.orgName.toUpperCase()} · SECURE SIGN-IN
                </span>
              </div>
            )}

            <div className="max-h-[72vh] overflow-y-auto px-4 py-4">
              {/* current session summary */}
              {session && (
                <div className="mb-4 flex items-center gap-3 rounded-[4px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full border',
                      session.provider === 'demo' ? 'border-ops-amber/45' : 'border-ops-cyan/40',
                    )}
                  >
                    <span
                      className={cn(
                        'font-mono text-[13px] font-semibold',
                        session.provider === 'demo' ? 'text-ops-amber' : 'text-ops-cyan',
                      )}
                    >
                      {session.operator.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-slate-100">{session.operator}</span>
                      <span
                        className={cn(
                          'rounded-[2px] border px-1 py-[1px] font-mono text-[7.5px] font-bold tracking-[0.12em]',
                          session.provider === 'demo' ? 'border-ops-amber/40 text-ops-amber' : 'border-ops-cyan/40 text-ops-cyan',
                        )}
                      >
                        {session.role}
                      </span>
                    </div>
                    <div className="mt-[3px] flex items-center gap-1.5 font-mono text-[8px] tracking-[0.14em] text-slate-500">
                      <Led tone={session.provider === 'demo' ? 'amber' : 'green'} size={4} pulse />
                      {session.provider === 'demo' ? 'DEMO MUNICIPALITY' : session.orgLabel.toUpperCase()}
                      {session.email && <span className="text-slate-700">· {session.email}</span>}
                    </div>
                  </div>
                </div>
              )}

              {gate && cloud && (
                <div className="mb-3 flex items-start gap-2 rounded-[4px] border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                  <Lock size={13} className="mt-[1px] shrink-0 text-slate-500" />
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Operator access requires a confirmed municipal account. Credentials never leave this deployment
                    through the command center — authentication is handled by Supabase Auth with email confirmation
                    enabled.
                  </p>
                </div>
              )}

              {/* ---------- cloud auth (production) ---------- */}
              {cloud ? (
                <div>
                  {/* tabs */}
                  <div className="mb-3 flex items-center rounded-[4px] border border-white/[0.07] bg-night-950 p-[2px]">
                    {(['signin', 'signup'] as AuthTab[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTab(t)
                          setError(null)
                          setNotice(null)
                        }}
                        className={cn(
                          'relative flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[3px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] transition-colors',
                          tab === t ? 'text-ops-cyan' : 'text-slate-500 hover:text-slate-300',
                        )}
                      >
                        {tab === t && (
                          <motion.span
                            layoutId="auth-tab"
                            transition={{ type: 'spring', stiffness: 450, damping: 34 }}
                            className="absolute inset-0 rounded-[3px] border border-ops-cyan/50 bg-ops-cyan/[0.08]"
                          />
                        )}
                        <span className="relative flex items-center gap-1.5">
                          {t === 'signin' ? <LogIn size={10} /> : <UserPlus size={10} />}
                          {t === 'signin' ? 'Sign In' : 'Create Account'}
                        </span>
                      </button>
                    ))}
                  </div>

                  {tab === 'signin' ? (
                    <form onSubmit={submitSignIn} className="space-y-2.5">
                      <Field label="Email">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="operator@municipality.gov"
                          className={inputCls}
                          autoComplete="email"
                          required
                        />
                      </Field>
                      <Field label="Password">
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          className={inputCls}
                          autoComplete="current-password"
                          required
                        />
                      </Field>
                      {error && (
                        <div className="rounded-[3px] border border-ops-red/35 bg-ops-red/[0.07] px-2.5 py-1.5 font-mono text-[9px] tracking-[0.06em] text-ops-red">
                          {error}
                        </div>
                      )}
                      {notice && (
                        <div className="flex items-start gap-2 rounded-[3px] border border-emerald-400/30 bg-emerald-400/[0.06] px-2.5 py-1.5">
                          <MailCheck size={12} className="mt-[1px] shrink-0 text-emerald-300" />
                          <p className="font-mono text-[9px] leading-relaxed tracking-[0.04em] text-emerald-200/90">{notice}</p>
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={submitting || busy}
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-[4px] bg-ops-cyan font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-night-950 transition-colors hover:bg-cyan-300 disabled:opacity-50"
                      >
                        {submitting ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-night-950/30 border-t-night-950" />
                        ) : (
                          <LogIn size={13} />
                        )}
                        Sign In
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={submitSignUp} className="space-y-2.5">
                      <Field label="Display Name">
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Alex Reyes"
                          className={inputCls}
                          autoComplete="name"
                        />
                      </Field>
                      <Field label="Work Email">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="operator@municipality.gov"
                          className={inputCls}
                          autoComplete="email"
                          required
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Password">
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="8+ characters"
                            className={inputCls}
                            autoComplete="new-password"
                            required
                          />
                        </Field>
                        <Field label="Confirm">
                          <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="repeat"
                            className={inputCls}
                            autoComplete="new-password"
                            required
                          />
                        </Field>
                      </div>
                      <p className="font-mono text-[8px] leading-relaxed tracking-[0.08em] text-slate-600">
                        New operators are provisioned as VIEWER into the organization configured for this deployment.
                        An admin promotes roles (TRAFFIC_OPERATOR / EMERGENCY_DISPATCHER / ADMIN) via the profiles
                        table. A confirmation email must be verified before the first sign-in.
                      </p>
                      {error && (
                        <div className="rounded-[3px] border border-ops-red/35 bg-ops-red/[0.07] px-2.5 py-1.5 font-mono text-[9px] tracking-[0.06em] text-ops-red">
                          {error}
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={submitting || busy}
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-[4px] border border-ops-cyan/50 bg-ops-cyan/10 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ops-cyan transition-colors hover:bg-ops-cyan/20 disabled:opacity-50"
                      >
                        {submitting ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-ops-cyan/30 border-t-ops-cyan" />
                        ) : (
                          <UserPlus size={13} />
                        )}
                        Create Operator Account
                      </button>
                    </form>
                  )}

                  <p className="mt-3 text-center font-mono text-[7.5px] tracking-[0.14em] text-slate-700">
                    AUTH VIA SUPABASE · EMAIL CONFIRMATION REQUIRED · RLS-ISOLATED ORG DATA
                  </p>

                  {demoEntry && onEnterDemo && (
                    <div className="mt-4 border-t border-white/[0.05] pt-3">
                      <button
                        type="button"
                        onClick={onEnterDemo}
                        disabled={busy}
                        className="flex h-8 w-full items-center justify-center gap-2 rounded-[4px] border border-ops-amber/40 bg-ops-amber/[0.06] font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-ops-amber transition-colors hover:bg-ops-amber/[0.12] disabled:opacity-50"
                      >
                        <PlayCircle size={12} />
                        Enter Demo
                        <span className="font-mono text-[7px] font-medium tracking-[0.14em] text-ops-amber/60">
                          LOCAL SESSION · NO CLOUD ACCESS
                        </span>
                      </button>
                      <p className="mt-2 text-center font-mono text-[7px] tracking-[0.12em] text-slate-700">
                        LOCAL DEMO ORGANIZATION · SEED DATA · NO PRODUCTION RECORDS
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* ---------- offline demo operators ---------- */
                <div>
                  {demoEntry && onEnterDemo && (
                    <button
                      type="button"
                      onClick={onEnterDemo}
                      disabled={busy}
                      className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-[4px] bg-ops-amber font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-night-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
                    >
                      <PlayCircle size={13} />
                      Enter Demo
                    </button>
                  )}
                  <div className="mb-2 flex items-center justify-between">
                    <MicroLabel className="text-slate-500">Demo Operator</MicroLabel>
                    <span className="rounded-[2px] border border-ops-amber/35 px-1.5 py-[1px] font-mono text-[7.5px] font-semibold tracking-[0.14em] text-ops-amber">
                      OFFLINE ONLY
                    </span>
                  </div>
                  <div className="space-y-[3px]">
                    {DEMO_OPERATORS.map((o) => (
                      <button
                        key={o.role}
                        type="button"
                        onClick={() => setRole(o.role)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-[4px] border px-2.5 py-2 text-left transition-colors',
                          role === o.role
                            ? 'border-ops-amber/50 bg-ops-amber/[0.07]'
                            : 'border-white/[0.06] bg-white/[0.01] hover:border-white/15 hover:bg-white/[0.03]',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-[9px] w-[9px] items-center justify-center rounded-full border',
                            role === o.role ? 'border-ops-amber' : 'border-slate-600',
                          )}
                        >
                          {role === o.role && <span className="h-[5px] w-[5px] rounded-full bg-ops-amber" />}
                        </span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="text-[11.5px] font-medium text-slate-200">{o.operator}</div>
                          <div className="mt-[2px] font-mono text-[8px] tracking-[0.1em] text-slate-600">{o.blurb}</div>
                        </div>
                        <span className="font-mono text-[8px] font-bold tracking-[0.12em] text-slate-500">{o.role}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSignInDemo(chosen.operator, chosen.role)}
                    disabled={busy}
                    className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-[4px] border border-ops-amber/45 bg-ops-amber/10 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ops-amber transition-colors hover:bg-ops-amber/20 disabled:opacity-50"
                  >
                    <UserRound size={13} />
                    Continue as {chosen.operator}
                  </button>
                  <p className="mt-3 text-center font-mono text-[7.5px] tracking-[0.14em] text-slate-700">
                    NO CLOUD CONFIGURED · LOCAL SIMULATION ONLY
                  </p>
                </div>
              )}

              {/* sign out */}
              {session && (
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3">
                  <span className="font-mono text-[8px] tracking-[0.14em] text-slate-700">
                    SESSION {session.provider === 'supabase' ? '· SUPABASE AUTH' : '· LOCAL DEMO'}
                  </span>
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex items-center gap-1.5 rounded-[3px] border border-ops-red/35 px-2.5 py-[5px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ops-red transition-colors hover:bg-ops-red/10"
                  >
                    <LogOut size={11} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </motion.div>
      )}
    </div>
  )
}