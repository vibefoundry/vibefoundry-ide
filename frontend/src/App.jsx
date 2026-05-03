import { useState, useEffect, useRef, useCallback } from 'react'
import { SignedIn, SignedOut, SignIn, useAuth, useUser, useClerk } from '@clerk/clerk-react'
import FileTree from './components/FileTree'
import FileViewer from './components/FileViewer'
import ScriptRunner from './components/ScriptRunner'
import FolderPicker from './components/FolderPicker'
import {
  getFileType,
  getExtension
} from './utils/fileSystem'
import './App.css'

function App() {
  const { getToken } = useAuth()
  const { isSignedIn } = useUser()
  const { signOut } = useClerk()
  const [skipAuth, setSkipAuth] = useState(() => localStorage.getItem('vf_skip_auth') === '1')

  const handleAuthToggle = async () => {
    if (isSignedIn) {
      await signOut()
    }
    localStorage.removeItem('vf_skip_auth')
    setSkipAuth(false)
  }
  const [tree, setTree] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileContent, setFileContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [folderName, setFolderName] = useState(null)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [isResizing, setIsResizing] = useState(false)
  const [canWrite, setCanWrite] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null) // 'saving', 'saved', 'error'
  const [showBuildModal, setShowBuildModal] = useState(false)
  const [isScaffolding, setIsScaffolding] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(() => localStorage.getItem('previewUrl') || '')
  const [deletedFileToast, setDeletedFileToast] = useState(null)
  const [showFolderPicker, setShowFolderPicker] = useState(true)
  const [projectPath, setProjectPath] = useState(null)
  const [scriptRunnerHeight, setScriptRunnerHeight] = useState(null)
  const [isResizingScriptRunner, setIsResizingScriptRunner] = useState(false)
  const [scriptChangeEvent, setScriptChangeEvent] = useState(null)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const mainContentRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const suppressAnimationsRef = useRef(false)
  const autoPreviewDebounceRef = useRef(null)
  const isAutoPreviewingRef = useRef(false)

  // Sidebar resize handlers - use refs to avoid stale closures
  const isResizingRef = useRef(false)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    // Pointer capture routes all subsequent pointer events to `handle` at the
    // browser dispatch level — works across iframes and the Chrome PDF plugin.
    try { handle.setPointerCapture(pointerId) } catch {}
    isResizingRef.current = true
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev) => {
      if (!isResizingRef.current) return
      ev.preventDefault()
      const newWidth = Math.max(200, Math.min(600, ev.clientX))
      setSidebarWidth(newWidth)
    }

    const onEnd = () => {
      isResizingRef.current = false
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { handle.releasePointerCapture(pointerId) } catch {}
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }, [])

  // Script runner resize handler
  const isResizingScriptRunnerRef = useRef(false)

  const handleScriptRunnerResizeStart = useCallback((e) => {
    e.preventDefault()
    const handle = e.currentTarget
    const pointerId = e.pointerId
    try { handle.setPointerCapture(pointerId) } catch {}
    isResizingScriptRunnerRef.current = true
    setIsResizingScriptRunner(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const startY = e.clientY
    const startHeight = scriptRunnerHeight || (mainContentRef.current?.clientHeight / 4) || 200

    const onMove = (ev) => {
      if (!isResizingScriptRunnerRef.current) return
      ev.preventDefault()
      const deltaY = startY - ev.clientY
      const newHeight = Math.max(100, Math.min(600, startHeight + deltaY))
      setScriptRunnerHeight(newHeight)
    }

    const onEnd = () => {
      isResizingScriptRunnerRef.current = false
      setIsResizingScriptRunner(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { handle.releasePointerCapture(pointerId) } catch {}
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
    }

    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
  }, [scriptRunnerHeight])

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

          // Show toast if files were deleted
          if (data.deletedFiles && data.deletedFiles.length > 0) {
            setDeletedFileToast({ filename: data.deletedFiles[0] })
            setTimeout(() => setDeletedFileToast(null), 3000)
          }

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
          } else if (fileData.type === 'image') {
            // Image file - backend returns path for direct serving
            setFileContent({
              type: 'image',
              path: fileData.path,
              filename: fileData.filename,
              extension: fileData.extension
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
          // Bridge profile events to the LargeFilePreviewModal via custom event
          if (data.type === 'profile_progress' || data.type === 'profile_complete') {
            window.dispatchEvent(new MessageEvent('vf-ws-message', { data: event.data }))
          }
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
          } else if (data.type === 'script_change' && data.path) {
            // Forward script changes to ScriptRunner via state
            setScriptChangeEvent({ path: data.path, timestamp: Date.now() })
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
        // Show toast if files were deleted
        if (treeData.deletedFiles && treeData.deletedFiles.length > 0) {
          setDeletedFileToast({ filename: treeData.deletedFiles[0] })
          setTimeout(() => setDeletedFileToast(null), 3000)
        }
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

        // If file is too large, show the large file preview modal
        if (data.type === 'massive_file') {
          setFileContent({
            type: 'massive_file',
            filename: data.filename,
            filePath: data.filePath,
            fileSize: data.fileSize,
            columns: data.columns,
            totalRows: data.totalRows,
            hasProfile: data.hasProfile,
            columnDtypes: data.columnDtypes,
          })
        // If backend already parsed as dataframe, use directly
        } else if (data.type === 'dataframe') {
          setFileContent({
            type: 'dataframe',
            columns: data.columns,
            columnInfo: data.columnInfo,
            data: data.data,
            filename: data.filename,
            filePath: data.filePath,
            totalRows: data.totalRows,
            offset: data.offset,
            limit: data.limit,
            sheetNames: data.sheetNames || null,
            activeSheet: data.activeSheet || null
          })
        } else if (data.type === 'docx') {
          setFileContent({
            type: 'docx',
            paragraphs: data.paragraphs,
            tables: data.tables,
            filename: data.filename
          })
        } else if (data.type === 'image') {
          // Image - backend returns path for direct serving
          setFileContent({
            type: 'image',
            path: data.path,
            filename: data.filename,
            extension: data.extension
          })
        } else if (data.type === 'json') {
          setFileContent({
            type: 'json',
            data: data.data,
            filename: data.filename
          })
        } else if (data.type === 'pdf') {
          setFileContent({
            type: 'pdf',
            path: data.path,
            filename: data.filename
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

  // Switch Excel sheet
  const handleSheetChange = async (sheetName) => {
    if (!selectedFile?.path) return
    setLoading(true)
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(selectedFile.path)}&sheet=${encodeURIComponent(sheetName)}`)
      if (res.ok) {
        const data = await res.json()
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
            limit: data.limit,
            sheetNames: data.sheetNames || null,
            activeSheet: data.activeSheet || null
          })
        }
      }
    } catch (err) {
      console.error('Failed to switch sheet:', err)
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
          // Show toast if files were deleted
          if (data.deletedFiles && data.deletedFiles.length > 0) {
            setDeletedFileToast({ filename: data.deletedFiles[0] })
            setTimeout(() => setDeletedFileToast(null), 3000)
          }
        }
      } catch (err) {
        console.error('Failed to refresh tree:', err)
      }
    }
  }, [projectPath])

  // Build project structure - creates folders and pulls templates via the proxy
  const handleBuildProject = async () => {
    if (!projectPath || !canWrite) return

    setIsScaffolding(true)

    try {
      // Grab the Clerk session JWT so the backend can authenticate against
      // the templates proxy on vibefoundry.ai. If signed out, getToken()
      // returns null — the backend falls back to the public template path.
      const token = await getToken().catch(() => null)

      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/build', { method: 'POST', headers })
      if (!res.ok) {
        throw new Error('Build failed')
      }
      await handleRefresh()
      setShowBuildModal(false)
    } catch (err) {
      console.error('Failed to build project:', err)
    } finally {
      setIsScaffolding(false)
    }
  }

  // Create new folder in project root
  const handleCreateNewFolder = async () => {
    if (!projectPath || !canWrite || !newFolderName.trim()) return

    setCreatingFolder(true)
    try {
      const res = await fetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath,
          name: newFolderName.trim()
        })
      })
      if (res.ok) {
        setNewFolderName('')
        setShowNewFolderModal(false)
        await handleRefresh()
      } else {
        const errData = await res.json()
        console.error('Failed to create folder:', errData.detail)
      }
    } catch (err) {
      console.error('Failed to create folder:', err)
    } finally {
      setCreatingFolder(false)
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
          } else if (data.type === 'image') {
            setFileContent({
              type: 'image',
              path: data.path,
              filename: data.filename,
              extension: data.extension
            })
          } else if (data.type === 'pdf') {
            setFileContent({
              type: 'pdf',
              path: data.path,
              filename: data.filename
            })
          } else {
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
        }
      } catch (err) {
        console.error('Failed to refresh file:', err)
      }
    }
  }

  const activeResizeCursor = isResizing
    ? 'col-resize'
    : isResizingScriptRunner
      ? 'ns-resize'
      : null

  const renderSignInGate = () => (
    <div className="signin-screen">
      <SignIn
        routing="virtual"
        appearance={{
          layout: {
            logoImageUrl: '/vf_logo.png',
            logoPlacement: 'inside',
          },
          variables: {
            colorBackground: '#dbeafe',
            colorText: '#0f172a',
            colorTextSecondary: '#1e3a8a',
            colorPrimary: '#2563eb',
            colorInputBackground: '#ffffff',
            colorInputText: '#0f172a',
            borderRadius: '8px',
          },
          elements: {
            rootBox: { width: '380px' },
            card: {
              // Heavily translucent so the page-background grid reads
              // straight through the card body — only the banner above
              // is opaque blue.
              background: 'rgba(219, 234, 254, 0.22)',
              backdropFilter: 'blur(1px)',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
              border: '1px solid rgba(147, 197, 253, 0.6)',
              padding: '0 28px 24px 28px',
              overflow: 'hidden',
            },
            // Banner = just the logo box, bled to card edges with blue + grid.
            // Sized large for visual weight.
            logoBox: {
              background: '#2563eb',
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.16) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.16) 1px, transparent 1px)
              `,
              backgroundSize: '32px 32px',
              margin: '0 -28px 16px -28px',
              padding: '56px 0',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '14px',
            },
            logoImage: { height: '128px', width: 'auto', filter: 'brightness(0) invert(1)' },
            header: {
              background: 'transparent',
              margin: '0 0 12px 0',
              padding: '0',
              textAlign: 'center',
            },
            headerTitle: { color: '#0f172a', fontSize: '17px', fontWeight: '600', margin: '0' },
            headerSubtitle: { display: 'none' },
            // Tighten the form column — Clerk's defaults leave a lot of vertical air.
            main: { gap: '12px' },
            form: { gap: '12px' },
            formFieldRow: { margin: '0' },
            formField: { margin: '0' },
            formFieldLabel: { display: 'none' },
            formButtonPrimary: { marginTop: '4px' },
            footer: { display: 'none' },
            badge: { display: 'none' },
          },
        }}
      />
      <button
        className="signin-skip"
        onClick={() => {
          localStorage.setItem('vf_skip_auth', '1')
          setSkipAuth(true)
        }}
      >
        Continue without signing in →
      </button>
      <p className="signin-skip-note">Free version. Some templates and features will be limited.</p>
    </div>
  )

  const ideContent = (
    <div className={`app ${isResizing ? 'resizing' : ''}`}>
      {activeResizeCursor && (
        <div className="resize-capture-overlay" style={{ cursor: activeResizeCursor }} />
      )}
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
          <div className="top-bar-section top-bar-right">
            <button
              className="btn-flat"
              onClick={async () => {
                try {
                  await fetch('/api/terminal/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: projectPath })
                  })
                } catch (err) {
                  console.error('Failed to launch terminal:', err)
                }
              }}
            >
              Local Terminal
            </button>
            <button
              className="btn-flat btn-claude"
              onClick={async () => {
                try {
                  await fetch('/api/terminal/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: projectPath, command: 'claude' })
                  })
                } catch (err) {
                  console.error('Failed to launch Claude:', err)
                }
              }}
            >
              Claude
            </button>
            <button
              className="btn-flat btn-codex"
              onClick={async () => {
                try {
                  await fetch('/api/terminal/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: projectPath, command: 'codex' })
                  })
                } catch (err) {
                  console.error('Failed to launch Codex:', err)
                }
              }}
            >
              Codex
            </button>
            <button
              className="btn-flat btn-gemini"
              onClick={async () => {
                try {
                  await fetch('/api/terminal/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: projectPath, command: 'gemini' })
                  })
                } catch (err) {
                  console.error('Failed to launch Gemini:', err)
                }
              }}
            >
              Gemini
            </button>
            <button className="btn-flat btn-auth" onClick={handleAuthToggle}>
              {isSignedIn ? 'Sign out' : 'Sign in'}
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="main-area">
        <div className={`sidebar ${isResizing ? 'resizing' : ''}`} style={{ width: sidebarWidth }}>
          <div className="file-tree-container">
            {tree.length > 0 ? (
              <FileTree
                tree={tree}
                onFileSelect={handleFileSelect}
                selectedPath={selectedFile?.path}
                onFilesModified={handleFilesModified}
                canWrite={canWrite}
                onRefresh={handleRefresh}
                suppressAnimationsRef={suppressAnimationsRef}
                projectPath={projectPath}
              />
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
          <div className="resize-handle" onPointerDown={handleResizeStart} />
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
              onSheetChange={handleSheetChange}
              saveStatus={saveStatus}
              onLargeFilePreviewReady={(data) => {
                setFileContent({
                  type: 'dataframe',
                  columns: data.columns,
                  columnInfo: data.columnInfo,
                  data: data.data,
                  filename: data.filename,
                  filePath: data.filePath,
                  totalRows: data.totalRows,
                  offset: data.offset,
                  limit: data.limit,
                })
              }}
              onLargeFileCancel={() => {
                setFileContent(null)
                setSelectedFile(null)
              }}
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
                onPointerDown={handleScriptRunnerResizeStart}
              />
              <ScriptRunner
                folderName={folderName}
                height={scriptRunnerHeight}
                scriptChangeEvent={scriptChangeEvent}
              />
            </>
          )}
        </div>

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
          onCancel={projectPath ? () => setShowFolderPicker(false) : undefined}
        />
      )}

      {showNewFolderModal && (
        <div className="modal-overlay" onClick={() => !creatingFolder && setShowNewFolderModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Folder</h3>
              <button className="modal-close" onClick={() => !creatingFolder && setShowNewFolderModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Create a new folder in the project root:</p>
              <input
                type="text"
                className="dialog-input"
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) {
                    handleCreateNewFolder()
                  } else if (e.key === 'Escape') {
                    setShowNewFolderModal(false)
                    setNewFolderName('')
                  }
                }}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowNewFolderModal(false); setNewFolderName('') }} disabled={creatingFolder}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateNewFolder} disabled={creatingFolder || !newFolderName.trim()}>
                {creatingFolder ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      {canWrite && tree.length > 0 && (
        <div className="bottom-bar">
          <span className="bottom-bar-text">VibeFoundry IDE v0.1.38</span>
        </div>
      )}

    </div>
  )

  if (skipAuth) return ideContent

  return (
    <>
      <SignedOut>{renderSignInGate()}</SignedOut>
      <SignedIn>{ideContent}</SignedIn>
    </>
  )
}

export default App
