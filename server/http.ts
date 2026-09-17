import type { IncomingMessage, ServerResponse } from 'node:http'

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  params: Record<string, string>
  query: URLSearchParams
}

type Handler = (ctx: RouteContext) => Promise<void> | void

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
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(pathSegments[i])
        else if (seg !== pathSegments[i]) {
          matched = false
          break
        }
      }
      if (!matched) continue
      try {
        await route.handler({ req, res, params, query: url.searchParams })
      } catch (error) {
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
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('invalid_json_body')
  }
}
