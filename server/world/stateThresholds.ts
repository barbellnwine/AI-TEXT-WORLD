import type { StateChange } from '../domain/worldTypes.ts'

// Engine values are 0..10; UI values may be 0..100.
export const conditionBand = (value: number) => [3, 5, 7, 9].filter(n => value >= n).length
export function meaningfulChanges(changes: StateChange[]): StateChange[] {
  return changes.filter(c => {
    if (c.from === c.to) return false
    const field = c.field.split(':').at(-1)!
    if (['status', 'flooded', 'power', 'accessible'].includes(field)) return true
    if (['fatigue', 'survival_need', 'hunger', 'thirst', 'wetness', 'coldExposure', 'heatExposure', 'infectionRisk', 'injury', 'health', 'skinCondition'].includes(field)) return conditionBand(Number(c.from)) !== conditionBand(Number(c.to))
    if (c.field.startsWith('place:') || c.field.startsWith('object:')) return Number(c.from) >= 1 && Number(c.to) < 1
    return false
  })
}
export function conditionSummary(name: string, changes: StateChange[]): string {
  const names: Record<string, string> = { fatigue: '피로', survival_need: '허기와 갈증', hunger: '허기', thirst: '갈증', wetness: '젖은 정도', coldExposure: '추위의 영향', heatExposure: '더위의 영향', infectionRisk: '감염 위험', injury: '부상', health: '몸의 쇠약', skinCondition: '피부 상태' }
  const grades = ['낮은 수준', '가벼운 수준', '뚜렷한 수준', '심한 수준', '위험한 수준']
  return changes.map(c => c.field.endsWith(':status') ? `${name}은 부상을 입었다.` : c.field.endsWith(':skinCondition') ? `${name}의 피부 상태가 ${Number(c.to) > Number(c.from) ? '호전되었다' : '악화되었다'}.` : `${name}의 ${names[c.field.split(':').at(-1)!] ?? '상태'}가 ${Number(c.to) > Number(c.from) ? '높아져' : '낮아져'} ${grades[conditionBand(Number(c.to))]}에 이르렀다.`).join(' ')
}
