import { useState, useEffect, useCallback } from 'react'

// The Data Catalogue: what's in the connected SharePoint library, described.
// Profiles are computed by the backend (which reads SharePoint directly) and the
// prose comes from the Azure describer. Both are cached, so this view is a plain
// read of ~/.vibefoundry/catalog.json unless the user explicitly rebuilds.

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
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const ColumnRow = ({ col }) => {
  const stat =
    col.kind === 'categorical'
      ? `${col.n_unique?.toLocaleString()} distinct${col.values?.length ? ' · ' + col.values.slice(0, 4).join(', ') : ''}`
      : col.kind === 'temporal'
        ? `${col.min} → ${col.max}`
        : [
            col.min != null ? `min ${col.min}` : null,
            col.max != null ? `max ${col.max}` : null,
            col.mean != null ? `mean ${col.mean}` : null,
          ].filter(Boolean).join(' · ')
  return (
    <tr className="dc-col-row">
      <td className="dc-col-name">{col.name}</td>
      <td className="dc-col-kind"><span className={`dc-kind dc-kind-${col.kind}`}>{col.kind}</span></td>
      <td className="dc-col-desc">{col.description || <span className="dc-muted">—</span>}</td>
      <td className="dc-col-stat">{stat}</td>
    </tr>
  )
}

const DatasetCard = ({ ds, onPull, pulling }) => {
  const [open, setOpen] = useState(false)
  if (ds.error) {
    return (
      <div className="dc-card dc-card-error">
        <div className="dc-card-head">
          <span className="dc-name">{ds.name}</span>
          <span className="dc-muted">{fmtBytes(ds.size_bytes)}</span>
        </div>
        <div className="dc-error">Could not catalogue this file: {ds.error}</div>
      </div>
    )
  }
  return (
    <div className="dc-card">
      <div className="dc-card-head">
        <div className="dc-head-left">
          <span className="dc-title">{ds.title || ds.name}</span>
          {/* Show the subfolder path when there is one — with the walk, two
              folders can each hold a sales.csv. */}
          <span className="dc-name">{ds.path || ds.name}</span>
        </div>
        <div className="dc-head-right">
          <button
            className="btn-flat"
            disabled={pulling}
            onClick={() => onPull(ds)}
            title="Copy this dataset into input_folder"
          >
            {pulling ? 'Pulling…' : 'Pull'}
          </button>
        </div>
      </div>
      {ds.summary && <p className="dc-summary">{ds.summary}</p>}
      <div className="dc-facts">
        <span><strong>{ds.rows?.toLocaleString()}</strong> rows</span>
        <span><strong>{ds.n_columns}</strong> columns</span>
        <span>{fmtBytes(ds.size_bytes)}</span>
        {ds.grain && <span className="dc-grain">{ds.grain}</span>}
      </div>
      <button className="dc-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾ Hide columns' : `▸ Show ${ds.columns?.length || 0} columns`}
      </button>
      {open && (
        <div className="dc-table-wrap">
          <table className="dc-table">
            <thead>
              <tr><th>Column</th><th>Kind</th><th>Description</th><th>Values</th></tr>
            </thead>
            <tbody>
              {(ds.columns || []).map((c) => <ColumnRow key={c.name} col={c} />)}
            </tbody>
          </table>
          {ds.n_columns > (ds.columns?.length || 0) && (
            <p className="dc-muted dc-truncated">
              Showing {ds.columns.length} of {ds.n_columns} columns.
            </p>
          )}
        </div>
      )}
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
    // ds.path is relative to the catalogued root and may include subfolders;
    // fall back to the bare name for catalogues built before paths existed.
    const sru = `${cat.folder}/${ds.path || ds.name}`
    setPullingName(ds.name)
    try {
      const res = await fetch('/api/sharepoint/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverRelativeUrl: sru, destFolder: 'input_folder' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Pull failed')
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
          placeholder="/sites/YourSite/Shared Documents/Folder"
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
        <span className="dc-built">Last built: {fmtWhen(cat?.built_at)}</span>
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
          The describer isn’t configured, so datasets will be profiled but not described.
        </div>
      )}
      {cat?.truncated && (
        <div className="dc-banner">
          Stopped after the first 100 datasets — this folder has more. Point at a
          narrower subfolder to catalogue the rest.
        </div>
      )}
      {building && (
        <div className="dc-banner">
          Reading each dataset in full and describing it. Only changed files are
          re-read, so this is a one-time cost per upload.
        </div>
      )}

      <div className="dc-list">
        {loading ? (
          <p className="dc-muted">Loading catalogue…</p>
        ) : datasets.length === 0 ? (
          <div className="dc-empty">
            <p className="dc-empty-title">No catalogue yet</p>
            <p className="dc-muted">
              Point at a SharePoint folder above and build it. Each dataset gets a
              description, a row grain, and a column profile — and becomes visible
              to Codex through the <code>vf_catalog</code> tool.
            </p>
          </div>
        ) : (
          datasets.map((ds) => (
            <DatasetCard key={ds.name} ds={ds} onPull={pull} pulling={pullingName === ds.name} />
          ))
        )}
      </div>
    </div>
  )
}

export default DataCatalogue
