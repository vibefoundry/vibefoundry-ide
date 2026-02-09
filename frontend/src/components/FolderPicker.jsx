import { useState, useEffect } from 'react'
import './FolderPicker.css'

function FolderPicker({ onSelect, onCancel }) {
  const [currentPath, setCurrentPath] = useState('')
  const [folders, setFolders] = useState([])
  const [parentPath, setParentPath] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [inputPath, setInputPath] = useState('')

  // Load home directory on mount
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
        setFolders(data.folders)
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

  const handleFolderClick = (folder) => {
    loadDirectory(folder.path)
  }

  const handleParentClick = () => {
    if (parentPath) {
      loadDirectory(parentPath)
    }
  }

  const handlePathSubmit = (e) => {
    e.preventDefault()
    if (inputPath.trim()) {
      loadDirectory(inputPath.trim())
    }
  }

  const handleSelect = () => {
    onSelect(currentPath)
  }

  return (
    <div className="folder-picker-overlay" onClick={onCancel}>
      <div className="folder-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="folder-picker-header">
          <h3>Select Project Folder</h3>
          <button className="modal-close" onClick={onCancel}>×</button>
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
                <div className="folder-picker-item parent" onDoubleClick={handleParentClick}>
                  <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
                  </svg>
                  <span className="folder-name">..</span>
                </div>
              )}
              {folders.length === 0 ? (
                <div className="folder-picker-empty">No subfolders</div>
              ) : (
                folders.map((folder) => (
                  <div
                    key={folder.path}
                    className="folder-picker-item"
                    onDoubleClick={() => handleFolderClick(folder)}
                  >
                    <svg className="folder-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M.54 3.87L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
                    </svg>
                    <span className="folder-name">{folder.name}</span>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        <div className="folder-picker-footer">
          <div className="folder-picker-selected">
            {currentPath}
          </div>
          <div className="folder-picker-actions">
            <button className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" onClick={handleSelect} disabled={!currentPath}>
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FolderPicker
