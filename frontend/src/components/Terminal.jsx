import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// Fixed terminal size - wider and taller for better Claude Code experience
const FIXED_COLS = 80
const FIXED_ROWS = 73

function Terminal({ syncUrl, isConnected, autoLaunchClaude = false }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const [isTerminalConnected, setIsTerminalConnected] = useState(false)
  const hasLaunchedClaudeRef = useRef(false)

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
      smoothScrollDuration: 100,
      scrollSensitivity: 1,
      rightClickSelectsWord: true,
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

    // Handle Ctrl+C (copy when selection exists) and Ctrl+V (paste)
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

    // Right-click to paste
    const handleContextMenu = (event) => {
      event.preventDefault()
      navigator.clipboard.readText().then(text => {
        if (text && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(text)
        }
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

  if (!isConnected) {
    return null
  }

  return (
    <div className="terminal-container">
      <div className="terminal-status">
        <span className={`terminal-dot ${isTerminalConnected ? 'connected' : ''}`}></span>
        <span>{isTerminalConnected ? 'Connected' : 'Connecting...'}</span>
      </div>
      <div className="terminal-body" ref={terminalRef}></div>
    </div>
  )
}

export default Terminal
