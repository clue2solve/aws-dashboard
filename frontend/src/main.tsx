import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider, createTheme, CssBaseline, Box, Typography, Button } from '@mui/material'
import BlockIcon from '@mui/icons-material/Block'
import { jwtDecode } from 'jwt-decode'
import App from './App'
import {
  getToken,
  setToken,
  clearToken,
  redirectToLogin,
} from './api'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#232F3E', // AWS dark blue
    },
    secondary: {
      main: '#FF9900', // AWS orange
    },
    background: {
      default: '#f5f5f5',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
        },
      },
    },
  },
})

interface JwtClaims {
  sub?: string
  exp?: number
  userType?: string
  email?: string
  givenName?: string
  familyName?: string
}

/**
 * Try to capture a token arriving as either ?token=... (query) or #token=... (fragment).
 * Returns true if a token was consumed and stored.
 */
function consumeIncomingToken(): boolean {
  const url = new URL(window.location.href)

  // Query-string arrival: ?token=...
  const queryToken = url.searchParams.get('token')
  if (queryToken) {
    setToken(queryToken)
    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.toString())
    return true
  }

  // Fragment arrival: #token=... (preferred — keeps JWT out of access logs)
  if (window.location.hash && window.location.hash.length > 1) {
    const hashParams = new URLSearchParams(window.location.hash.slice(1))
    const hashToken = hashParams.get('token')
    if (hashToken) {
      setToken(hashToken)
      hashParams.delete('token')
      const remaining = hashParams.toString()
      window.history.replaceState(
        {},
        '',
        `${url.pathname}${url.search}${remaining ? '#' + remaining : ''}`,
      )
      return true
    }
  }

  return false
}

function decodeToken(token: string): JwtClaims | null {
  try {
    return jwtDecode<JwtClaims>(token)
  } catch {
    return null
  }
}

function isExpired(claims: JwtClaims | null): boolean {
  if (!claims || typeof claims.exp !== 'number') return true
  return claims.exp * 1000 <= Date.now()
}

function AccessDenied({ email }: { email?: string }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 3,
        textAlign: 'center',
        bgcolor: 'background.default',
      }}
    >
      <BlockIcon sx={{ fontSize: 72, color: 'error.main' }} />
      <Typography variant="h4" fontWeight={700}>
        Access denied
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 480 }}>
        The Platform Admin is restricted to SYSTEM administrators.
        {email && (
          <>
            {' '}
            You are signed in as <strong>{email}</strong>.
          </>
        )}
      </Typography>
      <Button
        variant="outlined"
        onClick={() => {
          clearToken()
          redirectToLogin()
        }}
        sx={{ mt: 2 }}
      >
        Sign in with a different account
      </Button>
    </Box>
  )
}

function bootstrapAndRender() {
  // 1. Capture any incoming token from URL (query or fragment).
  consumeIncomingToken()

  // 2. Read stored token.
  let token = getToken()
  let claims = token ? decodeToken(token) : null

  // 3. If missing/invalid/expired, redirect out to console SSO handoff.
  if (!token || !claims || isExpired(claims)) {
    if (token) {
      // Stored token is bad — drop it before bouncing.
      clearToken()
    }
    redirectToLogin()
    return
  }

  // 4. Non-SYSTEM users see a friendly denial.
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  if (claims.userType !== 'SYSTEM') {
    root.render(
      <React.StrictMode>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AccessDenied email={claims.email} />
        </ThemeProvider>
      </React.StrictMode>,
    )
    return
  }

  // 5. Happy path — render the app.
  root.render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  )
}

bootstrapAndRender()
