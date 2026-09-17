import type { CSSProperties } from 'react'
type IconName = 'shield' | 'copy' | 'arrow' | 'check' | 'lock' | 'external' | 'file' | 'info' | 'chevron' | 'refresh'
const paths: Record<IconName, string> = {
  shield: 'M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z M8 12l3 3 5-6',
  copy: 'M9 9h11v12H9z M15 9V3H3v12h6', arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6', lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  external: 'M14 3h7v7m0-7L10 14 M10 3H3v18h18v-7',
  file: 'M14 2H5v20h14V7l-5-5Zm0 0v6h5 M8 12h8 M8 16h8',
  info: 'M12 11v6m0-10v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chevron: 'm6 9 6 6 6-6', refresh: 'M20 7v5h-5 M4 17v-5h5 M5.5 7a8 8 0 0 1 13-1L20 12 M4 12l1.5 6a8 8 0 0 0 13-1',
}
export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>
}
export function Emblem() {
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 4 56 18v28L32 60 8 46V18Z" stroke="currentColor" strokeWidth="1.4" /><path d="M32 11 50 22v20L32 53 14 42V22Z" stroke="currentColor" strokeOpacity=".35" /><path d="m21 41 11-23 11 23M25 34h14" stroke="currentColor" strokeWidth="2.5" /><path d="M4 32h8m40 0h8M32 0v8m0 48v8" stroke="currentColor" /></svg>
}