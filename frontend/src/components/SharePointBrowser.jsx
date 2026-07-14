import { useState, useEffect, useRef } from 'react'
import './FolderPicker.css'

// SharePoint connector UI (no-Graph, delegated user-SSO). Two modes:
//  - Not connected: enter host/site, "Connect" → opens the Microsoft sign-in
//    (via openExternal in the pane), polls until the token lands.
//  - Connected: browse the document library and "Pull" files into input_folder.
// Talks only to the local backend's /api/sharepoint/* endpoints.
function SharePointBrowser({ onCancel, onPulled }) {
  const [status, setStatus] = useState(null)      // {connected, host, site}
  const [host, setHost] = useState('')
  const [site, setSite] = useState('')
  const [listing, setListing] = useState(null)    // {current, files, folders}
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [pulling, setPulling] = useState(null)    // serverRelativeUrl being pulled
  const [pulled, setPulled] = useState({})        // serverRelativeUrl -> true
  const pollRef = useRef(null)

  useEffect(() => {
    refreshStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const refreshStatus = async () => {
    setLoading(true)
    try {
      const s = await (await fetch('/api/sharepoint/status')).json()
      setStatus(s)
      setHost(s.host || '')
      setSite(s.site || '')
      if (s.connected) loadFolder('')
      else setLoading(false)
    } catch {
      setError('Failed to reach the backend')
      setLoading(false)
    }
  }

  const connect = async () => {
    if (!host.trim() || !site.trim()) { setError('Enter the SharePoint host and site'); return }
    setConnecting(true)
    setError(null)
    try {
      await fetch('/api/sharepoint/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), site: site.trim() }),
      })
      const d = await (await fetch('/api/sharepoint/auth/start', { method: 'POST' })).json()
      if (!d.url) throw new Error(d.detail || 'Could not start sign-in')
      if (window.openai && window.openai.openExternal) window.openai.openExternal({ href: d.url })
      else window.open(d.url, '_blank', 'noopener')
      // Poll for the token to land after the browser sign-in completes.
      let tries = 0
      pollRef.current = setInterval(async () => {
        tries += 1
        try {
          const s = await (await fetch('/api/sharepoint/status')).json()
          if (s.connected) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setConnecting(false)
            setStatus(s)
            loadFolder('')
          }
        } catch {}
        if (tries > 150) { clearInterval(pollRef.current); pollRef.current = null; setConnecting(false) }
      }, 2000)
    } catch (e) {
      setError(e.message)
      setConnecting(false)
    }
  }

  const loadFolder = async (rel) => {
    setLoading(true)
    setError(null)
    try {
      const url = rel ? `/api/sharepoint/list?folder=${encodeURIComponent(rel)}` : '/api/sharepoint/list'
      const res = await fetch(url)
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Failed to list folder') }
      setListing(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const pull = async (file) => {
    setPulling(file.serverRelativeUrl)
    try {
      const res = await fetch('/api/sharepoint/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverRelativeUrl: file.serverRelativeUrl }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.success) throw new Error(d.detail || 'Download failed')
      setPulled((p) => ({ ...p, [file.serverRelativeUrl]: true }))
      if (onPulled) onPulled()
    } catch (e) {
      alert('Pull failed: ' + e.message)
    } finally {
      setPulling(null)
    }
  }

  const signOut = async () => {
    await fetch('/api/sharepoint/signout', { method: 'POST' })
    setStatus((s) => ({ ...(s || {}), connected: false }))
    setListing(null)
  }

  // Parent folder, bounded to the site's document library root.
  const root = `${(status && status.site) || site}/Shared Documents`
  const current = listing && listing.current
  const parent = current && current.length > root.length ? current.slice(0, current.lastIndexOf('/')) : null

  const fmtSize = (n) => {
    const b = Number(n)
    if (!b || isNaN(b)) return ''
    if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
    if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB'
    if (b > 1e3) return (b / 1e3).toFixed(0) + ' KB'
    return b + ' B'
  }

  const folderIcon = (
    <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z" />
    </svg>
  )
  const fileIcon = (
    <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5L9.5 1zM9 5V2l3 3H9z" />
    </svg>
  )

  return (
    <div className="folder-picker-overlay" onClick={onCancel || undefined}>
      <div className="folder-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="folder-picker-header">
          <h3>SharePoint</h3>
          {onCancel && <button className="modal-close" onClick={onCancel}>×</button>}
        </div>

        {!status ? (
          <div className="folder-picker-list"><div className="folder-picker-loading">Loading…</div></div>
        ) : !status.connected ? (
          // ---- Not connected: config + connect ----
          <div style={{ padding: '18px 20px' }}>
            <p style={{ marginTop: 0, color: 'var(--color-text-muted)' }}>
              Connect your SharePoint to pull files into <code>input_folder</code>. You sign in with your own
              Microsoft account — VibeFoundry only sees what you can already access.
            </p>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>SharePoint host</label>
            <input
              className="folder-picker-path-input"
              style={{ width: '100%', marginBottom: 10 }}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="contoso.sharepoint.com"
            />
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Site path</label>
            <input
              className="folder-picker-path-input"
              style={{ width: '100%', marginBottom: 14 }}
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="/sites/YourSite"
            />
            {error && <div className="folder-picker-error" style={{ marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" onClick={connect} disabled={connecting}>
              {connecting ? 'Waiting for sign-in…' : 'Connect SharePoint'}
            </button>
            {connecting && (
              <p style={{ color: 'var(--color-text-subtle)', fontSize: 12, marginTop: 10 }}>
                Complete the sign-in in your browser, then come back — this will update automatically.
              </p>
            )}
          </div>
        ) : (
          // ---- Connected: browse + pull ----
          <>
            <div className="folder-picker-path-form" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {current || `${status.host}${status.site}`}
              </span>
              <button type="button" className="btn-flat" onClick={signOut}>Sign out</button>
            </div>
            <div className="folder-picker-list">
              {loading ? (
                <div className="folder-picker-loading">Loading…</div>
              ) : error ? (
                <div className="folder-picker-error">{error}</div>
              ) : (
                <>
                  {parent && (
                    <div className="folder-picker-item parent" onDoubleClick={() => loadFolder(parent)}>
                      {folderIcon}<span className="folder-name">..</span>
                    </div>
                  )}
                  {(listing.folders || []).map((f) => (
                    <div key={f.serverRelativeUrl} className="folder-picker-item" onDoubleClick={() => loadFolder(f.serverRelativeUrl)}>
                      {folderIcon}<span className="folder-name">{f.name}</span>
                    </div>
                  ))}
                  {(listing.files || []).map((f) => (
                    <div key={f.serverRelativeUrl} className="folder-picker-item" style={{ justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                        {fileIcon}
                        <span className="folder-name">{f.name}</span>
                        {f.size ? <span style={{ color: 'var(--color-text-subtle)', fontSize: 11 }}>{fmtSize(f.size)}</span> : null}
                      </span>
                      <button
                        className="btn-flat"
                        disabled={pulling === f.serverRelativeUrl || pulled[f.serverRelativeUrl]}
                        onClick={() => pull(f)}
                      >
                        {pulled[f.serverRelativeUrl] ? 'Added ✓' : pulling === f.serverRelativeUrl ? 'Pulling…' : 'Pull'}
                      </button>
                    </div>
                  ))}
                  {(listing.folders || []).length === 0 && (listing.files || []).length === 0 && (
                    <div className="folder-picker-empty">Empty folder</div>
                  )}
                </>
              )}
            </div>
            <div className="folder-picker-footer">
              <div className="folder-picker-selected">Double-click a folder to open it · "Pull" copies a file into input_folder.</div>
              <div className="folder-picker-actions">
                {onCancel && <button className="btn-secondary" onClick={onCancel}>Close</button>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SharePointBrowser
