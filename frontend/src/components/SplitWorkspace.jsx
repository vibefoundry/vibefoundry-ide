import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Terminal from './Terminal'
import CodespaceSync from './CodespaceSync'
import './SplitWorkspace.css'

function SplitWorkspace({
  projectPath,
  syncConnection,
  onSyncConnectionChange,
  onClose,
  onSyncComplete,
  onAuthChange
}) {
  const [previewUrl, setPreviewUrl] = useState(() => localStorage.getItem('previewUrl') || '')
  const [splitPosition, setSplitPosition] = useState(50) // percentage
  const [isDragging, setIsDragging] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [codespaceCollapsed, setCodespaceCollapsed] = useState(false)

  // Handle split resize
  const handleSplitDragStart = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleDragMove = (e) => {
      const container = document.querySelector('.split-workspace-content')
      if (!container) return
      const rect = container.getBoundingClientRect()
      const percentage = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPosition(Math.max(20, Math.min(80, percentage)))
    }

    const handleDragEnd = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
    }

    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
  }, [])

  return createPortal(
    <div className="split-workspace-overlay">
      <div className="split-workspace">
        <div className="split-workspace-header">
          <span className="split-workspace-title">Workspace</span>
          <button className="split-workspace-close" onClick={onClose}>×</button>
        </div>

        <div className={`split-workspace-content ${isDragging ? 'dragging' : ''}`}>
          {/* Left side - Preview */}
          <div className="split-pane split-pane-left" style={{ width: `${splitPosition}%` }}>
            <div className="split-pane-header">
              <span>Preview</span>
            </div>
            <div className="split-pane-body">
              <div className="preview-url-bar">
                <input
                  type="text"
                  className="preview-url-input"
                  placeholder="Enter URL (e.g., http://localhost:3000)"
                  value={previewUrl}
                  onChange={(e) => {
                    setPreviewUrl(e.target.value)
                    localStorage.setItem('previewUrl', e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const iframe = document.querySelector('.split-preview-iframe')
                      if (iframe) iframe.src = previewUrl
                    }
                  }}
                />
                <button
                  className="btn-flat"
                  onClick={() => {
                    const iframe = document.querySelector('.split-preview-iframe')
                    if (iframe) iframe.src = previewUrl
                  }}
                >
                  Go
                </button>
              </div>
              {previewUrl ? (
                <iframe
                  className="split-preview-iframe"
                  src={previewUrl}
                  title="App Preview"
                  style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
                />
              ) : (
                <div className="preview-placeholder">
                  Enter a URL above to preview your app
                </div>
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="split-resize-handle"
            onMouseDown={handleSplitDragStart}
          />

          {/* Right side - Terminal */}
          <div className="split-pane split-pane-right" style={{ width: `${100 - splitPosition}%` }}>
            <div className={`split-codespace-section ${codespaceCollapsed ? 'minimized' : ''}`}>
              <CodespaceSync
                projectPath={projectPath}
                currentConnection={syncConnection}
                minimized={codespaceCollapsed}
                onSyncComplete={onSyncComplete}
                onConnectionChange={onSyncConnectionChange}
                onLaunchClaude={() => {
                  setShowTerminal(true)
                }}
                onAuthChange={onAuthChange}
              />
              {codespaceCollapsed && (
                <button className="btn-flat btn-small btn-expand" onClick={() => setCodespaceCollapsed(false)}>
                  Settings
                </button>
              )}
            </div>

            <div className="split-terminal-body">
              {showTerminal && syncConnection.syncUrl ? (
                <Terminal
                  syncUrl={syncConnection.syncUrl}
                  isConnected={syncConnection.isConnected}
                  autoLaunchClaude={true}
                />
              ) : (
                <div className="terminal-launch-screen">
                  {syncConnection.syncUrl && (
                    <button
                      className="btn-launch-claude"
                      onClick={() => setShowTerminal(true)}
                      disabled={!syncConnection.isConnected}
                    >
                      Launch Claude Code in Virtual Sandbox
                    </button>
                  )}
                  {!syncConnection.syncUrl && (
                    <div className="terminal-launch-message">
                      Connect to a codespace to launch the terminal
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default SplitWorkspace
