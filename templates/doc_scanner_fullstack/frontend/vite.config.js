import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// FRONTEND_PORT + BACKEND_PORT are set by the launcher (run_app.sh / .bat),
// which reserves two free ports up front. 0 lets Vite pick its own if not set.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.FRONTEND_PORT) || 0,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || 5000}`,
        changeOrigin: true,
      },
    },
  },
})
