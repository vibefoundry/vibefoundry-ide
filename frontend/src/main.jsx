import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'

const PUBLISHABLE_KEY = 'pk_test_cmFwaWQtcHl0aG9uLTQyLmNsZXJrLmFjY291bnRzLmRldiQ'

const localization = {
  signIn: {
    start: {
      title: 'Sign In For VibeFoundry Premium',
      subtitle: '',
    },
  },
}

createRoot(document.getElementById('root')).render(
  <ClerkProvider publishableKey={PUBLISHABLE_KEY} localization={localization}>
    <App />
  </ClerkProvider>
)

// Register service worker for PWA install support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
