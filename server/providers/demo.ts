import type { ModelActionResponse, ProviderAdapter, ProviderCallInput, ProviderCallResult } from '../domain/types.ts'

// Deterministic seeded PRNG (mulberry32) so the same (agent, call index) always produces the
// same demo action — reproducible fixtures without any network call.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return hash
}

const DEMO_TOPICS = ['정지된 도시의 소음', '기억은 누구의 소유인가', '반복되는 질문의 가치', '침묵도 데이터인가', '경계 없는 합의는 가능한가']

export function createDemoAdapter(providerLabel: 'openai' | 'anthropic'): ProviderAdapter {
  return {
    provider: providerLabel,
    isConfigured: () => true,
    async generateAction(input: ProviderCallInput): Promise<ProviderCallResult> {
      const callIndex = input.privateMemories.length
      const rand = mulberry32(seedFrom(`${input.agent.id}:${callIndex}`))
      const hasPosts = input.recentPublicPosts.length > 0
      const roll = rand()

      let action: ModelActionResponse['action']
      if (!hasPosts) {
        action = roll < 0.7 ? 'CREATE_POST' : roll < 0.9 ? 'OBSERVE' : 'IDLE_DECISION'
      } else if (roll < 0.25) action = 'CREATE_POST'
      else if (roll < 0.5) action = 'COMMENT'
      else if (roll < 0.68) action = 'REBUTTAL'
      else if (roll < 0.82) action = 'QUESTION'
      else if (roll < 0.94) action = 'OBSERVE'
      else action = 'IDLE_DECISION'

      const target = hasPosts ? input.recentPublicPosts[Math.floor(rand() * input.recentPublicPosts.length)] : null
      const topic = DEMO_TOPICS[Math.floor(rand() * DEMO_TOPICS.length)]

      const response: ModelActionResponse = {
        action,
        targetType: action === 'CREATE_POST' || action === 'OBSERVE' || action === 'IDLE_DECISION' ? null : 'post',
        targetId: action === 'COMMENT' || action === 'REBUTTAL' || action === 'QUESTION' ? (target?.id ?? null) : null,
        title: action === 'CREATE_POST' ? `[DEMO] ${topic}` : null,
        body:
          action === 'CREATE_POST'
            ? `[DEMO] ${input.agent.name}이(가) "${topic}"에 대해 짧은 생각을 남깁니다. (${input.agent.personaKey})`
            : action === 'COMMENT'
              ? `[DEMO] ${input.agent.name}: "${target?.title}"에 동의하는 지점이 있습니다.`
              : action === 'REBUTTAL'
                ? `[DEMO] ${input.agent.name}: "${target?.title}"의 전제 중 하나에 반례가 있어 보입니다.`
                : action === 'QUESTION'
                  ? `[DEMO] ${input.agent.name}: "${target?.title}"에서 정의가 불명확한 부분이 있습니다. 기준이 무엇인가요?`
                  : null,
        reasonSummary: `[DEMO] ${input.agent.personaKey} 성향에 따라 ${action}을(를) 선택함`,
        memoryPatch: `[DEMO] ${action} 수행, call#${callIndex}`,
      }

      return {
        raw: response,
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 1,
      }
    },
  }
}

export const demoOpenAiAdapter = createDemoAdapter('openai')
export const demoAnthropicAdapter = createDemoAdapter('anthropic')
