export async function api<T>(path: string, method = 'GET', payload?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '요청을 처리할 수 없습니다.')
  return data
}
