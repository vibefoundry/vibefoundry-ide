/**
 * Auth utilities for VibeFoundry IDE
 */

// Your Netlify site URL (change this after deploying)
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_URL || 'http://localhost:8888'

/**
 * Get stored auth from localStorage
 */
export function getStoredAuth() {
  const github_token = localStorage.getItem('github_token')
  const github_id = localStorage.getItem('github_id')
  const github_username = localStorage.getItem('github_username')

  if (github_token && github_id) {
    return { github_token, github_id, github_username }
  }
  return null
}

/**
 * Store auth in localStorage
 */
export function storeAuth(github_token, github_id, github_username) {
  localStorage.setItem('github_token', github_token)
  localStorage.setItem('github_id', github_id)
  localStorage.setItem('github_username', github_username)
}

/**
 * Clear stored auth
 */
export function clearAuth() {
  localStorage.removeItem('github_token')
  localStorage.removeItem('github_id')
  localStorage.removeItem('github_username')
}

/**
 * Parse auth from URL params (after OAuth redirect)
 */
export function parseAuthFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const github_token = params.get('github_token')
  const github_id = params.get('github_id')
  const github_username = params.get('github_username')

  if (github_token && github_id) {
    // Clear URL params
    window.history.replaceState({}, document.title, window.location.pathname)
    return { github_token, github_id, github_username }
  }
  return null
}

/**
 * Validate user access with backend
 */
export async function validateAccess(github_id) {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_id })
    })

    if (!response.ok) {
      return { valid: false, reason: 'Server error' }
    }

    return await response.json()
  } catch (err) {
    console.error('Validation error:', err)
    return { valid: false, reason: 'Could not connect to server' }
  }
}

/**
 * Get the login URL
 */
export function getLoginUrl() {
  return `${AUTH_BASE_URL}/api/auth-github`
}

/**
 * Fetch user's codespaces from GitHub
 */
export async function fetchCodespaces(github_token) {
  try {
    const response = await fetch('https://api.github.com/user/codespaces', {
      headers: {
        'Authorization': `Bearer ${github_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to fetch codespaces')
    }

    const data = await response.json()
    return data.codespaces || []
  } catch (err) {
    console.error('Failed to fetch codespaces:', err)
    return []
  }
}
