/**
 * API configuration for VibeFoundry IDE
 */

// Backend API URL - use same origin (served by Python backend)
// In dev mode with Vite proxy, requests go to localhost:8765
export const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// GitHub OAuth Client ID (public, safe to be in frontend)
export const GITHUB_CLIENT_ID = "Ov23liCAx7meEKstteI3"
export const GITHUB_SCOPES = "codespace repo user:email"
