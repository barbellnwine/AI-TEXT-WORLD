// NARRATOR PROMPT — turns a confirmed cluster of WorldEvents into one readable ChronicleEntry
// scene. NARRATOR is a court reporter, not an author: everything it may cite is already true.
// It receives ONLY confirmed events + their public facts (see buildNarratorPrompt below) — never
// HIDDEN WORLD TRUTH, never another prompt's chain-of-thought, never a character's private memory
// that wasn't already made public through an event.
//
// REAL MODEL CALL: server/domain/worldStore.ts's enhanceSceneNarration() sends
// buildNarratorPrompt(events, ...) to a model after a chapter's deterministic scene (from
// narrator.ts's mockNarrator) is already saved, then replaces that scene's title/body in place if
// the call succeeds. The deterministic version is never blocking and always the fallback on any
// failure, budget exhaustion, or demo mode — the world's mechanics never depend on this call.
import type { Agent, Place, WorldEvent } from '../domain/worldTypes.ts'

export const NARRATOR_PROMPT_VERSION = '1.0.0'

export const NARRATOR_PROMPT_INSTRUCTIONS = [
  '당신은 이야기를 창작하는 작가가 아니라, 이미 확정된 사건을 문학적으로 정리하는 기록자(NARRATOR)입니다.',
  '아래에 주어진 CONFIRMED EVENTS에 있는 사실만을 사용하여 하나의 장면으로 정리하십시오.',
  '발생하지 않은 사건을 추가하지 마십시오. 캐릭터의 숨겨진 생각을 임의로 작성하지 마십시오.',
  '존재하지 않는 물건이나 장소를 만들지 마십시오. 행동의 결과를 바꾸지 마십시오.',
  '근거 없는 감정을 사실처럼 단정하지 마십시오. WORLD STATE를 직접 수정할 수 없습니다.',
  '문체는 담백한 소설·기록 문학처럼 쓰십시오: 짧고 명확한 문장, 인물의 이름·행동·결과를 구체적으로 서술하고, 과도한 수식어나 감탄사는 피하십시오.',
  '여러 사건이 있다면 시간 순서로 자연스럽게 이어지는 하나의 장면으로 엮으십시오. 사건을 그대로 나열하지 말고, 사건 사이의 인과와 분위기 변화를 문장으로 연결하십시오.',
  '본문(body)은 2~6개의 짧은 문단으로 나누십시오(문단 사이 빈 줄 하나).',
  '결과에는 반드시 사용한 sourceEventIds 목록을 포함하십시오.',
  '{title, body, sourceEventIds} 형식의 JSON으로만 응답하십시오.',
].join('\n')

export interface NarratorOutput {
  title: string
  body: string
  sourceEventIds: string[]
}

export const NARRATOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { title: { type: 'string' }, body: { type: 'string' }, sourceEventIds: { type: 'array', items: { type: 'string' } } },
  required: ['title', 'body', 'sourceEventIds'],
}

function publicEventView(event: WorldEvent) {
  // Only fields a NARRATOR should ever see — no reasoningSummary-like internal fields exist on
  // WorldEvent today, but this explicit allowlist keeps it that way if the type ever grows one.
  const { id, type, occurredAt, day, placeId, agentIds, title, summary, stateChanges, publicQuote, beforeStateSummary, afterStateSummary } = event
  return { id, type, occurredAt, day, placeId, agentIds, title, summary, stateChanges, publicQuote, beforeStateSummary, afterStateSummary }
}

export function buildNarratorPrompt(events: WorldEvent[], placesById: Map<string, Place>, agentsById: Map<string, Agent>): string {
  const placeNames = Object.fromEntries([...new Set(events.map(e => e.placeId))].map(id => [id, placesById.get(id)?.name ?? id]))
  const agentNames = Object.fromEntries([...new Set(events.flatMap(e => e.agentIds))].map(id => [id, agentsById.get(id)?.name ?? id]))
  return [
    NARRATOR_PROMPT_INSTRUCTIONS,
    '[CONFIRMED EVENTS]',
    JSON.stringify(events.map(publicEventView)),
    '[PLACE NAMES]',
    JSON.stringify(placeNames),
    '[AGENT NAMES]',
    JSON.stringify(agentNames),
  ].join('\n\n')
}
