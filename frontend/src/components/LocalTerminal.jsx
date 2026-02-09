import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

const FIXED_COLS = 80
const FIXED_ROWS = 20

function LocalTerminal({ id, onClose }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const wsRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!terminalRef.current) return

    // Create terminal
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 2000,
      cols: FIXED_COLS,
      rows: FIXED_ROWS,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      }
    })

    xterm.open(terminalRef.current)

    // Load WebGL addon
    try {
      const webglAddon = new WebglAddon()
      xterm.loadAddon(webglAddon)
    } catch (e) {
      console.warn('WebGL addon failed to load:', e)
    }

    xtermRef.current = xterm

    // Connect WebSocket to local backend
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      ws.send(JSON.stringify({ type: 'resize', cols: FIXED_COLS, rows: FIXED_ROWS }))
    }

    ws.onmessage = (event) => {
      xterm.write(event.data)
    }

    ws.onclose = () => {
      setIsConnected(false)
      xterm.writeln('\r\n\x1b[31mDisconnected\x1b[0m')
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    // Handle keyboard input
    const inputDisposable = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    return () => {
      inputDisposable.dispose()
      ws.close()
      xterm.dispose()
    }
  }, [])

  return (
    <div className="local-terminal-instance">
      <div className="local-terminal-header">
        <span className={`terminal-status-dot ${isConnected ? 'connected' : ''}`}></span>
        <span className="terminal-id">Terminal {id}</span>
        {onClose && (
          <button className="terminal-close-btn" onClick={onClose}>×</button>
        )}
      </div>
      <div className="local-terminal-content" ref={terminalRef}></div>
    </div>
  )
}

export default LocalTerminal
