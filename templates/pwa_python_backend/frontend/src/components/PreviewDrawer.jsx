import React, { useEffect, useRef } from 'react'

export default function PreviewDrawer({ receipt, items, highlightedLineNo, onClose }) {
  const highlightedRef = useRef(null)

  // Scroll the clicked line into view when the selection changes.
  useEffect(() => {
    if (highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [highlightedLineNo, receipt?.receipt_id])

  return (
    <aside className="preview-drawer">
      <div className="preview-header">
        <div className="title">{receipt.location || '(unknown)'}</div>
        <button className="close" onClick={onClose} title="Close">×</button>
      </div>
      <div className="preview-body">
        <div className="preview-meta">
          <div className="meta-row"><span className="k">Receipt</span><span>{receipt.receipt_id}</span></div>
          {receipt.date && <div className="meta-row"><span className="k">Date</span><span>{receipt.date}</span></div>}
          {(receipt.city || receipt.state) && (
            <div className="meta-row">
              <span className="k">Location</span>
              <span>{[receipt.city, receipt.state].filter(Boolean).join(', ')}</span>
            </div>
          )}
          <div className="meta-row"><span className="k">Items</span><span>{receipt.item_count}</span></div>
          <div className="meta-row"><span className="k">Total</span><span>${(receipt.total || 0).toFixed(2)}</span></div>
        </div>

        <div className="preview-image">
          <img
            src={`/api/image/${encodeURIComponent(receipt.receipt_id)}`}
            alt={`Receipt ${receipt.receipt_id}`}
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>

        {items.length > 0 && (
          <div className="preview-items">
            {items.map(it => {
              const highlighted = it.line_no === highlightedLineNo
              return (
                <div
                  key={it.line_no}
                  ref={highlighted ? highlightedRef : null}
                  className={`item ${highlighted ? 'highlighted' : ''}`}
                >
                  <div>
                    <div className="desc" title={it.item}>{it.item}</div>
                    <div className="type">{it.item_type}</div>
                  </div>
                  <div className="price">
                    {typeof it.price === 'number' ? `$${it.price.toFixed(2)}` : it.price}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
