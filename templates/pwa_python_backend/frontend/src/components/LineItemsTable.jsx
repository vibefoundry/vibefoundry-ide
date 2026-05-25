import React, { useMemo, useState } from 'react'

const COLUMNS = [
  { key: 'date',      label: 'Date' },
  { key: 'location',  label: 'Store' },
  { key: 'item',      label: 'Item' },
  { key: 'item_type', label: 'Type' },
  { key: 'price',     label: 'Price', numeric: true },
]

export default function LineItemsTable({ items, selected, onRowClick }) {
  const [sort, setSort] = useState({ key: 'date', desc: true })

  const sorted = useMemo(() => {
    const arr = [...items]
    arr.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      let cmp
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av).localeCompare(String(bv))
      return sort.desc ? -cmp : cmp
    })
    return arr
  }, [items, sort])

  const toggleSort = (key) => {
    setSort(prev => prev.key === key
      ? { key, desc: !prev.desc }
      : { key, desc: key === 'price' || key === 'date' })
  }

  if (items.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          No line items yet. Upload a receipt to get started.
        </div>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                className={col.numeric ? 'numeric' : ''}
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                {sort.key === col.key && (
                  <span className="sort-indicator">{sort.desc ? '▼' : '▲'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const isSelected = selected?.receiptId === row.receipt_id
              && selected?.lineNo === row.line_no
            return (
              <tr
                key={`${row.receipt_id}:${row.line_no}:${i}`}
                className={isSelected ? 'selected' : ''}
                onClick={() => onRowClick(row)}
              >
                <td>{row.date || ''}</td>
                <td>{row.location || ''}</td>
                <td title={row.item}>{row.item}</td>
                <td>{row.item_type}</td>
                <td className="numeric">
                  {typeof row.price === 'number' ? `$${row.price.toFixed(2)}` : row.price}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
