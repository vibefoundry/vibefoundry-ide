import React, { useState } from 'react'

// Numbers render rounded to 2 decimals; non-numbers pass through.
function fmtCell(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && !Number.isInteger(v)) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof v === 'number') return v.toLocaleString()
  return String(v)
}

function ResultTable({ table, questionId }) {
  if (!table || !table.columns?.length) return null
  const shown = table.rows.length
  return (
    <div className="result">
      <div className="result-head">
        <span>
          {table.total.toLocaleString()} row{table.total === 1 ? '' : 's'}
          {table.total > shown ? ` · showing first ${shown}` : ''}
        </span>
        {questionId && (
          <a href={`/api/result/${questionId}/download`}>Download .parquet</a>
        )}
      </div>
      <div className="result-scroll">
        <table>
          <thead>
            <tr>{table.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{fmtCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CodeBlock({ code, description }) {
  const [open, setOpen] = useState(false)
  if (!code) return null
  return (
    <div className="code-disclosure">
      <button className="code-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} {description || 'Generated query'}
      </button>
      {open && <pre className="code-block"><code>{code}</code></pre>}
    </div>
  )
}

export default function Message({ message, stageLabel }) {
  const { role } = message

  if (role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">{message.text}</div>
      </div>
    )
  }

  return (
    <div className="msg assistant">
      <div className="bubble">
        {message.stage && (
          <div className="stage"><span className="spinner" /> {stageLabel || 'Working…'}</div>
        )}
        {message.error && (
          <div className="msg-error">
            <strong>Couldn’t answer that.</strong>
            <pre>{message.error}</pre>
          </div>
        )}
        {message.text && (
          <div className="answer">
            {message.text.split('\n').map((line, i) =>
              line.trim() ? <p key={i}>{line}</p> : <br key={i} />
            )}
          </div>
        )}
        {!message.stage && (
          <CodeBlock code={message.code} description={message.description} />
        )}
        {message.table && (
          <ResultTable table={message.table} questionId={message.questionId} />
        )}
      </div>
    </div>
  )
}
