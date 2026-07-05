// Shared fetch wrapper that injects Authorization header from sessionStorage.
// On 401, clears the token and redirects to console SSO handoff.

export const TOKEN_STORAGE_KEY = 'c2a_token'
export const CONSOLE_SSO_HANDOFF_URL = 'https://console.clue2.app/sso-handoff'

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY)
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY)
}

export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href)
  window.location.href = `${CONSOLE_SSO_HANDOFF_URL}?returnTo=${returnTo}`
}

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(input, { ...init, headers })

  if (response.status === 401) {
    // Token missing/expired/invalid — wipe and bounce to console.
    clearToken()
    redirectToLogin()
    throw new ApiError(401, 'Unauthorized — redirecting to login')
  }

  return response
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await apiFetch(url, { method: 'GET' })
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // ignore parse errors
    }
    const message =
      (body as { message?: string } | null)?.message ||
      `Request failed with status ${response.status}`
    throw new ApiError(response.status, message, body)
  }
  return (await response.json()) as T
}
