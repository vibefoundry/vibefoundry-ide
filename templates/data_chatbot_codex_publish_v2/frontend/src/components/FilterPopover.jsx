import React, { useMemo, useState } from 'react'

// Excel-style filter menu for one column. Rendered position:fixed at the
// clicked header so it escapes the grid's scroll clipping.
export default function FilterPopover({ column, config, current, anchorRect, onApply, onClose }) {
  const style = {
    position: 'fixed',
    top: Math.min(anchorRect.bottom + 4, window.innerHeight - 360),
    left: Math.min(anchorRect.left, window.innerWidth - 280),
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="filter-popover" style={style}>
        <div className="filter-title">{column}</div>
        {config.type === 'values' && (
          <ValuesFilter options={config.options} current={current} onApply={onApply} onClose={onClose} />
        )}
        {config.type === 'text' && (
          <TextFilter current={current} onApply={onApply} onClose={onClose} />
        )}
        {config.type === 'range' && (
          <RangeFilter config={config} current={current} onApply={onApply} onClose={onClose} />
        )}
      </div>
    </>
  )
}

function ValuesFilter({ options, current, onApply, onClose }) {
  const [search, setSearch] = useState('')
  // Selected set: from the active filter, or "all" when none.
  const [selected, setSelected] = useState(() =>
    new Set(current?.values ?? options)
  )

  const shown = useMemo(
    () => options.filter(o => String(o).toLowerCase().includes(search.toLowerCase())),
    [options, search]
  )

  const toggle = (opt) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(opt) ? next.delete(opt) : next.add(opt)
      return next
    })
  }

  const apply = () => {
    // All selected -> no filter; none -> treat as cleared too.
    if (selected.size === 0 || selected.size === options.length) onApply(null)
    else onApply({ type: 'values', values: [...selected] })
  }

  return (
    <>
      <input
        className="filter-search"
        placeholder="Search values…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
      />
      <div className="filter-actions-mini">
        <button onClick={() => setSelected(new Set(options))}>Select all</button>
        <button onClick={() => setSelected(new Set())}>Clear</button>
      </div>
      <div className="filter-options">
        {shown.map((opt, i) => (
          <label key={i} className="filter-option">
            <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} />
            <span>{String(opt)}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="filter-empty">No matches</div>}
      </div>
      <FilterButtons onApply={apply} onClear={() => onApply(null)} onClose={onClose} />
    </>
  )
}

function TextFilter({ current, onApply, onClose }) {
  const [text, setText] = useState(current?.text ?? '')
  const apply = () => onApply(text.trim() ? { type: 'text', text: text.trim() } : null)
  return (
    <>
      <input
        className="filter-search"
        placeholder="Contains…"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && apply()}
        autoFocus
      />
      <FilterButtons onApply={apply} onClear={() => onApply(null)} onClose={onClose} />
    </>
  )
}

function RangeFilter({ config, current, onApply, onClose }) {
  const [min, setMin] = useState(current?.min ?? '')
  const [max, setMax] = useState(current?.max ?? '')
  const apply = () => {
    const lo = min === '' ? null : Number(min)
    const hi = max === '' ? null : Number(max)
    onApply(lo === null && hi === null ? null : { type: 'range', min: lo, max: hi })
  }
  return (
    <>
      <div className="filter-range">
        <input type="number" placeholder={`min (${config.min})`} value={min}
               onChange={e => setMin(e.target.value)} />
        <span>–</span>
        <input type="number" placeholder={`max (${config.max})`} value={max}
               onChange={e => setMax(e.target.value)} />
      </div>
      <FilterButtons onApply={apply} onClear={() => onApply(null)} onClose={onClose} />
    </>
  )
}

function FilterButtons({ onApply, onClear, onClose }) {
  return (
    <div className="filter-buttons">
      <button className="filter-clear" onClick={onClear}>Clear</button>
      <button className="filter-apply" onClick={() => { onApply(); onClose() }}>Apply</button>
    </div>
  )
}
