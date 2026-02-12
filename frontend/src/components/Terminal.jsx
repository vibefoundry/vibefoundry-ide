import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { CanvasAddon } from '@xterm/addon-canvas'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const FONT_SIZE = 14
const MAX_RECONNECT_ATTEMPTS = 30 // Try for 30 seconds
const RECONNECT_DELAY = 1000 // 1 second between attempts

function Terminal({ syncUrl, isConnected, autoLaunchClaude = false, onTerminalActivity }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)
  const [connectionStatus, setConnectionStatus] = useState('waiting') // waiting, connecting, connected, error
  const hasLaunchedClaudeRef = useRef(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [restartKey, setRestartKey] = useState(0) // Increment to force terminal restart
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef(null)

  useEffect(() => {
    if (!terminalRef.current || !syncUrl) return

    // If sync server not connected yet, show waiting state
    if (!isConnected) {
      setConnectionStatus('waiting')
      return
    }

    // Reset reconnect attempts on fresh connection
    reconnectAttemptsRef.current = 0

    // Create terminal - FitAddon will handle sizing
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: FONT_SIZE,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 1000,
      scrollSensitivity: 1,
      theme: {
        background: '#ffffff',
        foreground: '#1e1e1e',
        cursor: '#1e1e1e',
        selectionBackground: '#b5d5ff',
        black: '#1e1e1e',
        red: '#c91b00',
        green: '#00a600',
        yellow: '#c7c400',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#e74856',
        brightGreen: '#16c60c',
        brightYellow: '#f9f1a5',
        brightBlue: '#3b78ff',
        brightMagenta: '#b4009e',
        brightCyan: '#61d6d6',
        brightWhite: '#ffffff',
      }
    })

    // Load FitAddon first so we can fit before opening
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    xterm.open(terminalRef.current)
    xtermRef.current = xterm

    // Load canvas addon for proper rendering and mouse handling on HiDPI displays
    try {
      const canvasAddon = new CanvasAddon()
      xterm.loadAddon(canvasAddon)
    } catch (e) {
      console.warn('Canvas addon failed to load:', e)
    }

    // Helper to fit and notify server
    const doFit = () => {
      fitAddon.fit()

      // Send new size to server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: xterm.cols,
          rows: xterm.rows
        }))
      }
    }

    // Use ResizeObserver to detect container size changes (more reliable than window resize)
    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        doFit()
      })
      resizeObserver.observe(terminalRef.current)
    }

    // Also listen for window resize as fallback
    const handleResize = () => doFit()
    window.addEventListener('resize', handleResize)

    // Initial fit after a short delay to ensure container is properly sized
    setTimeout(() => doFit(), 100)

    // Handle keyboard shortcuts
    xterm.attachCustomKeyEventHandler((event) => {
      // Ctrl+C or Cmd+C: copy if there's a selection
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && event.type === 'keydown') {
        const selection = xterm.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false // Prevent xterm from handling it
        }
        // No selection - let it pass through as SIGINT
      }

      // Ctrl+V or Cmd+V: paste from clipboard
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(text)
          }
        })
        return false // Prevent xterm from handling it
      }

      return true // Let xterm handle other keys
    })

    // Right-click context menu
    const handleContextMenu = (event) => {
      event.preventDefault()
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: !!xterm.getSelection()
      })
    }
    terminalRef.current.addEventListener('contextmenu', handleContextMenu)

    // Keepalive ping interval
    let pingInterval = null
    let isMounted = true

    // Connect WebSocket with retry logic
    const connectWebSocket = () => {
      if (!isMounted) return

      setConnectionStatus('connecting')
      const wsUrl = syncUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/terminal'
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted) return
        reconnectAttemptsRef.current = 0
        setConnectionStatus('connected')
        xterm.clear()
        // Send current fitted dimensions
        ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }))

        // Start keepalive ping every 25 seconds
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, 25000)

        // Auto-launch Claude Code if requested and not already launched
        if (autoLaunchClaude && !hasLaunchedClaudeRef.current) {
          hasLaunchedClaudeRef.current = true
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('claude\n')
            }
          }, 500)
        }
      }

      ws.onmessage = (event) => {
        // Skip pong messages from keepalive
        if (event.data === '{"type":"pong"}') return
        xterm.write(event.data)
        // Report activity to parent (for detecting when Claude stops streaming)
        if (onTerminalActivity) onTerminalActivity()
      }

      ws.onclose = () => {
        if (!isMounted) return
        hasLaunchedClaudeRef.current = false
        if (pingInterval) {
          clearInterval(pingInterval)
          pingInterval = null
        }

        // Try to reconnect if we haven't exceeded max attempts
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS && isConnected) {
          reconnectAttemptsRef.current++
          setConnectionStatus('connecting')
          reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_DELAY)
        } else {
          setConnectionStatus('error')
          xterm.writeln('\r\n\x1b[33mTerminal disconnected. Click "Restart Virtual Terminal" to reconnect.\x1b[0m')
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        // onclose will handle reconnection
      }
    }

    // Start connection
    connectWebSocket()

    // Handle keyboard input
    const inputDisposable = xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data)
      }
    })

    const terminalElement = terminalRef.current
    return () => {
      isMounted = false
      if (pingInterval) clearInterval(pingInterval)
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      inputDisposable.dispose()
      terminalElement?.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('resize', handleResize)
      if (resizeObserver) resizeObserver.disconnect()
      if (wsRef.current) wsRef.current.close()
      xterm.dispose()
    }
  }, [syncUrl, isConnected, restartKey])

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  const handleCopy = () => {
    const selection = xtermRef.current?.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    }
    setContextMenu(null)
  }

  const handlePaste = () => {
    navigator.clipboard.readText().then(text => {
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(text)
      }
    })
    setContextMenu(null)
  }

  // Restart terminal and launch Claude
  const handleRestart = useCallback(() => {
    hasLaunchedClaudeRef.current = false
    reconnectAttemptsRef.current = 0
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    setRestartKey(prev => prev + 1)
  }, [])

  // Get status text and dot class
  const getStatusDisplay = () => {
    switch (connectionStatus) {
      case 'waiting':
        return { text: 'Waiting for codespace...', dotClass: '' }
      case 'connecting':
        return { text: 'Connecting terminal...', dotClass: '' }
      case 'connected':
        return { text: 'Connected', dotClass: 'connected' }
      case 'error':
        return { text: 'Disconnected', dotClass: 'error' }
      default:
        return { text: 'Unknown', dotClass: '' }
    }
  }

  const { text: statusText, dotClass } = getStatusDisplay()

  return (
    <>
      <div className="terminal-toolbar">
        <div className="terminal-status">
          <span className={`terminal-dot ${dotClass}`}></span>
          <span>{statusText}</span>
        </div>
        <button className="terminal-restart-btn" onClick={handleRestart} disabled={connectionStatus === 'waiting'}>
          Restart Virtual Terminal
        </button>
      </div>
      <div className="terminal-body" ref={terminalRef}>
        {connectionStatus === 'waiting' && (
          <div className="terminal-waiting-message">
            Waiting for codespace to be ready...
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="terminal-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button onClick={handleCopy} disabled={!contextMenu.hasSelection}>
            Copy
          </button>
          <button onClick={handlePaste}>
            Paste
          </button>
        </div>
      )}
    </>
  )
}

export default Terminal
