import { useState, useEffect, useRef, useCallback } from 'react'
import LocalTerminal from './LocalTerminal'
import './ScriptRunner.css'

let terminalIdCounter = 1

function ScriptRunner({ folderName, height, scriptChangeEvent, lastTerminalActivity, onStreamlitUrl }) {
  const [activeTab, setActiveTab] = useState('scripts') // 'scripts' or 'terminal'
  const [terminals, setTerminals] = useState([{ id: terminalIdCounter }])
  const [activeTerminalId, setActiveTerminalId] = useState(terminalIdCounter)
  const [scripts, setScripts] = useState([])
  const [selectedScripts, setSelectedScripts] = useState(new Set())
  const [isRunning, setIsRunning] = useState(false)
  const [output, setOutput] = useState([])
  const [pendingScripts, setPendingScripts] = useState([]) // Scripts edited, shown in modal when done
  const [showPendingModal, setShowPendingModal] = useState(false)
  const [checkedPendingScripts, setCheckedPendingScripts] = useState(new Set())
  const [collapsed, setCollapsed] = useState(false)
  const [scriptsWidth, setScriptsWidth] = useState(200)
  const [isResizingScripts, setIsResizingScripts] = useState(false)
  const [installModal, setInstallModal] = useState({ show: false, module: null, scriptPath: null })
  const [isInstalling, setIsInstalling] = useState(false)
  const [runningModal, setRunningModal] = useState({ show: false, status: 'running', scripts: [], results: [] })
  const [runningProcesses, setRunningProcesses] = useState([])
  const [showProcessManager, setShowProcessManager] = useState(false)
  const outputRef = useRef(null)
  const scriptsResizeRef = useRef(null)
  const scriptQueueRef = useRef([])
  const isRunningRef = useRef(false)
  const hasCompletedInitialLoadRef = useRef(false) // Only show banner after first successful load + settle
  const bannerTimeoutRef = useRef(null) // For auto-dismissing the banner
  const modalDismissedAtRef = useRef(0) // Cooldown: track when modal was last dismissed

  // Fetch scripts list
  const fetchScripts = useCallback(async () => {
    try {
      const res = await fetch('/api/scripts')
      if (res.ok) {
        const data = await res.json()
        setScripts(data.scripts || [])

        // After first successful fetch, wait 2 seconds then enable modal
        if (!hasCompletedInitialLoadRef.current) {
          setTimeout(() => {
            hasCompletedInitialLoadRef.current = true
            console.log('[ScriptRunner] Initial load complete, now listening for script changes')
          }, 2000)
        }
      }
    } catch (err) {
      console.error('Failed to fetch scripts:', err)
    }
  }, [])

  // Fetch running processes
  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch('/api/processes')
      if (res.ok) {
        const data = await res.json()
        setRunningProcesses(data.processes || [])
      }
    } catch (err) {
      console.error('Failed to fetch processes:', err)
    }
  }, [])

  // Stop a single process
  const stopProcess = async (pid) => {
    try {
      const res = await fetch('/api/processes/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid })
      })
      if (res.ok) {
        addOutput(`⏹ Stopped process ${pid}`, 'warning')
        fetchProcesses()
      }
    } catch (err) {
      addOutput(`Error stopping process: ${err.message}`, 'error')
    }
  }

  // Poll for running processes when process manager is open
  useEffect(() => {
    if (showProcessManager) {
      fetchProcesses()
      const interval = setInterval(fetchProcesses, 2000)
      return () => clearInterval(interval)
    }
  }, [showProcessManager, fetchProcesses])

  // Load scripts when folder changes
  useEffect(() => {
    if (folderName) {
      fetchScripts()
    }
  }, [folderName, fetchScripts])


  // Track last processed events to prevent duplicates (path -> timestamp)
  const lastProcessedEventsRef = useRef({})

  // Handle script change events from App.jsx (single WebSocket connection)
  // Uses a banner that accumulates changes and auto-dismisses after inactivity
  useEffect(() => {
    if (!scriptChangeEvent) return

    // Skip until initial load is complete - prevents banner appearing before app is ready
    if (!hasCompletedInitialLoadRef.current) {
      console.log('[ScriptRunner] Ignoring script change during initial load:', scriptChangeEvent.path)
      return
    }

    // Skip if modal is currently showing - don't accumulate more while user is deciding
    if (showPendingModal) {
      return
    }

    // Skip during cooldown period after modal was dismissed
    const now = Date.now()
    if (now - modalDismissedAtRef.current < 5000) {
      return
    }

    const scriptPath = scriptChangeEvent.path
    // Normalize path for case-insensitive comparison (Windows)
    const normalizedPath = scriptPath.toLowerCase()

    // Skip if we already processed this path within 3 seconds (stronger debounce)
    const lastTime = lastProcessedEventsRef.current[normalizedPath]
    if (lastTime && (now - lastTime) < 3000) {
      return
    }
    lastProcessedEventsRef.current[normalizedPath] = now

    // Clean up old entries
    const cutoff = now - 10000
    for (const key of Object.keys(lastProcessedEventsRef.current)) {
      if (lastProcessedEventsRef.current[key] < cutoff) {
        delete lastProcessedEventsRef.current[key]
      }
    }

    // Refresh scripts list
    fetchScripts()

    // Accumulate scripts silently (modal shows when terminal goes idle)
    setPendingScripts(prev => {
      if (prev.includes(scriptPath)) return prev
      return [...prev, scriptPath]
    })
    // Auto-check new scripts
    setCheckedPendingScripts(prev => {
      const next = new Set(prev)
      next.add(scriptPath)
      return next
    })
  }, [scriptChangeEvent, fetchScripts, showPendingModal])

  // Watch terminal activity - show modal when terminal goes idle for 2 seconds
  useEffect(() => {
    // Only run if we have pending scripts and terminal activity data
    if (pendingScripts.length === 0 || !lastTerminalActivity || showPendingModal) return

    // Check every 500ms if terminal has been idle for 2 seconds
    const checkIdle = () => {
      const now = Date.now()

      // Respect cooldown period after modal was dismissed (5 seconds)
      if (now - modalDismissedAtRef.current < 5000) {
        return
      }

      const idleTime = now - lastTerminalActivity
      if (idleTime >= 2000) {
        // Terminal has been idle for 2 seconds - Claude is done, show modal
        setShowPendingModal(true)
      }
    }

    const intervalId = setInterval(checkIdle, 500)
    return () => clearInterval(intervalId)
  }, [pendingScripts.length, lastTerminalActivity, showPendingModal])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current)
    }
  }, [])

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
  const queueScripts = (scriptPaths, showModal = true) => {
    // Add to queue (avoid duplicates)
    for (const path of scriptPaths) {
      if (!scriptQueueRef.current.includes(path)) {
        scriptQueueRef.current.push(path)
      }
    }
    // Start processing if not already running
    processQueue(showModal)
  }

  // Process the script queue one at a time
  const processQueue = async (showModal = true) => {
    if (isRunningRef.current || scriptQueueRef.current.length === 0) return

    isRunningRef.current = true
    setIsRunning(true)

    // Get all scripts to run for the modal
    const allScripts = [...scriptQueueRef.current]
    const results = []

    // Show running modal
    if (showModal) {
      setRunningModal({ show: true, status: 'running', scripts: allScripts, results: [] })
    }

    while (scriptQueueRef.current.length > 0) {
      const scriptPath = scriptQueueRef.current.shift()
      const result = await runSingleScript(scriptPath)
      results.push({ script: scriptPath, ...result })

      // Update modal with progress
      if (showModal) {
        setRunningModal(prev => ({ ...prev, results: [...results] }))
      }
    }

    isRunningRef.current = false
    setIsRunning(false)

    // Update modal to show final status
    if (showModal) {
      const hasError = results.some(r => !r.success)
      if (hasError) {
        setRunningModal(prev => ({
          ...prev,
          status: 'error',
          results
        }))
      } else {
        // Auto-close on success after brief delay
        setRunningModal(prev => ({
          ...prev,
          status: 'complete',
          results
        }))
        setTimeout(() => {
          setRunningModal({ show: false, status: 'running', scripts: [], results: [] })
        }, 1500)
      }
    }
  }

  // Run a single script - returns result object
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

        // Check if this was a Streamlit app
        if (result.streamlit_url) {
          addOutput(`🚀 Streamlit app running at: ${result.streamlit_url}`, 'success')
          // Notify parent to show in preview tab
          if (onStreamlitUrl) {
            onStreamlitUrl(result.streamlit_url)
          }
        } else if (result.success) {
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

        return {
          success: result.success,
          timed_out: result.timed_out,
          return_code: result.return_code,
          error: result.error,
          streamlit_url: result.streamlit_url
        }
      } else {
        addOutput(`Failed to run ${scriptName}`, 'error')
        return { success: false, error: 'Failed to run script' }
      }
    } catch (err) {
      addOutput(`Error: ${err.message}`, 'error')
      return { success: false, error: err.message }
    }
  }

  // Run multiple scripts (used by manual Run button)
  const runScripts = async (scriptPaths, showModal = true) => {
    if (scriptPaths.length === 0) return
    queueScripts(scriptPaths, showModal)
  }

  // Close the running modal
  const closeRunningModal = () => {
    setRunningModal({ show: false, status: 'running', scripts: [], results: [] })
  }

  // Cancel running scripts from modal
  const handleCancelFromModal = async () => {
    await handleStop()
    setRunningModal(prev => ({ ...prev, status: 'cancelled' }))
  }

  const handleRun = () => {
    const selected = Array.from(selectedScripts)
    if (selected.length === 0) {
      addOutput('No scripts selected', 'warning')
      return
    }
    runScripts(selected)
  }

  const handleStop = async () => {
    try {
      const res = await fetch('/api/scripts/stop', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        addOutput(`⏹ Stopped ${data.stopped} running script(s)`, 'warning')
        // Clear the queue and reset running state
        scriptQueueRef.current = []
        isRunningRef.current = false
        setIsRunning(false)
      }
    } catch (err) {
      addOutput(`Stop error: ${err.message}`, 'error')
    }
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

  // Run checked pending scripts from modal
  const handleApprovePending = useCallback(() => {
    const scriptsToRun = pendingScripts.filter(p => checkedPendingScripts.has(p))
    if (scriptsToRun.length > 0) {
      queueScripts(scriptsToRun)
    }
    setPendingScripts([])
    setCheckedPendingScripts(new Set())
    setShowPendingModal(false)
    modalDismissedAtRef.current = Date.now() // Start cooldown
  }, [pendingScripts, checkedPendingScripts])

  // Dismiss the modal
  const handleDismissPending = useCallback(() => {
    setPendingScripts([])
    setCheckedPendingScripts(new Set())
    setShowPendingModal(false)
    modalDismissedAtRef.current = Date.now() // Start cooldown
  }, [])

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

  // Keyboard escape handler for modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showPendingModal) {
        handleDismissPending()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showPendingModal, handleDismissPending])

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
            <button
              className="btn-header btn-stop"
              onClick={handleStop}
              disabled={!isRunning}
            >
              Stop
            </button>
            <button
              className={`btn-header ${showProcessManager ? 'active' : ''}`}
              onClick={() => setShowProcessManager(!showProcessManager)}
              title="View running processes"
            >
              Processes
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

      {/* Running Status Modal */}
      {runningModal.show && (
        <div className="running-modal-overlay" onMouseDown={runningModal.status !== 'running' ? closeRunningModal : undefined}>
          <div className="running-modal" onMouseDown={(e) => e.stopPropagation()}>
            {runningModal.status === 'running' && (
              <>
                <div className="running-modal-icon spinning">⟳</div>
                <h3>Running Scripts...</h3>
                <div className="running-scripts-list">
                  {runningModal.scripts.map((script, i) => {
                    const scriptName = script.split('/').pop()
                    const result = runningModal.results[i]
                    let statusIcon = '○'
                    let statusClass = 'pending'
                    if (result) {
                      statusIcon = result.success ? '✓' : '✗'
                      statusClass = result.success ? 'success' : 'error'
                    } else if (i === runningModal.results.length) {
                      statusIcon = '●'
                      statusClass = 'running'
                    }
                    return (
                      <div key={i} className={`running-script-item ${statusClass}`}>
                        <span className="running-script-status">{statusIcon}</span>
                        <span className="running-script-name">{scriptName}</span>
                      </div>
                    )
                  })}
                </div>
                <button className="btn-cancel-run" onMouseDown={handleCancelFromModal}>Cancel</button>
              </>
            )}
            {runningModal.status === 'complete' && (
              <>
                <div className="running-modal-icon complete">✓</div>
                <h3>Complete</h3>
                <p>{runningModal.results.length} script{runningModal.results.length !== 1 ? 's' : ''} finished successfully</p>
                <button className="btn-close-modal" onMouseDown={closeRunningModal}>Close</button>
              </>
            )}
            {runningModal.status === 'error' && (
              <>
                <div className="running-modal-icon error">✗</div>
                <h3>Error</h3>
                <div className="running-scripts-list">
                  {runningModal.results.map((result, i) => {
                    const scriptName = result.script.split('/').pop()
                    return (
                      <div key={i} className={`running-script-item ${result.success ? 'success' : 'error'}`}>
                        <span className="running-script-status">{result.success ? '✓' : '✗'}</span>
                        <span className="running-script-name">{scriptName}</span>
                      </div>
                    )
                  })}
                </div>
                <button className="btn-close-modal" onMouseDown={closeRunningModal}>Close</button>
              </>
            )}
            {runningModal.status === 'cancelled' && (
              <>
                <div className="running-modal-icon cancelled">⏹</div>
                <h3>Cancelled</h3>
                <p>Script execution was stopped</p>
                <button className="btn-close-modal" onMouseDown={closeRunningModal}>Close</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Process Manager Modal */}
      {showProcessManager && (
        <div className="process-manager-overlay" onMouseDown={() => setShowProcessManager(false)}>
          <div className="process-manager-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="process-manager-header">
              <h3>Running Processes</h3>
              <button className="process-manager-close" onClick={() => setShowProcessManager(false)}>×</button>
            </div>
            <div className="process-manager-body">
              {runningProcesses.length === 0 ? (
                <div className="no-processes">No processes currently running</div>
              ) : (
                <table className="process-table">
                  <thead>
                    <tr>
                      <th>PID</th>
                      <th>Script</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runningProcesses.map((proc) => (
                      <tr key={proc.pid}>
                        <td className="pid-cell">{proc.pid}</td>
                        <td className="script-cell" title={proc.script_path}>{proc.script_name}</td>
                        <td className="type-cell">
                          <span className={`type-badge ${proc.type}`}>{proc.type}</span>
                        </td>
                        <td className="status-cell">
                          <span className={`status-badge ${proc.status}`}>{proc.status}</span>
                        </td>
                        <td className="action-cell">
                          <button
                            className="btn-kill"
                            onClick={() => stopProcess(proc.pid)}
                            title="Stop this process"
                          >
                            Kill
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="process-manager-footer">
              <button className="btn-refresh-processes" onClick={fetchProcesses}>
                Refresh
              </button>
              <button
                className="btn-kill-all"
                onClick={handleStop}
                disabled={runningProcesses.length === 0}
              >
                Kill All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scripts Modified Modal - shows when Claude finishes editing */}
      {showPendingModal && pendingScripts.length > 0 && (
        <div className="pending-modal-overlay" onMouseDown={handleDismissPending}>
          <div className="pending-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="pending-modal-close"
              onMouseDown={handleDismissPending}
              title="Close (Esc)"
            >
              ×
            </button>
            <div className="pending-modal-icon">✓</div>
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
                onMouseDown={handleApprovePending}
                disabled={isRunning || checkedPendingScripts.size === 0}
              >
                {isRunning ? 'Running...' : `Run ${checkedPendingScripts.size} Script${checkedPendingScripts.size !== 1 ? 's' : ''}`}
              </button>
              <button
                className="btn-dismiss"
                onMouseDown={handleDismissPending}
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
