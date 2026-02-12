import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { List } from 'react-window'

const ROW_HEIGHT = 32
const CHUNK_SIZE = 1000
const DEFAULT_COL_WIDTH = 120
const ROW_NUM_WIDTH = 50
const MAX_AUTO_LOAD = 1000  // Only auto-load up to this many rows

// Memoized row component for react-window
const VirtualRow = memo(({ index, style, rows, columns, columnWidths, getColWidth, isCellSelected, handleCellMouseDown, handleCellMouseEnter }) => {
  const row = rows[index]
  if (!row) return <div style={style} />

  return (
    <div style={{ ...style, display: 'flex' }} className="df-row">
      <div className="df-cell df-row-num" style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }}>
        {index + 1}
      </div>
      {columns.map((col, colIdx) => {
        const width = getColWidth(col)
        const selected = isCellSelected(index, colIdx)
        return (
          <div
            key={col}
            className={`df-cell ${selected ? 'selected' : ''}`}
            style={{ width, minWidth: width }}
            onMouseDown={(e) => handleCellMouseDown(index, colIdx, e)}
            onMouseEnter={() => handleCellMouseEnter(index, colIdx)}
            title={String(row[col] ?? '')}
          >
            {String(row[col] ?? '')}
          </div>
        )
      })}
    </div>
  )
})

