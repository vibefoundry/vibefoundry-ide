import { getLoginUrl } from '../utils/auth'

function LoginScreen({ status, username, onLogout }) {
  const loginUrl = getLoginUrl()

  // Not logged in
  if (status === 'not_logged_in') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>VibeFoundry</h1>
          <p>Data analysis IDE with Claude Code</p>
          <a href={loginUrl} className="btn btn-primary login-btn">
            Login with GitHub
          </a>
        </div>
      </div>
    )
  }

  // Checking access
  if (status === 'checking') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>VibeFoundry</h1>
          <div className="spinner"></div>
          <p>Checking access...</p>
        </div>
      </div>
    )
  }

  // Access denied
  if (status === 'denied') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Access Pending</h1>
          <p>Hi <strong>{username}</strong>, your account is awaiting approval.</p>
          <p className="subtext">Contact the administrator to get access.</p>
          <button onClick={onLogout} className="btn btn-secondary">
            Logout
          </button>
        </div>
      </div>
    )
  }

  // Error
  if (status === 'error') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Connection Error</h1>
          <p>Could not connect to the authentication server.</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary">
            Retry
          </button>
          <button onClick={onLogout} className="btn btn-secondary" style={{ marginLeft: 10 }}>
            Logout
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default LoginScreen
