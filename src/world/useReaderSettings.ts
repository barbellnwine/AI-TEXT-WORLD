import { useCallback, useEffect, useState } from 'react'

export type ReaderFontSize = 'small' | 'medium' | 'large'
export type ReaderTheme = 'dark' | 'light'

const FONT_SIZE_KEY = 'worldReaderFontSize'
const THEME_KEY = 'worldReaderTheme'
const LAST_READ_KEY = 'worldReaderLastSceneId'

function readString<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key)
    return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private-mode browsers may block storage; the setting simply won't persist */
  }
}

// Reading preferences (font size, paper/ink theme, last-read position) live only in this
// browser — no account system exists yet, matching useFollowedAgents' approach.
export function useReaderSettings() {
  const [fontSize, setFontSizeState] = useState<ReaderFontSize>(() => readString(FONT_SIZE_KEY, 'medium', ['small', 'medium', 'large']))
  const [theme, setThemeState] = useState<ReaderTheme>(() => readString(THEME_KEY, 'dark', ['dark', 'light']))

  useEffect(() => writeString(FONT_SIZE_KEY, fontSize), [fontSize])
  useEffect(() => writeString(THEME_KEY, theme), [theme])

  const setFontSize = useCallback((size: ReaderFontSize) => setFontSizeState(size), [])
  const setTheme = useCallback((next: ReaderTheme) => setThemeState(next), [])

  const getLastReadSceneId = useCallback((): string | null => {
    try {
      return localStorage.getItem(LAST_READ_KEY)
    } catch {
      return null
    }
  }, [])

  const saveLastReadSceneId = useCallback((sceneId: string) => writeString(LAST_READ_KEY, sceneId), [])

  return { fontSize, setFontSize, theme, setTheme, getLastReadSceneId, saveLastReadSceneId }
}
