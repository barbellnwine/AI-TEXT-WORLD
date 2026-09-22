import { adminRequest } from './api'
import type {
  CharacterDTO, DraftDTO, DraftSummary, HumanState, Emotion, DraftKnowledgeItem,
  RelationshipDTO, RulePresetDTO, RulePresetSummary, ValidationResult, WorldRuleDTO,
} from './builderTypes'

export interface CharacterInputPayload {
  name: string; age: number | null; gender: string; appearance: string; background: string; occupation: string
  personality: string; goal: string; strengths: string[]; weaknesses: string[]; provider: string; model: string
  humanState: HumanState; emotion: Emotion; knowledge: DraftKnowledgeItem[]; privateInfo: string
  inventory: string[]; initialPlaceId: string | null
}

export const rulePresetApi = {
  list: () => adminRequest<{ presets: RulePresetSummary[] }>('/api/admin/world/rule-presets', 'GET'),
  get: (id: string) => adminRequest<{ preset: RulePresetDTO }>(`/api/admin/world/rule-presets/${encodeURIComponent(id)}`, 'GET'),
  create: (name: string, description?: string) => adminRequest<{ preset: RulePresetDTO }>('/api/admin/world/rule-presets', 'POST', { name, description }),
  update: (id: string, body: { name?: string; description?: string; rules?: Array<Omit<WorldRuleDTO, 'id'> & { id?: string }> }) =>
    adminRequest<{ preset: RulePresetDTO }>(`/api/admin/world/rule-presets/${encodeURIComponent(id)}`, 'PUT', body),
  duplicate: (id: string, name: string) => adminRequest<{ preset: RulePresetDTO }>(`/api/admin/world/rule-presets/${encodeURIComponent(id)}/duplicate`, 'POST', { name }),
  remove: (id: string) => adminRequest<{ ok: true }>(`/api/admin/world/rule-presets/${encodeURIComponent(id)}`, 'DELETE'),
}

export const worldBuilderApi = {
  listDrafts: () => adminRequest<{ drafts: DraftSummary[] }>('/api/admin/world/drafts', 'GET'),
  createDraft: (name?: string) => adminRequest<{ draft: DraftDTO }>('/api/admin/world/drafts', 'POST', { name }),
  getDraft: (id: string) => adminRequest<{ draft: DraftDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}`, 'GET'),
  deleteDraft: (id: string) => adminRequest<{ ok: true }>(`/api/admin/world/drafts/${encodeURIComponent(id)}`, 'DELETE'),
  setStep: (id: string, step: number) => adminRequest<{ ok: true }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/step`, 'PUT', { step }),

  saveBasicInfo: (id: string, body: Pick<DraftDTO, 'name' | 'intro' | 'genre' | 'background' | 'seasonName' | 'maxDays' | 'simSpeedMs' | 'targetPopulation' | 'isPublic'>) =>
    adminRequest<{ draft: DraftDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/basic-info`, 'PUT', body),
  saveRuleSelection: (id: string, rulePresetId: string | null) =>
    adminRequest<{ draft: DraftDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/rules`, 'PUT', { rulePresetId }),
  saveEnvironment: (id: string, body: Pick<DraftDTO, 'startDay' | 'startTime' | 'startWeather' | 'startTemperatureC' | 'backgroundSituation' | 'initialEvent' | 'powerStatus' | 'initialResources' | 'facilityStatus' | 'hiddenWorldTruth' | 'endCondition' | 'discoverableTruths'>) =>
    adminRequest<{ draft: DraftDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/environment`, 'PUT', body),
  savePlaces: (id: string, places: unknown[], connections: unknown[]) =>
    adminRequest<{ draft: DraftDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/places`, 'PUT', { places, connections }),

  generateCharacters: (id: string, count: number, provider: string) =>
    adminRequest<{ characters: CharacterDTO[]; usedDemo: boolean; errors: string[] }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/characters/generate`, 'POST', { count, provider }),
  addCharacter: (id: string, body: CharacterInputPayload) =>
    adminRequest<{ character: CharacterDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/characters`, 'POST', body),
  updateCharacter: (id: string, charId: string, body: CharacterInputPayload) =>
    adminRequest<{ character: CharacterDTO }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/characters/${encodeURIComponent(charId)}`, 'PUT', body),
  regenerateCharacter: (id: string, charId: string, provider: string) =>
    adminRequest<{ character: CharacterDTO; usedDemo: boolean; errors: string[] }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/characters/${encodeURIComponent(charId)}/regenerate`, 'POST', { provider }),
  deleteCharacter: (id: string, charId: string) =>
    adminRequest<{ ok: true }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/characters/${encodeURIComponent(charId)}`, 'DELETE'),

  saveRelationships: (id: string, relationships: Array<Pick<RelationshipDTO, 'fromCharacterId' | 'toCharacterId' | 'trust' | 'affection' | 'attraction' | 'note'>>) =>
    adminRequest<{ relationships: RelationshipDTO[] }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/relationships`, 'PUT', { relationships }),

  validate: (id: string) => adminRequest<ValidationResult>(`/api/admin/world/drafts/${encodeURIComponent(id)}/validate`, 'GET'),
  start: (id: string) => adminRequest<{ ok: boolean; error?: string; errors?: unknown[]; warnings?: unknown[] }>(`/api/admin/world/drafts/${encodeURIComponent(id)}/start`, 'POST'),
}