const DataFrameViewer = ({ content }) => {
  // Data state - rows loaded from backend
  const [rows, setRows] = useState(content.data || [])
  const [totalRows, setTotalRows] = useState(content.totalRows || content.data?.length || 0)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Filter/sort state
  const [filters, setFilters] = useState({})
  const [activeFilter, setActiveFilter] = useState(null)
  const [filterSearch, setFilterSearch] = useState('')
  const [tempFilter, setTempFilter] = useState({})
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 })
  const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' })

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [selection, setSelection] = useState(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [columnWidths, setColumnWidths] = useState({})

  // Refs
  const dropdownRef = useRef(null)
  const filterButtonRefs = useRef({})
  const containerRef = useRef(null)
  const headerRef = useRef(null)
  const listRef = useRef(null)
  const [containerHeight, setContainerHeight] = useState(400)

  // columnInfo state - initialized from props, updated by cascading filters
  const [columnInfo, setColumnInfo] = useState(content.columnInfo || {})
  const columns = content.columns || []
  const filePath = content.filePath || ''

  // Reset state when file changes
  useEffect(() => {
    setRows(content.data || [])
    setTotalRows(content.totalRows || content.data?.length || 0)
    setIsLoadingMore(false)
    setFilters({})
    setSortConfig({ column: null, direction: 'asc' })
    setSelection(null)
    setColumnWidths({})
    setColumnInfo(content.columnInfo || {})
  }, [content.filename])

  // Measure container height for virtual list
  useEffect(() => {
    const measureHeight = () => {
      if (containerRef.current) {
        const container = containerRef.current
        const statusbar = container.querySelector('.dataframe-statusbar')
        const header = container.querySelector('.dataframe-header-container')
        const statusH = statusbar?.offsetHeight || 0
        const headerH = header?.offsetHeight || 0
        const availableHeight = container.offsetHeight - statusH - headerH
        setContainerHeight(Math.max(100, availableHeight))
      }
    }
    measureHeight()
    window.addEventListener('resize', measureHeight)
    const timer = setTimeout(measureHeight, 100)
    return () => {
      window.removeEventListener('resize', measureHeight)
      clearTimeout(timer)
    }
  }, [isFullscreen])

  // Manual load more rows - no automatic loading
  const loadMoreRows = useCallback(async () => {
    if (isLoadingMore || !filePath || rows.length >= totalRows) return

    setIsLoadingMore(true)

    try {
      const res = await fetch(
        `/api/dataframe/rows?filePath=${encodeURIComponent(filePath)}&offset=${rows.length}&limit=${CHUNK_SIZE}`
      )

      if (res.ok) {
        const data = await res.json()
        if (data.data && data.data.length > 0) {
          setRows(prev => [...prev, ...data.data])
          setTotalRows(data.totalRows)
        }
      }
    } catch (err) {
      console.error('Failed to load rows:', err)
    } finally {
      setIsLoadingMore(false)
    }
  }, [filePath, rows.length, totalRows, isLoadingMore])

  // Apply filter/sort via backend
  const applyFilterSort = useCallback(async (newFilters, newSort) => {
    if (!filePath) return

    try {
      const res = await fetch('/api/dataframe/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          filters: newFilters,
          sort: newSort.column ? newSort : null
        })
      })

      if (res.ok) {
        const data = await res.json()
        setRows(data.data)
        setTotalRows(data.totalRows)
        // Update columnInfo with cascading filter options
        if (data.columnInfo) {
          setColumnInfo(data.columnInfo)
        }
        if (listRef.current) {
          listRef.current.scrollToRow({ index: 0 })
        }
      }
    } catch (err) {
      console.error('Failed to apply filter/sort:', err)
    }
  }, [filePath])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActiveFilter(null)
        setFilterSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selection) {
        e.preventDefault()
        copySelection()
      }
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selection, isFullscreen])

  // Calculate selection statistics
  const selectionStats = (() => {
    if (!selection) return null

    const { startRow, startCol, endRow, endCol } = selection
    const minRow = Math.min(startRow, endRow)
    const maxRow = Math.max(startRow, endRow)
    const minCol = Math.min(startCol, endCol)
    const maxCol = Math.max(startCol, endCol)

    const values = []
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (r < rows.length && c < columns.length) {
          const val = rows[r][columns[c]]
          if (typeof val === 'number' && !isNaN(val)) {
            values.push(val)
          }
        }
      }
    }

    const cellCount = (maxRow - minRow + 1) * (maxCol - minCol + 1)

    if (values.length === 0) {
      return { count: cellCount, numericCount: 0 }
    }

    const sum = values.reduce((a, b) => a + b, 0)
    const avg = sum / values.length

    return {
      count: cellCount,
      numericCount: values.length,
      sum: sum,
      average: avg,
      min: Math.min(...values),
      max: Math.max(...values)
    }
  })()

  // Copy selection to clipboard
  const copySelection = useCallback(() => {
    if (!selection) return

    const { startRow, startCol, endRow, endCol } = selection
    const minRow = Math.min(startRow, endRow)
    const maxRow = Math.max(startRow, endRow)
    const minCol = Math.min(startCol, endCol)
    const maxCol = Math.max(startCol, endCol)

    const lines = []
    for (let r = minRow; r <= maxRow; r++) {
      const cells = []
      for (let c = minCol; c <= maxCol; c++) {
        if (r < rows.length && c < columns.length) {
          cells.push(String(rows[r][columns[c]] ?? ''))
        }
      }
      lines.push(cells.join('\t'))
    }

    navigator.clipboard.writeText(lines.join('\n'))
  }, [selection, rows, columns])

  // Handle column header click for sorting
  const handleSort = async (col) => {
    const newSort = sortConfig.column === col
      ? { column: col, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' }
      : { column: col, direction: 'asc' }

    setSortConfig(newSort)
    await applyFilterSort(filters, newSort)
  }

  // Cell selection handlers
  const handleCellMouseDown = useCallback((rowIdx, colIdx, e) => {
    if (e.button !== 0) return
    setSelection({ startRow: rowIdx, startCol: colIdx, endRow: rowIdx, endCol: colIdx })
    setIsSelecting(true)
  }, [])

  const handleCellMouseEnter = useCallback((rowIdx, colIdx) => {
    if (isSelecting) {
      setSelection(prev => prev ? { ...prev, endRow: rowIdx, endCol: colIdx } : null)
    }
  }, [isSelecting])

  const handleMouseUp = () => {
    setIsSelecting(false)
  }

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [])

  // Check if cell is in selection
  const isCellSelected = useCallback((rowIdx, colIdx) => {
    if (!selection) return false
    const { startRow, startCol, endRow, endCol } = selection
    const minRow = Math.min(startRow, endRow)
    const maxRow = Math.max(startRow, endRow)
    const minCol = Math.min(startCol, endCol)
    const maxCol = Math.max(startCol, endCol)
    return rowIdx >= minRow && rowIdx <= maxRow && colIdx >= minCol && colIdx <= maxCol
  }, [selection])

  // Column resizing handlers
  const handleResizeStart = (col, e) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startWidth = columnWidths[col] || DEFAULT_COL_WIDTH

    const handleMouseMove = (e) => {
      const diff = e.clientX - startX
      setColumnWidths(prev => ({ ...prev, [col]: Math.max(50, startWidth + diff) }))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Filter functions
  const toggleFilter = (col, e) => {
    e.stopPropagation()
    if (activeFilter === col) {
      setActiveFilter(null)
      setFilterSearch('')
      return
    }

    const button = e?.currentTarget || filterButtonRefs.current[col]
    if (button) {
      const rect = button.getBoundingClientRect()
      setDropdownPosition({ x: rect.left, y: rect.bottom + 4 })
    }

    const info = columnInfo[col]
    if (info?.type === 'numeric') {
      setTempFilter(filters[col] || { min: '', max: '' })
    } else {
      setTempFilter(filters[col] || [])
    }
    setActiveFilter(col)
    setFilterSearch('')
  }

  const applyFilter = async (col) => {
    const newFilters = { ...filters }
    const info = columnInfo[col]

    if (info?.type === 'numeric') {
      if ((tempFilter.min === '' || tempFilter.min === null) &&
          (tempFilter.max === '' || tempFilter.max === null)) {
        delete newFilters[col]
      } else {
        newFilters[col] = tempFilter
      }
    } else {
      if (!tempFilter || tempFilter.length === 0) {
        delete newFilters[col]
      } else {
        newFilters[col] = tempFilter
      }
    }

    setFilters(newFilters)
    setActiveFilter(null)
    setFilterSearch('')
    await applyFilterSort(newFilters, sortConfig)
  }

  const clearFilter = async (col) => {
    const newFilters = { ...filters }
    delete newFilters[col]
    setFilters(newFilters)
    setActiveFilter(null)
    setFilterSearch('')
    await applyFilterSort(newFilters, sortConfig)
  }

  const toggleValue = (value) => {
    setTempFilter(prev => {
      if (Array.isArray(prev)) {
        if (prev.includes(value)) {
          return prev.filter(v => v !== value)
        } else {
          return [...prev, value]
        }
      }
      return [value]
    })
  }

  const selectAll = (col) => {
    const info = columnInfo[col]
    if (!info?.values) return
    const filtered = info.values.filter(v =>
      filterSearch === '' || String(v).toLowerCase().includes(filterSearch.toLowerCase())
    )
    setTempFilter(filtered)
  }

  const clearAll = () => {
    setTempFilter([])
  }

  const isFiltered = (col) => {
    const f = filters[col]
    if (!f) return false
    if (Array.isArray(f)) return f.length > 0
    return (f.min !== '' && f.min !== null) || (f.max !== '' && f.max !== null)
  }

  const activeFilterCount = Object.keys(filters).filter(isFiltered).length

  const formatNumber = (num) => {
    if (num === undefined || num === null) return '-'
    if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(2) + 'M'
    if (Math.abs(num) >= 1000) return (num / 1000).toFixed(2) + 'K'
    return Number.isInteger(num) ? num.toString() : num.toFixed(2)
  }

  // Get column width
  const getColWidth = useCallback((col) => columnWidths[col] || DEFAULT_COL_WIDTH, [columnWidths])

  // Calculate total width for horizontal scrolling
  const getTotalWidth = () => {
    let total = ROW_NUM_WIDTH
    for (const col of columns) {
      total += getColWidth(col)
    }
    return total
  }

  // Sync scroll between header and list
  const handleListScroll = useCallback((e) => {
    if (headerRef.current && e.target) {
      headerRef.current.scrollLeft = e.target.scrollLeft
    }
  }, [])

  const containerClass = `dataframe-container ${isFullscreen ? 'fullscreen' : ''}`

  return (
    <div className={containerClass} ref={containerRef}>
      {/* Table Header */}
      <div className="dataframe-header-container" ref={headerRef}>
        <div className="df-header-row" style={{ width: getTotalWidth() }}>
          <div className="df-header-cell df-row-num" style={{ width: ROW_NUM_WIDTH, minWidth: ROW_NUM_WIDTH }}>
            #
          </div>
          {columns.map((col) => {
            const filtered = isFiltered(col)
            const isSorted = sortConfig.column === col
            const width = getColWidth(col)
            return (
              <div
                key={col}
                className="df-header-cell"
                style={{ width, minWidth: width }}
              >
                <div className="header-content" onClick={() => handleSort(col)}>
                  <span className="header-text">{col}</span>
                  <span className="header-icons">
                    {isSorted && (
                      <span className="sort-indicator">
                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                    <button
                      ref={el => filterButtonRefs.current[col] = el}
                      className={`filter-btn ${filtered ? 'active' : ''}`}
                      onClick={(e) => toggleFilter(col, e)}
                      title="Filter"
                    >
                      ▼
                    </button>
                  </span>
                </div>
                <div
                  className="resize-handle"
                  onMouseDown={(e) => handleResizeStart(col, e)}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Virtual scrolling body */}
      <div
        className="dataframe-body-container"
        onScroll={handleListScroll}
        style={{ height: containerHeight, overflow: 'auto' }}
      >
        <div style={{ width: getTotalWidth(), minHeight: rows.length * ROW_HEIGHT }}>
          <List
            listRef={listRef}
            defaultHeight={containerHeight}
            rowCount={rows.length}
            rowHeight={ROW_HEIGHT}
            overscanCount={10}
            rowComponent={VirtualRow}
            rowProps={{
              rows,
              columns,
              columnWidths,
              getColWidth,
              isCellSelected,
              handleCellMouseDown,
              handleCellMouseEnter
            }}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="dataframe-statusbar">
        <span className="status-left">
          {rows.length}{totalRows > rows.length ? ` of ${totalRows.toLocaleString()}` : ''} rows × {columns.length} cols
          {activeFilterCount > 0 && ` • ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''}`}
        </span>
        <span className="status-center">
          {rows.length < totalRows && (
            <button
              className="load-more-btn"
              onClick={loadMoreRows}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Loading...' : `Load ${Math.min(CHUNK_SIZE, totalRows - rows.length).toLocaleString()} More Rows`}
            </button>
          )}
        </span>
        {selectionStats && selectionStats.numericCount > 0 && (
          <span className="status-right">
            <span className="stat">Sum: {formatNumber(selectionStats.sum)}</span>
            <span className="stat">Avg: {formatNumber(selectionStats.average)}</span>
          </span>
        )}
      </div>

      {/* Filter dropdown portal */}
      {activeFilter && createPortal(
        <div
          ref={dropdownRef}
          className="filter-dropdown"
          style={{ left: dropdownPosition.x, top: dropdownPosition.y }}
          onClick={e => e.stopPropagation()}
        >
          {columnInfo[activeFilter]?.type === 'numeric' ? (
            <div className="numeric-filter">
              <div className="filter-row">
                <label>Min:</label>
                <input
                  type="number"
                  value={tempFilter.min || ''}
                  onChange={e => setTempFilter(prev => ({ ...prev, min: e.target.value }))}
                  placeholder={String(columnInfo[activeFilter]?.min ?? '')}
                />
              </div>
              <div className="filter-row">
                <label>Max:</label>
                <input
                  type="number"
                  value={tempFilter.max || ''}
                  onChange={e => setTempFilter(prev => ({ ...prev, max: e.target.value }))}
                  placeholder={String(columnInfo[activeFilter]?.max ?? '')}
                />
              </div>
            </div>
          ) : (
            <div className="categorical-filter">
              <input
                type="text"
                className="filter-search"
                placeholder="Search..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
              />
              <div className="select-actions">
                <button onClick={() => selectAll(activeFilter)}>Select All</button>
                <button onClick={clearAll}>Clear All</button>
              </div>
              <div className="filter-values">
                {columnInfo[activeFilter]?.values
                  ?.filter(v => filterSearch === '' || String(v).toLowerCase().includes(filterSearch.toLowerCase()))
                  .slice(0, 100)
                  .map((val, idx) => (
                    <label key={idx} className="filter-checkbox">
                      <input
                        type="checkbox"
                        checked={Array.isArray(tempFilter) && tempFilter.includes(val)}
                        onChange={() => toggleValue(val)}
                      />
                      <span>{String(val)}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}
          <div className="filter-actions">
            <button className="clear-btn" onClick={() => clearFilter(activeFilter)}>Clear</button>
            <button className="apply-btn" onClick={() => applyFilter(activeFilter)}>Apply</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default DataFrameViewer
