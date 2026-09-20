// GM PROMPT — proposes an external event (weather turning, a resource shock, a discovery) within
// the world's existing bounds. A GM proposal is exactly as untrusted as an AGENT proposal: it must
// pass server/world/worldValidator.ts's validateGmEvent (existence checks) before it can become a
// WorldEvent. This is also the template the operator's "외부 사건 추가" admin feature conceptually
// mirrors (see server/api/worldAdminRoutes.ts + server/domain/worldStore.ts#addOperatorEvent),
// though today that endpoint is a human operator, not this prompt.
//
// WHERE A REAL MODEL CALL GOES: an adapter would send buildGmPrompt(...) to a model, parse a
// {placeId, agentIds, title, summary, importance} shape back out, then run it through
// validateGmEvent exactly like an operator-submitted event is run today.
import type { Faction, Place } from '../domain/worldTypes.ts'
import { WORLD_RULES_TEXT } from './worldRules.ts'

export const GM_PROMPT_VERSION = '1.0.0'

export const GM_PROMPT_INSTRUCTIONS = [
  '당신은 이 세계의 GM(게임 마스터)입니다.',
  '이미 존재하는 장소와 캐릭터만을 대상으로, 세계에 영향을 줄 외부 사건 하나를 제안할 수 있습니다.',
  '존재하지 않는 장소, 인물, 물건, 기술을 새로 만들 수 없습니다.',
  '이 제안은 확정된 사건이 아닙니다 — WORLD ENGINE의 검증을 통과해야만 EVENT LOG에 기록됩니다.',
  '{placeId, agentIds, title, summary, importance} 형식의 JSON으로만 응답하십시오.',
].join('\n')

export function buildGmPrompt(places: Pick<Place, 'id' | 'name'>[], factions: Pick<Faction, 'id' | 'name'>[], operatorIntent: string): string {
  return [
    WORLD_RULES_TEXT,
    GM_PROMPT_INSTRUCTIONS,
    '[EXISTING PLACES]',
    JSON.stringify(places, null, 2),
    '[EXISTING FACTIONS]',
    JSON.stringify(factions, null, 2),
    '[REQUESTED DIRECTION]',
    operatorIntent,
  ].join('\n\n')
}
