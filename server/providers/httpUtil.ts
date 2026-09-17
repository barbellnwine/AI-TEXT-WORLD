import { config } from '../config.ts'

export class ProviderCallError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Bounded timeout + bounded retries. Never retries indefinitely: at most `config.maxRetries`
// extra attempts, only for network/5xx failures (not for 4xx / malformed-content errors).
export async function fetchWithLimits(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (response.status >= 500 && attempt < config.maxRetries) {
        lastError = new ProviderCallError('UPSTREAM_5XX', `upstream ${response.status}`)
        continue
      }
      return response
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      if (attempt >= config.maxRetries) {
        throw new ProviderCallError(isAbort ? 'TIMEOUT' : 'NETWORK_ERROR', isAbort ? 'request timed out' : 'network error')
      }
    }
  }
  throw lastError instanceof ProviderCallError ? lastError : new ProviderCallError('UNKNOWN', 'provider call failed')
}
