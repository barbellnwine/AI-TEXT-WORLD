// MEMORY PROMPT — summarizes one character's newly observed events into an updated personal
// memory entry. Input comes from knowledgeFilter.buildAgentKnowledgeView() plus the events that
// just happened where that character was present, exactly like agentPrompt.ts — never another
// character's memory, never HIDDEN WORLD TRUTH.
//
// WHERE A REAL MODEL CALL GOES: a per-tick memory-update step would call this after each
// resolved action, send the prompt to a model, and append the result as a new AgentKnowledgeEntry
// on that character only.
import type { WorldEvent } from '../domain/worldTypes.ts'
import type { AgentKnowledgeView } from '../world/knowledgeFilter.ts'

export const MEMORY_PROMPT_VERSION = '1.0.0'

export const MEMORY_PROMPT_INSTRUCTIONS = [
  '당신은 한 캐릭터의 개인 기억을 정리하는 역할입니다.',
  '이 캐릭터가 실제로 경험하거나 직접 전달받은 사건만을 근거로, 한두 문장의 기억 요약을 만드십시오.',
  '다른 캐릭터의 생각이나 이 캐릭터가 모르는 사실을 추가하지 마십시오.',
  '{summary} 형식의 JSON으로만 응답하십시오.',
].join('\n')

export function buildMemoryPrompt(view: AgentKnowledgeView, newEvents: WorldEvent[]): string {
  return [
    MEMORY_PROMPT_INSTRUCTIONS,
    '[EXISTING MEMORY]',
    JSON.stringify(view.knownFacts, null, 2),
    '[NEWLY OBSERVED EVENTS]',
    JSON.stringify(newEvents, null, 2),
  ].join('\n\n')
}
