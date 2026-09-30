// AGENT PROMPT — asks one character what it wants to do next. The input MUST come from
// knowledgeFilter.buildAgentKnowledgeView(), never from raw WorldState: that function already
// excludes every other character's private memory and all HIDDEN WORLD TRUTH, so this template
// has no HIDDEN WORLD TRUTH section to accidentally include.
//
// worldAgent.ts adds the frozen season rules and the actor's own profile to this knowledge view.
// worldStore.ts validates proposals before resolving and applying any state changes.
import type { WorldEvent } from '../domain/worldTypes.ts'
import type { AgentKnowledgeView } from '../world/knowledgeFilter.ts'
import { WORLD_RULES_TEXT } from './worldRules.ts'

export const AGENT_PROMPT_VERSION = '3.1.0'

export const AGENT_PROMPT_INSTRUCTIONS = [
  '당신은 이 세계 속 한 명의 캐릭터입니다.',
  '아래에 주어진 당신의 상태, 위치, 소지품, 기억, 관찰 가능한 정보만을 근거로 다음 행동 하나를 제안하십시오.',
  '이 제안은 확정된 결과가 아닙니다. WORLD ENGINE이 별도로 가능 여부를 판정합니다.',
  '반드시 지정된 JSON 스키마(ProposedAction) 형식으로만 응답하십시오. 설명 문장을 덧붙이지 마십시오.',
].join('\n')

export function buildAgentPrompt(view: AgentKnowledgeView, recentPublicEvents: WorldEvent[]): string {
  const self={...view.self,trauma:view.self.trauma?{
    pain:view.self.trauma.pain,bloodLoss:view.self.trauma.bloodLoss,functions:view.self.trauma.functions,
    injuries:view.self.trauma.injuries.map(({part,type,site,severity,bleeding,pain,healingHours,onset,treatedAt,effects})=>({part,type,site,severity,bleeding,pain,healingHours,onset,treatedAt,effects:effects.map(({function:ability,degree,mechanism})=>({function:ability,degree,mechanism}))}))
  }:undefined}
  const sections = [
    WORLD_RULES_TEXT,
    AGENT_PROMPT_INSTRUCTIONS,
    '[YOUR STATE]',
    JSON.stringify(self),
    '[YOUR CURRENT PLACE]',
    JSON.stringify(view.currentPlace),
    '[EXISTING OBJECTS HERE]',
    JSON.stringify(view.visibleObjects ?? []),
    '[OBJECT LOCATIONS YOU PREVIOUSLY OBSERVED — MAY HAVE CHANGED]',
    JSON.stringify(view.observedObjects ?? []),
    '[VISIBLE PEOPLE — canContact=false means approach before speech or attack]',
    JSON.stringify(view.othersPresent),
    '[POSSESSIONS YOU HAVE ACTUALLY OBSERVED — MAY HAVE CHANGED]',
    JSON.stringify(view.observedPossessions ?? []),
    '[VISIBLE THREATS]',
    JSON.stringify({ threats: view.threats ?? [] }),
    '[YOUR RELATIONSHIPS]',
    JSON.stringify(view.relationships),
    '[WHAT YOU KNOW]',
    JSON.stringify(view.knownFacts),
    '[EVENTS YOU WERE PART OF OR PRESENT FOR]',
    JSON.stringify(view.observedEvents),
    '[RECENT PUBLIC EVENTS NEAR YOU]',
    JSON.stringify(recentPublicEvents),
  ]
  return sections.join('\n\n')
}
