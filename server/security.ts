import type { ServerResponse } from 'node:http'

// Process-wide limit, independent of attacker-controlled forwarded-IP headers.
// This reduces application work, but cannot replace hosting/edge bandwidth limits.
export function createRequestLimiter(capacity = 120, perSecond = 10) {
  let tokens = capacity
  let previous = Date.now()
  return (now = Date.now()): boolean => {
    tokens = Math.min(capacity, tokens + Math.max(0, now - previous) * perSecond / 1000)
    previous = now
    if (tokens < 1) return false
    tokens--
    return true
  }
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
}
