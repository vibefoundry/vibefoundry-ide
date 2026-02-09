function LoginScreen({ status, username }) {
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
        </div>
      </div>
    )
  }

  return null
}

export default LoginScreen
