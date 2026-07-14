import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Separate build for the Codex/ChatGPT desktop-app PANE.
// Produces ONE self-contained HTML file (all JS/CSS inlined) that the MCP
// server serves as the widget resource. This does NOT touch the normal build
// (vite.config.js -> src/vibefoundry/static/) that the pip package ships.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: '../codex-plugin/vibefoundry/server/pane',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // inline everything, no external asset URLs
    rollupOptions: {
      input: 'index.pane.html',
    },
  },
})
