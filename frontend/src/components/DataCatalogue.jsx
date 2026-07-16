import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// The Data Catalogue: what's in the connected SharePoint library, described.
//
// The list stays deliberately quiet — a title, one line, and the numbers. An
// earlier version put the full summary, the row grain and a column toggle on
// every card, which read as a wall of text and made three datasets look like a
// research paper. Detail lives in the modal instead: double-click a row for the
// description, a live 100-row preview, and the column profile.

const fmtBytes = (n) => {
  if (!n && n !== 0) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

const fmtWhen = (ts) => {
  if (!ts) return 'never'
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const colStat = (c) => {
  if (c.kind === 'categorical') {
    const vals = (c.values || []).slice(0, 3).join(', ')
    return `${c.n_unique?.toLocaleString()} values${vals ? ' · ' + vals : ''}`
  }
  if (c.kind === 'temporal') return `${c.min} → ${c.max}`
  return [
    c.min != null ? `min ${c.min}` : null,
    c.max != null ? `max ${c.max}` : null,
    c.mean != null ? `avg ${c.mean}` : null,
  ].filter(Boolean).join(' · ')
}

// --- Detail modal ------------------------------------------------------------
const DatasetModal = ({ ds, onClose, onPull, pulling }) => {
  const [tab, setTab] = useState('preview')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    // Fetched live rather than cached: the catalogue keeps aggregates, not rows.
    fetch(`/api/catalog/preview?path=${encodeURIComponent(ds.path || ds.name)}&rows=100`)
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.detail || 'Preview failed')))))
      .then((d) => { if (!cancelled) setPreview(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [ds.path, ds.name])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="dc-modal-overlay" onClick={onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dc-modal-head">
          <div className="dc-modal-titles">
            <h3>{ds.title || ds.name}</h3>
            <span className="dc-mono">{ds.path || ds.name}</span>
          </div>
          <button className="dc-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="dc-modal-body">
          {ds.summary && <p className="dc-modal-summary">{ds.summary}</p>}
          <div className="dc-facts">
            <span><strong>{ds.rows?.toLocaleString()}</strong> rows</span>
            <span><strong>{ds.n_columns}</strong> columns</span>
            <span>{fmtBytes(ds.size_bytes)}</span>
            {ds.grain && <span className="dc-grain">{ds.grain}</span>}
          </div>

          <div className="dc-tabs">
            <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
              Preview
            </button>
            <button className={tab === 'columns' ? 'active' : ''} onClick={() => setTab('columns')}>
              Columns ({ds.columns?.length || 0})
            </button>
          </div>

          {tab === 'preview' ? (
            error ? (
              <p className="dc-error dc-pad">Couldn’t load a preview: {error}</p>
            ) : !preview ? (
              <p className="dc-muted dc-pad">Loading the first 100 rows…</p>
            ) : (
              <div className="dc-table-wrap dc-preview-wrap">
                <table className="dc-table dc-preview">
                  <thead>
                    <tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((v, j) => (
                          <td key={j}>{v === null ? <span className="dc-null">null</span> : String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="dc-table-wrap">
              <table className="dc-table">
                <thead>
                  <tr><th>Column</th><th>Type</th><th>Description</th><th>Values</th></tr>
                </thead>
                <tbody>
                  {(ds.columns || []).map((c) => (
                    <tr key={c.name}>
                      <td className="dc-mono dc-nowrap">{c.name}</td>
                      <td><span className={`dc-kind dc-kind-${c.kind}`}>{c.kind}</span></td>
                      <td className="dc-col-desc">{c.description || <span className="dc-muted">—</span>}</td>
                      <td className="dc-col-stat">{colStat(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ds.n_columns > (ds.columns?.length || 0) && (
                <p className="dc-muted dc-pad">Showing {ds.columns.length} of {ds.n_columns} columns.</p>
              )}
            </div>
          )}
        </div>

        <div className="dc-modal-foot">
          <span className="dc-muted">{preview ? 'First 100 rows, read live from SharePoint.' : ''}</span>
          <div className="dc-foot-actions">
            <button className="btn-flat" onClick={onClose}>Close</button>
            <button className="btn-primary" disabled={pulling} onClick={() => onPull(ds)}>
              {pulling ? 'Pulling…' : 'Pull into input_folder'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// --- List row ----------------------------------------------------------------
const Row = ({ ds, onOpen }) => {
  if (ds.error) {
    return (
      <div className="dc-row dc-row-error">
        <div className="dc-row-main">
          <span className="dc-row-title">{ds.name}</span>
          <span className="dc-row-sub">Couldn’t be catalogued — {ds.error}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="dc-row" onDoubleClick={() => onOpen(ds)} title="Double-click to preview">
      <div className="dc-row-main">
        <span className="dc-row-title">{ds.title || ds.name}</span>
        <span className="dc-row-sub">{ds.grain || ds.summary}</span>
      </div>
      <div className="dc-row-meta">
        <span className="dc-mono dc-row-file">{ds.path || ds.name}</span>
        <span>{ds.rows?.toLocaleString()} rows</span>
        <span>{ds.n_columns} cols</span>
        <span>{fmtBytes(ds.size_bytes)}</span>
      </div>
    </div>
  )
}

const DataCatalogue = ({ onPulled, onConnect }) => {
  const [cat, setCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [pullingName, setPullingName] = useState(null)
  const [error, setError] = useState(null)
  const [spConnected, setSpConnected] = useState(null)
  const [folder, setFolder] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, sp] = await Promise.all([
        fetch('/api/catalog').then((r) => r.json()),
        fetch('/api/sharepoint/status').then((r) => r.json()).catch(() => ({})),
      ])
      setCat(c)
      setSpConnected(!!sp.connected)
      if (c.folder) setFolder(c.folder)
      else if (sp.site) setFolder(`${sp.site}/Shared Documents`)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const build = async (refresh) => {
    setBuilding(true)
    setError(null)
    try {
      const res = await fetch('/api/catalog/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, refresh: !!refresh }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Build failed')
      setCat(data)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBuilding(false)
    }
  }

  const pull = async (ds) => {
    setPullingName(ds.name)
    setError(null)
    try {
      const res = await fetch('/api/sharepoint/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverRelativeUrl: `${cat.folder}/${ds.path || ds.name}`,
          destFolder: 'input_folder',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Pull failed')
      setOpen(null)
      if (onPulled) onPulled()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setPullingName(null)
    }
  }

  const datasets = cat?.datasets || []

  return (
    <div className="dc-pane">
      <div className="dc-bar">
        <input
          className="dc-folder-input"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="/sites/YourSite/Shared Documents"
          spellCheck={false}
        />
        <button className="btn-flat" onClick={() => build(false)} disabled={building || !folder}>
          {building ? 'Cataloguing…' : datasets.length ? 'Update' : 'Build catalogue'}
        </button>
        {datasets.length > 0 && (
          <button className="btn-flat" onClick={() => build(true)} disabled={building}>
            Rebuild all
          </button>
        )}
        <span className="dc-built">Last built {fmtWhen(cat?.built_at)}</span>
      </div>

      {error && <div className="dc-banner dc-banner-error">{error}</div>}
      {spConnected === false && (
        <div className="dc-banner">
          Not connected to SharePoint.
          <button className="btn-flat dc-banner-btn" onClick={onConnect}>Connect</button>
        </div>
      )}
      {cat && cat.serviceConfigured === false && (
        <div className="dc-banner">
          The describer isn’t configured, so datasets are profiled but not described.
        </div>
      )}
      {cat?.truncated && (
        <div className="dc-banner">
          Stopped after the first 100 datasets — point at a narrower subfolder for the rest.
        </div>
      )}
      {building && (
        <div className="dc-banner">
          Reading each dataset and describing it. Only changed files are re-read.
        </div>
      )}

      <div className="dc-list">
        {loading ? (
          <p className="dc-muted dc-pad">Loading…</p>
        ) : datasets.length === 0 ? (
          <div className="dc-empty">
            <p className="dc-empty-title">No catalogue yet</p>
            <p className="dc-muted">
              Point at a SharePoint folder above and build it. Each dataset gets a
              plain-English description and a column profile — and becomes visible
              to Codex through the <code>vf_catalog</code> tool.
            </p>
          </div>
        ) : (
          <>
            <div className="dc-hint">Double-click a dataset to preview it.</div>
            {datasets.map((ds) => (
              <Row key={ds.path || ds.name} ds={ds} onOpen={setOpen} />
            ))}
          </>
        )}
      </div>

      {open && (
        <DatasetModal
          ds={open}
          onClose={() => setOpen(null)}
          onPull={pull}
          pulling={pullingName === open.name}
        />
      )}
    </div>
  )
}

export default DataCatalogue
