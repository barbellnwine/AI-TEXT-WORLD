// v4 DIRECTOR — deterministic pacing, no model calls. In a last-survivor world it creates the
// genre's pressure: supply drops draw people to one spot and closing zones push them together.
import { randomUUID } from 'node:crypto'
import type { WorldEvent, WorldState } from '../../domain/worldTypes.ts'
import type { WorldExecution } from '../../domain/worldAgent.ts'
import type { V4State } from './sceneTypes.ts'
import { hurtAgent } from './mortality.ts'

const DIRECTOR_INTERVAL = 120
const ZONE_WARNING_MINUTES = 120

export function isLastSurvivorWorld(world: WorldState, execution: WorldExecution): boolean {
  if (world.engine?.studio?.config.endings.some(e => e.type === 'survivors' && e.value === 1)) return true
  const text = [execution.draft.intro, execution.draft.background, execution.draft.endCondition, execution.draft.backgroundSituation,
    ...execution.rules.filter(r => r.enabled).map(r => `${r.title} ${r.description}`)].join(' ')
  return /최후의\s*(?:1인|한\s*명|생존자)|생존자\s*한\s*명|마지막\s*한\s*명|배틀\s*로얄|battle\s*royale|last\s*(?:one|survivor)/i.test(text)
}

export function ensureV4State(world: WorldState, execution: WorldExecution): V4State {
  const engine = world.engine!
  engine.v4 ??= { version: 1, sceneCount: 0, lastSceneMinute: {}, repeatCount: 0, consecutiveFailures: 0,
    director: { enabled: isLastSurvivorWorld(world, execution), nextEventMinute: engine.minute + DIRECTOR_INTERVAL, dropCount: 0, closures: [], announcements: [] } }
  return engine.v4
}

export function closedPlaceIds(v4: V4State, minute: number): Set<string> {
  return new Set(v4.director.closures.filter(c => c.effectiveMinute <= minute).map(c => c.placeId))
}

function systemEvent(world: WorldState, cause: string, placeId: string, title: string, summary: string, importance: WorldEvent['importance'], agentIds: string[] = [], stateChanges: WorldEvent['stateChanges'] = []): WorldEvent {
  return { id: randomUUID(), type: 'SYSTEM', occurredAt: new Date().toISOString(), day: world.clock.day, worldTime: world.clock.time,
    worldMinute: world.engine!.minute, phase: 'COMPLETED', cause, outcome: 'CONFIRMED', placeId, agentIds, title, summary,
    stateChanges, importance, relatedEventIds: [] }
}

function announce(world: WorldState, v4: V4State, text: string, kind: V4State['director']['announcements'][number]['kind']) {
  v4.director.announcements = [...v4.director.announcements, { minute: world.engine!.minute, text, kind }].slice(-8)
  for (const agent of world.agents.filter(a => a.publicState.status !== 'deceased'))
    agent.journal = [...(agent.journal ?? []), { minute: world.engine!.minute, text: `[방송] ${text}` }].slice(-60)
}

