import React, { useRef, useState } from 'react'

export default function Sidebar({
  receipts,
  scanning,
  selectedReceiptId,
  onUpload,
  onReceiptClick,
  onClearScanning,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (files.length > 0) onUpload(files)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Receipt Scanner</h1>
        <div className="subtitle">Drop images · click line items to preview</div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <h2>Upload</h2>
          <label
            className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false)
              handleFiles(e.dataTransfer.files)
            }}
            onClick={() => inputRef.current?.click()}
          >
            <div>Drop receipt images here</div>
            <div className="hint">or click to browse</div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                handleFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {scanning.length > 0 && (
          <div className="sidebar-section">
            <h2>Scanning</h2>
            <div className="scan-list">
              {scanning.map((row) => (
                <div key={row.receipt_id} className={`scan-row ${row.status}`}>
                  <span className="status-icon">
                    {row.status === 'scanning' && <span className="spinner" />}
                    {row.status === 'done' && <span title="done">✓</span>}
                    {row.status === 'error' && <span title={row.error}>✗</span>}
                  </span>
                  <span className="name" title={row.filename}>{row.filename}</span>
                </div>
              ))}
            </div>
            {scanning.every(r => r.status !== 'scanning') && (
              <button className="scan-clear" onClick={onClearScanning}>Clear</button>
            )}
          </div>
        )}

        <div className="sidebar-section">
          <h2>Receipts ({receipts.length})</h2>
          {receipts.length === 0 ? (
            <div className="status">No receipts yet.</div>
          ) : (
            <div className="receipt-list">
              {receipts.map((r) => (
                <div
                  key={r.receipt_id}
                  className={`receipt-row ${r.receipt_id === selectedReceiptId ? 'selected' : ''}`}
                  onClick={() => onReceiptClick(r.receipt_id)}
                >
                  <div className="store">{r.location || '(unknown)'}</div>
                  <div className="meta">
                    <span>{r.date || ''}</span>
                    <span>${(r.total || 0).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
