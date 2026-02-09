import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { createFolder, createFile, deleteEntry, renameEntry, moveEntry, getParentHandle } from '../utils/fileSystem'

// SVG Icons for different file types
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon folder">
    <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
  </svg>
)

const TextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file txt">
    <path d="M5 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm-.5 2.5A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zM5 8a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1H5z"/>
    <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm10-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z"/>
  </svg>
)

const SpreadsheetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file spreadsheet">
    <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V9H3V2a1 1 0 0 1 1-1h5.5v2zM3 12v-2h2v2H3zm0 1h2v2H4a1 1 0 0 1-1-1v-1zm3 2v-2h3v2H6zm4 0v-2h3v1a1 1 0 0 1-1 1h-2zm3-3h-3v-2h3v2zm-7 0v-2h3v2H6z"/>
  </svg>
)

const PythonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file python">
    <path d="M7.863 0C4.424 0 4.638 1.5 4.638 1.5l.004 1.553h3.284v.466H3.052S0 3.23 0 6.707c0 3.478 2.665 3.354 2.665 3.354h1.59v-1.615s-.086-2.665 2.622-2.665h4.515s2.536.041 2.536-2.453V1.088S14.295 0 7.863 0zM5.699 1.088c.465 0 .842.377.842.842a.843.843 0 0 1-.842.842.843.843 0 0 1-.843-.842c0-.465.378-.842.843-.842z"/>
    <path d="M8.137 16c3.439 0 3.225-1.5 3.225-1.5l-.004-1.553H8.074v-.466h4.874S16 12.77 16 9.293c0-3.478-2.665-3.354-2.665-3.354h-1.59v1.615s.086 2.665-2.622 2.665H4.608s-2.536-.041-2.536 2.453v2.24S1.705 16 8.137 16zm2.164-1.088a.843.843 0 0 1-.842-.842c0-.465.377-.842.842-.842.465 0 .843.377.843.842a.843.843 0 0 1-.843.842z"/>
  </svg>
)

const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file code">
    <path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/>
    <path d="M6.854 4.646a.5.5 0 0 1 0 .708L4.207 8l2.647 2.646a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 0 1 .708 0zm2.292 0a.5.5 0 0 0 0 .708L11.793 8l-2.647 2.646a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708 0z"/>
  </svg>
)

const MarkdownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file markdown">
    <path d="M14 3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h12zM2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2z"/>
    <path fillRule="evenodd" d="M9.146 8.146a.5.5 0 0 1 .708 0L11.5 9.793l1.646-1.647a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 0-.708z"/>
    <path fillRule="evenodd" d="M11.5 5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5z"/>
    <path d="M3.56 11V5.01h1.064l1.216 3.352 1.216-3.352h1.072V11H7.064V6.638L5.848 10H5.04L3.824 6.638V11H3.56z"/>
  </svg>
)

const DefaultFileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="tree-item-icon file default">
    <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
  </svg>
)

const FileIcon = ({ extension, isDirectory }) => {
  if (isDirectory) {
    return <FolderIcon />
  }

  const ext = extension?.toLowerCase()

  if (['.csv', '.xlsx', '.xls', '.parquet'].includes(ext)) {
    return <SpreadsheetIcon />
  }
  if (ext === '.py') {
    return <PythonIcon />
  }
  if (['.txt', '.json', '.log'].includes(ext)) {
    return <TextIcon />
  }
  if (['.md', '.mdx'].includes(ext)) {
    return <MarkdownIcon />
  }
  if (['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.sql', '.sh', '.yaml', '.yml', '.toml'].includes(ext)) {
    return <CodeIcon />
  }

  return <DefaultFileIcon />
}

