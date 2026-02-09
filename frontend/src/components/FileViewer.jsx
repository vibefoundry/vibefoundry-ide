import DataFrameViewer from './DataFrameViewer'
import JsonViewer from './JsonViewer'
import CodeViewer from './CodeViewer'
import MarkdownViewer from './MarkdownViewer'

const FileViewer = ({ content, canWrite, onSave, saveStatus }) => {
  if (!content) return null

  const renderViewer = () => {
    switch (content.type) {
      case 'dataframe':
        return <DataFrameViewer content={content} />
      case 'image':
        const ext = (content.extension || 'png').replace(/^\./, '') // Remove leading dot if present
        return (
          <div className="image-viewer">
            <img
              src={`data:image/${ext};base64,${content.content}`}
              alt={content.filename}
            />
          </div>
        )
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
