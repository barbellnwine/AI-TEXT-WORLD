import type { IncomingMessage, ServerResponse } from 'node:http'

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
}

type Handler = (ctx: RouteContext) => Promise<void> | void

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function paginationNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback
  const number = Number(value)
  return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback
}

interface Route {
  method: string
  segments: string[]
  handler: Handler
}

function compile(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export class Router {
  private routes: Route[] = []

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, segments: compile(path), handler })
  }

  get(path: string, handler: Handler): void {
    this.add('GET', path, handler)
  }

  post(path: string, handler: Handler): void {
    this.add('POST', path, handler)
  }

  put(path: string, handler: Handler): void {
    this.add('PUT', path, handler)
  }

  delete(path: string, handler: Handler): void {
    this.add('DELETE', path, handler)
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://internal')
    const pathSegments = compile(url.pathname)
    for (const route of this.routes) {
      if (route.method !== req.method) continue
      if (route.segments.length !== pathSegments.length) continue
      const params: Record<string, string> = {}
      let matched = true
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]
        if (seg.startsWith(':')) {
          try {
            params[seg.slice(1)] = decodeURIComponent(pathSegments[i])
          } catch {
            sendJson(res, 400, { error: 'invalid_path' })
            return true
          }
        }
        else if (seg !== pathSegments[i]) {
          matched = false
          break
        }
      }
      if (!matched) continue
      try {
        await route.handler({ req, res, params, query: url.searchParams })
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message })
          return true
        }
        sendJson(res, 500, { error: 'internal_error' })
        console.error('[ai-community] route error', error instanceof Error ? error.message : error)
      }
      return true
    }
    return false
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const maxBytes = 16_384
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume()
    throw new HttpError(413, 'request_body_too_large')
  }
  const text = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const cleanup = () => {
      req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAborted); req.off('error', onError)
    }
    const onData = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        cleanup(); req.resume(); reject(new HttpError(413, 'request_body_too_large'))
      } else chunks.push(chunk)
    }
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
    const onAborted = () => { cleanup(); reject(new HttpError(400, 'request_aborted')) }
    const onError = () => { cleanup(); reject(new HttpError(400, 'request_failed')) }
    req.on('data', onData); req.on('end', onEnd); req.on('aborted', onAborted); req.on('error', onError)
  })
  if (!text) return {} as T
  try {
    const body = JSON.parse(text)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
    return body as T
  } catch {
    throw new HttpError(400, 'invalid_json_body')
  }
}
