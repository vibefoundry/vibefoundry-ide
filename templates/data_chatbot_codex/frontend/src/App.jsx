import React, { useCallback, useEffect, useRef, useState } from 'react'
import DataPreview from './components/DataPreview.jsx'
import Message from './components/Message.jsx'
import CodexAuthModal from './components/CodexAuthModal.jsx'

const STAGE_LABEL = {
  classifying: 'Reading your question…',
  generating_code: 'Writing the query…',
  executing: 'Running the query…',
  answering: 'Writing the answer…',
}

export default function App() {
  const [preview, setPreview] = useState(null)
  const [activeFilters, setActiveFilters] = useState({})
  const [previewLoading, setPreviewLoading] = useState(false)
  const [messages, setMessages] = useState([])   // {role, text, stage, code, description, table, error, questionId, hasResult}
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  const [dataWidth, setDataWidth] = useState(1200)  // px width of the data-preview pane
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedTable, setSelectedTable] = useState(null)
  // When the backend reports a Codex 401 we open a re-auth modal and stash
  // the original question so we can re-send it after the user signs in.
  // `null` means no modal; a string means "this is the question to retry".
  const [pendingAuthQuestion, setPendingAuthQuestion] = useState(null)

  // Drag the divider between the data-preview pane and the chat pane to resize
  // both. The data pane starts at viewport x=0, so the cursor's clientX IS the
  // desired pane width; clamp so neither pane can be squeezed away.
  const startResize = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev) => {
      const min = 420
      const max = Math.max(min, window.innerWidth - 380)
      setDataWidth(Math.min(max, Math.max(min, ev.clientX)))
    }
    const stop = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Fetch the preview of one table — backend chooses the default table when
  // `table` is null. Always POST so we can send filters + table selection in
  // one body; backend handles empty filters as the unfiltered case.
  const fetchPreview = useCallback(async (filters, tableName) => {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: filters || {},
          table: tableName || undefined,
        }),
      })
      setPreview(await res.json())
    } catch (e) {
      console.warn('preview fetch failed', e)
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const applyFilter = useCallback((col, spec) => {
    setActiveFilters(prev => {
      const next = { ...prev }
      if (spec === null) delete next[col]
      else next[col] = spec
      fetchPreview(next, selectedTable)
      return next
    })
  }, [fetchPreview, selectedTable])

  const clearAllFilters = useCallback(() => {
    setActiveFilters({})
    fetchPreview({}, selectedTable)
  }, [fetchPreview, selectedTable])

  // Upload one or more parquets → backend adds/replaces tables, clears history
  // server-side, rebuilds metadata. We reset local UI state and refetch the
  // preview (backend will pick a default table from the new set).
  const handleUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      for (const f of files) fd.append('file', f)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || `upload failed (${res.status})`)
        return
      }
      setMessages([])
      setActiveFilters({})
      setSelectedTable(null)   // let backend pick the default of the new set
      await fetchPreview({}, null)
    } catch (e) {
      alert(`upload failed: ${e}`)
    } finally {
      setUploading(false)
    }
  }, [fetchPreview])

  // Switch which table is shown in the data preview. Resets filters because
  // they're column-scoped and don't carry over to a different schema.
  const handleSelectTable = useCallback((name) => {
    if (!name || name === selectedTable) return
    setSelectedTable(name)
    setActiveFilters({})
    fetchPreview({}, name)
  }, [fetchPreview, selectedTable])

  // Remove one table → backend deletes the parquet + clears history. Refetch
  // so the picker updates; if the deleted table was selected, backend picks
  // a new default.
  const handleDeleteTable = useCallback(async (name) => {
    if (!window.confirm(`Delete table "${name}"? This clears the conversation.`)) return
    try {
      const res = await fetch(`/api/tables/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(body.error || `delete failed (${res.status})`)
        return
      }
      setMessages([])
      setActiveFilters({})
      if (selectedTable === name) setSelectedTable(null)
      await fetchPreview({}, null)
    } catch (e) {
      alert(`delete failed: ${e}`)
    }
  }, [fetchPreview, selectedTable])

  // Load the dataset preview (sidebar) and any prior conversation.
  useEffect(() => {
    fetchPreview()
    fetch('/api/history').then(r => r.json()).then(body => {
      const restored = []
      for (const turn of body.history || []) {
        restored.push({ role: 'user', text: turn.question })
        restored.push({
          role: 'assistant',
          text: turn.answer,
          hasResult: turn.needs_code && turn.question_id ? true : false,
          questionId: turn.question_id,
        })
      }
      setMessages(restored)
    }).catch(() => {})
  }, [fetchPreview])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // EventSource only does GET, so read the streamed POST body by hand.
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
        let event = 'message', data = ''
        for (const line of frame.split('\n')) {
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

  // Update the in-flight assistant message (always the last one).
  const patchLast = useCallback((patch) => {
    setMessages(prev => {
      const next = prev.slice()
      const i = next.length - 1
      next[i] = { ...next[i], ...patch }
      return next
    })
  }, [])

  // `override` is set when the auth modal's success callback re-sends a
  // question that previously 401'd — in that case we bypass the input box
  // and don't clear it.
  const send = useCallback(async (override) => {
    const question = (typeof override === 'string' ? override : input).trim()
    if (!question || busy) return
    if (typeof override !== 'string') setInput('')
    setBusy(true)
    setMessages(prev => [
      ...prev,
      { role: 'user', text: question },
      { role: 'assistant', text: '', stage: 'classifying' },
    ])

    try {
      const resp = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ error: resp.statusText }))
        patchLast({ stage: null, error: body.error || 'request failed' })
        return
      }
      await consumeSSE(resp, (event, payload) => {
        if (event === 'stage') {
          patchLast({ stage: payload.stage })
        } else if (event === 'code') {
          patchLast({ code: payload.code, description: payload.description })
        } else if (event === 'answer_delta') {
          // Append streamed tokens to the live assistant message.
          setMessages(prev => {
            const next = prev.slice()
            const i = next.length - 1
            next[i] = { ...next[i], stage: null, text: (next[i].text || '') + payload.text }
            return next
          })
        } else if (event === 'answer') {
          patchLast({
            stage: null,
            text: payload.answer,
            code: payload.code,
            description: payload.description,
            hasResult: payload.has_result,
            questionId: payload.question_id,
            table: payload.has_result
              ? { columns: payload.columns, rows: payload.rows, total: payload.total_rows }
              : null,
          })
        } else if (event === 'error') {
          // Codex 401 → open the re-auth modal instead of dumping the raw
          // error into the chat. The modal's success callback re-sends this
          // question, so stash it.
          if (payload.error_code === 'codex_auth_expired') {
            setPendingAuthQuestion(payload.question || question)
            // Drop the failed user+assistant pair so the upcoming retry can
            // re-append them cleanly. Otherwise the chat shows the question
            // twice in a row.
            setMessages(prev => prev.slice(0, -2))
          } else {
            patchLast({ stage: null, error: payload.error, code: payload.code })
          }
        }
      })
    } catch (e) {
      patchLast({ stage: null, error: String(e) })
    } finally {
      setBusy(false)
    }
  }, [input, busy, consumeSSE, patchLast])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }, [send])

  const newChat = useCallback(async () => {
    await fetch('/api/reset', { method: 'POST' }).catch(() => {})
    setMessages([])
  }, [])

  // Modal callbacks: success re-sends the stashed question; cancel just
  // dismisses the modal (the question is dropped — user can ask again).
  const onAuthSuccess = useCallback(() => {
    const q = pendingAuthQuestion
    setPendingAuthQuestion(null)
    if (q) send(q)
  }, [pendingAuthQuestion, send])

  const onAuthCancel = useCallback(() => {
    setPendingAuthQuestion(null)
  }, [])

  // Empty state — no dataset uploaded yet. Render an upload-only screen
  // covering everything; once a file lands, /api/preview stops returning
  // `empty: true` and the normal layout renders.
  if (preview?.empty) {
    return (
      <div className="upload-start">
        <div className="upload-start-card">
          <h1>Upload tables to get started</h1>
          <p>
            Drop one or more <code>.parquet</code> files. Each file becomes a
            table the chatbot can query — and join across — when you ask
            questions. You can add more tables or delete existing ones later.
          </p>
          <label className={`upload-btn upload-btn-large${uploading ? ' uploading' : ''}`}>
            {uploading ? 'Uploading…' : 'Choose parquet file(s)'}
            <input
              type="file"
              accept=".parquet"
              multiple
              disabled={uploading}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                if (files.length > 0) handleUpload(files)
                e.target.value = ''
              }}
            />
          </label>
          <p className="upload-start-note">
            Files are stored locally inside the app folder; nothing leaves your machine except your questions to the AI.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app" style={{ '--data-w': `${dataWidth}px` }}>
      <DataPreview
        preview={preview}
        activeFilters={activeFilters}
        onApplyFilter={applyFilter}
        onClearAll={clearAllFilters}
        loading={previewLoading}
        onUpload={handleUpload}
        uploading={uploading}
        onSelectTable={handleSelectTable}
        onDeleteTable={handleDeleteTable}
      />
      <div
        className={`resizer${dragging ? ' dragging' : ''}`}
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
      />
      {pendingAuthQuestion !== null && (
        <CodexAuthModal onSuccess={onAuthSuccess} onCancel={onAuthCancel} />
      )}
      <div className="chat">
        <button className="newchat-float" onClick={newChat} disabled={busy}>New chat</button>

        <div className="messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="empty">
              <p>Ask anything about the dataset — totals, rankings, breakdowns, filters.</p>
              <ul>
                <li>“Total selling volume by US state for FY26, top 10”</li>
                <li>“How many distinct outlets are in the On Premise channel?”</li>
                <li>“What columns are in this data?”</li>
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} message={m} stageLabel={STAGE_LABEL[m.stage]} />
          ))}
        </div>

        <div className="composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question about the data…"
            rows={1}
            disabled={busy}
          />
          <button className="send-btn" onClick={send} disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
