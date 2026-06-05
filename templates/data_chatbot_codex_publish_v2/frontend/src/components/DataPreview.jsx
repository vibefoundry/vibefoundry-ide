import React, { useState } from 'react'
import FilterPopover from './FilterPopover.jsx'

// The green stats strip, top to bottom. `key` matches the backend stats block.
const STAT_ROWS = [
  { key: 'count', label: 'Count' },
  { key: 'sum', label: 'Sum' },
  { key: 'mean', label: 'Mean' },
  { key: 'median', label: 'Median' },
  { key: 'unique', label: 'Unique' },
  { key: 'null', label: 'Null' },
  { key: 'nan', label: 'NaN' },
  { key: 'blank', label: 'Blank' },
  { key: 'zeros', label: '0' },
]

function fmtStat(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString()
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return String(v)
}

function fmtCell(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && !Number.isInteger(v)) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

// Top-of-panel bar: one tab per loaded table (click to preview, × to delete)
// plus a "+ Add table" upload trigger that accepts multiple files. Rendered
// in both the pre-preview "loading…" state and the live preview state so the
// user can manage the table set at any time.
function TableTabs({ tables, selected, onSelect, onDelete, onUpload, uploading }) {
  return (
    <div className="table-tabs">
      {tables.map(t => {
        const active = t.name === selected
        const title = t.row_count != null
          ? `${t.row_count.toLocaleString()} rows · ${t.column_count} columns · ${t.file}`
          : t.file
        return (
          <div key={t.name} className={`table-tab${active ? ' active' : ''}`}>
            <button className="table-tab-name" onClick={() => onSelect?.(t.name)} title={title}>
              {t.name}
            </button>
            <button className="table-tab-delete" onClick={() => onDelete?.(t.name)} title={`Remove ${t.name}`}>
              ×
            </button>
          </div>
        )
      })}
      <label className={`upload-btn table-tab-upload${uploading ? ' uploading' : ''}`}
             title="Upload one or more parquet files">
        {uploading ? 'Uploading…' : '+ Add table'}
        <input
          type="file"
          accept=".parquet"
          multiple
          disabled={uploading}
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            if (files.length > 0) onUpload?.(files)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export default function DataPreview({
  preview, activeFilters = {}, onApplyFilter, onClearAll, loading,
  onUpload, uploading, onSelectTable, onDeleteTable,
}) {
  const [openCol, setOpenCol] = useState(null)
  const [anchorRect, setAnchorRect] = useState(null)

  const tables = preview?.tables_meta || []
  const selected = preview?.table_name || null

  if (!preview) {
    return (
      <aside className="data-panel">
        <TableTabs tables={tables} selected={selected} onSelect={onSelectTable}
                   onDelete={onDeleteTable} onUpload={onUpload} uploading={uploading} />
        <div className="data-loading">Loading dataset preview…</div>
      </aside>
    )
  }

  const { columns, rows, stats = {}, filters_config = {} } = preview
  const filterCount = Object.keys(activeFilters).length

  const openFilter = (e, col) => {
    setAnchorRect(e.currentTarget.getBoundingClientRect())
    setOpenCol(prev => (prev === col ? null : col))
  }

  const apply = (col, spec) => {
    onApplyFilter(col, spec)
    setOpenCol(null)
  }

  return (
    <aside className="data-panel">
      <TableTabs tables={tables} selected={selected} onSelect={onSelectTable}
                 onDelete={onDeleteTable} onUpload={onUpload} uploading={uploading} />
      {loading && <div className="data-overlay"><span className="spinner" /> Filtering…</div>}
      <div className="data-scroll">
        <table className="data-grid">
          <tbody className="stats-block">
            {STAT_ROWS.map(stat => (
              <tr key={stat.key}>
                <th className="stat-label">{stat.label}</th>
                {columns.map((c, i) => (
                  <td key={i} className="stat-cell">{fmtStat(stats[c]?.[stat.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tbody className="grid-head">
            <tr>
              <th className="rownum-head">#</th>
              {columns.map((c, i) => {
                const isActive = !!activeFilters[c]
                return (
                  <th key={i}>
                    <div className="col-head">
                      <span className="col-title" title={c}>{c}</span>
                      {filters_config[c] && (
                        <button
                          className={`filter-btn${isActive ? ' active' : ''}`}
                          onClick={(e) => openFilter(e, c)}
                          title={isActive ? 'Filtered — click to edit' : 'Filter'}
                        >▾</button>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </tbody>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="rownum">{ri + 1}</td>
                {row.map((cell, ci) => <td key={ci}>{fmtCell(cell)}</td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="no-rows" colSpan={columns.length + 1}>No rows match the active filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="data-foot">
        <span>
          {preview.source_file} · {preview.total_rows.toLocaleString()} rows · {preview.column_count} columns
          {filterCount > 0 && (
            <> · <button className="clear-all" onClick={onClearAll}>clear {filterCount} filter{filterCount > 1 ? 's' : ''}</button></>
          )}
        </span>
        <span>Powered by <strong>VibeFoundry</strong></span>
      </div>

      {openCol && anchorRect && filters_config[openCol] && (
        <FilterPopover
          column={openCol}
          config={filters_config[openCol]}
          current={activeFilters[openCol]}
          anchorRect={anchorRect}
          onApply={(spec) => apply(openCol, spec)}
          onClose={() => setOpenCol(null)}
        />
      )}
    </aside>
  )
}
