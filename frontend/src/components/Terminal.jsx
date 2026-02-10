import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// Fixed terminal size - wider and taller for better Claude Code experience
const FIXED_COLS = 75
const FIXED_ROWS = 70
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 24

function Terminal({ syncUrl, isConnected, autoLaunchClaude = false }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const [isTerminalConnected, setIsTerminalConnected] = useState(false)
  const hasLaunchedClaudeRef = useRef(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)

  useEffect(() => {
    if (!terminalRef.current || !isConnected || !syncUrl) return

    // Create terminal with fixed size
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 1000,
      cols: FIXED_COLS,
      rows: FIXED_ROWS,
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

    xterm.open(terminalRef.current)
    xtermRef.current = xterm

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

      // Ctrl/Cmd + Plus: zoom in
      if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+') && event.type === 'keydown') {
        event.preventDefault()
        setFontSize(prev => Math.min(prev + 1, MAX_FONT_SIZE))
        return false
      }

      // Ctrl/Cmd + Minus: zoom out
      if ((event.ctrlKey || event.metaKey) && event.key === '-' && event.type === 'keydown') {
        event.preventDefault()
        setFontSize(prev => Math.max(prev - 1, MIN_FONT_SIZE))
        return false
      }

      // Ctrl/Cmd + 0: reset zoom
      if ((event.ctrlKey || event.metaKey) && event.key === '0' && event.type === 'keydown') {
        event.preventDefault()
        setFontSize(DEFAULT_FONT_SIZE)
        return false
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

    // Connect WebSocket
    const wsUrl = syncUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/terminal'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    // Keepalive ping interval
    let pingInterval = null

    ws.onopen = () => {
      setIsTerminalConnected(true)
      xterm.clear()
      ws.send(JSON.stringify({ type: 'resize', cols: FIXED_COLS, rows: FIXED_ROWS }))

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
    }

    ws.onclose = () => {
      setIsTerminalConnected(false)
      hasLaunchedClaudeRef.current = false  // Reset so next launch will auto-run claude
      if (pingInterval) clearInterval(pingInterval)
      xterm.writeln('\r\n\x1b[31mConnection closed\x1b[0m')
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      xterm.writeln('\r\n\x1b[31mConnection error\x1b[0m')
    }

    // Handle keyboard input
    const inputDisposable = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    const terminalElement = terminalRef.current
    return () => {
      if (pingInterval) clearInterval(pingInterval)
      inputDisposable.dispose()
      terminalElement?.removeEventListener('contextmenu', handleContextMenu)
      ws.close()
      xterm.dispose()
    }
  }, [syncUrl, isConnected])

  // Update terminal font size when it changes
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
    }
  }, [fontSize])

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

  if (!isConnected) {
    return null
  }

  const handleZoomIn = () => setFontSize(prev => Math.min(prev + 1, MAX_FONT_SIZE))
  const handleZoomOut = () => setFontSize(prev => Math.max(prev - 1, MIN_FONT_SIZE))
  const handleZoomReset = () => setFontSize(DEFAULT_FONT_SIZE)

  return (
    <div className="terminal-container">
      <div className="terminal-toolbar">
        <div className="terminal-status">
          <span className={`terminal-dot ${isTerminalConnected ? 'connected' : ''}`}></span>
          <span>{isTerminalConnected ? 'Connected' : 'Connecting...'}</span>
        </div>
        <div className="terminal-zoom-controls">
          <button onClick={handleZoomOut} title="Zoom out (Ctrl -)">−</button>
          <span className="zoom-level" onClick={handleZoomReset} title="Reset zoom (Ctrl 0)">{fontSize}px</span>
          <button onClick={handleZoomIn} title="Zoom in (Ctrl +)">+</button>
        </div>
      </div>
      <div className="terminal-body" ref={terminalRef}></div>

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
    </div>
  )
}

export default Terminal
