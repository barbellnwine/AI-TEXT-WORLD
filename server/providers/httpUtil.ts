import { config } from '../config.ts'
import { MAX_PROVIDER_REQUEST_BYTES } from './requestBody.ts'

export class ProviderCallError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Bounded timeout + bounded retries. Never retries indefinitely: at most `config.maxRetries`
// extra attempts, only for network/5xx failures (not for 4xx / malformed-content errors).
export async function fetchWithLimits(url: string, init: RequestInit, maxRetries = config.maxRetries): Promise<Response> {
  if (!['https://api.openai.com/v1/chat/completions', 'https://api.anthropic.com/v1/messages'].includes(url)) {
    throw new ProviderCallError('INVALID_ENDPOINT', 'unapproved provider endpoint')
  }
  if (typeof init.body !== 'string' || Buffer.byteLength(init.body) > MAX_PROVIDER_REQUEST_BYTES) {
    throw new ProviderCallError('REQUEST_TOO_LARGE', 'provider request exceeds limit')
  }
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
      const chunks: Uint8Array[] = []
      let bytes = 0
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength
          if (bytes > 256_000) {
            controller.abort()
            throw new ProviderCallError('RESPONSE_TOO_LARGE', 'provider response exceeds limit')
          }
          chunks.push(chunk)
        }
      }
      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new ProviderCallError('UPSTREAM_5XX', `upstream ${response.status}`)
        continue
      }
      return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), {
        status: response.status, headers: response.headers,
      })
    } catch (error) {
      if (error instanceof ProviderCallError) throw error
      lastError = error
      const isAbort = error instanceof Error && error.name === 'AbortError'
      if (attempt >= maxRetries) {
        throw new ProviderCallError(isAbort ? 'TIMEOUT' : 'NETWORK_ERROR', isAbort ? 'request timed out' : 'network error')
      }
    } finally { clearTimeout(timer) }
  }
  throw lastError instanceof ProviderCallError ? lastError : new ProviderCallError('UNKNOWN', 'provider call failed')
}
