import type { WorldEvent } from './worldTypes.ts'

export function unsupportedNarrative(text: string, events: WorldEvent[]): boolean {
  // Major irreversible claims require structured engine evidence, not a suggestive event name.
  const ending = /(?:세계|시즌|배틀로얄|게임|대회|모든 것)[^.!?\n]{0,50}(?:종료|끝났|끝났다|막을 내렸)|게임 오버|^(?:마침내 |결국 )?(?:종료되|끝났다|끝났)/m
  if (ending.test(text) && !events.some(e => e.cause === 'world_ended')) return true
  if (/(사망|숨졌|목숨을 잃|죽었다|죽었)/.test(text) && !events.some(e => e.stateChanges.some(c => c.field.endsWith(':status') && c.to === 'deceased'))) return true
  return false
}
