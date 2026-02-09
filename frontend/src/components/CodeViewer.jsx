import { useEffect, useRef, useState, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'

// Map file extensions to CodeMirror language extensions
const getLanguageExtension = (extension) => {
  switch (extension) {
    case '.js':
    case '.jsx':
      return javascript({ jsx: true })
    case '.ts':
    case '.tsx':
      return javascript({ jsx: true, typescript: true })
    case '.py':
      return python()
    case '.html':
      return html()
    case '.css':
      return css()
    case '.json':
      return json()
    case '.md':
      return markdown()
    default:
      return []
  }
}

const CodeViewer = ({ content, canWrite, onSave, saveStatus }) => {
  const editorRef = useRef(null)
  const viewRef = useRef(null)
  const [isDirty, setIsDirty] = useState(false)
  const originalContent = useRef(content.content)

  // Handle save
  const handleSave = useCallback(() => {
    if (!canWrite || !viewRef.current || !isDirty) return
    const currentContent = viewRef.current.state.doc.toString()
    onSave(currentContent)
    originalContent.current = currentContent
    setIsDirty(false)
  }, [canWrite, onSave, isDirty])

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return

    // Clear previous editor
    if (viewRef.current) {
      viewRef.current.destroy()
    }

    originalContent.current = content.content
    setIsDirty(false)

    const languageExtension = getLanguageExtension(content.extension)

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString()
        setIsDirty(newContent !== originalContent.current)
      }
    })

    const theme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      },
      '.cm-content': {
        padding: '16px 0',
      },
      '.cm-gutters': {
        backgroundColor: '#f8fafc',
        color: '#64748b',
        border: 'none',
        paddingRight: '8px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#e2e8f0',
      },
      '.cm-activeLine': {
        backgroundColor: '#f1f5f9',
      },
      '.cm-line': {
        padding: '0 16px',
      },
    })

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      theme,
      updateListener,
      EditorView.editable.of(canWrite),
    ]

    if (languageExtension) {
      extensions.push(languageExtension)
    }

    const state = EditorState.create({
      doc: content.content,
      extensions,
    })

    viewRef.current = new EditorView({
      state,
      parent: editorRef.current,
    })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
      }
    }
  }, [content.content, content.extension, canWrite])

  // Update content when it changes externally (e.g., file reload)
  useEffect(() => {
    if (viewRef.current && content.content !== originalContent.current && !isDirty) {
      const currentPos = viewRef.current.state.selection.main.head
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: content.content
        },
        selection: { anchor: Math.min(currentPos, content.content.length) }
      })
      originalContent.current = content.content
    }
  }, [content.content, isDirty])

  return (
    <div className="code-editor-container">
      <div className="code-editor-toolbar">
        <span className="code-editor-filename">
          {content.filename}
          {isDirty && <span className="unsaved-dot" title="Unsaved changes" />}
        </span>
        <div className="code-editor-actions">
          {saveStatus === 'saving' && <span className="save-status saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="save-status saved">Saved</span>}
          {saveStatus === 'error' && <span className="save-status error">Save failed</span>}
          {canWrite && (
            <button
              className={`save-btn ${isDirty ? 'active' : ''}`}
              onClick={handleSave}
              disabled={!isDirty}
              title="Save (Cmd+S)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.5 1H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4.5L11.5 1zM3 2h8v3H3V2zm10 12H3v-5h10v5zm0-6H3V6h10v2z"/>
              </svg>
              Save
            </button>
          )}
        </div>
      </div>
      <div className="code-editor-content" ref={editorRef} />
    </div>
  )
}

export default CodeViewer
