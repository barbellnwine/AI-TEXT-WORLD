import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from '../config.ts'

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      /* ignore malformed cookie segment */
    }
  }
  return out
}

export const SESSION_COOKIE_NAME = 'aiw_session'

export function setSessionCookie(res: ServerResponse, token: string, maxAgeSeconds: number): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (config.production) attrs.push('Secure')
  res.setHeader('set-cookie', attrs.join('; '))
}

export function clearSessionCookie(res: ServerResponse): void {
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (config.production) attrs.push('Secure')
  res.setHeader('set-cookie', attrs.join('; '))
}
