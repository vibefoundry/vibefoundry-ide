import { useState, useEffect, useRef, useCallback } from 'react'
import LocalTerminal from './LocalTerminal'
import './ScriptRunner.css'

let terminalIdCounter = 1

function ScriptRunner({ folderName, height }) {
  const [activeTab, setActiveTab] = useState('scripts') // 'scripts' or 'terminal'
  const [terminals, setTerminals] = useState([{ id: terminalIdCounter }])
  const [activeTerminalId, setActiveTerminalId] = useState(terminalIdCounter)
  const [scripts, setScripts] = useState([])
  const [selectedScripts, setSelectedScripts] = useState(new Set())
  const [isRunning, setIsRunning] = useState(false)
  const [output, setOutput] = useState([])
  const [pendingScripts, setPendingScripts] = useState([]) // Scripts awaiting approval
  const [showPendingModal, setShowPendingModal] = useState(false)
  const [checkedPendingScripts, setCheckedPendingScripts] = useState(new Set()) // Which pending scripts are checked
  const [collapsed, setCollapsed] = useState(false)
  const [scriptsWidth, setScriptsWidth] = useState(200)
  const [isResizingScripts, setIsResizingScripts] = useState(false)
  const [installModal, setInstallModal] = useState({ show: false, module: null, scriptPath: null })
  const [isInstalling, setIsInstalling] = useState(false)
  const outputRef = useRef(null)
  const wsRef = useRef(null)
  const scriptsResizeRef = useRef(null)
  const scriptQueueRef = useRef([])
  const isRunningRef = useRef(false)

  // Fetch scripts list
  const fetchScripts = useCallback(async () => {
    try {
      const res = await fetch('/api/scripts')
      if (res.ok) {
        const data = await res.json()
        setScripts(data.scripts || [])
      }
    } catch (err) {
      console.error('Failed to fetch scripts:', err)
    }
  }, [])

  // Load scripts when folder changes
  useEffect(() => {
    if (folderName) {
      fetchScripts()
    }
  }, [folderName, fetchScripts])

  // Connect to WebSocket for file change notifications
  useEffect(() => {
    if (!folderName) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/watch`

    const connect = () => {
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('Script watcher connected')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'script_change') {
            // Refresh scripts list
            fetchScripts()

            // Add to pending scripts modal (avoid duplicates, auto-check new scripts)
            const scriptPath = data.path
            setPendingScripts(prev => {
              if (prev.includes(scriptPath)) return prev
              return [...prev, scriptPath]
            })
            setCheckedPendingScripts(prev => {
              const next = new Set(prev)
              next.add(scriptPath)
              return next
            })
            setShowPendingModal(true)
          } else if (data.type === 'data_change') {
            addOutput('Data files changed - metadata updated', 'info')
          }
        } catch (e) {
          // Ignore parse errors for keepalive messages
        }
      }

      ws.onclose = () => {
        // Reconnect after delay
        setTimeout(connect, 3000)
      }

      wsRef.current = ws
    }

    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [folderName])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const addOutput = (message, type = 'log') => {
    setOutput(prev => [...prev, { message, type, timestamp: new Date() }])
  }

  // Detect ModuleNotFoundError and extract module name
  const detectMissingModule = (stderr) => {
    if (!stderr) return null
    const match = stderr.match(/ModuleNotFoundError: No module named ['\"]([^'\"]+)['\"]/)
    if (match) {
      // Handle submodule imports like 'PIL.Image' -> 'PIL' (which is 'pillow')
      const moduleName = match[1].split('.')[0]
      // Map common module names to pip package names
      const moduleMap = {
        'PIL': 'pillow',
        'cv2': 'opencv-python',
        'sklearn': 'scikit-learn',
        'yaml': 'pyyaml',
      }
      return moduleMap[moduleName] || moduleName
    }
    return null
  }

  // Handle pip install
  const handleInstallModule = async () => {
    const { module, scriptPath } = installModal
    setIsInstalling(true)
    addOutput(`📦 Installing ${module}...`, 'info')

    try {
      const res = await fetch('/api/pip/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: module })
      })

      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          addOutput(`✓ Successfully installed ${module}`, 'success')
          if (data.stdout) addOutput(data.stdout.trim(), 'stdout')

          // Close modal and re-run the script
          setInstallModal({ show: false, module: null, scriptPath: null })
          setIsInstalling(false)

          // Re-run the script
          addOutput(`🔄 Re-running script...`, 'info')
          await runScripts([scriptPath])
        } else {
          addOutput(`✗ Failed to install ${module}`, 'error')
          if (data.stderr) addOutput(data.stderr.trim(), 'stderr')
          setIsInstalling(false)
        }
      } else {
        addOutput(`✗ Failed to install ${module}`, 'error')
        setIsInstalling(false)
      }
    } catch (err) {
      addOutput(`Error: ${err.message}`, 'error')
      setIsInstalling(false)
    }
  }

  const toggleScript = (scriptPath) => {
    setSelectedScripts(prev => {
      const next = new Set(prev)
      if (next.has(scriptPath)) {
        next.delete(scriptPath)
      } else {
        next.add(scriptPath)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedScripts(new Set(scripts.map(s => s.path)))
  }

  const selectNone = () => {
    setSelectedScripts(new Set())
  }

  // Queue scripts to run (prevents concurrent runs)
  const queueScripts = (scriptPaths) => {
    // Add to queue (avoid duplicates)
    for (const path of scriptPaths) {
      if (!scriptQueueRef.current.includes(path)) {
        scriptQueueRef.current.push(path)
      }
    }
    // Start processing if not already running
    processQueue()
  }

  // Process the script queue one at a time
  const processQueue = async () => {
    if (isRunningRef.current || scriptQueueRef.current.length === 0) return

    isRunningRef.current = true
    setIsRunning(true)

    while (scriptQueueRef.current.length > 0) {
      const scriptPath = scriptQueueRef.current.shift()
      await runSingleScript(scriptPath)
    }

    isRunningRef.current = false
    setIsRunning(false)
  }

  // Run a single script
  const runSingleScript = async (scriptPath) => {
    const scriptName = scriptPath.split('/').pop()
    addOutput('─'.repeat(40), 'divider')
    addOutput(`▶ Running: ${scriptName}`, 'header')

    try {
      const res = await fetch('/api/scripts/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scripts: [scriptPath] })
      })

      if (res.ok) {
        const data = await res.json()
        const result = data.results[0]

        if (result.stdout) {
          addOutput(result.stdout.trim(), 'stdout')
        }
        if (result.stderr) {
          addOutput(result.stderr.trim(), 'stderr')
        }
        if (result.error) {
          addOutput(result.error, 'error')
        }

        if (result.success) {
          addOutput(`✓ ${scriptName} completed`, 'success')
        } else if (result.timed_out) {
          addOutput(`⏱ ${scriptName} timed out`, 'error')
        } else {
          addOutput(`✗ ${scriptName} failed (code ${result.return_code})`, 'error')

          // Check for missing module error
          const missingModule = detectMissingModule(result.stderr)
          if (missingModule) {
            setInstallModal({ show: true, module: missingModule, scriptPath })
          }
        }
      } else {
        addOutput(`Failed to run ${scriptName}`, 'error')
      }
    } catch (err) {
      addOutput(`Error: ${err.message}`, 'error')
    }
  }

  // Run multiple scripts (used by manual Run button)
  const runScripts = async (scriptPaths) => {
    if (scriptPaths.length === 0) return
    queueScripts(scriptPaths)
  }

  const handleRun = () => {
    const selected = Array.from(selectedScripts)
    if (selected.length === 0) {
      addOutput('No scripts selected', 'warning')
      return
    }
    runScripts(selected)
  }

  const handleRefreshMetadata = async () => {
    try {
      const res = await fetch('/api/metadata/generate', { method: 'POST' })
      if (res.ok) {
        addOutput('✓ Metadata regenerated', 'success')
      }
    } catch (err) {
      addOutput(`Metadata error: ${err.message}`, 'error')
    }
  }

  const clearOutput = () => {
    setOutput([])
  }

  // Approve and run checked pending scripts
  const handleApprovePending = () => {
    const scriptsToRun = pendingScripts.filter(p => checkedPendingScripts.has(p))
    if (scriptsToRun.length > 0) {
      queueScripts(scriptsToRun)
    }
    setPendingScripts([])
    setCheckedPendingScripts(new Set())
    setShowPendingModal(false)
  }

  // Dismiss pending scripts
  const handleDismissPending = () => {
    setPendingScripts([])
    setCheckedPendingScripts(new Set())
    setShowPendingModal(false)
  }

  // Toggle a pending script checkbox
  const togglePendingScript = (scriptPath) => {
    setCheckedPendingScripts(prev => {
      const next = new Set(prev)
      if (next.has(scriptPath)) {
        next.delete(scriptPath)
      } else {
        next.add(scriptPath)
      }
      return next
    })
  }

  // Select/deselect all pending scripts
  const toggleAllPendingScripts = () => {
    if (checkedPendingScripts.size === pendingScripts.length) {
      setCheckedPendingScripts(new Set())
    } else {
      setCheckedPendingScripts(new Set(pendingScripts))
    }
  }

  const addTerminal = () => {
    terminalIdCounter++
    const newTerminal = { id: terminalIdCounter }
    setTerminals(prev => [...prev, newTerminal])
    setActiveTerminalId(terminalIdCounter)
  }

  const closeTerminal = (id) => {
    setTerminals(prev => {
      const newTerminals = prev.filter(t => t.id !== id)
      if (newTerminals.length === 0) {
        // Always keep at least one terminal
        terminalIdCounter++
        return [{ id: terminalIdCounter }]
      }
      // If we closed the active terminal, switch to another
      if (activeTerminalId === id) {
        setActiveTerminalId(newTerminals[newTerminals.length - 1].id)
      }
      return newTerminals
    })
  }

  const clearTerminals = () => {
    terminalIdCounter++
    setTerminals([{ id: terminalIdCounter }])
    setActiveTerminalId(terminalIdCounter)
  }

  const handleScriptsResizeStart = (e) => {
    e.preventDefault()
    scriptsResizeRef.current = true
    setIsResizingScripts(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = scriptsWidth

    const handleResizeMove = (e) => {
      if (!scriptsResizeRef.current) return
      const delta = e.clientX - startX
      const newWidth = Math.max(100, Math.min(400, startWidth + delta))
      setScriptsWidth(newWidth)
    }

    const handleResizeEnd = () => {
      scriptsResizeRef.current = false
      setIsResizingScripts(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }

  if (!folderName) return null

  return (
    <div className={`script-runner ${collapsed ? 'collapsed' : ''}`} style={height ? { height } : undefined}>
      <div className="script-runner-header">
        <div className="script-runner-header-left">
          <span className="collapse-icon" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? '▶' : '▼'}
          </span>
          <div className="script-runner-tabs">
            <button
              className={`script-runner-tab ${activeTab === 'scripts' ? 'active' : ''}`}
              onClick={() => setActiveTab('scripts')}
            >
              Script Runner
            </button>
            <button
              className={`script-runner-tab ${activeTab === 'terminal' ? 'active' : ''}`}
              onClick={() => setActiveTab('terminal')}
            >
              Local Terminal
            </button>
          </div>
        </div>
        {activeTab === 'scripts' && (
          <div className="script-runner-header-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn-header"
              onClick={handleRun}
              disabled={isRunning || selectedScripts.size === 0}
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
            <button className="btn-header" onClick={fetchScripts}>
              Refresh
            </button>
            <button className="btn-header" onClick={handleRefreshMetadata}>
              Farm Metadata
            </button>
            <button className="btn-header" onClick={clearOutput}>
              Clear
            </button>
          </div>
        )}
      </div>

      {!collapsed && activeTab === 'scripts' && (
        <div className={`script-runner-body ${isResizingScripts ? 'resizing' : ''}`}>

          <div className="script-list" style={{ width: scriptsWidth }}>
            {scripts.length > 0 ? (
              <>
                <div className="script-list-actions">
                  <button className="btn-link" onClick={selectAll}>All</button>
                  <button className="btn-link" onClick={selectNone}>None</button>
                </div>
                {scripts.map((script) => (
                  <label key={script.path} className="script-item">
                    <input
                      type="checkbox"
                      checked={selectedScripts.has(script.path)}
                      onChange={() => toggleScript(script.path)}
                    />
                    <span className="script-name">{script.relative_path}</span>
                  </label>
                ))}
              </>
            ) : (
              <div className="no-scripts">No scripts in app_folder/scripts/</div>
            )}
          </div>

          <div className="scripts-resize-handle" onMouseDown={handleScriptsResizeStart} />

          <div className="script-output-section">
            <div className="script-output" ref={outputRef}>
              {output.map((entry, i) => (
                <div key={i} className={`output-line ${entry.type}`}>
                  {entry.message}
                </div>
              ))}
              {output.length === 0 && (
                <div className="output-placeholder">Script output will appear here...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {!collapsed && activeTab === 'terminal' && (
        <div className="local-terminal-body">
          <div className="terminal-tabs-bar">
            {terminals.map(term => (
              <div
                key={term.id}
                className={`terminal-tab ${activeTerminalId === term.id ? 'active' : ''}`}
                onClick={() => setActiveTerminalId(term.id)}
              >
                <span>Terminal {term.id}</span>
                <button
                  className="terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTerminal(term.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button className="terminal-tab-new" onClick={addTerminal}>+</button>
            <button className="terminal-tab-clear" onClick={clearTerminals}>Clear All</button>
          </div>
          <div className="terminal-instances">
            {terminals.map(term => (
              <div
                key={term.id}
                className="terminal-instance-wrapper"
                style={{ display: activeTerminalId === term.id ? 'flex' : 'none' }}
              >
                <LocalTerminal id={term.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Module Install Modal */}
      {installModal.show && (
        <div className="install-modal-overlay" onClick={() => !isInstalling && setInstallModal({ show: false, module: null, scriptPath: null })}>
          <div className="install-modal" onClick={(e) => e.stopPropagation()}>
            <div className="install-modal-icon">📦</div>
            <h3>Missing Module</h3>
            <p>
              The module <code>{installModal.module}</code> is not installed.
            </p>
            <p>Would you like to install it?</p>
            <div className="install-modal-actions">
              <button
                className="btn-install"
                onClick={handleInstallModule}
                disabled={isInstalling}
              >
                {isInstalling ? 'Installing...' : `pip install ${installModal.module}`}
              </button>
              <button
                className="btn-cancel"
                onClick={() => setInstallModal({ show: false, module: null, scriptPath: null })}
                disabled={isInstalling}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Scripts Modal */}
      {showPendingModal && pendingScripts.length > 0 && (
        <div className="pending-modal-overlay" onClick={handleDismissPending}>
          <div className="pending-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pending-modal-icon">📝</div>
            <h3>Scripts Modified</h3>
            <div className="pending-scripts-list">
              <label className="pending-script-item select-all">
                <input
                  type="checkbox"
                  checked={checkedPendingScripts.size === pendingScripts.length}
                  onChange={toggleAllPendingScripts}
                />
                <span>Select All</span>
              </label>
              {pendingScripts.map((scriptPath, i) => (
                <label key={i} className="pending-script-item">
                  <input
                    type="checkbox"
                    checked={checkedPendingScripts.has(scriptPath)}
                    onChange={() => togglePendingScript(scriptPath)}
                  />
                  <span>{scriptPath.split('/').pop()}</span>
                </label>
              ))}
            </div>
            <div className="pending-modal-actions">
              <button
                className="btn-run-pending"
                onClick={handleApprovePending}
                disabled={isRunning || checkedPendingScripts.size === 0}
              >
                {isRunning ? 'Running...' : `Run ${checkedPendingScripts.size} Script${checkedPendingScripts.size !== 1 ? 's' : ''}`}
              </button>
              <button
                className="btn-dismiss"
                onClick={handleDismissPending}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScriptRunner
