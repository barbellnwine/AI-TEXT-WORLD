// CHARACTER AUTO GENERATE (MODE A) + regenerate-one (MODE C). Structured JSON output only —
// see section 45 of the builder spec. Real provider calls are OFF by default (config.worldDemoMode)
// so a fresh checkout never spends money; the deterministic mock keeps AI AUTO fully usable and
// testable without any API key. Never includes HIDDEN WORLD TRUTH in the generation prompt
// (section 10) — callers must not pass it in `worldContext`.
import type { DatabaseSync } from 'node:sqlite'
import { ensurePricingSeeded, getPricing, estimateCostUsd, getUsdToKrwRate, checkBudget, reserveBudget, settleReservation } from './budget.ts'
import { ensureModelConfigured } from './worldAgent.ts'
import { config } from '../config.ts'
import { fetchWithLimits, ProviderCallError } from '../providers/httpUtil.ts'
import { WORLD_RULES_TEXT } from '../prompts/worldRules.ts'
import { DEFAULT_EMOTION, DEFAULT_HUMAN_STATE, type CharacterInput, type Emotion, type HumanState } from './worldDrafts.ts'

export interface CharacterGenContext {
  worldName: string
  genre: string
  background: string
  seasonPremise: string
  existingNames: string[]
}

// The one place a DraftDTO becomes generation context — deliberately typed so hiddenWorldTruth
// (which DraftDTO has, section 10) has no field to land in here. Callers must go through this
// instead of hand-building the object, so the exclusion can't be silently reintroduced.
export function contextFromDraft(draft: { name: string; genre: string; background: string; intro: string }, existingNames: string[]): CharacterGenContext {
  return { worldName: draft.name, genre: draft.genre, background: draft.background, seasonPremise: draft.background, existingNames }
}

export type GeneratedCharacter = Pick<CharacterInput,
  'name' | 'age' | 'gender' | 'appearance' | 'background' | 'occupation' | 'personality' | 'goal' | 'strengths' | 'weaknesses'
> & { humanState: HumanState; emotion: Emotion }

const NAME_POOL = [
  '김서준', '이하윤', '박지민', '최도윤', '정예린', '한소율', '오세인', '임하늘', '강태오', '나윤재',
  '유리안', '백승리', '문가온', '서준경', '조은채', '장하람', '윤도경', '신아린', '배태민', '홍시우',
]
const OCCUPATIONS = ['전기 기술자', '의료 연구원', '보안 담당', '통신 기술자', '물류 관리자', '생물학자', '요리 담당', '기록 담당', '조종사', '정비공']
const TRAITS = ['침착함', '즉흥적', '신중함', '다혈질', '분석적', '낙천적', '의심 많음', '헌신적', '냉소적', '리더십']

function clamp(n: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

// Deterministic (no Math.random) so tests and repeated demo calls are reproducible and diverse
// across a batch — index-based selection, not personality-stat overload (section 19/23).
function mockCharacter(index: number, existingNames: Set<string>): GeneratedCharacter {
  let name = NAME_POOL[index % NAME_POOL.length]
  let guard = 0
  while (existingNames.has(name) && guard < NAME_POOL.length) {
    guard++
    name = NAME_POOL[(index + guard) % NAME_POOL.length]
  }
  existingNames.add(name)
  const occupation = OCCUPATIONS[index % OCCUPATIONS.length]
  const traitA = TRAITS[index % TRAITS.length]
  const traitB = TRAITS[(index + 3) % TRAITS.length]
  const age = 22 + ((index * 7) % 40)
  const gender = index % 2 === 0 ? '여성' : '남성'
  return {
    name, age, gender,
    appearance: `평범한 체격에 ${gender === '여성' ? '단발' : '짧은 머리'}를 한 ${age}세.`,
    background: `${occupation}으로 일해왔으며, 평소 ${traitA}한 인상을 준다.`,
    occupation,
    personality: `평소 ${traitA}하지만 위기 상황에서는 ${traitB}한 모습을 보인다. 극단적인 성향은 아니며, 상황에 따라 유연하게 반응한다.`,
    goal: '주어진 상황에서 살아남고 신뢰할 수 있는 사람을 찾는 것.',
    strengths: [traitA],
    weaknesses: [traitB === traitA ? '고집' : traitB],
    // DAY 1 baseline stays away from extremes unless the world explicitly starts in crisis.
    humanState: { ...DEFAULT_HUMAN_STATE, ambition: clamp(3 + (index % 4)) },
    emotion: { ...DEFAULT_EMOTION, mood: clamp(5 + (index % 3)) },
  }
}

export function validateGeneratedCharacter(raw: unknown): { ok: true; character: GeneratedCharacter } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['not_an_object'] }
  const r = raw as Record<string, unknown>
  const str = (key: string): string => (typeof r[key] === 'string' ? (r[key] as string).slice(0, 2000) : '')
  const arr = (key: string): string[] => (Array.isArray(r[key]) ? (r[key] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8) : [])
  if (!str('name').trim()) errors.push('name_required')
  const age = typeof r.age === 'number' && Number.isFinite(r.age) ? Math.min(120, Math.max(1, Math.round(r.age))) : null
  const hsRaw = (typeof r.human_state === 'object' && r.human_state !== null ? r.human_state : {}) as Record<string, unknown>
  const emoRaw = (typeof r.emotion === 'object' && r.emotion !== null ? r.emotion : {}) as Record<string, unknown>
  const num = (obj: Record<string, unknown>, key: string, fallback: number) => (typeof obj[key] === 'number' && Number.isFinite(obj[key]) ? clamp(obj[key] as number) : fallback)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    character: {
      name: str('name').trim(), age, gender: str('gender'), appearance: str('appearance'), background: str('background'),
      occupation: str('occupation'), personality: str('personality'), goal: str('goal'), strengths: arr('strengths'), weaknesses: arr('weaknesses'),
      humanState: {
        survival_need: num(hsRaw, 'survival_need', DEFAULT_HUMAN_STATE.survival_need),
        fatigue: num(hsRaw, 'fatigue', DEFAULT_HUMAN_STATE.fatigue),
        stress: num(hsRaw, 'stress', DEFAULT_HUMAN_STATE.stress),
        sexual_desire: num(hsRaw, 'sexual_desire', DEFAULT_HUMAN_STATE.sexual_desire),
        greed: num(hsRaw, 'greed', DEFAULT_HUMAN_STATE.greed),
        ambition: num(hsRaw, 'ambition', DEFAULT_HUMAN_STATE.ambition),
      },
      emotion: {
        mood: num(emoRaw, 'mood', DEFAULT_EMOTION.mood),
        anger: num(emoRaw, 'anger', DEFAULT_EMOTION.anger),
        fear: num(emoRaw, 'fear', DEFAULT_EMOTION.fear),
      },
    },
  }
}

function buildPrompt(count: number, ctx: CharacterGenContext): { system: string; user: string } {
  const system = [
    WORLD_RULES_TEXT,
    '',
    '당신은 세계관 캐릭터 생성기입니다. 반드시 지정된 JSON 스키마로만 응답하십시오.',
    '나이, 이름, 성격, 목표가 서로 겹치지 않도록 다양하게 구성하십시오.',
    'DAY 1이 특별한 위기 상황이 아니라면 human_state/emotion 수치를 1이나 10 같은 극단값으로 채우지 마십시오.',
  ].join('\n')
  const user = [
    `세계 이름: ${ctx.worldName}`,
    `장르: ${ctx.genre}`,
    `배경: ${ctx.background}`,
    `시즌 개요: ${ctx.seasonPremise}`,
    ctx.existingNames.length ? `이미 존재하는 이름(중복 금지): ${ctx.existingNames.join(', ')}` : '',
    `${count}명의 캐릭터를 생성하십시오. 각 캐릭터는 다음 JSON 스키마를 따르는 객체입니다:`,
    '{"name":"","age":0,"gender":"","appearance":"","background":"","occupation":"","personality":"","goal":"","strengths":[],"weaknesses":[],"human_state":{"survival_need":1,"fatigue":1,"stress":1,"sexual_desire":1,"greed":1,"ambition":1},"emotion":{"mood":1,"anger":1,"fear":1}}',
    '응답은 반드시 {"characters":[ ... ]} 형태의 단일 JSON 객체여야 합니다.',
  ].filter(Boolean).join('\n')
  return { system, user }
}

interface CharacterBatch { items: unknown[]; inputTokens?: number; outputTokens?: number }

async function callOpenAiForCharacters(count: number, ctx: CharacterGenContext): Promise<CharacterBatch> {
  const { system, user } = buildPrompt(count, ctx)
  const response = await fetchWithLimits('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      max_tokens: Math.min(4000, 700 * count),
      temperature: 0.9,
    }),
  })
  if (!response.ok) throw new ProviderCallError(`OPENAI_HTTP_${response.status}`, 'openai request failed')
  const data = await response.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const content = data.choices[0]?.message?.content
  if (!content) throw new ProviderCallError('OPENAI_EMPTY_RESPONSE', 'empty model response')
  const parsed = JSON.parse(content) as { characters?: unknown[] }
  if (!Array.isArray(parsed.characters)) throw new ProviderCallError('OPENAI_INVALID_JSON', 'missing characters array')
  return { items: parsed.characters, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens }
}

async function callAnthropicForCharacters(count: number, ctx: CharacterGenContext): Promise<CharacterBatch> {
  const { system, user } = buildPrompt(count, ctx)
  const tool = {
    name: 'submit_characters',
    description: '생성된 캐릭터 배열을 제출합니다.',
    input_schema: {
      type: 'object',
      properties: { characters: { type: 'array', items: { type: 'object' } } },
      required: ['characters'],
    },
  }
  const response = await fetchWithLimits('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: config.anthropicModel,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [tool],
      tool_choice: { type: 'tool', name: 'submit_characters' },
      max_tokens: Math.min(4000, 700 * count),
    }),
  })
  if (!response.ok) throw new ProviderCallError(`ANTHROPIC_HTTP_${response.status}`, 'anthropic request failed')
  const data = await response.json() as { content: Array<{ type: string; input?: { characters?: unknown[] } }>; usage?: { input_tokens?: number; output_tokens?: number } }
  const toolUse = data.content.find(block => block.type === 'tool_use')
  if (!toolUse?.input?.characters || !Array.isArray(toolUse.input.characters)) throw new ProviderCallError('ANTHROPIC_EMPTY_RESPONSE', 'no characters in tool_use')
  return { items: toolUse.input.characters, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens }
}

export interface GenerateResult {
  characters: GeneratedCharacter[]
  usedDemo: boolean
  errors: string[]
}

// Batches the whole request into one call (section 44) — the caller decides how many to ask for;
// regenerating a single character later is just this same function called with count=1.
export async function generateCharacters(provider: 'openai' | 'anthropic', count: number, ctx: CharacterGenContext, db?: DatabaseSync): Promise<GenerateResult> {
  const boundedCount = Math.min(config.maxActiveCharacters, Math.max(1, Math.round(count)))
  const apiKey = provider === 'openai' ? config.openaiApiKey : config.anthropicApiKey
  const useDemo = config.worldDemoMode
  const existingNames = new Set(ctx.existingNames)

  if (useDemo) {
    const characters: GeneratedCharacter[] = []
    for (let i = 0; i < boundedCount; i++) characters.push(mockCharacter(existingNames.size + i, existingNames))
    return { characters, usedDemo: true, errors: [] }
  }

  if (!apiKey) throw new ProviderCallError('PROVIDER_KEY_MISSING', 'provider key missing')
  if (!db) throw new ProviderCallError('BUDGET_STORE_MISSING', 'budget store required')
  const model = provider === 'openai' ? config.openaiModel : config.anthropicModel
  ensureModelConfigured({ provider, model })
  ensurePricingSeeded(db)
  const pricing = getPricing(db, provider, model)!
  const prompt = buildPrompt(boundedCount, ctx)
  const reserveUsd = estimateCostUsd(pricing, Buffer.byteLength(prompt.system + prompt.user) + 3000, Math.min(4000, 700 * boundedCount))
  const rate = getUsdToKrwRate(db), reserveKrw = reserveUsd * rate
  const budget = checkBudget(db, reserveKrw)
  if (!budget.allowed) throw new ProviderCallError('BUDGET_LIMIT', 'generation budget exhausted')
  reserveBudget(db, budget.weekKey, reserveKrw, reserveUsd, budget.monthKey)
  let actualUsd = reserveUsd
  try {
    const batch = provider === 'openai' ? await callOpenAiForCharacters(boundedCount, ctx) : await callAnthropicForCharacters(boundedCount, ctx)
    if (Number.isFinite(batch.inputTokens) && Number.isFinite(batch.outputTokens) && batch.inputTokens! >= 0 && batch.outputTokens! >= 0) actualUsd = estimateCostUsd(pricing, batch.inputTokens!, batch.outputTokens!)
    const raw = batch.items
    const characters: GeneratedCharacter[] = []
    const errors: string[] = []
    for (const item of raw.slice(0, boundedCount)) {
      const result = validateGeneratedCharacter(item)
      if (result.ok) characters.push(result.character)
      else errors.push(...result.errors)
    }
    if (characters.length < boundedCount) errors.push('Some characters were not returned; retry only the missing count.')
    return { characters, usedDemo: false, errors }
  } catch (error) {
    const message = error instanceof ProviderCallError ? error.code : 'PROVIDER_CALL_FAILED'
    return { characters: [], usedDemo: false, errors: [message] }
  } finally {
    settleReservation(db, budget.weekKey, reserveKrw, reserveUsd, actualUsd * rate, actualUsd, provider, budget.monthKey)
  }
}
