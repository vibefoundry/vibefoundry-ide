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
      }
    } catch (err) {
      console.error('Failed to start profiling:', err)
    }
  }

  // Debounced row estimation when filters change
  const requestEstimate = useCallback(() => {
    if (estimateTimerRef.current) clearTimeout(estimateTimerRef.current)
    const hasFilters = Object.values(filters).some(v => {
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object' && v !== null) return v.min != null || v.max != null
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

  const handleCategoricalToggle = (colName, value) => {
    setFilters(prev => {
      const current = prev[colName] || []
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
      return { ...prev, [colName]: next }
    })
  }

  const handleNumericChange = (colName, field, value) => {
    setFilters(prev => {
      const current = prev[colName] || {}
      return { ...prev, [colName]: { ...current, [field]: value === '' ? null : value } }
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
    const selected = filters[colName] || []
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
                onClick={() => setFilters(prev => ({ ...prev, [colName]: [] }))}
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
                  <div className="lfp-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <span className="lfp-progress-text">
                  {progress.done} / {progress.total} chunks &middot; {progressPct}%
                </span>
              </div>
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
                          value={filters[colName]?.min ?? ''}
                          onChange={e => handleNumericChange(colName, 'min', e.target.value)}
                        />
                        <span className="lfp-range-sep">to</span>
                        <input
                          type="number"
                          placeholder={`Max (${info.max ?? ''})`}
                          value={filters[colName]?.max ?? ''}
                          onChange={e => handleNumericChange(colName, 'max', e.target.value)}
                        />
                      </div>
                    )}

                    {info.type === 'categorical' && renderCategoricalDropdown(colName, info)}
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