// Advances the director to the current minute. Returns public events to publish.
export function runDirector(world: WorldState, execution: WorldExecution): WorldEvent[] {
  const v4 = ensureV4State(world, execution), engine = world.engine!, events: WorldEvent[] = []
  if (!v4.director.enabled) return events
  const minute = engine.minute
  // Zone warnings become closures; anyone still inside is hurt once per world hour.
  for (const closure of v4.director.closures) {
    if (closure.effectiveMinute > minute) continue
    const place = world.places.find(p => p.id === closure.placeId)
    if (!place) continue
    if (closure.lastDamageMinute < closure.effectiveMinute) {
      closure.lastDamageMinute = closure.effectiveMinute
      const text = `${place.name}이(가) 위험 구역이 되었다. 그곳에 남은 사람은 시간이 지날수록 몸이 상한다.`
      announce(world, v4, text, 'ZONE_CLOSED')
      events.push(systemEvent(world, 'director:zone_closed', place.id, `${place.name} 폐쇄`, text, 'high'))
    }
    while (minute - closure.lastDamageMinute >= 60) {
      closure.lastDamageMinute += 60
      for (const agent of world.agents.filter(a => a.publicState.locationId === place.id && a.publicState.status !== 'deceased')) {
        const changes: WorldEvent['stateChanges'] = []
        // Staying in a closed zone is survivable for a while, then lethal.
        if (hurtAgent(world, agent, 2, changes)) {
          const text = `${agent.name}은(는) 위험 구역이 된 ${place.name}을(를) 끝내 벗어나지 못하고 숨을 거두었다.`
          announce(world, v4, text, 'ZONE_CLOSED')
          events.push(systemEvent(world, 'director:zone_death', place.id, `${agent.name} 사망`, text, 'critical', [agent.id], changes))
          continue
        }
        agent.journal = [...(agent.journal ?? []), { minute, text: `위험 구역에 머무는 동안 몸이 눈에 띄게 상했다. 여기 더 있으면 죽는다.` }].slice(-60)
        events.push(systemEvent(world, 'director:zone_damage', place.id, `${agent.name} · 위험 구역`, `${agent.name}은(는) 위험 구역이 된 ${place.name}에 머물다 몸이 상했다.`, 'normal', [agent.id], changes))
      }
    }
  }
  if (minute < v4.director.nextEventMinute) return events
  v4.director.nextEventMinute = minute + DIRECTOR_INTERVAL
  const closed = closedPlaceIds(v4, minute), warned = new Set(v4.director.closures.map(c => c.placeId))
  const open = world.places.filter(p => !closed.has(p.id) && !warned.has(p.id) && p.accessible !== false)
  if (!open.length) return events
  const pick = <T,>(items: T[], salt: number) => items[(Math.floor(minute / 60) + salt * 7) % items.length]
  const closing = v4.director.dropCount > 0 && v4.director.dropCount % 2 === 1 && open.length > 2
  if (closing) {
    // Close the open place with the fewest people so the zone squeezes survivors together.
    const people = (id: string) => world.agents.filter(a => a.publicState.locationId === id && a.publicState.status !== 'deceased').length
    const target = [...open].sort((a, b) => people(a.id) - people(b.id) || a.connectedPlaceIds.length - b.connectedPlaceIds.length)[0]
    v4.director.closures.push({ placeId: target.id, effectiveMinute: minute + ZONE_WARNING_MINUTES, lastDamageMinute: -1 })
    const text = `섬 전체에 안내 방송이 울렸다. "한 시간 뒤 ${target.name}은(는) 위험 구역이 된다. 그곳에 있는 사람은 떠나라."`
    announce(world, v4, text, 'ZONE_WARNING')
    events.push(systemEvent(world, 'director:zone_warning', target.id, `${target.name} 폐쇄 예고`, text, 'high'))
  } else {
    const target = pick(open, v4.director.dropCount)
    const supplies: Array<{ name: string; kind: 'food' | 'water' | 'medicine' | 'tool' }> = [
      { name: '밀봉된 생수병', kind: 'water' }, { name: '비상식량 한 봉', kind: 'food' },
      v4.director.dropCount % 2 === 0 ? { name: '붕대와 소독약', kind: 'medicine' } : { name: '사냥용 칼', kind: 'tool' },
    ]
    for (const s of supplies) engine.objects.push({ id: `drop-${randomUUID()}`, name: s.name, kind: s.kind, quantity: 1, condition: 'intact',
      location: { kind: 'place', id: target.id }, ...(s.kind === 'tool' ? { physical: { material: 'metal', edge: 'sharp' as const, portable: true, attackPower: 3, cover: 0 } } : {}) })
    const text = `낙하산을 단 보급 상자가 ${target.name} 쪽으로 떨어졌다. 섬 어디서든 그 낙하산이 보였다.`
    announce(world, v4, text, 'SUPPLY_DROP')
    events.push(systemEvent(world, 'director:supply_drop', target.id, `${target.name} 보급 투하`, text, 'high'))
  }
  v4.director.dropCount++
  return events
}