const TreeNode = ({
  node,
  onFileSelect,
  selectedPath,
  depth = 0,
  newPaths,
  modifiedPaths,
  onAnimationEnd,
  expandedPaths,
  onToggleExpand,
  registerRef,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  canWrite,
  onDragStart,
  onDragEnd,
  onDrop,
  draggedPath,
  dropTargetPath,
  isConnected
}) => {
  const isCodespaceBridge = node.name === 'codespace_bridge' || node.path.includes('/codespace_bridge/')
  const isExpanded = isCodespaceBridge ? false : expandedPaths.has(node.path)
  const itemRef = useRef(null)
  const inputRef = useRef(null)
  const isNew = newPaths.has(node.path)
  const isModified = modifiedPaths.has(node.path)
  const isRenaming = renamingPath === node.path
  const isDragging = draggedPath === node.path
  const isDropTarget = dropTargetPath === node.path && node.isDirectory && !isCodespaceBridge

  useEffect(() => {
    if (itemRef.current && registerRef) {
      registerRef(node.path, itemRef.current)
    }
  }, [node.path, registerRef])

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const handleClick = () => {
    if (isRenaming) return
    if (isCodespaceBridge) return // Don't allow clicking on codespace_bridge
    if (node.isDirectory) {
      onToggleExpand(node.path)
    } else {
      onFileSelect(node)
    }
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (isCodespaceBridge) return // No context menu for codespace_bridge
    onContextMenu(e, node)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onRenameSubmit()
    } else if (e.key === 'Escape') {
      onRenameCancel()
    }
  }

  const handleDragStart = (e) => {
    if (!canWrite || isRenaming || isCodespaceBridge) {
      e.preventDefault()
      return
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.path)
    onDragStart(node)
  }

  const isValidDropTarget = (targetPath, dragPath) => {
    if (!targetPath || !dragPath) return false
    // Can't drop on itself
    if (targetPath === dragPath) return false
    // Can't drop a folder into its own descendant
    if (targetPath.startsWith(dragPath + '/')) return false
    // Can't drop into current parent (already there)
    const dragParent = dragPath.substring(0, dragPath.lastIndexOf('/'))
    if (targetPath === dragParent) return false
    return true
  }

  const handleDragOver = (e) => {
    if (!canWrite || !draggedPath) return
    if (node.isDirectory && isValidDropTarget(node.path, draggedPath)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const handleDragEnter = (e) => {
    if (!canWrite || !draggedPath) return
    if (node.isDirectory && isValidDropTarget(node.path, draggedPath)) {
      e.preventDefault()
      onDrop(node, true) // true = just hovering, set as drop target
    }
  }

  const handleDragLeave = (e) => {
    // Only clear if leaving the actual element (not entering a child)
    const rect = itemRef.current?.getBoundingClientRect()
    if (rect) {
      const { clientX, clientY } = e
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        if (dropTargetPath === node.path) {
          onDrop(null, true)
        }
      }
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!canWrite || !draggedPath) return
    if (node.isDirectory && isValidDropTarget(node.path, draggedPath)) {
      onDrop(node, false) // false = actual drop
    }
  }

  const handleDragEnd = () => {
    onDragEnd()
  }

  const isSelected = selectedPath === node.path

  return (
    <div>
      <div
        ref={itemRef}
        className={`tree-item ${isSelected ? 'selected' : ''} ${isNew ? 'new-item' : ''} ${isModified ? 'modified-item' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''} ${isCodespaceBridge ? 'locked' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onAnimationEnd={onAnimationEnd}
        draggable={canWrite && !isRenaming && !isCodespaceBridge}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        data-path={node.path}
      >
        {node.isDirectory && (
          <span className="tree-toggle">{isExpanded ? '▼' : '▶'}</span>
        )}
        {!node.isDirectory && <span className="tree-toggle"></span>}
        <FileIcon extension={node.extension} isDirectory={node.isDirectory} />
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            className="rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="tree-item-name">{node.name}</span>
            {node.name === 'app_folder' && isConnected && (
              <span className="tree-item-indicator connected-dot" title="Connected to Codespace"></span>
            )}
            {(node.name === 'input_folder' || node.name === 'output_folder') && (
              <span className="tree-item-indicator lock-icon" title="Local only">🔒</span>
            )}
          </>
        )}
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child, index) => (
            <TreeNode
              key={child.path || index}
              node={child}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              depth={depth + 1}
              newPaths={newPaths}
              modifiedPaths={modifiedPaths}
              onAnimationEnd={onAnimationEnd}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              registerRef={registerRef}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              renameValue={renameValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              canWrite={canWrite}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              draggedPath={draggedPath}
              dropTargetPath={dropTargetPath}
              isConnected={isConnected}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Helper to collect all paths and their modification times from tree
const collectPathsWithMeta = (nodes, result = { paths: new Set(), modTimes: new Map() }) => {
  for (const node of nodes) {
    result.paths.add(node.path)
    if (!node.isDirectory && node.lastModified) {
      result.modTimes.set(node.path, node.lastModified)
    }
    if (node.children) {
      collectPathsWithMeta(node.children, result)
    }
  }
  return result
}

const getParentPath = (path) => {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

const getAncestorPaths = (path) => {
  const parts = path.split('/')
  const ancestors = []
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'))
  }
  return ancestors
}

const TrashIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
)

// Context Menu Component
const ContextMenu = ({ x, y, node, onClose, onAction, canWrite }) => {
  const menuRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [position, setPosition] = useState({ x, y })

  // Collision detection - adjust position if menu would overflow viewport
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current
      const rect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let newX = x
      let newY = y

      // Check right edge
      if (x + rect.width > viewportWidth - 10) {
        newX = x - rect.width
      }

      // Check bottom edge
      if (y + rect.height > viewportHeight - 10) {
        newY = y - rect.height
      }

      // Ensure not off left/top edge
      newX = Math.max(10, newX)
      newY = Math.max(10, newY)

      if (newX !== position.x || newY !== position.y) {
        setPosition({ x: newX, y: newY })
      }
    }
  }, [x, y])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const isPythonFile = !node.isDirectory && node.extension?.toLowerCase() === '.py'

  const handleCopyRunCommand = async () => {
    const command = `python ${node.name}`
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => {
        onClose()
      }, 800)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Show run command option for Python files even in read-only mode
  if (!canWrite && !isPythonFile) {
    return createPortal(
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: position.x, top: position.y }}
      >
        <div className="context-menu-item disabled">
          Read-only mode
        </div>
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {/* Run command for Python files */}
      {isPythonFile && (
        <>
          <div className="context-menu-item" onClick={handleCopyRunCommand}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
            </svg>
            {copied ? 'Copied!' : 'Copy run command'}
          </div>
          {canWrite && <div className="context-menu-divider" />}
        </>
      )}

      {canWrite && (
        <>
          {node.isDirectory && (
            <>
              {/* Add Data option for all folders */}
              <div className="context-menu-item" onClick={() => onAction('addData', node)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                  <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H4zm0 1h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
                </svg>
                Add Data
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => onAction('newFolder', node)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3H14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H2.5a2 2 0 0 1-2-2V3.87z"/>
                </svg>
                New Folder
              </div>
              <div className="context-menu-item" onClick={() => onAction('newFile', node)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/>
                </svg>
                New File
              </div>
              <div className="context-menu-divider" />
            </>
          )}
          <div className="context-menu-item" onClick={() => onAction('rename', node)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
            </svg>
            Rename
          </div>
          <div className="context-menu-item danger" onClick={() => onAction('delete', node)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
              <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
            </svg>
            Delete
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

// New Folder/File Dialog
const NewItemDialog = ({ type, parentPath, onSubmit, onCancel }) => {
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (name.trim()) {
      onSubmit(name.trim())
    }
  }

  return createPortal(
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>New {type === 'folder' ? 'Folder' : 'File'}</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={type === 'folder' ? 'Folder name' : 'File name'}
            className="dialog-input"
          />
          <div className="dialog-actions">
            <button type="button" className="dialog-btn cancel" onClick={onCancel}>Cancel</button>
            <button type="submit" className="dialog-btn primary" disabled={!name.trim()}>Create</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

// Delete Confirmation Dialog
const DeleteDialog = ({ node, onConfirm, onCancel }) => {
  if (!node || !node.name) return null
  return createPortal(
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>Delete {node.isDirectory ? 'Folder' : 'File'}</h3>
        <p>Are you sure you want to delete <strong>{node.name}</strong>?</p>
        {node.isDirectory && <p className="dialog-warning">This will delete all contents inside the folder.</p>}
        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onCancel}>Cancel</button>
          <button className="dialog-btn danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Data files that should never show animations (they get auto-deleted)
const FORBIDDEN_DATA_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json']
// Files that should never show animations (internal system files)
const IGNORED_ANIMATION_FILES = ['time_keeper.txt']

const FileTree = ({
  tree,
  onFileSelect,
  selectedPath,
  onFilesModified,
  canWrite,
  rootHandle,
  onRefresh,
  suppressAnimationsRef,
  isConnected,
  // Optional controlled expanded paths (for preserving state across re-renders)
  controlledExpandedPaths,
  onExpandedPathsChange
}) => {
  const [newPaths, setNewPaths] = useState(new Set())
  const [modifiedPathsState, setModifiedPathsState] = useState(new Set())
  const [notifications, setNotifications] = useState([])
  const [internalExpandedPaths, setInternalExpandedPaths] = useState(new Set())

  // Use controlled paths if provided, otherwise use internal state
  const expandedPaths = controlledExpandedPaths !== undefined ? controlledExpandedPaths : internalExpandedPaths
  const setExpandedPaths = onExpandedPathsChange !== undefined ? onExpandedPathsChange : setInternalExpandedPaths
  const [animatingNotifications, setAnimatingNotifications] = useState([])
  const [showTrash, setShowTrash] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [renamingPath, setRenamingPath] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [newItemDialog, setNewItemDialog] = useState(null)
  const [deleteDialog, setDeleteDialog] = useState(null)
  const [draggedPath, setDraggedPath] = useState(null)
  const [draggedNode, setDraggedNode] = useState(null)
  const [dropTargetPath, setDropTargetPath] = useState(null)
  const prevPathsRef = useRef(new Set())
  const prevModTimesRef = useRef(new Map())
  const prevTreeRef = useRef(null)
  const isInitialMount = useRef(true)
  const elementRefs = useRef(new Map())
  const trashRef = useRef(null)
  const isMovingRef = useRef(false) // Track drag-move operations to suppress notifications

  const registerRef = useCallback((path, element) => {
    elementRefs.current.set(path, element)
  }, [])

  const onToggleExpand = useCallback((path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const expandToPath = useCallback((path) => {
    const ancestors = getAncestorPaths(path)
    setExpandedPaths(prev => {
      const next = new Set(prev)
      ancestors.forEach(p => next.add(p))
      return next
    })
  }, [])

  useEffect(() => {
    if (tree.length > 0 && expandedPaths.size === 0) {
      const rootPath = tree[0]?.path
      if (rootPath) {
        setExpandedPaths(new Set([rootPath]))
      }
    }
  }, [tree])

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

  const findNodeInPrevTree = (targetPath) => {
    if (!prevTreeRef.current) return null
    return findNodeByPath(prevTreeRef.current, targetPath)
  }

  // Handle context menu
  const handleContextMenu = (e, node) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  // Handle context menu actions
  const handleContextAction = async (action, node) => {
    closeContextMenu()

    switch (action) {
      case 'rename':
        setRenamingPath(node.path)
        setRenameValue(node.name)
        break

      case 'delete':
        setDeleteDialog(node)
        break

      case 'newFolder':
        setNewItemDialog({ type: 'folder', parentNode: node })
        setExpandedPaths(prev => new Set([...prev, node.path]))
        break

      case 'newFile':
        setNewItemDialog({ type: 'file', parentNode: node })
        setExpandedPaths(prev => new Set([...prev, node.path]))
        break

      case 'addData':
        // Open file picker for multiple files
        try {
          const fileHandles = await window.showOpenFilePicker({
            multiple: true,
            types: [
              {
                description: 'Data files',
                accept: {
                  'text/csv': ['.csv'],
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                  'application/vnd.ms-excel': ['.xls'],
                  'application/json': ['.json'],
                  'text/plain': ['.txt']
                }
              },
              {
                description: 'All files',
                accept: {
                  '*/*': []
                }
              }
            ]
          })

          // Copy each selected file to the target folder
          for (const fileHandle of fileHandles) {
            const file = await fileHandle.getFile()
            const content = await file.arrayBuffer()
            const newFileHandle = await node.handle.getFileHandle(file.name, { create: true })
            const writable = await newFileHandle.createWritable()
            await writable.write(content)
            await writable.close()
          }

          // Expand the folder and refresh
          setExpandedPaths(prev => new Set([...prev, node.path]))
          if (onRefresh) onRefresh()
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.error('Add data failed:', err)
            alert('Failed to add data: ' + err.message)
          }
        }
        break
    }
  }

  // Handle rename submit
  const handleRenameSubmit = async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      setRenameValue('')
      return
    }

    const node = findNodeByPath(tree, renamingPath)
    if (!node || node.name === renameValue.trim()) {
      setRenamingPath(null)
      setRenameValue('')
      return
    }

    try {
      const parentHandle = await getParentHandle(rootHandle, node.path)
      await renameEntry(parentHandle, node.name, renameValue.trim(), node.isDirectory)
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Rename failed:', err)
      alert('Failed to rename: ' + err.message)
    }

    setRenamingPath(null)
    setRenameValue('')
  }

  const handleRenameCancel = () => {
    setRenamingPath(null)
    setRenameValue('')
  }

  // Handle new folder/file creation
  const handleNewItemSubmit = async (name) => {
    if (!newItemDialog) return

    try {
      const parentHandle = newItemDialog.parentNode.handle
      if (newItemDialog.type === 'folder') {
        await createFolder(parentHandle, name)
      } else {
        await createFile(parentHandle, name)
      }
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Create failed:', err)
      alert('Failed to create: ' + err.message)
    }

    setNewItemDialog(null)
  }

  // Handle delete confirmation
  const handleDeleteConfirm = async () => {
    if (!deleteDialog || !deleteDialog.path) return

    try {
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: deleteDialog.path,
          isDirectory: deleteDialog.isDirectory
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Delete failed')
      }

      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Delete failed:', err)
      alert('Failed to delete: ' + err.message)
    }

    setDeleteDialog(null)
  }

  // Drag and drop handlers
  const handleDragStart = useCallback((node) => {
    setDraggedPath(node.path)
    setDraggedNode(node)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null)
    setDraggedNode(null)
    setDropTargetPath(null)
  }, [])

  const handleDrop = useCallback(async (targetNode, isHovering) => {
    // If just hovering, set drop target for visual feedback
    if (isHovering) {
      setDropTargetPath(targetNode ? targetNode.path : null)
      return
    }

    // Actual drop
    if (!draggedNode || !targetNode || !rootHandle) {
      handleDragEnd()
      return
    }

    try {
      // Suppress notifications during move
      isMovingRef.current = true

      const srcParentHandle = await getParentHandle(rootHandle, draggedNode.path)
      const destParentHandle = targetNode.handle

      await moveEntry(srcParentHandle, destParentHandle, draggedNode.name, draggedNode.isDirectory)

      if (onRefresh) onRefresh()

      // Reset after a short delay to allow tree update
      setTimeout(() => {
        isMovingRef.current = false
      }, 600)
    } catch (err) {
      console.error('Move failed:', err)
      alert('Failed to move: ' + err.message)
      isMovingRef.current = false
    }

    handleDragEnd()
  }, [draggedNode, rootHandle, onRefresh, handleDragEnd])

  useEffect(() => {
    const { paths: currentPaths, modTimes: currentModTimes } = collectPathsWithMeta(tree)

    if (isInitialMount.current) {
      isInitialMount.current = false
      prevPathsRef.current = currentPaths
      prevModTimesRef.current = currentModTimes
      prevTreeRef.current = tree
      return
    }

    // Helper to check if path is a data file in app_folder (should be filtered)
    const shouldFilterPath = (path) => {
      if (!path) return false

      // Check for ignored system files (like time_keeper.txt)
      const filename = path.split('/').pop()
      if (IGNORED_ANIMATION_FILES.includes(filename)) return true

      const pathLower = path.toLowerCase()
      const isInAppFolder = pathLower.includes('/app_folder/') ||
                            pathLower.includes('app_folder/') ||
                            pathLower.startsWith('app_folder')
      if (!isInAppFolder) return false

      // Check extension
      const parts = path.split('.')
      if (parts.length < 2) return false
      const ext = '.' + parts[parts.length - 1].toLowerCase()
      return FORBIDDEN_DATA_EXTENSIONS.includes(ext)
    }

    const addedPaths = new Set()
    for (const path of currentPaths) {
      if (!prevPathsRef.current.has(path)) {
        // Filter out data files in app_folder - they get auto-deleted
        if (!shouldFilterPath(path)) {
          addedPaths.add(path)
        }
      }
    }

    const removedPaths = new Set()
    for (const path of prevPathsRef.current) {
      if (!currentPaths.has(path)) {
        // Filter out data files in app_folder
        if (!shouldFilterPath(path)) {
          removedPaths.add(path)
        }
      }
    }

    const modifiedPaths = new Set()
    for (const [path, modTime] of currentModTimes) {
      const prevModTime = prevModTimesRef.current.get(path)
      if (prevModTime && prevModTime !== modTime) {
        // Filter out data files in app_folder
        if (!shouldFilterPath(path)) {
          modifiedPaths.add(path)
        }
      }
    }

    const newNotifications = []

    // Skip notifications and animations during internal operations (drag-move, save, etc.)
    if (isMovingRef.current || suppressAnimationsRef?.current) {
      prevPathsRef.current = currentPaths
      prevModTimesRef.current = currentModTimes
      prevTreeRef.current = tree
      return
    }

    if (addedPaths.size > 0) {
      setNewPaths(addedPaths)
      for (const path of addedPaths) {
        const node = findNodeByPath(tree, path)
        if (node) {
          expandToPath(path)
          newNotifications.push({
            id: Math.random().toString(36).substr(2, 9),
            path: path,
            name: node.name,
            isDirectory: node.isDirectory,
            extension: node.extension,
            action: 'Created!'
          })
        }
      }
    }

    if (modifiedPaths.size > 0) {
      setModifiedPathsState(modifiedPaths)
      if (onFilesModified) {
        onFilesModified(Array.from(modifiedPaths))
      }
      for (const path of modifiedPaths) {
        const node = findNodeByPath(tree, path)
        if (node) {
          expandToPath(path)
          newNotifications.push({
            id: Math.random().toString(36).substr(2, 9),
            path: path,
            name: node.name,
            isDirectory: node.isDirectory,
            extension: node.extension,
            action: 'Modified!'
          })
        }
      }
    }

    if (removedPaths.size > 0) {
      for (const path of removedPaths) {
        const node = findNodeInPrevTree(path)
        if (node) {
          newNotifications.push({
            id: Math.random().toString(36).substr(2, 9),
            path: path,
            name: node.name,
            isDirectory: node.isDirectory,
            extension: node.extension,
            action: 'Deleted!'
          })
        }
      }
    }

    if (newNotifications.length > 0) {
      const hasDeleted = newNotifications.some(n => n.action === 'Deleted!')
      if (hasDeleted) {
        setShowTrash(true)
      }

      setNotifications(newNotifications)

      setTimeout(() => {
        setAnimatingNotifications(newNotifications)
        setNotifications([])
      }, 2000)

      setTimeout(() => {
        setAnimatingNotifications([])
        setNewPaths(new Set())
        setModifiedPathsState(new Set())
        setShowTrash(false)
      }, 3000)
    }

    prevPathsRef.current = currentPaths
    prevModTimesRef.current = currentModTimes
    prevTreeRef.current = tree
  }, [tree, expandToPath])

  const handleAnimationEnd = (path) => {
    setNewPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }

  const getTargetPosition = (path, isDeleted) => {
    if (isDeleted && trashRef.current) {
      const rect = trashRef.current.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }

    const element = elementRefs.current.get(path)
    if (element) {
      const rect = element.getBoundingClientRect()
      return { x: rect.left + 20, y: rect.top + rect.height / 2 }
    }
    return { x: 160, y: window.innerHeight / 2 }
  }

  return (
    <div className="file-tree">
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={closeContextMenu}
          onAction={handleContextAction}
          canWrite={canWrite}
        />
      )}

      {/* New Item Dialog */}
      {newItemDialog && (
        <NewItemDialog
          type={newItemDialog.type}
          parentPath={newItemDialog.parentNode.path}
          onSubmit={handleNewItemSubmit}
          onCancel={() => setNewItemDialog(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteDialog && (
        <DeleteDialog
          node={deleteDialog}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteDialog(null)}
        />
      )}

      {/* Static notifications in center */}
      {notifications.length > 0 && createPortal(
        <div className="file-notification-container">
          <div className="file-notification-grid">
            {notifications.map((notification) => (
              <div key={notification.id} className="file-notification">
                <div className="file-notification-icon">
                  <FileIcon extension={notification.extension} isDirectory={notification.isDirectory} />
                </div>
                <div className="file-notification-info">
                  <span className="file-notification-name">{notification.name}</span>
                  <span className={`file-notification-action ${notification.action === 'Deleted!' ? 'deleted' : notification.action === 'Modified!' ? 'modified' : 'created'}`}>
                    {notification.action}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Trash icon for deleted files */}
      {showTrash && createPortal(
        <div className="trash-icon-container" ref={trashRef}>
          <TrashIcon />
        </div>,
        document.body
      )}

      {/* Flying notifications */}
      {animatingNotifications.length > 0 && createPortal(
        <>
          {animatingNotifications.map((notification) => {
            const isDeleted = notification.action === 'Deleted!'
            const target = getTargetPosition(notification.path, isDeleted)
            const startX = window.innerWidth / 2 + 160
            const startY = window.innerHeight / 2
            const deltaX = target.x - startX
            const deltaY = target.y - startY

            return (
              <div
                key={notification.id}
                className={`file-notification-flying ${isDeleted ? 'deleted' : ''}`}
                style={{
                  '--start-x': `${startX}px`,
                  '--start-y': `${startY}px`,
                  '--delta-x': `${deltaX}px`,
                  '--delta-y': `${deltaY}px`,
                }}
              >
                <div className="file-notification-flying-content">
                  <FileIcon extension={notification.extension} isDirectory={notification.isDirectory} />
                  <span className="file-notification-flying-name">{notification.name}</span>
                </div>
              </div>
            )
          })}
        </>,
        document.body
      )}

      {tree.map((node, index) => (
        <TreeNode
          key={node.path || index}
          node={node}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          depth={0}
          newPaths={newPaths}
          modifiedPaths={modifiedPathsState}
          onAnimationEnd={() => handleAnimationEnd(node.path)}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          registerRef={registerRef}
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={handleRenameCancel}
          canWrite={canWrite}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          draggedPath={draggedPath}
          dropTargetPath={dropTargetPath}
          isConnected={isConnected}
        />
      ))}
    </div>
  )
}

export default FileTree
