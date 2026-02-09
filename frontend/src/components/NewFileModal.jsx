import { useState, useEffect, useRef } from 'react'

export default function NewFileModal({ isOpen, onClose, onCreate }) {
  const [fileName, setFileName] = useState('script.py')
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)
  const textareaRef = useRef(null)

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFileName('script.py')
      setContent('')
      setError(null)
    }
  }, [isOpen])

  const handleCreate = async () => {
    if (!fileName.trim()) {
      setError('Please enter a file name')
      return
    }
    if (!content.trim()) {
      setError('Please paste some code')
      return
    }

    try {
      await onCreate(fileName.trim(), content)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setContent(text)
      setError(null)
    } catch (err) {
      setError('Could not read clipboard. Please paste manually (Ctrl+V)')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && e.metaKey) {
      handleCreate()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New File from Clipboard</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="fileName">File name</label>
            <input
              id="fileName"
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder="script.py"
            />
          </div>

          <div className="form-group">
            <label htmlFor="fileContent">
              Code
              <button type="button" className="paste-btn" onClick={handlePaste}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                  <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                </svg>
                Paste
              </button>
            </label>
            <textarea
              ref={textareaRef}
              id="fileContent"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste your code here..."
              rows={12}
            />
          </div>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate}>Create File</button>
        </div>
      </div>
    </div>
  )
}
