import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getStoredToken,
  getStoredUser,
  storeCredentials,
  clearCredentials,
  startDeviceFlow,
  pollDeviceFlow,
  getCurrentUser,
  listCodespaces,
  getCodespaceSyncUrl,
  createCodespace,
  startCodespace,
  deleteCodespace
} from '../utils/github'
import {
  checkSyncServer,
  runFullSync,
  pushScriptsToCodespace,
  writeTimeKeeper,
  resetCodespace
} from '../utils/codespaceSync'

function CodespaceSync({ projectPath, onSyncComplete, onConnectionChange, currentConnection, onAuthChange, onLaunchClaude, minimized = false }) {
  // Auth state
  const [token, setToken] = useState(getStoredToken())
  const [user, setUser] = useState(getStoredUser())
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [deviceCode, setDeviceCode] = useState(null)
  const [loginError, setLoginError] = useState(null)
  const [showCopyToast, setShowCopyToast] = useState(false)

  // Codespace state
  const [codespaces, setCodespaces] = useState([])
  const [selectedCodespace, setSelectedCodespace] = useState(null)
  const [isLoadingCodespaces, setIsLoadingCodespaces] = useState(false)
  const [isCreatingCodespace, setIsCreatingCodespace] = useState(false)
  const [isLaunchingCodespace, setIsLaunchingCodespace] = useState(false)
  const [isDeletingCodespace, setIsDeletingCodespace] = useState(false)
  const [isResettingCodespace, setIsResettingCodespace] = useState(false)

  // Sync state - initialize from currentConnection if provided
  const [syncUrl, setSyncUrl] = useState(currentConnection?.syncUrl || null)
  const [isConnected, setIsConnected] = useState(currentConnection?.isConnected || false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isStartingUp, setIsStartingUp] = useState(false) // True when codespace is being created/started
  const [isSyncing, setIsSyncing] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('idle') // idle, syncing, success, error
  const [syncMessage, setSyncMessage] = useState('')
  const [autoSync, setAutoSync] = useState(false)
  const [lastSync, setLastSync] = useState({})

  // Refs
  const pollIntervalRef = useRef(null)
  const syncIntervalRef = useRef(null)
  const devicePollRef = useRef(null)
  const lastSyncRef = useRef({})
  const watchSocketRef = useRef(null)
  const [useWebSocket, setUseWebSocket] = useState(true) // Try WebSocket first, fall back to polling

  // Load codespaces when logged in
  useEffect(() => {
    if (token && user) {
      loadCodespaces()
    }
  }, [token, user])

  // Restore selectedCodespace when codespaces load and there's an existing syncUrl
  useEffect(() => {
    if (codespaces.length > 0 && syncUrl && !selectedCodespace) {
      // Find the codespace that matches the syncUrl
      const matchingCodespace = codespaces.find(cs => {
        const csUrl = getCodespaceSyncUrl(cs)
        return csUrl === syncUrl
      })
      if (matchingCodespace) {
        setSelectedCodespace(matchingCodespace)
      }
    }
  }, [codespaces, syncUrl, selectedCodespace])

  // Auto-sync when connected and enabled - use WebSocket or fall back to polling
  useEffect(() => {
    if (!isConnected || !autoSync || !projectPath || !syncUrl) return

    // Initial sync
    handleSync()

    // Try WebSocket connection for real-time file change notifications
    if (useWebSocket) {
      try {
        // Convert HTTP URL to WebSocket URL
        const wsUrl = syncUrl.replace(/^http/, 'ws') + '/watch'
        console.log('[CodespaceSync] Connecting to watch WebSocket:', wsUrl)

        const ws = new WebSocket(wsUrl)
        watchSocketRef.current = ws

        ws.onopen = () => {
          console.log('[CodespaceSync] Watch WebSocket connected')
          setSyncMessage('Connected (real-time sync)')
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'file_change') {
              console.log('[CodespaceSync] File changed:', msg.path, msg.change)
              // File changed in codespace - sync it
              handleSync()
            } else if (msg.type === 'connected') {
              console.log('[CodespaceSync] Watch server connected, watchdog:', msg.watchdog_available)
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        }

        ws.onerror = (err) => {
          console.warn('[CodespaceSync] Watch WebSocket error, falling back to polling:', err)
          setUseWebSocket(false)
        }

        ws.onclose = () => {
          console.log('[CodespaceSync] Watch WebSocket closed')
          watchSocketRef.current = null
          // If we were connected and WebSocket closed, fall back to polling
          // This handles cases like codespace restart
          if (isConnected) {
            console.log('[CodespaceSync] WebSocket closed while connected, falling back to polling')
            setUseWebSocket(false)
          }
        }

        return () => {
          if (watchSocketRef.current) {
            watchSocketRef.current.close()
            watchSocketRef.current = null
          }
        }
      } catch (err) {
        console.warn('[CodespaceSync] WebSocket not available, falling back to polling:', err)
        setUseWebSocket(false)
      }
    }

    // Fallback: polling every 3 seconds (instead of 1 second)
    if (!useWebSocket) {
      console.log('[CodespaceSync] Using polling fallback (every 3s)')
      syncIntervalRef.current = setInterval(() => {
        handleSync()
      }, 3000)

      return () => {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current)
        }
      }
    }
  }, [isConnected, autoSync, projectPath, syncUrl, useWebSocket])

  // Check connection when codespace selected
  useEffect(() => {
    if (selectedCodespace && syncUrl) {
      checkConnection()
      const interval = setInterval(checkConnection, 2000)
      return () => clearInterval(interval)
    }
  }, [selectedCodespace, syncUrl])

  // Keep codespace alive by pinging GitHub API every 2 minutes
  useEffect(() => {
    if (!token || !selectedCodespace?.name) return

    const keepAlive = async () => {
      try {
        // Ping the GitHub API to get codespace details - this counts as activity
        const response = await fetch(`https://api.github.com/user/codespaces/${selectedCodespace.name}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github+json"
          }
        })
        if (response.ok) {
          const data = await response.json()
          // If codespace stopped, try to restart it
          if (data.state === 'Shutdown' || data.state === 'Stopped') {
            console.log('Codespace stopped, attempting restart...')
            setSyncMessage('Codespace stopped, restarting...')
            try {
              await startCodespace(token, selectedCodespace.name)
              setSyncMessage('Codespace restarting...')
            } catch (e) {
              console.error('Failed to restart codespace:', e)
            }
          }
        }
      } catch (err) {
        console.error('Keep-alive ping failed:', err)
      }
    }

    // Initial check
    keepAlive()
    // Ping every 2 minutes to prevent idle shutdown
    const interval = setInterval(keepAlive, 120000)
    return () => clearInterval(interval)
  }, [token, selectedCodespace])

  // Write time_keeper.txt every minute to keep codespace active
  useEffect(() => {
    if (!syncUrl || !isConnected) return

    // Write immediately on connect
    writeTimeKeeper(syncUrl)

    // Then every minute
    const interval = setInterval(() => {
      writeTimeKeeper(syncUrl)
    }, 60000)

    return () => clearInterval(interval)
  }, [syncUrl, isConnected])

  // Notify parent of connection changes
  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange({ syncUrl, isConnected })
    }
  }, [syncUrl, isConnected, onConnectionChange])

  const loadCodespaces = async () => {
    if (!token) return
    setIsLoadingCodespaces(true)
    try {
      const spaces = await listCodespaces(token)
      setCodespaces(spaces)
    } catch (err) {
      console.error('Failed to load codespaces:', err)
    } finally {
      setIsLoadingCodespaces(false)
    }
  }

  const checkConnection = async () => {
    if (!syncUrl) return
    const connected = await checkSyncServer(syncUrl)
    setIsConnected(connected)
    if (!connected && !isStartingUp && !isLaunchingCodespace) {
      // Only show disconnected message if we're not in a starting state
      setSyncStatus('idle')
      setSyncMessage('Codespace not running or sync server offline')
    }
  }

  const handleLogin = async () => {
    setIsLoggingIn(true)
    setLoginError(null)

    try {
      const deviceData = await startDeviceFlow()
      setDeviceCode(deviceData)

      // Open GitHub in new tab
      window.open(deviceData.verification_uri, '_blank')

      // Start polling for completion with dynamic interval
      let pollInterval = (deviceData.interval || 5) * 1000

      const pollForToken = async () => {
        try {
          const result = await pollDeviceFlow(deviceData.device_code)

          if (result.access_token) {
            const userInfo = await getCurrentUser(result.access_token)
            storeCredentials(result.access_token, userInfo)
            setToken(result.access_token)
            setUser(userInfo)
            setDeviceCode(null)
            setIsLoggingIn(false)
            // Notify parent of auth change for validation
            if (onAuthChange) onAuthChange(userInfo)
          } else if (result.error === 'expired_token') {
            setLoginError('Code expired. Please try again.')
            setDeviceCode(null)
            setIsLoggingIn(false)
          } else if (result.error === 'access_denied') {
            setLoginError('Access denied.')
            setDeviceCode(null)
            setIsLoggingIn(false)
          } else if (result.error === 'slow_down') {
            // GitHub wants us to slow down - use their suggested interval
            pollInterval = (result.interval || 10) * 1000
            devicePollRef.current = setTimeout(pollForToken, pollInterval)
          } else if (result.error === 'authorization_pending') {
            // Still waiting - poll again
            devicePollRef.current = setTimeout(pollForToken, pollInterval)
          } else {
            // Unknown response, keep polling
            devicePollRef.current = setTimeout(pollForToken, pollInterval)
          }
        } catch (err) {
          console.error('Poll error:', err)
          setLoginError('Login failed: ' + err.message)
          setDeviceCode(null)
          setIsLoggingIn(false)
        }
      }

      // Start first poll after initial interval
      devicePollRef.current = setTimeout(pollForToken, pollInterval)
    } catch (err) {
      setLoginError(err.message)
      setIsLoggingIn(false)
    }
  }

  const handleLogout = () => {
    if (devicePollRef.current) clearTimeout(devicePollRef.current)
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current)
    if (watchSocketRef.current) {
      watchSocketRef.current.close()
      watchSocketRef.current = null
    }
    clearCredentials()
    setToken(null)
    setUser(null)
    setCodespaces([])
    setSelectedCodespace(null)
    setSyncUrl(null)
    setIsConnected(false)
    setDeviceCode(null)
    setUseWebSocket(true) // Reset for next connection
    // Notify parent of auth change
    if (onAuthChange) onAuthChange(null)
  }

  const handleSelectCodespace = (codespace) => {
    // Close existing WebSocket if switching codespaces
    if (watchSocketRef.current) {
      watchSocketRef.current.close()
      watchSocketRef.current = null
    }
    setSelectedCodespace(codespace)
    const url = getCodespaceSyncUrl(codespace)
    setSyncUrl(url)
    setIsConnected(false)
    setSyncStatus('idle')
    lastSyncRef.current = {}
    setLastSync({})
    setUseWebSocket(true) // Try WebSocket for new connection
  }

  const handleCreateCodespace = async () => {
    console.log('Creating codespace...')
    setIsCreatingCodespace(true)
    setIsStartingUp(true)
    setSyncMessage('Creating codespace...')
    setSyncStatus('syncing')
    try {
      const newCodespace = await createCodespace(token)
      console.log('Codespace created:', newCodespace)

      // Immediately add to dropdown and select it
      setCodespaces(prev => [...prev, newCodespace])
      handleSelectCodespace(newCodespace)

      // Open codespace URL immediately
      const codespaceUrl = `https://${newCodespace.name}.github.dev`
      window.open(codespaceUrl, '_blank')

      setSyncMessage('Codespace created! Starting up (this may take a few minutes)...')

      // Poll for sync server to respond - codespace creation can take a while
      const pollForReady = async (attempts = 0) => {
        if (attempts > 300) { // Max 5 minutes at 1 second intervals
          setIsStartingUp(false)
          setSyncMessage('Codespace is still starting. Check the browser tab.')
          setSyncStatus('idle')
          return
        }

        const connected = await checkSyncServer(syncUrl || getCodespaceSyncUrl(newCodespace))

        if (connected) {
          setIsConnected(true)
          setIsStartingUp(false)
          setSyncMessage('Connected!')
          setSyncStatus('success')
          loadCodespaces()
        } else {
          const mins = Math.floor(attempts / 60)
          const secs = attempts % 60
          setSyncMessage(`Starting codespace... ${mins > 0 ? `${mins}m ` : ''}${secs}s`)
          setTimeout(() => pollForReady(attempts + 1), 1000)
        }
      }

      setTimeout(() => pollForReady(0), 2000)
    } catch (err) {
      console.error('Failed to create codespace:', err)
      setSyncMessage('Failed to create codespace: ' + err.message)
      setSyncStatus('error')
      setIsStartingUp(false)
    } finally {
      setIsCreatingCodespace(false)
    }
  }

  const handleLaunchCodespace = async () => {
    if (!selectedCodespace) return
    setIsLaunchingCodespace(true)
    try {
      // Start the codespace if not already running
      if (selectedCodespace.state !== 'Available') {
        await startCodespace(token, selectedCodespace.name)
      }
      // Open codespace in browser
      const codespaceUrl = `https://${selectedCodespace.name}.github.dev`
      console.log('[CodespaceSync] Opening URL:', codespaceUrl)
      console.log('[CodespaceSync] selectedCodespace:', selectedCodespace)
      window.open(codespaceUrl, '_blank')

      // Poll for codespace to be ready and sync server to respond
      const pollForReady = async (attempts = 0) => {
        if (attempts > 120) { // Max 2 minutes at 1 second intervals
          setIsLaunchingCodespace(false)
          setSyncMessage('Codespace took too long to start')
          return
        }

        const connected = await checkSyncServer(syncUrl)

        if (connected) {
          setIsConnected(true)
          setIsLaunchingCodespace(false)
          setSyncMessage('Connected!')
          setSyncStatus('success')
          loadCodespaces() // Refresh list only once connected
        } else {
          setTimeout(() => pollForReady(attempts + 1), 1000)
        }
      }

      setTimeout(() => pollForReady(0), 1000)
    } catch (err) {
      setSyncMessage('Failed to start codespace: ' + err.message)
      setIsLaunchingCodespace(false)
    }
  }

  const handleConnect = async () => {
    if (!selectedCodespace) return
    setIsConnecting(true)
    setSyncMessage('Connecting...')
    setSyncStatus('syncing')

    try {
      // Start the codespace if not already running
      if (selectedCodespace.state !== 'Available') {
        setSyncMessage('Starting codespace...')
        await startCodespace(token, selectedCodespace.name)
      }

      // Poll for sync server to respond
      const pollForReady = async (attempts = 0) => {
        if (attempts > 120) { // Max 2 minutes at 1 second intervals
          setIsConnecting(false)
          setSyncMessage('Connection timed out - codespace may still be starting')
          setSyncStatus('error')
          return
        }

        const connected = await checkSyncServer(syncUrl)

        if (connected) {
          setIsConnected(true)
          setIsConnecting(false)
          setSyncMessage('Connected!')
          setSyncStatus('success')
          // Refresh codespaces list once connected
          loadCodespaces()
        } else {
          setSyncMessage(`Waiting for sync server... (${attempts}s)`)
          setTimeout(() => pollForReady(attempts + 1), 1000)
        }
      }

      setTimeout(() => pollForReady(0), 1000)
    } catch (err) {
      setSyncMessage('Failed to connect: ' + err.message)
      setSyncStatus('error')
      setIsConnecting(false)
    }
  }

  const handleDeleteCodespace = async () => {
    if (!selectedCodespace) return
    if (!confirm(`Delete codespace "${selectedCodespace.name}"?`)) return
    setIsDeletingCodespace(true)
    try {
      await deleteCodespace(token, selectedCodespace.name)
      setSelectedCodespace(null)
      setSyncUrl(null)
      setIsConnected(false)
      await loadCodespaces()
      setSyncMessage('Codespace deleted')
    } catch (err) {
      setSyncMessage('Failed to delete codespace: ' + err.message)
    } finally {
      setIsDeletingCodespace(false)
    }
  }

  const handleResetCodespace = async () => {
    if (!syncUrl || !isConnected) return
    if (!confirm('Reset codespace to latest dev-branch? This will discard all local changes in the codespace.')) return
    setIsResettingCodespace(true)
    setSyncMessage('Resetting codespace...')
    setSyncStatus('syncing')
    try {
      const result = await resetCodespace(syncUrl)
      setSyncMessage('Codespace reset to latest dev-branch')
      setSyncStatus('success')
      // Clear sync state to force fresh sync
      lastSyncRef.current = {}
      setLastSync({})
    } catch (err) {
      setSyncMessage('Failed to reset: ' + err.message)
      setSyncStatus('error')
    } finally {
      setIsResettingCodespace(false)
    }
  }

  const handleSync = useCallback(async () => {
    if (!syncUrl || !projectPath || isSyncing) return

    setIsSyncing(true)
    setSyncStatus('syncing')
    setSyncMessage('Syncing...')

    try {
      const response = await fetch('/api/sync/full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codespace_url: syncUrl,
          last_sync: lastSyncRef.current
        })
      })

      if (!response.ok) {
        throw new Error('Sync failed')
      }

      const result = await response.json()
      const newLastSync = result.scripts_sync?.last_sync || lastSyncRef.current
      lastSyncRef.current = newLastSync
      setLastSync(newLastSync)

      const syncedCount = result.scripts_sync?.synced_files?.length || 0
      if (syncedCount > 0) {
        setSyncStatus('success')
        setSyncMessage(`Synced ${syncedCount} script(s)`)
        if (onSyncComplete) onSyncComplete()
      } else {
        setSyncStatus('success')
        setSyncMessage('Up to date')
      }
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err.message)
    } finally {
      setIsSyncing(false)
    }
  }, [syncUrl, projectPath, isSyncing, onSyncComplete])

  const handlePushScripts = useCallback(async () => {
    if (!syncUrl || !projectPath || isPushing) return

    setIsPushing(true)
    setSyncStatus('syncing')
    setSyncMessage('Pushing scripts...')

    try {
      const response = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codespace_url: syncUrl })
      })

      if (!response.ok) {
        throw new Error('Push failed')
      }

      const result = await response.json()
      const pushedCount = result.pushed_files?.length || 0

      if (pushedCount > 0) {
        setSyncStatus('success')
        setSyncMessage(`Pushed ${pushedCount} script(s)`)
      } else {
        setSyncStatus('success')
        setSyncMessage('No scripts to push')
      }
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err.message)
    } finally {
      setIsPushing(false)
    }
  }, [syncUrl, projectPath, isPushing])

  const copyCode = () => {
    if (deviceCode?.user_code) {
      navigator.clipboard.writeText(deviceCode.user_code)
      setShowCopyToast(true)
      setTimeout(() => setShowCopyToast(false), 3000)
    }
  }

  // Not logged in - show login
  if (!token || !user) {
    return (
      <div className="codespace-sync">
        <div className="sync-section">
          <div className="sync-label">GitHub</div>
          {deviceCode ? (
            <div className="device-code-box">
              <div className="device-code-label">Enter this code on GitHub:</div>
              <div className="device-code">
                {deviceCode.user_code}
              </div>
              <button className="btn-copy-code" onClick={copyCode}>
                Click to Copy
              </button>
              {showCopyToast && (
                <div className="copy-toast">Copied! Go to GitHub!</div>
              )}
              <div className="device-code-waiting">
                <span className="spinner"></span> Waiting for authorization...
              </div>
            </div>
          ) : (
            <button
              className="btn-github"
              onClick={handleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? 'Starting...' : 'Login with GitHub'}
            </button>
          )}
          {loginError && <div className="sync-error">{loginError}</div>}
        </div>
      </div>
    )
  }

  // Minimized view - just sync controls
  if (minimized && isConnected) {
    return (
      <div className="codespace-sync codespace-sync-minimized">
        <div className="sync-status-inline">
          <span className="sync-dot connected"></span>
          <span>Connected</span>
        </div>
        <div className="sync-controls-inline">
          <label className="sync-auto-label">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
            />
            Auto
          </label>
          <button
            className="btn-small"
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <button
            className="btn-small"
            onClick={handlePushScripts}
            disabled={isPushing}
          >
            {isPushing ? 'Pushing...' : 'Push Scripts'}
          </button>
          <button
            className="btn-small btn-warning"
            onClick={handleResetCodespace}
            disabled={isResettingCodespace}
          >
            {isResettingCodespace ? 'Resetting...' : 'Reset'}
          </button>
        </div>
        {syncMessage && (
          <span className={`sync-status-message ${syncStatus}`}>{syncMessage}</span>
        )}
      </div>
    )
  }

  // Logged in - show codespace selector and sync
  return (
    <div className="codespace-sync">
      {/* User info */}
      <div className="sync-section">
        <div className="sync-label">GitHub</div>
        <div className="sync-user">
          <span>@{user.login}</span>
          <button className="btn-link" onClick={handleLogout}>logout</button>
        </div>
      </div>

      {/* Codespace selector */}
      <div className="sync-section">
        <div className="sync-label">Codespace</div>
        <select
          className="sync-select"
          value={selectedCodespace?.name || ''}
          onChange={(e) => {
            const cs = codespaces.find(c => c.name === e.target.value)
            if (cs) handleSelectCodespace(cs)
          }}
          disabled={isLoadingCodespaces}
        >
          <option value="">
            {isLoadingCodespaces ? 'Loading...' : 'Select codespace...'}
          </option>
          {codespaces.map(cs => (
            <option key={cs.name} value={cs.name}>
              {cs.name} ({cs.state})
            </option>
          ))}
        </select>
        <div className="sync-buttons">
          <button
            className="btn-small"
            onClick={loadCodespaces}
            disabled={isLoadingCodespaces}
          >
            Refresh
          </button>
          <button
            className="btn-small"
            onClick={handleCreateCodespace}
            disabled={isCreatingCodespace}
          >
            {isCreatingCodespace ? 'Creating...' : 'New'}
          </button>
          {selectedCodespace && (
            <button
              className="btn-small"
              onClick={() => {
                handleLaunchCodespace()
                if (onLaunchClaude) onLaunchClaude()
              }}
              disabled={isLaunchingCodespace}
            >
              {isLaunchingCodespace ? 'Launching...' : 'Launch'}
            </button>
          )}
          {selectedCodespace && (
            <button
              className="btn-small btn-danger"
              onClick={handleDeleteCodespace}
              disabled={isDeletingCodespace}
            >
              {isDeletingCodespace ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* Sync status */}
      {selectedCodespace && (
        <div className="sync-section">
          <div className="sync-label">Sync Status</div>
          <div className="sync-status-row">
            <div className={`sync-dot ${isConnected ? 'connected' : (isStartingUp || isLaunchingCodespace) ? 'starting' : 'disconnected'}`}></div>
            <span className="sync-status-text">
              {isConnected
                ? 'Connected'
                : isStartingUp
                  ? 'Starting codespace...'
                  : isLaunchingCodespace
                    ? 'Starting...'
                    : selectedCodespace.state !== 'Available'
                      ? 'Codespace Stopped'
                      : 'Waiting for sync server...'}
            </span>
          </div>
          {!isConnected && !isLaunchingCodespace && (
            <div className="sync-message info">
              {selectedCodespace.state !== 'Available'
                ? 'Click "Launch" to restart your codespace'
                : 'Codespace is running but sync server not responding'}
            </div>
          )}
          {isLaunchingCodespace && (
            <div className="sync-message syncing">
              <span className="spinner-small"></span>
              Codespace is starting up...
              <button
                className="btn-cancel-launch"
                onClick={() => setIsLaunchingCodespace(false)}
              >
                Cancel
              </button>
            </div>
          )}
          {isConnected && syncMessage && (
            <div className={`sync-message ${syncStatus}`}>
              {syncStatus === 'syncing' && <span className="spinner-small"></span>}
              {syncMessage}
            </div>
          )}
          <div className="sync-controls">
            <label className="sync-auto-label">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                disabled={!isConnected}
              />
              Auto-sync
            </label>
            <button
              className="btn-small btn-sync"
              onClick={handleSync}
              disabled={!isConnected || isSyncing}
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              className="btn-small"
              onClick={handlePushScripts}
              disabled={!isConnected || isPushing}
            >
              {isPushing ? 'Pushing...' : 'Push Scripts'}
            </button>
            <button
              className="btn-small btn-warning"
              onClick={handleResetCodespace}
              disabled={!isConnected || isResettingCodespace}
            >
              {isResettingCodespace ? 'Resetting...' : 'Reset'}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default CodespaceSync
