// Neutral, host-native theme applied when VibeFoundry runs EMBEDDED in a host
// pane — the Codex/ChatGPT widget or the Claude Code preview. Overrides
// VibeFoundry's blue-tinted standalone theme with a white/neutral-gray palette
// and the system font so the IDE reads as part of the host, not a separate app.
//
// Idempotent: guarded by an id so calling it from multiple entry points (App's
// embedded-mode effect AND pane-main.jsx) only ever injects one style tag.
export function applyPaneTheme() {
  if (typeof document === 'undefined') return
  if (document.getElementById('vf-pane-theme')) return
  const style = document.createElement('style')
  style.id = 'vf-pane-theme'
  style.textContent = `
    :root {
      --color-bg: #ffffff;
      --color-bg-alt: #f9f9f9;
      --color-bg-elevated: #ffffff;
      --color-bg-subtle: #f0f0f0;
      --color-border: #e5e5e5;
      --color-border-hover: #d4d4d4;
      --color-text: #0d0d0d;
      --color-text-muted: #5d5d5d;
      --color-text-subtle: #8f8f8f;
      --color-accent: #0d0d0d;
      --color-accent-hover: #000000;
      --color-accent-subtle: #ececec;
      --font-main: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
    }
  `
  document.head.appendChild(style)

  // Windows display scaling (125%/150%) gets applied twice in embedded panes:
  // the host window is already scaled, then the pane webview scales again by
  // devicePixelRatio — so the IDE renders ~2x the host chrome. Counter-zoom by
  // 1/dpr, Windows only: macOS retina reports dpr 2 but renders at the correct
  // logical size, so it must not be touched.
  const isWindows = /Windows/i.test(navigator.userAgent || '')
  const dpr = window.devicePixelRatio || 1
  if (isWindows && dpr > 1) {
    document.documentElement.style.zoom = String(1 / dpr)
  }
}
