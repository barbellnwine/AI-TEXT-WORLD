// AGENT PROMPT — asks one character what it wants to do next. The input MUST come from
// knowledgeFilter.buildAgentKnowledgeView(), never from raw WorldState: that function already
// excludes every other character's private memory and all HIDDEN WORLD TRUTH, so this template
// has no HIDDEN WORLD TRUTH section to accidentally include.
//
// WHERE A REAL MODEL CALL GOES: replace mockGenerateProposedAction in server/domain/agentRuntime.ts
// (not yet created — this mock phase has no per-tick agent loop) with a provider adapter that
// sends buildAgentPrompt(view, recentPublicEvents) to the model and parses a ProposedAction JSON
// back out, then always pass that result through server/world/worldValidator.ts before touching
// WorldState. Never let the model's own output be trusted as final.
import type { WorldEvent } from '../domain/worldTypes.ts'
import type { AgentKnowledgeView } from '../world/knowledgeFilter.ts'
import { WORLD_RULES_TEXT } from './worldRules.ts'

export const AGENT_PROMPT_VERSION = '1.0.0'

export const AGENT_PROMPT_INSTRUCTIONS = [
  '당신은 이 세계 속 한 명의 캐릭터입니다.',
  '아래에 주어진 당신의 상태, 위치, 소지품, 기억, 관찰 가능한 정보만을 근거로 다음 행동 하나를 제안하십시오.',
  '이 제안은 확정된 결과가 아닙니다. WORLD ENGINE이 별도로 가능 여부를 판정합니다.',
  '반드시 지정된 JSON 스키마(ProposedAction) 형식으로만 응답하십시오. 설명 문장을 덧붙이지 마십시오.',
].join('\n')

export function buildAgentPrompt(view: AgentKnowledgeView, recentPublicEvents: WorldEvent[]): string {
  const sections = [
    WORLD_RULES_TEXT,
    AGENT_PROMPT_INSTRUCTIONS,
    '[YOUR STATE]',
    JSON.stringify(view.self, null, 2),
    '[YOUR CURRENT PLACE]',
    JSON.stringify(view.currentPlace, null, 2),
    '[OTHERS PRESENT HERE]',
    JSON.stringify(view.othersPresent, null, 2),
    '[YOUR RELATIONSHIPS]',
    JSON.stringify(view.relationships, null, 2),
    '[WHAT YOU KNOW]',
    JSON.stringify(view.knownFacts, null, 2),
    '[EVENTS YOU WERE PART OF OR PRESENT FOR]',
    JSON.stringify(view.observedEvents, null, 2),
    '[RECENT PUBLIC EVENTS NEAR YOU]',
    JSON.stringify(recentPublicEvents, null, 2),
    '[OUTPUT SCHEMA: ProposedAction]',
    'actorId, actionType, targetIds, locationId, intendedAction, spokenText?, usedItemIds?, destinationId?, claimedKnowledgeId?, reasoningSummary?',
  ]
  return sections.join('\n\n')
}
