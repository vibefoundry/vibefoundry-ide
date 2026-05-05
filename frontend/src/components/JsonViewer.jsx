import { useState } from 'react'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isArray = (v) => Array.isArray(v)
const isContainer = (v) => isObject(v) || isArray(v)

const Primitive = ({ value }) => {
  if (value === null) return <span className="json-null">null</span>
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>
  if (typeof value === 'number') return <span className="json-number">{value}</span>
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>
  return <span>{String(value)}</span>
}

const Node = ({ k, value, isLast, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const container = isContainer(value)
  const empty = container && (isArray(value) ? value.length === 0 : Object.keys(value).length === 0)

  const open = isArray(value) ? '[' : '{'
  const close = isArray(value) ? ']' : '}'
  const comma = isLast ? '' : ','
  const keyLabel = k !== undefined ? <><span className="json-key">"{k}"</span>: </> : null

  if (!container || empty) {
    return (
      <div className="json-line">
        {keyLabel}
        {empty ? <span className="json-bracket">{open}{close}</span> : <Primitive value={value} />}
        {comma}
      </div>
    )
  }

  const entries = isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value)
  const count = entries.length

  return (
    <div className="json-node">
      <div className="json-line">
        <span
          className="json-toggle"
          onClick={() => setExpanded(!expanded)}
          role="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </span>
        {keyLabel}
        <span className="json-bracket">{open}</span>
        {!expanded && (
          <>
            <span className="json-ellipsis" onClick={() => setExpanded(true)}>
              {' '}… {count} {isArray(value) ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'key' : 'keys')}{' '}
            </span>
            <span className="json-bracket">{close}</span>
            {comma}
          </>
        )}
      </div>
      {expanded && (
        <>
          <div className="json-children">
            {entries.map(([childKey, childVal], idx) => (
              <Node
                key={childKey}
                k={isArray(value) ? undefined : childKey}
                value={childVal}
                isLast={idx === entries.length - 1}
                defaultExpanded={true}
              />
            ))}
          </div>
          <div className="json-line">
            <span className="json-bracket">{close}</span>{comma}
          </div>
        </>
      )}
    </div>
  )
}

const JsonViewer = ({ content }) => {
  return (
    <div className="json-viewer">
      <div className="json-viewer-inner">
        <Node value={content.data} isLast={true} defaultExpanded={true} />
      </div>
    </div>
  )
}

export default JsonViewer
