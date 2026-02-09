/**
 * Auth utilities for VibeFoundry IDE
 * Uses existing GitHub auth from github.js, just adds validation
 */

// Your Netlify site URL (change this after deploying)
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:8888'

/**
 * Validate user access with backend
 * @param {string} github_id - User's GitHub ID
 * @param {string} github_username - User's GitHub username (optional, for registration)
 */
export async function validateAccess(github_id, github_username = null) {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        github_id: github_id.toString(),
        github_username
      })
    })

    if (!response.ok) {
      return { valid: false, reason: 'Server error' }
    }

    return await response.json()
  } catch (err) {
    console.error('Validation error:', err)
    return { valid: false, reason: 'Could not connect to auth server' }
  }
}

/**
 * Get the auth base URL
 */
export function getAuthUrl() {
  return AUTH_BASE_URL
}
