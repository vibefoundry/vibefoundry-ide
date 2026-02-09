/**
 * GitHub OAuth and API utilities
 */

import { API_BASE_URL, GITHUB_CLIENT_ID, GITHUB_SCOPES } from './config'

const REDIRECT_URI = window.location.origin + "/file-preview/"

// Storage keys
const TOKEN_KEY = "vf_github_token"
const USER_KEY = "vf_github_user"

/**
 * Get stored GitHub token
 */
export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * Get stored GitHub user
 */
export function getStoredUser() {
  const user = localStorage.getItem(USER_KEY)
  return user ? JSON.parse(user) : null
}

/**
 * Store GitHub credentials
 */
export function storeCredentials(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/**
 * Clear stored credentials
 */
export function clearCredentials() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/**
 * Start GitHub OAuth flow
 * Opens GitHub authorization page
 */
export function startOAuthFlow() {
  const state = Math.random().toString(36).substring(7)
  sessionStorage.setItem("oauth_state", state)

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state: state
  })

  window.location.href = `https://github.com/login/oauth/authorize?${params}`
}

/**
 * Handle OAuth callback - exchange code for token
 * This needs a backend proxy since GitHub doesn't support CORS for token exchange
 * For now, we'll use the Device Flow instead which works client-side
 */
export async function handleOAuthCallback(code, state) {
  const storedState = sessionStorage.getItem("oauth_state")
  if (state !== storedState) {
    throw new Error("State mismatch - possible CSRF attack")
  }
  sessionStorage.removeItem("oauth_state")

  // Note: This won't work without a backend proxy due to CORS
  // GitHub's token endpoint doesn't allow browser requests
  // We'll need to use Device Flow instead
  throw new Error("OAuth callback requires backend proxy - use Device Flow instead")
}

/**
 * Start Device Flow authentication (via backend API to bypass CORS)
 */
export async function startDeviceFlow() {
  const response = await fetch(`${API_BASE_URL}/api/github/device-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: GITHUB_SCOPES
    })
  })

  if (!response.ok) {
    throw new Error("Failed to start device flow")
  }

  return response.json()
}

/**
 * Poll for Device Flow completion (via backend API to bypass CORS)
 */
export async function pollDeviceFlow(deviceCode) {
  const response = await fetch(`${API_BASE_URL}/api/github/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  })

  return response.json()
}

/**
 * Get current user info
 */
export async function getCurrentUser(token) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error("Failed to get user info")
  }

  return response.json()
}

/**
 * List user's codespaces
 */
export async function listCodespaces(token) {
  // Add timestamp to URL to bust cache
  const url = "https://api.github.com/user/codespaces?_t=" + Date.now()

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error("Failed to list codespaces")
  }

  const data = await response.json()
  return data.codespaces || []
}

/**
 * Get codespace details including forwarded ports
 */
export async function getCodespaceDetails(token, codespaceName) {
  const response = await fetch(`https://api.github.com/user/codespaces/${codespaceName}`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error("Failed to get codespace details")
  }

  return response.json()
}

/**
 * Get forwarded port URL for a codespace
 * Returns the public URL for port 8787 (sync server)
 */
export function getCodespaceSyncUrl(codespace) {
  // GitHub Codespace URL pattern for forwarded ports
  // Format: https://{codespace-name}-{port}.app.github.dev
  const name = codespace.name
  return `https://${name}-8787.app.github.dev`
}

/**
 * Start a stopped codespace
 */
export async function startCodespace(token, codespaceName) {
  const response = await fetch(`https://api.github.com/user/codespaces/${codespaceName}/start`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error("Failed to start codespace")
  }

  return response.json()
}

/**
 * Delete a codespace
 */
export async function deleteCodespace(token, codespaceName) {
  const response = await fetch(`https://api.github.com/user/codespaces/${codespaceName}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!response.ok) {
    throw new Error("Failed to delete codespace")
  }

  return true
}

/**
 * Create a new codespace for vibefoundry-sandbox dev branch
 */
export async function createCodespace(token) {
  // First get the repo ID
  const repoResponse = await fetch("https://api.github.com/repos/vibefoundry/vibefoundry-sandbox", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  })

  if (!repoResponse.ok) {
    throw new Error("Failed to get repository info")
  }

  const repo = await repoResponse.json()

  // Create codespace
  const response = await fetch("https://api.github.com/user/codespaces", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      repository_id: repo.id,
      ref: "dev-branch"
    })
  })

  if (!response.ok) {
    throw new Error("Failed to create codespace")
  }

  return response.json()
}
