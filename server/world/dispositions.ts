export const DISPOSITION_LABELS = { selfInterest: '자기중심성', empathy: '공감', trust: '신뢰 성향', competitiveness: '경쟁심', riskTolerance: '위험 감수', aggression: '공격성', negotiation: '협상 선호', impulsivity: '충동성' } as const
export type Dispositions = Record<keyof typeof DISPOSITION_LABELS, number>
export const DEFAULT_DISPOSITIONS: Dispositions = { selfInterest: 5, empathy: 5, trust: 5, competitiveness: 5, riskTolerance: 5, aggression: 5, negotiation: 5, impulsivity: 5 }
export function parseDispositions(raw: unknown, fallback: Dispositions = DEFAULT_DISPOSITIONS): Dispositions {
  if (raw == null) return { ...fallback }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_dispositions')
  const result = { ...fallback }
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(DEFAULT_DISPOSITIONS, key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) throw new Error('invalid_dispositions')
    result[key as keyof Dispositions] = value
  }
  return result
}
// Stable, diverse defaults for generated characters; never rerolled at decision time.
export function generatedDispositions(seed: string): Dispositions {
  let n = [...seed].reduce((h,c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return Object.fromEntries(Object.keys(DEFAULT_DISPOSITIONS).map(key => { n = (Math.imul(n,1664525)+1013904223) >>> 0; return [key, 2+n%7] })) as Dispositions
}

export interface Motivation {
  id: string; goal: string; targetId?: string; objectId?: string; createdMinute: number; updatedMinute: number
  status: 'active' | 'achieved' | 'blocked' | 'abandoned'; attempts: number; failures: number; evidenceEventIds: string[]; actionIds?: string[]
}
export interface MotivationState { version: 1; longTerm: string; currentId?: string; goals: Motivation[] }
