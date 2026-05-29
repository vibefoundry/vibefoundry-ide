/**
 * Blocking re-auth modal. Shown when the backend reports a Codex 401
 * (error_code === 'codex_auth_expired') on an /api/ask call.
 *
 * Flow:
 *   1. Backend sees CodexAuthError → SSE error with error_code + question
 *   2. App.jsx opens this modal and remembers the failing question
 *   3. User clicks "Sign in to Codex" → POST /api/auth/codex/login
 *   4. Backend runs `codex login` (browser pops, user OAuths)
 *   5. On {ok:true} → onSuccess() → App.jsx closes the modal and re-sends
 *      the original question
 *
 * Backdrop click + ESC are intentionally disabled — auth is broken, so we
 * don't want the user dismissing the modal and typing into a chat that
 * can't work. The single explicit "Not now" exit clears the modal but
 * does NOT retry the question.
 */
import { useState, useCallback } from 'react'

export default function CodexAuthModal({ onSuccess, onCancel }) {
  const [phase, setPhase] = useState('idle')  // idle | running | error
  const [error, setError] = useState(null)

  const signIn = useCallback(async () => {
    setPhase('running')
    setError(null)
    try {
      const res = await fetch('/api/auth/codex/login', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        onSuccess()
      } else {
        setPhase('error')
        setError(body.error || `sign-in failed (${res.status})`)
      }
    } catch (e) {
      setPhase('error')
      setError(String(e))
    }
  }, [onSuccess])

  return (
    <div className="codex-auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="codex-auth-title">
      <div className="codex-auth-modal">
        <h2 id="codex-auth-title">Sign in to Codex</h2>
        <p className="codex-auth-body">
          Your Codex session has expired. Sign in again to keep using the
          chatbot — a browser tab will open for you to confirm your account.
        </p>

        {phase === 'running' && (
          <p className="codex-auth-status">
            Waiting for you to finish signing in in the browser…
          </p>
        )}
        {phase === 'error' && (
          <p className="codex-auth-error">
            {error}
          </p>
        )}

        <div className="codex-auth-actions">
          <button
            type="button"
            className="codex-auth-cancel"
            onClick={onCancel}
            disabled={phase === 'running'}
          >
            Not now
          </button>
          <button
            type="button"
            className="codex-auth-primary"
            onClick={signIn}
            disabled={phase === 'running'}
            autoFocus
          >
            {phase === 'running' ? 'Signing in…' : 'Sign in to Codex'}
          </button>
        </div>
      </div>
    </div>
  )
}
