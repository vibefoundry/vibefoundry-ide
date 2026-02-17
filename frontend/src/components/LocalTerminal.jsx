import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { CanvasAddon } from '@xterm/addon-canvas'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const FONT_SIZE = 14

function LocalTerminal({ projectPath, onTerminalActivity }) {
  const terminalRef = useRef(null)
  const xtermRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [contextMenu, setContextMenu] = useState(null)
  const [restartKey, setRestartKey] = useState(0)
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (!terminalRef.current) return

    // Create terminal
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: FONT_SIZE,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 1000,
      scrollSensitivity: 1,
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

    // Load FitAddon
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    xterm.open(terminalRef.current)
    xtermRef.current = xterm

    // Load canvas addon
    try {
      const canvasAddon = new CanvasAddon()
      xterm.loadAddon(canvasAddon)
    } catch (e) {
      console.warn('Canvas addon failed to load:', e)
    }

    // Helper to fit and notify server
    const doFit = () => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: xterm.cols,
          rows: xterm.rows
        }))
      }
    }

    // ResizeObserver for container size changes
    let resizeObserver = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => doFit())
      resizeObserver.observe(terminalRef.current)
    }

    window.addEventListener('resize', doFit)
    setTimeout(() => doFit(), 100)

    // Keyboard shortcuts
    xterm.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && event.type === 'keydown') {
        const selection = xterm.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then(text => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(text)
          }
        })
        return false
      }
      return true
    })

    // Context menu
    const handleContextMenu = (event) => {
      event.preventDefault()
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: !!xterm.getSelection()
      })
    }
    terminalRef.current.addEventListener('contextmenu', handleContextMenu)

    // Connect to local WebSocket
    let isMounted = true
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`

    const connectWebSocket = () => {
      if (!isMounted) return

      setConnectionStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted) return
        setConnectionStatus('connected')
        xterm.clear()
        ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }))

        // CD into project directory and launch claude
        if (projectPath && !hasInitializedRef.current) {
          hasInitializedRef.current = true
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(`cd "${projectPath}" && clear\n`)
              // Launch claude after a short delay
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send('claude\n')
                }
              }, 500)
            }
          }, 300)
        }
      }

      ws.onmessage = (event) => {
        if (event.data === '{"type":"pong"}') return
        xterm.write(event.data)
        if (onTerminalActivity) onTerminalActivity()
      }

      ws.onclose = () => {
        if (!isMounted) return
        hasInitializedRef.current = false
        setConnectionStatus('disconnected')
        xterm.writeln('\r\n\x1b[33mTerminal disconnected. Click "Restart" to reconnect.\x1b[0m')
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    }

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
      inputDisposable.dispose()
      terminalElement?.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('resize', doFit)
      if (resizeObserver) resizeObserver.disconnect()
      if (wsRef.current) wsRef.current.close()
      xterm.dispose()
    }
  }, [projectPath, restartKey])

  // Close context menu
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  const handleCopy = () => {
    const selection = xtermRef.current?.getSelection()
    if (selection) navigator.clipboard.writeText(selection)
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

  const handleRestart = useCallback(() => {
    hasInitializedRef.current = false
    setRestartKey(prev => prev + 1)
  }, [])

  return (
    <>
      <div className="terminal-toolbar">
        <div className="terminal-status">
          <span className={`terminal-dot ${connectionStatus === 'connected' ? 'connected' : connectionStatus === 'disconnected' ? 'error' : ''}`}></span>
          <span>{connectionStatus === 'connected' ? 'Connected (Local)' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}</span>
        </div>
        <button className="terminal-restart-btn" onClick={handleRestart}>
          Restart Terminal
        </button>
      </div>
      <div className="terminal-body local-terminal-body" ref={terminalRef} />

      {contextMenu && (
        <div
          className="terminal-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={handleCopy} disabled={!contextMenu.hasSelection}>Copy</button>
          <button onClick={handlePaste}>Paste</button>
        </div>
      )}
    </>
  )
}

export default LocalTerminal
