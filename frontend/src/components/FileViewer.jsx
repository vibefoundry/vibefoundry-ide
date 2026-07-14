import { useState, useEffect } from 'react'
import DataFrameViewer from './DataFrameViewer'
import LargeFilePreviewModal from './LargeFilePreviewModal'
import JsonViewer from './JsonViewer'
import CodeViewer from './CodeViewer'
import MarkdownViewer from './MarkdownViewer'

// In the Codex pane, direct <img src="/api/image">/<iframe src="/api/pdf"> bypass
// the callTool proxy and fail. There we fetch the file as base64 through the
// proxy and render a data: URL. In the standalone app (no window.openai) this is
// inert — the original direct URL is used, exactly as before.
const IS_PANE = typeof window !== 'undefined' && !!window.openai

const useDataUrl = (path) => {
  const [dataUrl, setDataUrl] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!IS_PANE) return
    let cancelled = false
    setDataUrl(null)
    setError(null)
    fetch(`/api/file-base64?path=${encodeURIComponent(path)}`)
      .then((r) =>
        r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.detail || 'Failed to load')))
      )
      .then((d) => { if (!cancelled) setDataUrl(`data:${d.contentType};base64,${d.base64}`) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [path])
  return { dataUrl, error }
}

const ImageViewer = ({ content }) => {
  const { dataUrl, error } = useDataUrl(content.path)
  const src = IS_PANE ? dataUrl : `/api/image?path=${encodeURIComponent(content.path)}`
  return (
    <div className="image-viewer">
      {error ? (
        <p>Failed to load image: {error}</p>
      ) : IS_PANE && !src ? (
        <p>Loading image…</p>
      ) : (
        <img src={src} alt={content.filename} />
      )}
    </div>
  )
}

const PdfViewer = ({ content }) => {
  const { dataUrl, error } = useDataUrl(content.path)
  const src = IS_PANE ? dataUrl : `/api/pdf?path=${encodeURIComponent(content.path)}`
  return (
    <div className="pdf-viewer">
      {error ? (
        <p>Failed to load PDF: {error}</p>
      ) : IS_PANE && !src ? (
        <p>Loading PDF…</p>
      ) : (
        <iframe src={src} title={content.filename} />
      )}
    </div>
  )
}

const DocxViewer = ({ content }) => {
  return (
    <div className="docx-viewer">
      <div className="docx-content">
        {content.paragraphs.map((para, i) => {
          const style = para.style || ''
          if (style.startsWith('Heading 1')) return <h1 key={i}>{para.text}</h1>
          if (style.startsWith('Heading 2')) return <h2 key={i}>{para.text}</h2>
          if (style.startsWith('Heading 3')) return <h3 key={i}>{para.text}</h3>
          if (style.startsWith('Heading')) return <h4 key={i}>{para.text}</h4>
          if (style === 'Title') return <h1 key={i} className="docx-title">{para.text}</h1>
          if (style === 'Subtitle') return <h2 key={i} className="docx-subtitle">{para.text}</h2>
          if (style.includes('List')) return <li key={i}>{para.text}</li>
          return <p key={i}>{para.text}</p>
        })}
        {content.tables.map((table, ti) => (
          <table key={`table-${ti}`} className="docx-table">
            <tbody>
              {table.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    ri === 0 ? <th key={ci}>{cell}</th> : <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  )
}

const FileViewer = ({ content, canWrite, onSave, onSheetChange, saveStatus, onLargeFilePreviewReady, onLargeFileCancel }) => {
  if (!content) return null

  const renderViewer = () => {
    switch (content.type) {
      case 'massive_file':
        return (
          <LargeFilePreviewModal
            content={content}
            onPreviewReady={onLargeFilePreviewReady}
            onCancel={onLargeFileCancel}
          />
        )
      case 'dataframe':
        return <DataFrameViewer content={content} onSheetChange={onSheetChange} />
      case 'docx':
        return <DocxViewer content={content} />
      case 'image':
        return <ImageViewer content={content} />
      case 'pdf':
        return <PdfViewer content={content} />
      case 'json':
        return <JsonViewer content={content} />
      case 'code':
        return (
          <CodeViewer
            content={content}
            canWrite={canWrite}
            onSave={onSave}
            saveStatus={saveStatus}
          />
        )
      case 'markdown':
        return (
          <CodeViewer
            content={content}
            canWrite={canWrite}
            onSave={onSave}
            saveStatus={saveStatus}
          />
        )
      case 'text':
        return (
          <CodeViewer
            content={content}
            canWrite={canWrite}
            onSave={onSave}
            saveStatus={saveStatus}
          />
        )
      case 'error':
        return (
          <div className="unknown-viewer">
            <p>Error: {content.message}</p>
          </div>
        )
      case 'unknown':
        return (
          <div className="unknown-viewer">
            <p>{content.message}</p>
          </div>
        )
      default:
        return (
          <div className="unknown-viewer">
            <p>Cannot preview this file type</p>
          </div>
        )
    }
  }

  return (
    <div className="file-viewer-container">
      {renderViewer()}
    </div>
  )
}

export default FileViewer
