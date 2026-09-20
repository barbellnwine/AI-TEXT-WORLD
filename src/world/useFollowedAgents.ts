import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'worldFollowedAgents'

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* private-mode browsers may block storage; follows simply won't persist */
  }
}

// No login yet, so "follow" state lives in this browser only — matches the plan to add
// accounts later without changing how pages read follow state (still just this hook).
export function useFollowedAgents() {
  const [followed, setFollowed] = useState<string[]>(() => read())

  useEffect(() => write(followed), [followed])

  const isFollowed = useCallback((id: string) => followed.includes(id), [followed])
  const toggle = useCallback((id: string) => {
    setFollowed(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]))
  }, [])

  return { followed, isFollowed, toggle }
}
