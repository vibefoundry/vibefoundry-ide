import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import LineItemsTable from './components/LineItemsTable.jsx'
import PreviewDrawer from './components/PreviewDrawer.jsx'

export default function App() {
  const [lineItems, setLineItems] = useState([])
  const [receipts, setReceipts] = useState([])
  const [scanning, setScanning] = useState([])    // {receipt_id, filename, status, error?}
  const [selected, setSelected] = useState(null)  // {receiptId, lineNo}
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refreshAll = useCallback(async () => {
    try {
      const [itemsRes, receiptsRes] = await Promise.all([
        fetch('/api/line_items'),
        fetch('/api/receipts'),
      ])
      const itemsBody = await itemsRes.json()
      const receiptsBody = await receiptsRes.json()
      setLineItems(itemsBody.items || [])
      setReceipts(receiptsBody.receipts || [])
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshAll() }, [refreshAll])

  // Parse an SSE stream from the fetch response body. The browser's
  // EventSource API only supports GET, so we read the streamed POST response
  // line-by-line with a TextDecoder.
  const consumeSSE = useCallback(async (response, onEvent) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const lines = frame.split('\n')
        let event = 'message'
        let data = ''
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        if (data) {
          try { onEvent(event, JSON.parse(data)) }
          catch (e) { console.warn('bad SSE frame', e, data) }
        }
      }
    }
  }, [])

  const handleUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return
    const form = new FormData()
    for (const f of files) form.append('files', f)

    const resp = await fetch('/api/scan', { method: 'POST', body: form })
    if (!resp.ok || !resp.body) {
      const body = await resp.json().catch(() => ({ error: resp.statusText }))
      setError(body.error || 'upload failed')
      return
    }

    await consumeSSE(resp, (event, payload) => {
      if (event === 'batch_started') {
        setScanning(prev => [
          ...payload.receipts.map(r => ({
            receipt_id: r.receipt_id,
            filename: r.filename,
            status: 'scanning',
          })),
          ...prev,
        ])
      } else if (event === 'receipt_done') {
        setScanning(prev => prev.map(row =>
          row.receipt_id === payload.receipt_id
            ? { ...row, status: payload.status, error: payload.error }
            : row
        ))
        if (payload.status === 'done') refreshAll()
      }
    })
  }, [consumeSSE, refreshAll])

  const clearScanning = useCallback(() => setScanning([]), [])

  const handleRowClick = useCallback((row) => {
    setSelected({ receiptId: row.receipt_id, lineNo: row.line_no })
  }, [])

  const handleReceiptClick = useCallback((receiptId) => {
    setSelected({ receiptId, lineNo: null })
  }, [])

  const handleClosePreview = useCallback(() => setSelected(null), [])

  const selectedReceipt = useMemo(
    () => receipts.find(r => r.receipt_id === selected?.receiptId) || null,
    [receipts, selected]
  )
  const selectedReceiptItems = useMemo(
    () => lineItems.filter(it => it.receipt_id === selected?.receiptId),
    [lineItems, selected]
  )

  return (
    <div className="viewer">
      <Sidebar
        receipts={receipts}
        scanning={scanning}
        selectedReceiptId={selected?.receiptId || null}
        onUpload={handleUpload}
        onReceiptClick={handleReceiptClick}
        onClearScanning={clearScanning}
      />
      <div className="main">
        <div className="table-toolbar">
          <h2>Line Items</h2>
          <div className="table-toolbar-actions">
            {loading && <span className="status">Loading…</span>}
            {error && <span className="status error">{error}</span>}
            {!loading && !error && (
              <span className="status">
                {lineItems.length} item{lineItems.length === 1 ? '' : 's'} ·{' '}
                {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <LineItemsTable
          items={lineItems}
          selected={selected}
          onRowClick={handleRowClick}
        />
      </div>
      {selected && selectedReceipt && (
        <PreviewDrawer
          receipt={selectedReceipt}
          items={selectedReceiptItems}
          highlightedLineNo={selected.lineNo}
          onClose={handleClosePreview}
        />
      )}
    </div>
  )
}
