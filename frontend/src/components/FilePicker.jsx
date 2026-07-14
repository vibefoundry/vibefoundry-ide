import { useState, useEffect } from 'react'
import './FolderPicker.css'

// A local-filesystem FILE picker (as opposed to FolderPicker's folder picker).
// Used by "Add Data" in the Codex pane: the sandboxed browser can't upload, so
// the user browses their own machine and picks a file, and the backend copies
// it into the project (see /api/files/copy). Reuses FolderPicker's CSS.
function FilePicker({ onSelect, onCancel, destName }) {
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState([])
  const [files, setFiles] = useState([])
  const [parentPath, setParentPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [inputPath, setInputPath] = useState('')

  useEffect(() => {
    const loadHome = async () => {
      try {
        const res = await fetch('/api/fs/home')
        if (res.ok) {
          const data = await res.json()
          loadDirectory(data.path)
        }
      } catch (err) {
        setError('Failed to load home directory')
        setLoading(false)
      }
    }
    loadHome()
  }, [])

  const loadDirectory = async (path) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`)
      if (res.ok) {
        const data = await res.json()
        setCurrentPath(data.current)
        setInputPath(data.current)
        setParentPath(data.parent)
        setFolders(data.folders || [])
        setFiles(data.files || [])
      } else {
        const errData = await res.json()
        setError(errData.detail || 'Failed to load directory')
      }
    } catch (err) {
      setError('Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  const handlePathSubmit = (e) => {
    e.preventDefault()
    if (inputPath.trim()) loadDirectory(inputPath.trim())
  }

  const folderIcon = (
    <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z" />
    </svg>
  )
  const fileIcon = (
    <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9.5 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5L9.5 1zM9 5V2l3 3H9z" />
    </svg>
  )

  return (
    <div className="folder-picker-overlay" onClick={onCancel || undefined}>
      <div className="folder-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="folder-picker-header">
          <h3>Add data{destName ? ` to ${destName}` : ''}</h3>
          {onCancel && <button className="modal-close" onClick={onCancel}>×</button>}
        </div>

        <form className="folder-picker-path-form" onSubmit={handlePathSubmit}>
          <input
            type="text"
            className="folder-picker-path-input"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="Enter path..."
          />
          <button type="submit" className="btn-flat">Go</button>
        </form>

        <div className="folder-picker-list">
          {loading ? (
            <div className="folder-picker-loading">Loading...</div>
          ) : error ? (
            <div className="folder-picker-error">{error}</div>
          ) : (
            <>
              {parentPath && (
                <div className="folder-picker-item parent" onDoubleClick={() => loadDirectory(parentPath)}>
                  {folderIcon}
                  <span className="folder-name">..</span>
                </div>
              )}
              {folders.map((folder) => (
                <div
                  key={folder.path}
                  className="folder-picker-item"
                  onDoubleClick={() => loadDirectory(folder.path)}
                >
                  {folderIcon}
                  <span className="folder-name">{folder.name}</span>
                </div>
              ))}
              {files.map((file) => (
                <div
                  key={file.path}
                  className="folder-picker-item"
                  title="Double-click to add this file"
                  onDoubleClick={() => onSelect(file.path)}
                >
                  {fileIcon}
                  <span className="folder-name">{file.name}</span>
                </div>
              ))}
              {folders.length === 0 && files.length === 0 && (
                <div className="folder-picker-empty">Empty folder</div>
              )}
            </>
          )}
        </div>

        <div className="folder-picker-footer">
          <div className="folder-picker-selected">Double-click a file to add it to your project.</div>
          <div className="folder-picker-actions">
            {onCancel && <button className="btn-secondary" onClick={onCancel}>Cancel</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FilePicker
