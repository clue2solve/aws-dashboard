// Shared fetch wrapper that injects Authorization header from sessionStorage.
// On 401, clears the token and redirects to console SSO handoff.

export const TOKEN_STORAGE_KEY = 'c2a_token'
export const CONSOLE_SSO_HANDOFF_URL = 'https://console.control.apps.clue2.app/sso-handoff'

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

// Cross-app fetches to the coordinator (a different host). Same c2a_token
// bearer, but the target isn't the admin backend so apiFetch's 401→SSO
// bounce would loop through the wrong host. Instead we surface the 401 as
// an ApiError and let the caller decide.
export const COORDINATOR_BASE_URL = 'https://coordinator.control.apps.clue2.app'

export async function coordinatorGet<T>(path: string): Promise<T> {
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${COORDINATOR_BASE_URL}${path}`, { method: 'GET', headers })
  if (!response.ok) {
    let body: unknown = null
    try { body = await response.json() } catch { /* ignore */ }
    const message =
      (body as { message?: string } | null)?.message ||
      `Coordinator request failed with status ${response.status}`
    throw new ApiError(response.status, message, body)
  }
  return (await response.json()) as T
}

// Same cross-app fetch idiom as coordinatorGet, but for POST calls that
// carry a JSON body (e.g. minting/revoking invitations). Body may be
// omitted for POST endpoints that don't take one.
export async function coordinatorPost<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')
  const response = await fetch(`${COORDINATOR_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let respBody: unknown = null
    try { respBody = await response.json() } catch { /* ignore */ }
    const message =
      (respBody as { message?: string } | null)?.message ||
      `Coordinator request failed with status ${response.status}`
    throw new ApiError(response.status, message, respBody)
  }
  return (await response.json()) as T
}
