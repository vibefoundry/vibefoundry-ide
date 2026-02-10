import { useState, useEffect, useRef, useCallback } from 'react'
import FileTree from './components/FileTree'
import FileViewer from './components/FileViewer'
import CodespaceSync from './components/CodespaceSync'
import Terminal from './components/Terminal'
import ScriptRunner from './components/ScriptRunner'
import FolderPicker from './components/FolderPicker'
import LoginScreen from './components/LoginScreen'
import {
  getFileType,
  getExtension
} from './utils/fileSystem'
import { listAllFiles, getFile, syncScriptsToLocal, pushScriptsToCodespace } from './utils/codespaceSync'
import { getStoredUser } from './utils/github'
import { validateAccess } from './utils/auth'
import './App.css'

function App() {
  const [tree, setTree] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [folderName, setFolderName] = useState(null)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [isResizing, setIsResizing] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [syncControlsCollapsed, setSyncControlsCollapsed] = useState(false) // Collapse sidebar sync controls
  const [canWrite, setCanWrite] = useState(false) // Track if we have write access
  const [saveStatus, setSaveStatus] = useState(null) // 'saving', 'saved', 'error'
  const [showBuildModal, setShowBuildModal] = useState(false)
  const [isScaffolding, setIsScaffolding] = useState(false)
  const [syncConnection, setSyncConnection] = useState({ syncUrl: null, isConnected: false })
  const [activeTab, setActiveTab] = useState('local') // 'local' or 'codespace'
  const [codespaceFiles, setCodespaceFiles] = useState([])
  const [loadingCodespaceFiles, setLoadingCodespaceFiles] = useState(false)
  const [codespaceExpandedPaths, setCodespaceExpandedPaths] = useState(new Set())
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(() => localStorage.getItem('previewUrl') || '')
  const [isPulling, setIsPulling] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [deletedFileToast, setDeletedFileToast] = useState(null) // { filename } for toast animation
  const [showFolderPicker, setShowFolderPicker] = useState(true)
  const [projectPath, setProjectPath] = useState(null)
  const [scriptRunnerHeight, setScriptRunnerHeight] = useState(null) // null = calculate 1/4 on mount
  const [isResizingScriptRunner, setIsResizingScriptRunner] = useState(false)
  const [showCodespaceModal, setShowCodespaceModal] = useState(true)
  const [terminalWidth, setTerminalWidth] = useState(720)
  const [isResizingTerminal, setIsResizingTerminal] = useState(false)

  // Auth state - uses existing GitHub auth from CodespaceSync
  const [authStatus, setAuthStatus] = useState('checking') // 'checking', 'not_logged_in', 'denied', 'allowed', 'error'
  const [authUser, setAuthUser] = useState(null) // GitHub user from github.js

  const rootHandleRef = useRef(null)
  const mainContentRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const suppressAnimationsRef = useRef(false)
  const lastSyncRef = useRef({})
  const autoPreviewDebounceRef = useRef(null)
  const isAutoPreviewingRef = useRef(false)

  // Sidebar resize handlers - use refs to avoid stale closures
  const isResizingRef = useRef(false)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizingRef.current = true
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleResizeMove = (e) => {
      if (!isResizingRef.current) return
      e.preventDefault()
      const newWidth = Math.max(200, Math.min(600, e.clientX))
      setSidebarWidth(newWidth)
    }

    const handleResizeEnd = () => {
      isResizingRef.current = false
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [])

  // Script runner resize handler
  const isResizingScriptRunnerRef = useRef(false)

  const handleScriptRunnerResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizingScriptRunnerRef.current = true
    setIsResizingScriptRunner(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const startY = e.clientY
    const startHeight = scriptRunnerHeight || (mainContentRef.current?.clientHeight / 4) || 200

    const handleResizeMove = (e) => {
      if (!isResizingScriptRunnerRef.current) return
      e.preventDefault()
      const deltaY = startY - e.clientY
      const newHeight = Math.max(100, Math.min(600, startHeight + deltaY))
      setScriptRunnerHeight(newHeight)
    }

    const handleResizeEnd = () => {
      isResizingScriptRunnerRef.current = false
      setIsResizingScriptRunner(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [scriptRunnerHeight])

  // Terminal pane resize handler
  const isResizingTerminalRef = useRef(false)

  const handleTerminalResizeStart = useCallback((e) => {
    e.preventDefault()
    isResizingTerminalRef.current = true
    setIsResizingTerminal(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleResizeMove = (e) => {
      if (!isResizingTerminalRef.current) return
      e.preventDefault()
      const newWidth = Math.max(400, Math.min(1200, window.innerWidth - e.clientX))
      setTerminalWidth(newWidth)
    }

    const handleResizeEnd = () => {
      isResizingTerminalRef.current = false
      setIsResizingTerminal(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [])

  // Check auth on mount - uses existing GitHub auth from github.js
  useEffect(() => {
    const checkAuth = async () => {
      const user = getStoredUser()

      if (!user) {
        // Not logged in yet - let them proceed, they'll login via CodespaceSync
        setAuthStatus('not_logged_in')
        return
      }

      setAuthUser(user)

      // Validate with backend
      const result = await validateAccess(user.id, user.login)
      if (result.valid) {
        setAuthStatus('allowed')
      } else if (result.reason === 'Could not connect to auth server') {
        // Can't reach auth server - allow for now (offline mode)
        setAuthStatus('allowed')
      } else {
        setAuthStatus('denied')
      }
    }

    checkAuth()
  }, [])

  // Re-check auth when user logs in via CodespaceSync
  const handleAuthChange = async (user) => {
    if (!user) {
      setAuthUser(null)
      setAuthStatus('not_logged_in')
      return
    }

    setAuthUser(user)
    setAuthStatus('checking')

    const result = await validateAccess(user.id, user.login)
    if (result.valid) {
      setAuthStatus('allowed')
    } else if (result.reason === 'Could not connect to auth server') {
      setAuthStatus('allowed')
    } else {
      setAuthStatus('denied')
    }
  }

  // Initialize script runner height to 1/4 of main content
  useEffect(() => {
    if (mainContentRef.current && scriptRunnerHeight === null) {
      setScriptRunnerHeight(mainContentRef.current.clientHeight / 4)
    }
  }, [tree, scriptRunnerHeight])

  // Helper to get a hash of the tree structure including modification times
  const getTreeHash = (nodes) => {
    const entries = []
    const collect = (items) => {
      for (const item of items) {
        entries.push(`${item.path}:${item.lastModified || 0}`)
        if (item.children) collect(item.children)
      }
    }
    collect(nodes)
    return entries.sort().join('|')
  }

  // Start polling for file changes
  useEffect(() => {
    if (!projectPath) return

    const poll = async () => {
      try {
        const res = await fetch('/api/files/tree')
        if (res.ok) {
          const data = await res.json()
          const newTree = data.tree

          setTree(prevTree => {
            const oldHash = getTreeHash(prevTree)
            const newHash = getTreeHash([newTree])
            if (oldHash !== newHash) {
              return [newTree]
            }
            return prevTree
          })
        }
      } catch (err) {
        console.error('Polling error:', err)
      }
    }

    pollIntervalRef.current = setInterval(poll, 2000)  // Reduced from 1s to improve PC performance

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [projectPath])

  // WebSocket for auto-preview of new output files (with debouncing + lock)
  useEffect(() => {
    if (!projectPath) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/watch`
    let ws = null
    let pendingFilePath = null // Track the latest file to load
    let reconnectTimeout = null
    let isMounted = true

    const loadOutputFile = async (filePath) => {
      // Skip if already loading or unmounted
      if (isAutoPreviewingRef.current || !isMounted) {
        pendingFilePath = filePath // Queue for later
        return
      }

      isAutoPreviewingRef.current = true
      const fileName = filePath.split('/').pop()
      setSelectedFile({ name: fileName, path: filePath })
      setLoading(true)

      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
        if (res.ok) {
          const fileData = await res.json()
          if (fileData.type === 'dataframe') {
            setFileContent({
              type: 'dataframe',
              columns: fileData.columns,
              columnInfo: fileData.columnInfo,
              data: fileData.data,
              filename: fileData.filename,
              filePath: fileData.filePath,
              totalRows: fileData.totalRows,
              offset: fileData.offset,
              limit: fileData.limit
            })
          } else if (fileData.encoding === 'base64') {
            // Image file
            const ext = fileName.split('.').pop()?.toLowerCase()
            setFileContent({
              type: 'image',
              content: fileData.content,
              filename: fileData.filename,
              extension: ext
            })
          }
        }
      } catch (err) {
        console.error('Failed to load output file:', err)
      } finally {
        setLoading(false)
        isAutoPreviewingRef.current = false

        // If another file was queued while loading, load it after a delay
        if (pendingFilePath && pendingFilePath !== filePath && isMounted) {
          const nextFile = pendingFilePath
          pendingFilePath = null
          setTimeout(() => loadOutputFile(nextFile), 300)
        }
      }
    }

    // Collect files during debounce window, prioritize images over data files
    let pendingPreviewFiles = []
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp']
    const dataExts = ['csv', 'xlsx', 'xls']
    const allPreviewExts = [...imageExts, ...dataExts]

    const pickBestFile = (files) => {
      // Prioritize images over data files
      const images = files.filter(f => {
        const ext = f.split('.').pop()?.toLowerCase()
        return imageExts.includes(ext)
      })
      if (images.length > 0) return images[images.length - 1] // Latest image
      return files[files.length - 1] // Latest file
    }

    const connect = () => {
      if (!isMounted) return

      ws = new WebSocket(wsUrl)

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'output_file_change' && data.path) {
            const filePath = data.path
            const fileName = filePath.split('/').pop()

            // Auto-preview data files and images
            const ext = fileName.split('.').pop()?.toLowerCase()
            if (allPreviewExts.includes(ext)) {
              // Add to pending files
              if (!pendingPreviewFiles.includes(filePath)) {
                pendingPreviewFiles.push(filePath)
              }

              // Debounce: wait for all files, then pick the best one
              if (autoPreviewDebounceRef.current) {
                clearTimeout(autoPreviewDebounceRef.current)
              }
              autoPreviewDebounceRef.current = setTimeout(() => {
                autoPreviewDebounceRef.current = null
                const bestFile = pickBestFile(pendingPreviewFiles)
                pendingPreviewFiles = []
                loadOutputFile(bestFile)
              }, 1000) // Wait 1 second for things to settle
            }
          }
        } catch (e) {
          // Ignore parse errors for keepalive messages
        }
      }

      ws.onclose = () => {
        // Reconnect after delay (only if still mounted)
        if (isMounted) {
          reconnectTimeout = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      if (ws) ws.close()
      if (autoPreviewDebounceRef.current) {
        clearTimeout(autoPreviewDebounceRef.current)
      }
    }
  }, [projectPath])

  // Open folder picker
  const handleOpenFolder = () => {
    setShowFolderPicker(true)
  }

  // Handle folder selection from picker
  const handleFolderSelected = async (path) => {
    setShowFolderPicker(false)
    setLoading(true)

    // Clear existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }

    try {
      // Tell backend about the selected folder
      const selectRes = await fetch('/api/folder/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })

      if (!selectRes.ok) {
        throw new Error('Failed to select folder')
      }

      const selectData = await selectRes.json()
      setProjectPath(path)
      setFolderName(selectData.name || path.split('/').pop())
      setCanWrite(true)

      // Load the file tree
      const treeRes = await fetch('/api/files/tree')
      if (treeRes.ok) {
        const treeData = await treeRes.json()
        setTree([treeData.tree])
      }

      setSelectedFile(null)
      setFileContent(null)
    } catch (err) {
      console.error('Failed to open folder:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = async (file) => {
    if (file.isDirectory) return

    setSelectedFile(file)
    setLoading(true)

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(file.path)}`)
      if (res.ok) {
        const data = await res.json()

        // If backend already parsed as dataframe, use directly
        if (data.type === 'dataframe') {
          setFileContent({
            type: 'dataframe',
            columns: data.columns,
            columnInfo: data.columnInfo,
            data: data.data,
            filename: data.filename,
            filePath: data.filePath,
            totalRows: data.totalRows,
            offset: data.offset,
            limit: data.limit
          })
        } else {
          const fileType = getFileType(file.name)
          const extension = getExtension(file.name)
          setFileContent({
            type: fileType,
            content: data.content,
            filename: data.filename,
            extension,
            encoding: data.encoding
          })
        }
      } else {
        throw new Error('Failed to read file')
      }
    } catch (err) {
      console.error('Failed to read file:', err)
      setFileContent({ type: 'error', message: 'Failed to read file' })
    } finally {
      setLoading(false)
    }
  }

  // Save file content
  const handleFileSave = useCallback(async (newContent) => {
    if (!selectedFile?.path || !canWrite) return

    // Suppress animations during save
    suppressAnimationsRef.current = true
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile.path, content: newContent })
      })

      if (!res.ok) {
        throw new Error('Failed to save file')
      }

      setSaveStatus('saved')
      // Update fileContent to reflect saved state
      setFileContent(prev => ({ ...prev, content: newContent }))
      // Clear status and re-enable animations after delay
      setTimeout(() => {
        setSaveStatus(null)
        suppressAnimationsRef.current = false
      }, 2000)
    } catch (err) {
      console.error('Failed to save file:', err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(null), 3000)
    }
  }, [selectedFile, canWrite])

  // Refresh the file tree (called after file operations)
  const handleRefresh = useCallback(async () => {
    if (projectPath) {
      try {
        const res = await fetch('/api/files/tree')
        if (res.ok) {
          const data = await res.json()
          setTree([data.tree])
        }
      } catch (err) {
        console.error('Failed to refresh tree:', err)
      }
    }
  }, [projectPath])

  // Build project structure (scaffolding is done by backend on folder select)
  const handleBuildProject = async () => {
    if (!projectPath || !canWrite) return

    setIsScaffolding(true)

    try {
      // Re-select folder to trigger scaffolding on backend
      await fetch('/api/folder/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      })
      await handleRefresh()
      setShowBuildModal(false)
    } catch (err) {
      console.error('Failed to scaffold project:', err)
    } finally {
      setIsScaffolding(false)
    }
  }

  // Pull scripts from codespace
  const handlePullScripts = async () => {
    if (!syncConnection.syncUrl || !projectPath || isPulling) return
    setIsPulling(true)
    try {
      const response = await fetch('/api/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codespace_url: syncConnection.syncUrl,
          last_sync: lastSyncRef.current
        })
      })
      if (response.ok) {
        const result = await response.json()
        lastSyncRef.current = result.last_sync || {}
      }
      await handleRefresh()
    } catch (err) {
      console.error('Failed to pull scripts:', err)
    } finally {
      setIsPulling(false)
    }
  }

  // Push scripts to codespace
  const handlePushScripts = async () => {
    if (!syncConnection.syncUrl || !projectPath || isPushing) return
    setIsPushing(true)
    try {
      await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codespace_url: syncConnection.syncUrl })
      })
    } catch (err) {
      console.error('Failed to push scripts:', err)
    } finally {
      setIsPushing(false)
    }
  }

  // Load codespace files when tab is active and connected
  const loadCodespaceFiles = useCallback(async (isInitialLoad = false) => {
    if (!syncConnection.syncUrl || !syncConnection.isConnected) return

    // Only show loading indicator on initial load to prevent tree collapse
    if (isInitialLoad) {
      setLoadingCodespaceFiles(true)
    }
    try {
      const tree = await listAllFiles(syncConnection.syncUrl)
      setCodespaceFiles(tree ? [tree] : [])
    } catch (err) {
      console.error('Failed to load codespace files:', err)
      setCodespaceFiles([])
    } finally {
      if (isInitialLoad) {
        setLoadingCodespaceFiles(false)
      }
    }
  }, [syncConnection.syncUrl, syncConnection.isConnected])

  // Reload codespace files when switching to codespace tab or when connected, with periodic polling
  useEffect(() => {
    if (activeTab !== 'codespace' || !syncConnection.isConnected) {
      return
    }

    // Initial load (show loading indicator)
    loadCodespaceFiles(true)

    // Poll every 3 seconds while tab is active (silent refresh to preserve tree state)
    const interval = setInterval(() => loadCodespaceFiles(false), 3000)

    return () => clearInterval(interval)
  }, [activeTab, syncConnection.isConnected, loadCodespaceFiles])

  // Handle selecting a codespace file
  const handleCodespaceFileSelect = async (file) => {
    if (file.isDirectory) return

    setSelectedFile({ name: file.name, path: `codespace://${file.path}`, isCodespace: true })
    setLoading(true)

    try {
      const fileData = await getFile(syncConnection.syncUrl, file.path)
      const fileType = getFileType(file.name)
      const extension = getExtension(file.name)
      setFileContent({
        type: fileType,
        content: fileData.content,
        filename: file.name,
        extension
      })
    } catch (err) {
      console.error('Failed to read codespace file:', err)
      setFileContent({ type: 'error', message: 'Failed to read file from codespace' })
    } finally {
      setLoading(false)
    }
  }

  // Helper to find a node by path in the tree
  const findNodeByPath = (nodes, targetPath) => {
    for (const node of nodes) {
      if (node.path === targetPath) return node
      if (node.children) {
        const found = findNodeByPath(node.children, targetPath)
        if (found) return found
      }
    }
    return null
  }

  // Handle file modifications - auto-refresh if viewing modified file
  const handleFilesModified = async (modifiedPaths) => {
    if (selectedFile && modifiedPaths.includes(selectedFile.path)) {
      try {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(selectedFile.path)}`)
        if (res.ok) {
          const data = await res.json()
          const fileType = getFileType(selectedFile.name)
          const extension = getExtension(selectedFile.name)
          setFileContent({
            type: fileType,
            content: data.content,
            filename: data.filename,
            extension,
            encoding: data.encoding
          })
        }
      } catch (err) {
        console.error('Failed to refresh file:', err)
      }
    }
  }

  // Show login screen for checking/denied/error states
  // Allow 'not_logged_in' to see the app (they'll login via CodespaceSync)
  if (authStatus === 'checking' || authStatus === 'denied' || authStatus === 'error') {
    return (
      <LoginScreen
        status={authStatus}
        username={authUser?.login}
      />
    )
  }

  return (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
      {/* Unified Top Bar */}
      {canWrite && tree.length > 0 && (
        <div className="top-bar">
          <div className="top-bar-section top-bar-left" style={{ width: sidebarWidth }}>
            <span className="top-bar-title">{folderName || 'Project'}</span>
            <button className="btn-flat" onClick={() => setShowBuildModal(true)}>
              Build
            </button>
          </div>
          <div className="top-bar-section top-bar-center">
            <div className="view-tabs">
              <button
                className={`view-tab ${!showPreview ? 'active' : ''}`}
                onClick={() => setShowPreview(false)}
              >
                Files
              </button>
              <button
                className={`view-tab ${showPreview ? 'active' : ''}`}
                onClick={() => setShowPreview(true)}
              >
                Preview
              </button>
            </div>
            <span className="top-bar-title">
              {showPreview ? '' : (selectedFile?.name || 'No file selected')}
            </span>
          </div>
          <div className="top-bar-section top-bar-right" style={{ width: terminalCollapsed ? 'auto' : terminalWidth }}>
            <span className="top-bar-title">Virtual Terminal</span>
            <div className="codespace-status">
              <span className={`status-dot ${syncConnection.isConnected ? 'connected' : ''}`}></span>
              <span className="status-text">
                {syncConnection.isConnected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <button
              className="btn-flat"
              onClick={() => setShowCodespaceModal(true)}
            >
              Codespace
            </button>
            <button
              className="btn-flat"
              onClick={() => setTerminalCollapsed(!terminalCollapsed)}
            >
              {terminalCollapsed ? 'Expand' : 'Collapse'}
            </button>
            {showTerminal && !terminalCollapsed && syncConnection.syncUrl && (
              <button
                className="btn-flat"
                onClick={() => {
                  setShowTerminal(false)
                  setTimeout(() => setShowTerminal(true), 100)
                }}
              >
                Relaunch
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="main-area">
        <div className={`sidebar ${isResizing ? 'resizing' : ''}`} style={{ width: sidebarWidth }}>
          {/* Repository Tabs */}
          {canWrite && tree.length > 0 && syncConnection.syncUrl && (
            <div className="repo-tabs">
              <button
                className={`repo-tab ${activeTab === 'local' ? 'active' : ''}`}
                onClick={() => setActiveTab('local')}
              >
                Local
              </button>
              <button
                className={`repo-tab ${activeTab === 'codespace' ? 'active' : ''}`}
                onClick={() => setActiveTab('codespace')}
                disabled={!syncConnection.isConnected}
              >
                Codespace
              </button>
            </div>
          )}

          <div className="file-tree-container">
            {tree.length > 0 ? (
              activeTab === 'local' ? (
                <FileTree
                  tree={tree}
                  onFileSelect={handleFileSelect}
                  selectedPath={selectedFile?.path}
                  onFilesModified={handleFilesModified}
                  canWrite={canWrite}
                  onRefresh={handleRefresh}
                  suppressAnimationsRef={suppressAnimationsRef}
                  isConnected={syncConnection.isConnected}
                />
              ) : (
                <div className="codespace-file-list">
                  {loadingCodespaceFiles && codespaceFiles.length === 0 ? (
                    <div className="loading-files">Loading...</div>
                  ) : codespaceFiles.length > 0 ? (
                    <FileTree
                      tree={codespaceFiles}
                      onFileSelect={handleCodespaceFileSelect}
                      selectedPath={selectedFile?.path}
                      canWrite={false}
                      suppressAnimationsRef={suppressAnimationsRef}
                      controlledExpandedPaths={codespaceExpandedPaths}
                      onExpandedPathsChange={setCodespaceExpandedPaths}
                    />
                  ) : (
                    <div className="no-files">No files yet</div>
                  )}
                </div>
              )
            ) : (
              <div className="tree-placeholder">
                <button className="open-folder-btn" onClick={handleOpenFolder}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
                  </svg>
                  Open Folder
                </button>
              </div>
            )}
          </div>
          <div className="resize-handle" onMouseDown={handleResizeStart} />
        </div>

        <div className="main-content" ref={mainContentRef}>
          {/* Data File Deleted Toast - centered in main content */}
          {deletedFileToast && (
            <div className="deleted-file-toast">
              <div className="toast-title">Raw Data Shall Not Pass!</div>
              <div className="toast-icon">🛡️</div>
              <div className="toast-filename">{deletedFileToast.filename} - Deleted</div>
            </div>
          )}

          {showPreview ? (
            <div className="preview-pane">
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
                      // Force iframe refresh by toggling key
                      const iframe = document.querySelector('.preview-iframe')
                      if (iframe) iframe.src = previewUrl
                    }
                  }}
                />
                <button
                  className="btn-flat"
                  onClick={() => {
                    const iframe = document.querySelector('.preview-iframe')
                    if (iframe) iframe.src = previewUrl
                  }}
                >
                  Go
                </button>
              </div>
              {previewUrl ? (
                <iframe
                  className="preview-iframe"
                  src={previewUrl}
                  title="App Preview"
                  style={{ pointerEvents: isResizing ? 'none' : 'auto' }}
                />
              ) : (
                <div className="preview-placeholder">
                  Enter a URL above to preview your app
                </div>
              )}
            </div>
          ) : loading ? (
            <div className="loading">Loading...</div>
          ) : fileContent ? (
            <FileViewer
              content={fileContent}
              canWrite={canWrite && !!selectedFile?.path}
              onSave={handleFileSave}
              saveStatus={saveStatus}
            />
          ) : (
            <div className="placeholder">
              <div className="placeholder-content">
                <svg className="placeholder-icon" width="48" height="48" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
                </svg>
                <p className="placeholder-title">Select a file</p>
              </div>
            </div>
          )}

          {/* Script Runner Panel */}
          {canWrite && tree.length > 0 && (
            <>
              <div
                className="script-runner-resize-handle"
                onMouseDown={handleScriptRunnerResizeStart}
              />
              <ScriptRunner
                folderName={folderName}
                height={scriptRunnerHeight}
              />
            </>
          )}
        </div>

        {/* Terminal Pane */}
        {!terminalCollapsed && (
          <div className={`terminal-pane ${isResizingTerminal ? 'resizing' : ''}`} style={{ width: terminalWidth }}>
            <div className="terminal-resize-handle" onMouseDown={handleTerminalResizeStart} />
            <div className="terminal-main">
              {showTerminal && syncConnection.syncUrl ? (
                <Terminal
                  syncUrl={syncConnection.syncUrl}
                  isConnected={syncConnection.isConnected}
                  autoLaunchClaude={true}
                />
              ) : (
                <div className="terminal-launch-screen">
                  {syncConnection.syncUrl && !showCodespaceModal && (
                    <button
                      className="btn-launch-claude"
                      onClick={() => setShowTerminal(true)}
                      disabled={!syncConnection.isConnected}
                    >
                      Launch Claude Code in Virtual Sandbox
                    </button>
                  )}
                </div>
              )}

              {/* Codespace Modal - always render CodespaceSync to keep sync running */}
              <div
                className="codespace-modal-overlay"
                style={{ display: showCodespaceModal ? 'flex' : 'none' }}
                onClick={() => setShowCodespaceModal(false)}
              >
                <div className="codespace-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="codespace-modal-close" onClick={() => setShowCodespaceModal(false)}>×</button>
                  <CodespaceSync
                    projectPath={projectPath}
                    currentConnection={syncConnection}
                    onSyncComplete={() => {
                      handleRefresh()
                      if (activeTab === 'codespace') loadCodespaceFiles()
                    }}
                    onConnectionChange={(conn) => {
                      setSyncConnection(conn)
                    }}
                    onAuthChange={handleAuthChange}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showBuildModal && (
        <div className="modal-overlay" onClick={() => !isScaffolding && setShowBuildModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Build Project</h3>
              <button className="modal-close" onClick={() => !isScaffolding && setShowBuildModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>This will create the VibeFoundry project structure:</p>
              <ul className="folder-list">
                <li>input_folder/</li>
                <li>output_folder/</li>
                <li>app_folder/ (scripts, meta_data)</li>
                <li>codespace_bridge/</li>
              </ul>
              <p className="modal-note">Skip this if your project is already set up.</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowBuildModal(false)} disabled={isScaffolding}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleBuildProject} disabled={isScaffolding}>
                {isScaffolding ? 'Building...' : 'Build'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFolderPicker && (
        <FolderPicker
          onSelect={handleFolderSelected}
          onCancel={() => setShowFolderPicker(false)}
        />
      )}

      {/* Bottom Bar */}
      {canWrite && tree.length > 0 && (
        <div className="bottom-bar">
          <span className="bottom-bar-text">VibeFoundry IDE v0.1.35</span>
        </div>
      )}

    </div>
  )
}

export default App
