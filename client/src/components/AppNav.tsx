'use client'

import { useEffect, useRef, useState } from 'react'

const GATEWAY = 'https://www.aiden.services'

type AidenApp = { name: string; url: string; color: string }

const AIDEN_APPS: AidenApp[] = [
  { name: 'Chat', url: 'https://chat.aiden.services', color: '#ff2e2e' },
  { name: 'Listen', url: 'https://listen.aiden.services', color: '#ff6b00' },
  { name: 'Synthetic Research', url: 'https://synthetic-research.aiden.services/dashboard', color: '#3b82f6' },
  { name: 'Pitch', url: 'https://pitch.aiden.services', color: '#ff2e2e' },
  { name: 'refrAIm', url: 'https://refraim.aiden.services', color: '#eab308' },
  { name: 'Brand Audit', url: 'https://brandaudit.aiden.services', color: '#ff6b00' },
  { name: 'Brief Sharpener', url: 'https://brief-sharpener.aiden.services', color: '#3b82f6' },
  { name: 'Ads', url: 'https://ads.aiden.services', color: '#3b82f6' },
  { name: 'Colleague', url: 'https://www.aiden.services/colleague', color: '#ff2e2e' },
  { name: 'Teacher', url: 'https://teacher.aiden.services', color: '#ff6b00' },
]

export type AppNavProps = {
  appName: string
  tagline?: string
  currentApp: string
}

export default function AppNav({ appName, tagline, currentApp }: AppNavProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const balanceRequestRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function loadBalance() {
      const requestId = ++balanceRequestRef.current
      try {
        const response = await fetch(`${GATEWAY}/api/tokens/balance`, {
          credentials: 'include',
        })
        const d = response.ok ? await response.json() : null
        if (cancelled || requestId !== balanceRequestRef.current || !d) return
        if (typeof d.email === 'string') setEmail(d.email)
        if (typeof d.balance === 'number') setBalance(d.balance)
      } catch {
        // Balance is helpful but non-blocking. Server billing remains authoritative.
      }
    }
    const onRefresh = () => { void loadBalance() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadBalance()
    }

    void loadBalance()
    window.addEventListener('aiden:balance-refresh', onRefresh)
    window.addEventListener('focus', onRefresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      balanceRequestRef.current += 1
      window.removeEventListener('aiden:balance-refresh', onRefresh)
      window.removeEventListener('focus', onRefresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Publish the rendered nav height so each app can offset its own pinned chrome
  // (handles flex-wrap on narrow widths instead of a hardcoded guess).
  useEffect(() => {
    const el = wrapRef.current?.closest('.aiden-nav') as HTMLElement | null
    if (!el) return
    const setVar = () =>
      document.documentElement.style.setProperty('--aiden-nav-h', `${el.offsetHeight}px`)
    setVar()
    const ro = new ResizeObserver(setVar)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header className="aiden-nav">
      <style>{AIDEN_NAV_CSS}</style>
      <a className="aiden-nav-brand" href={`${GATEWAY}/dashboard`} title="AIDEN">
        <img className="aiden-nav-logo" src={`${GATEWAY}/images/aiden-logo.png`} alt="AIDEN" />
        <span className="aiden-nav-app">{appName}</span>
      </a>
      {tagline ? <span className="aiden-nav-tag">{tagline}</span> : null}
      <span className="aiden-nav-spacer" />
      {email ? <span className="aiden-nav-tag">{email}</span> : null}
      {balance !== null ? <span className="aiden-nav-tag">{balance} tokens</span> : null}
      <div className="aiden-nav-apps" ref={wrapRef}>
        <button
          type="button"
          className="aiden-nav-appsbtn"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="AIDEN apps"
        >
          <span className="aiden-nav-waffle">
            {Array.from({ length: 9 }).map((_, i) => <i key={i} />)}
          </span>
          Apps
        </button>
        <div className={`aiden-nav-menu${open ? ' aiden-nav-open' : ''}`} role="menu">
          {AIDEN_APPS.map((a) =>
            a.name === currentApp ? (
              <a key={a.name} className="aiden-nav-current" aria-current="page">
                <span className="aiden-nav-dot" style={{ background: a.color }} />
                {a.name}
              </a>
            ) : (
              <a key={a.name} href={a.url}>
                <span className="aiden-nav-dot" style={{ background: a.color }} />
                {a.name}
              </a>
            ),
          )}
        </div>
      </div>
      <a className="aiden-nav-hub" href={`${GATEWAY}/dashboard`}>Back to Hub</a>
      <button
        type="button"
        className="aiden-nav-signout"
        onClick={() => { window.location.href = `${GATEWAY}/auth/logout` }}
      >
        Sign out
      </button>
    </header>
  )
}

const AIDEN_NAV_CSS = `
.aiden-nav { display:flex; align-items:center; gap:12px; padding:12px 18px; background:#141417; border-bottom:1px solid #2a2a30; font-family:system-ui,-apple-system,'Segoe UI',sans-serif; flex-wrap:wrap; position:sticky; top:0; z-index:60; }
.aiden-nav * { box-sizing:border-box; }
.aiden-nav-brand { display:flex; align-items:center; gap:7px; text-decoration:none; }
.aiden-nav-logo { height:22px; width:auto; display:block; }
.aiden-nav-app { font-family:'Archivo Narrow',sans-serif; font-weight:400; letter-spacing:.02em; font-size:20px; color:#9a9aa2; }
.aiden-nav-tag { color:#9a9aa2; font-size:13px; }
.aiden-nav-spacer { flex:1; }
.aiden-nav-apps { position:relative; }
.aiden-nav-appsbtn { display:flex; align-items:center; gap:7px; background:transparent; border:1px solid #2a2a30; color:#e6e6ea; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; }
.aiden-nav-appsbtn:hover { border-color:#3a3a42; }
.aiden-nav-waffle { display:grid; grid-template-columns:repeat(3,3px); gap:2px; }
.aiden-nav-waffle i { width:3px; height:3px; background:currentColor; border-radius:1px; }
.aiden-nav-menu { position:absolute; top:calc(100% + 8px); right:0; z-index:50; width:300px; max-width:88vw; background:#1a1a1f; border:1px solid #2a2a30; border-radius:10px; padding:8px; display:none; grid-template-columns:1fr 1fr; gap:4px; box-shadow:0 14px 44px rgba(0,0,0,.55); }
.aiden-nav-menu.aiden-nav-open { display:grid; }
.aiden-nav-menu a { display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:8px; text-decoration:none; color:#e6e6ea; font-size:13px; }
.aiden-nav-menu a:hover { background:#26262c; }
.aiden-nav-menu a.aiden-nav-current { color:#ff6b00; cursor:default; }
.aiden-nav-dot { width:8px; height:8px; border-radius:50%; flex:none; }
.aiden-nav-hub { color:#9a9aa2; text-decoration:none; font-size:13px; white-space:nowrap; }
.aiden-nav-hub:hover { color:#ff6b00; }
.aiden-nav-signout { background:transparent; border:1px solid #2a2a30; color:#9a9aa2; border-radius:8px; padding:6px 10px; font-size:13px; cursor:pointer; }
.aiden-nav-signout:hover { color:#e6e6ea; border-color:#3a3a42; }
`
