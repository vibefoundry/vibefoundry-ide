/**
 * API configuration for VibeFoundry IDE
 */

// Check for port in URL params (for hosted frontend connecting to local backend)
function getApiBaseUrl() {
  const params = new URLSearchParams(window.location.search)
  const port = params.get('port')

  if (port) {
    // Hosted frontend connecting to local backend
    return `http://localhost:${port}`
  }

  // Local development or bundled mode - use same origin
  return import.meta.env.VITE_API_URL || ''
}

export const API_BASE_URL = getApiBaseUrl()

// GitHub OAuth Client ID (public, safe to be in frontend)
export const GITHUB_CLIENT_ID = "Ov23liCAx7meEKstteI3"
export const GITHUB_SCOPES = "codespace repo user:email"
