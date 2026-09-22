// AI WORLD — ADMIN WORLD BUILDER client types. Mirrors server/domain/{rulePresets,worldDrafts}.ts
// and server/world/builderValidation.ts (same convention as src/world/types.ts vs
// server/domain/worldTypes.ts: separate copies since client/server build under different tsconfigs).

export const RULE_CATEGORIES = [
  'BASIC_PRINCIPLE', 'PHYSICS', 'SPACE_MOVEMENT', 'RESOURCE_ITEM', 'SURVIVAL_BODY',
  'EMOTION_DESIRE', 'RELATIONSHIP', 'KNOWLEDGE_INFO', 'TECHNOLOGY_SETTING', 'DEATH_INJURY', 'CUSTOM',
] as const
export type RuleCategory = typeof RULE_CATEGORIES[number]

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  BASIC_PRINCIPLE: '기본 세계 원칙', PHYSICS: '물리 법칙', SPACE_MOVEMENT: '공간 / 이동', RESOURCE_ITEM: '자원 / 물품',
  SURVIVAL_BODY: '생존 / 신체', EMOTION_DESIRE: '감정 / 욕구', RELATIONSHIP: '인간관계', KNOWLEDGE_INFO: '지식 / 정보',
  TECHNOLOGY_SETTING: '기술 / 세계관', DEATH_INJURY: '죽음 / 부상', CUSTOM: '사용자 정의 법칙',
}

export interface WorldRuleDTO {
  id: string; category: RuleCategory; title: string; description: string
  enabled: boolean; priority: number; systemLocked: boolean; custom: boolean
}

export interface RulePresetSummary {
  id: string; name: string; description: string; isSystem: boolean; ruleCount: number; createdAt: string; updatedAt: string
}

export interface RulePresetDTO extends RulePresetSummary {
  rules: WorldRuleDTO[]
}

export interface HumanState { survival_need: number; fatigue: number; stress: number; sexual_desire: number; greed: number; ambition: number }
export interface Emotion { mood: number; anger: number; fear: number }
export interface DraftResource { key: string; label: string; level: number; max: number; unit?: string }
export interface DraftKnowledgeItem { summary: string }

export type DraftStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'ARCHIVED'
export type CharacterSource = 'AI_AUTO' | 'MANUAL' | 'AI_EDITED'

export interface DraftSummary {
  id: string; status: DraftStatus; name: string; seasonName: string; targetPopulation: number
  placeCount: number; characterCount: number; updatedAt: string
}

export interface PlaceDTO {
  id: string; name: string; description: string; type: string; x: number; y: number
  isPublic: boolean; isDiscovered: boolean; capacity: number | null
  resources: DraftResource[]; items: string[]; facilityStatus: string
}

export interface ConnectionDTO {
  id: string; fromPlaceId: string; toPlaceId: string; travelTime: number
  connectionType: string; blocked: boolean; requirements: string
}

export interface CharacterDTO {
  id: string; name: string; age: number | null; gender: string; appearance: string; background: string
  occupation: string; personality: string; goal: string; strengths: string[]; weaknesses: string[]
  provider: string; model: string; humanState: HumanState; emotion: Emotion; knowledge: DraftKnowledgeItem[]
  privateInfo: string; inventory: string[]; initialPlaceId: string | null; source: CharacterSource
  createdAt: string; updatedAt: string
}

export interface RelationshipDTO {
  id: string; fromCharacterId: string; toCharacterId: string; trust: number; affection: number; attraction: number; note: string
}

export interface DraftDTO {
  maxActiveCharacters?: number
  discoverableTruths?: Array<{ id: string; summary: string; placeId: string; revealedPlaceId?: string }>
  id: string; status: DraftStatus; wizardStep: number
  name: string; intro: string; genre: string; background: string; seasonName: string
  maxDays: number | null; simSpeedMs: number; targetPopulation: number; isPublic: boolean
  rulePresetId: string | null
  startDay: number; startTime: string; startWeather: string; startTemperatureC: number
  backgroundSituation: string; initialEvent: string; powerStatus: string; initialResources: DraftResource[]
  facilityStatus: string; hiddenWorldTruth: string; endCondition: string
  createdAt: string; updatedAt: string; startedAt: string | null; endedAt: string | null
  places: PlaceDTO[]; connections: ConnectionDTO[]; characters: CharacterDTO[]; relationships: RelationshipDTO[]
}

export interface ValidationIssue { code: string; message: string }
export interface ValidationResult { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }
