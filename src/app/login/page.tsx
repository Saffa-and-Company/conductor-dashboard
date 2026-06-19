'use client'

import { useCallback, useEffect, useRef, useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

declare global {
  interface Window {
    google?: any
  }
}

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const router = useRouter()
  const googleBtnRef = useRef<HTMLDivElement | null>(null)

  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

  const completeLogin = useCallback(async (path: string, body: any) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Login failed')
      setLoading(false)
      return false
    }

    router.push('/')
    router.refresh()
    return true
  }, [router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await completeLogin('/api/auth/login', { username, password })
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!googleClientId) return

    const onScriptLoad = () => {
      if (!window.google || !googleBtnRef.current) return
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: any) => {
          setError('')
          setLoading(true)
          try {
            const ok = await completeLogin('/api/auth/google', { credential: response?.credential })
            if (!ok) return
          } catch {
            setError('Google sign-in failed')
            setLoading(false)
          }
        },
      })
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        shape: 'pill',
      })
      setGoogleReady(true)
    }

    const existing = document.querySelector('script[data-google-gsi="1"]') as HTMLScriptElement | null
    if (existing) {
      if (window.google) onScriptLoad()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.setAttribute('data-google-gsi', '1')
    script.onload = onScriptLoad
    script.onerror = () => setError('Failed to load Google Sign-In')
    document.head.appendChild(script)
  }, [googleClientId, completeLogin])

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{
        fontFamily: "'Inter Tight', system-ui, sans-serif",
        background: '#0D0D0D',
      }}
    >
      {/* ── Left Brand Panel (desktop only) ── */}
      <div
        className="hidden lg:flex relative flex-col justify-between overflow-hidden"
        style={{ width: '50%', minHeight: '100vh' }}
      >
        {/* Network SVG background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.14,
            animation: 'ctvc-float 8s ease-in-out infinite',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ctvc-assets/enhanced_collision_network.svg"
            alt=""
            className="w-full h-full object-cover"
            style={{ transform: 'scale(1.2)' }}
          />
        </div>

        {/* Gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 30% 50%, rgba(0,205,255,0.06) 0%, transparent 70%)',
          }}
        />

        {/* Brand content — nudged above center */}
        <div className="relative z-10 flex flex-col justify-center flex-1 px-16 xl:px-20" style={{ paddingBottom: '12vh' }}>
          {/* Logo */}
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center mb-10 overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ctv-mark.png" alt="Cotton Tree" className="w-10 h-10 object-contain" />
          </div>

          {/* Eyebrow */}
          <p
            style={{
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase' as const,
              color: '#00CDFF',
              marginBottom: '16px',
            }}
          >
            Your AI Crew
          </p>

          {/* Headline */}
          <h1
            style={{
              fontSize: 'clamp(2.5rem, 4vw, 3.5rem)',
              fontWeight: 500,
              letterSpacing: '-0.04em',
              lineHeight: 1.05,
              color: '#FFFFFF',
              margin: 0,
            }}
          >
            Conductor
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: '16px',
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.45)',
              marginTop: '16px',
              maxWidth: '380px',
            }}
          >
            Your agents are standing by. Check in, give direction, and keep everything moving.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 px-16 xl:px-20 pb-10">
          <p
            style={{
              fontSize: '12px',
              color: 'rgba(255,255,255,0.25)',
            }}
          >
            Cotton Tree Ventures
          </p>
        </div>
      </div>

      {/* ── Right Login Panel ── */}
      <div
        className="flex-1 flex items-center justify-center p-6 sm:p-10 min-h-screen lg:min-h-0"
        style={{ background: '#0D0D0D' }}
      >
        <div className="w-full max-w-sm">
          {/* Mobile-only brand header */}
          <div className="flex flex-col items-center mb-10 lg:hidden">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-4 overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ctv-mark.png" alt="Cotton Tree" className="w-10 h-10 object-contain" />
            </div>
            <p
              style={{
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.16em',
                textTransform: 'uppercase' as const,
                color: '#00CDFF',
                marginBottom: '8px',
              }}
            >
              Your AI Crew
            </p>
            <h1
              style={{
                fontSize: '1.75rem',
                fontWeight: 500,
                letterSpacing: '-0.04em',
                color: '#FFFFFF',
                margin: 0,
              }}
            >
              Conductor
            </h1>
          </div>

          {/* Glass card */}
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '20px',
              padding: '36px 32px',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            {/* Card header */}
            <div className="mb-8">
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  margin: '0 0 6px 0',
                }}
              >
                Sign in
              </h2>
              <p
                style={{
                  fontSize: '13px',
                  color: 'rgba(255,255,255,0.4)',
                  margin: 0,
                }}
              >
                Welcome back to mission control
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              {/* Error alert */}
              {error && (
                <div
                  role="alert"
                  style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    fontSize: '13px',
                    color: '#f87171',
                    marginBottom: '20px',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Username field */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="username"
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '8px',
                  }}
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  required
                  aria-required="true"
                  style={{
                    width: '100%',
                    height: '44px',
                    padding: '0 16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s cubic-bezier(0.22,1,0.36,1)',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,205,255,0.5)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                />
              </div>

              {/* Password field */}
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="password"
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const,
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '8px',
                  }}
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                  aria-required="true"
                  style={{
                    width: '100%',
                    height: '44px',
                    padding: '0 16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#FFFFFF',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.3s cubic-bezier(0.22,1,0.36,1)',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(0,205,255,0.5)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                />
              </div>

              {/* Sign in button */}
              <button
                type="submit"
                disabled={loading || !username || !password}
                style={{
                  width: '100%',
                  height: '44px',
                  borderRadius: '100px',
                  background: loading || !username || !password ? 'rgba(0,205,255,0.3)' : '#00CDFF',
                  color: '#0D0D0D',
                  fontSize: '14px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: loading || !username || !password ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontFamily: "'Inter Tight', system-ui, sans-serif",
                }}
                onMouseEnter={(e) => {
                  if (!loading && username && password) {
                    e.currentTarget.style.background = '#33d9ff'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && username && password) {
                    e.currentTarget.style.background = '#00CDFF'
                  }
                }}
              >
                {loading ? (
                  <>
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        border: '2px solid rgba(13,13,13,0.3)',
                        borderTopColor: '#0D0D0D',
                        borderRadius: '50%',
                        animation: 'ctvc-spin 0.6s linear infinite',
                      }}
                    />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            {/* Divider */}
            <div
              className="flex items-center gap-3"
              style={{ margin: '20px 0' }}
            >
              <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>or</span>
              <div style={{ height: '1px', flex: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Google sign-in */}
            <div className="flex justify-center">
              {googleClientId ? (
                <div className="min-h-[44px]" ref={googleBtnRef} />
              ) : (
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>
                  Google sign-in not configured
                </p>
              )}
            </div>
            {googleClientId && !googleReady && (
              <p style={{ textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginTop: '8px' }}>
                Loading Google Sign-In...
              </p>
            )}
          </div>

          {/* Footer (mobile) */}
          <p
            className="lg:hidden"
            style={{
              textAlign: 'center',
              fontSize: '12px',
              color: 'rgba(255,255,255,0.2)',
              marginTop: '24px',
            }}
          >
            Cotton Tree Ventures
          </p>
        </div>
      </div>

      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes ctvc-float {
          0%, 100% { transform: translateY(0px) scale(1.2); }
          50% { transform: translateY(-12px) scale(1.2); }
        }
        @keyframes ctvc-spin {
          to { transform: rotate(360deg); }
        }
        /* Override placeholder color for login inputs */
        .min-h-screen input::placeholder {
          color: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  )
}
