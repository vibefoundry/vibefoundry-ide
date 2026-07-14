import { useState, useEffect, useRef, useCallback } from 'react'

const formatSize = (bytes) => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

const formatRows = (n) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

const SAFE_ROW_LIMIT = 1_000_000
const VALUES_PAGE_SIZE = 500
const ROW_LIMIT_OPTIONS = [
  { label: 'First 100K rows', value: 100_000 },
  { label: 'First 250K rows', value: 250_000 },
  { label: 'First 500K rows', value: 500_000 },
  { label: 'First 1M rows', value: 1_000_000 },
  { label: 'All rows (use filters)', value: null },
]

// In the Codex pane, WebSockets are inert, so the WS-driven profile_complete
// event never arrives. There we poll the result endpoint instead.
const IS_PANE = typeof window !== 'undefined' && !!window.openai

const LargeFilePreviewModal = ({ content, onPreviewReady, onCancel }) => {
  const [stage, setStage] = useState('intro')
  const [progress, setProgress] = useState({ done: 0, total: 1 })
  const [profile, setProfile] = useState(null)
  const [filters, setFilters] = useState({})
  const [rowLimit, setRowLimit] = useState(500_000)
  const [estimatedRows, setEstimatedRows] = useState(null)
  const [estimating, setEstimating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [visibleCounts, setVisibleCounts] = useState({})
  const [openDropdown, setOpenDropdown] = useState(null)
  const [dropdownSearch, setDropdownSearch] = useState('')
  const estimateTimerRef = useRef(null)
  const dropdownRef = useRef(null)
  const pollRef = useRef(null)

  // Clear the pane profile poller on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpenDropdown(null)
        setDropdownSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Listen for WebSocket profile progress/complete events
  useEffect(() => {
    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.filePath !== content.filePath) return
        if (data.type === 'profile_progress') {
          setProgress({ done: data.done, total: data.total })
        } else if (data.type === 'profile_complete') {
          setProfile(data.profile)
          setEstimatedRows(data.profile.total_rows)
          setStage('filtering')
        }
      } catch {}
    }
    window.addEventListener('vf-ws-message', handleMessage)
    return () => window.removeEventListener('vf-ws-message', handleMessage)
  }, [content.filePath])

  // If profile already exists, skip straight to filtering
  useEffect(() => {
    if (content.hasProfile) {
      setStage('filtering')
      fetch(`/api/dataframe/profile/result?filePath=${encodeURIComponent(content.filePath)}`)
        .then(r => r.json())
        .then(data => {
          setProfile(data.profile)
          setEstimatedRows(data.profile.total_rows || content.totalRows)
        })
        .catch(() => {})
    }
  }, [content.hasProfile, content.filePath, content.totalRows])

  const startProfiling = async () => {
    setStage('profiling')
    setProgress({ done: 0, total: 1 })
    try {
      const res = await fetch('/api/dataframe/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: content.filePath }),
      })
      const data = await res.json()
      if (data.status === 'complete') {
        setProfile(data.profile)
        setEstimatedRows(data.profile.total_rows || content.totalRows)
        setStage('filtering')
      } else if (IS_PANE) {
        // WebSockets are inert in the pane, so profile_complete never arrives —
        // poll the result endpoint until profiling finishes.
        pollForProfile()
      }
    } catch (err) {
      console.error('Failed to start profiling:', err)
    }
  }

  const pollForProfile = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    let tries = 0
    pollRef.current = setInterval(async () => {
      tries += 1
      try {
        const r = await fetch(`/api/dataframe/profile/result?filePath=${encodeURIComponent(content.filePath)}`)
        if (r.ok) {
          const d = await r.json()
          if (d && d.profile && (d.profile.total_rows != null || d.profile.columns)) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setProfile(d.profile)
            setEstimatedRows(d.profile.total_rows || content.totalRows)
            setStage('filtering')
            return
          }
        }
      } catch {}
      if (tries > 600) {  // ~10 min safety net
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 1000)
  }

  // Debounced row estimation when filters change
  const requestEstimate = useCallback(() => {
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current)
    const hasFilters = Object.values(filters).some(v => {
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object' && v !== null) {
        if ((v.exclude || []).length > 0) return true
        if (v.min != null || v.max != null) return true
        if ((v.values || []).length > 0) return true
      }
      return false
    })
    if (!hasFilters) {
      setEstimatedRows(profile?.total_rows || content.totalRows)
      return
    }
    estimateTimerRef.current = setTimeout(async () => {
      setEstimating(true)
      try {
        const res = await fetch('/api/dataframe/estimate-rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: content.filePath, filters }),
        })
        const data = await res.json()
        setEstimatedRows(data.estimatedRows)
      } catch {} finally {
        setEstimating(false)
      }
    }, 400)
  }, [filters, content.filePath, profile, content.totalRows])

  useEffect(() => {
    if (stage === 'filtering' && profile) requestEstimate()
  }, [filters, stage, profile, requestEstimate])

  // Read a column's selected categorical values regardless of legacy-list or object form.
  const getSelectedValues = (colName) => {
    const f = filters[colName]
    if (Array.isArray(f)) return f
    if (f && typeof f === 'object') return f.values || []
    return []
  }

  // Read a column's exclusion tokens (e.g. ['null','zero']).
  const getExclude = (colName) => {
    const f = filters[colName]
    if (!f || Array.isArray(f)) return []
    return f.exclude || []
  }

  const handleCategoricalToggle = (colName, value) => {
    setFilters(prev => {
      const current = prev[colName]
      const currentValues = Array.isArray(current)
        ? current
        : (current?.values || [])
      const currentExclude = Array.isArray(current) ? [] : (current?.exclude || [])
      const nextValues = currentValues.includes(value)
        ? currentValues.filter(v => v !== value)
        : [...currentValues, value]
      // Keep legacy list form when no exclusions are set.
      if (currentExclude.length === 0) {
        return { ...prev, [colName]: nextValues }
      }
      return { ...prev, [colName]: { values: nextValues, exclude: currentExclude } }
    })
  }

  const handleNumericChange = (colName, field, value) => {
    setFilters(prev => {
      const current = prev[colName] || {}
      return { ...prev, [colName]: { ...current, [field]: value === '' ? null : value } }
    })
  }

  const handleExcludeToggle = (colName, kind, isCategorical) => {
    setFilters(prev => {
      const current = prev[colName]
      let values, exclude, min, max
      if (Array.isArray(current)) {
        values = current
        exclude = []
      } else if (current && typeof current === 'object') {
        values = current.values
        exclude = current.exclude || []
        min = current.min
        max = current.max
      } else {
        exclude = []
      }
      const nextExclude = exclude.includes(kind)
        ? exclude.filter(k => k !== kind)
        : [...exclude, kind]
      if (isCategorical) {
        const nextValues = values || []
        if (nextExclude.length === 0 && nextValues.length === 0) {
          // Revert to legacy list form when nothing is set.
          return { ...prev, [colName]: [] }
        }
        return { ...prev, [colName]: { values: nextValues, exclude: nextExclude } }
      }
      return {
        ...prev,
        [colName]: { min: min ?? null, max: max ?? null, exclude: nextExclude },
      }
    })
  }

  const handlePreview = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dataframe/filtered-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: content.filePath, filters, rowLimit }),
      })
      const data = await res.json()
      if (data.type === 'dataframe') onPreviewReady(data)
    } catch (err) {
      console.error('Filtered preview failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const effectiveRows = rowLimit ? Math.min(estimatedRows ?? Infinity, rowLimit) : estimatedRows
  const isSafe = effectiveRows != null && effectiveRows <= SAFE_ROW_LIMIT
  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const renderCategoricalDropdown = (colName, info) => {
    const selected = getSelectedValues(colName)
    const isOpen = openDropdown === colName
    const allValues = info.values || []
    const filtered = dropdownSearch && isOpen
      ? allValues.filter(v => v.toLowerCase().includes(dropdownSearch.toLowerCase()))
      : allValues
    const limit = visibleCounts[colName] || VALUES_PAGE_SIZE
    const visibleValues = filtered.slice(0, limit)
    const hasMore = filtered.length > limit

    return (
      <div className="lfp-dropdown-wrap" ref={isOpen ? dropdownRef : null}>
        <button
          className="lfp-dropdown-trigger"
          onClick={() => {
            setOpenDropdown(isOpen ? null : colName)
            setDropdownSearch('')
            setVisibleCounts(prev => ({ ...prev, [colName]: VALUES_PAGE_SIZE }))
          }}
        >
          <span className="lfp-dropdown-text">
            {selected.length === 0
              ? 'All values'
              : `${selected.length} selected`}
          </span>
          <span className="lfp-dropdown-arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
        </button>

        {isOpen && (
          <div className="lfp-dropdown-menu">
            <input
              className="lfp-dropdown-search"
              type="text"
              placeholder="Search values..."
              value={dropdownSearch}
              onChange={e => {
                setDropdownSearch(e.target.value)
                setVisibleCounts(prev => ({ ...prev, [colName]: VALUES_PAGE_SIZE }))
              }}
              autoFocus
            />
            <div className="lfp-dropdown-list">
              {visibleValues.map(val => (
                <label key={val} className="lfp-dropdown-item">
                  <input
                    type="checkbox"
                    checked={selected.includes(val)}
                    onChange={() => handleCategoricalToggle(colName, val)}
                  />
                  <span>{val}</span>
                </label>
              ))}
              {hasMore && (
                <button
                  className="lfp-show-more"
                  onClick={() => setVisibleCounts(prev => ({
                    ...prev,
                    [colName]: (prev[colName] || VALUES_PAGE_SIZE) + VALUES_PAGE_SIZE
                  }))}
                >
                  Show more ({filtered.length - limit} remaining)...
                </button>
              )}
              {filtered.length === 0 && (
                <div className="lfp-dropdown-empty">No matching values</div>
              )}
            </div>
            {selected.length > 0 && (
              <button
                className="lfp-clear-filter"
                onClick={() => setFilters(prev => {
                  const current = prev[colName]
                  if (!current || Array.isArray(current)) {
                    return { ...prev, [colName]: [] }
                  }
                  const exclude = current.exclude || []
                  if (exclude.length === 0) {
                    return { ...prev, [colName]: [] }
                  }
                  return { ...prev, [colName]: { values: [], exclude } }
                })}
              >
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="large-file-modal-overlay">
      <div className="modal-content large-file-modal">
        <div className="modal-header">
          <div className="lfp-header-content">
            <h3 className="lfp-header-title">Large File Preview</h3>
            {stage === 'filtering' && estimatedRows != null && (
              <span className={`lfp-header-estimate ${isSafe ? 'safe' : 'warning'}`}>
                {estimating
                  ? 'Estimating...'
                  : `~${formatRows(effectiveRows)} rows${isSafe ? ' \u2014 good to go!' : ' \u2014 try narrowing your filters'}`}
              </span>
            )}
          </div>
          <button className="modal-close" onClick={onCancel}>&times;</button>
        </div>

        <div className="modal-body">
          {/* INTRO */}
          {stage === 'intro' && (
            <div className="lfp-intro">
              <div className="lfp-file-info">
                <span className="lfp-filename">{content.filename}</span>
                <span className="lfp-meta">
                  {formatSize(content.fileSize)} &middot; {formatRows(content.totalRows)} rows &middot; {content.columns.length} columns
                </span>
              </div>
              <p className="lfp-desc">
                This file is too large to preview directly. We'll scan it in chunks to gather filter options,
                then you can narrow down what you'd like to see.
              </p>
              <button className="lfp-start-btn" onClick={startProfiling}>Start Scanning</button>
            </div>
          )}

          {/* PROFILING */}
          {stage === 'profiling' && (
            <div className="lfp-profiling">
              <div className="lfp-file-info">
                <span className="lfp-filename">{content.filename}</span>
              </div>
              <div className="lfp-progress-container">
                <div className="lfp-progress-bar">
                  <div
                    className="lfp-progress-fill"
                    style={{ width: IS_PANE ? '100%' : `${progressPct}%`, opacity: IS_PANE ? 0.5 : 1 }}
                  />
                </div>
                <span className="lfp-progress-text">
                  {IS_PANE
                    ? 'Scanning the file… this can take a moment.'
                    : `${progress.done} / ${progress.total} chunks · ${progressPct}%`}
                </span>
              </div>
            </div>
          )}

          {/* FILTERING - loading profile */}
          {stage === 'filtering' && !profile && (
            <div className="lfp-profiling">
              <div className="lfp-file-info">
                <span className="lfp-filename">{content.filename}</span>
              </div>
              <p className="lfp-desc">Loading filter options...</p>
            </div>
          )}

          {/* FILTERING */}
          {stage === 'filtering' && profile && (
            <div className="lfp-filtering">
              <div className="lfp-row-limit">
                <select
                  value={rowLimit ?? ''}
                  onChange={e => setRowLimit(e.target.value ? Number(e.target.value) : null)}
                >
                  {ROW_LIMIT_OPTIONS.map(opt => (
                    <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="lfp-filters">
                {Object.entries(profile.columns).map(([colName, info]) => (
                  <div key={colName} className="lfp-filter-row">
                    <div className="lfp-filter-header">
                      <span className="lfp-col-name">{colName}</span>
                      <span className="lfp-filter-type">{info.type}</span>
                    </div>

                    {info.type === 'numeric' && (
                      <div className="lfp-numeric-range">
                        <input
                          type="number"
                          placeholder={`Min (${info.min ?? ''})`}
                          value={Array.isArray(filters[colName]) ? '' : (filters[colName]?.min ?? '')}
                          onChange={e => handleNumericChange(colName, 'min', e.target.value)}
                        />
                        <span className="lfp-range-sep">to</span>
                        <input
                          type="number"
                          placeholder={`Max (${info.max ?? ''})`}
                          value={Array.isArray(filters[colName]) ? '' : (filters[colName]?.max ?? '')}
                          onChange={e => handleNumericChange(colName, 'max', e.target.value)}
                        />
                      </div>
                    )}

                    {info.type === 'categorical' && renderCategoricalDropdown(colName, info)}

                    <div className="lfp-exclude-row">
                      {info.type === 'numeric' && (
                        <>
                          <label className="lfp-exclude-item">
                            <input
                              type="checkbox"
                              checked={getExclude(colName).includes('null')}
                              onChange={() => handleExcludeToggle(colName, 'null', false)}
                            />
                            <span>No nulls</span>
                          </label>
                          <label className="lfp-exclude-item">
                            <input
                              type="checkbox"
                              checked={getExclude(colName).includes('zero')}
                              onChange={() => handleExcludeToggle(colName, 'zero', false)}
                            />
                            <span>No 0s</span>
                          </label>
                          <label className="lfp-exclude-item">
                            <input
                              type="checkbox"
                              checked={getExclude(colName).includes('nan')}
                              onChange={() => handleExcludeToggle(colName, 'nan', false)}
                            />
                            <span>No NaN</span>
                          </label>
                        </>
                      )}
                      {info.type === 'categorical' && (
                        <>
                          <label className="lfp-exclude-item">
                            <input
                              type="checkbox"
                              checked={getExclude(colName).includes('null')}
                              onChange={() => handleExcludeToggle(colName, 'null', true)}
                            />
                            <span>No nulls</span>
                          </label>
                          <label className="lfp-exclude-item">
                            <input
                              type="checkbox"
                              checked={getExclude(colName).includes('blank')}
                              onChange={() => handleExcludeToggle(colName, 'blank', true)}
                            />
                            <span>No blanks</span>
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="lfp-actions">
                <button className="lfp-cancel-btn" onClick={onCancel}>Cancel</button>
                <button
                  className="lfp-preview-btn"
                  disabled={loading || estimating}
                  onClick={handlePreview}
                >
                  {loading ? 'Loading Preview...' : 'Preview Filtered Data'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LargeFilePreviewModal
