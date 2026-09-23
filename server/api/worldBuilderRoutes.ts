import type { DatabaseSync } from 'node:sqlite'
import { Router, readJsonBody, sendJson, HttpError } from '../http.ts'
import { requireAdminRole } from './userAuth.ts'
import {
  listRulePresets, getRulePreset, createRulePreset, updateRulePresetMeta, duplicateRulePreset, deleteRulePreset,
  setPresetRules, RULE_CATEGORIES, type IncomingRule, type RuleCategory,
} from '../domain/rulePresets.ts'
import {
  listDrafts, getDraft, createDraft, deleteDraft, setWizardStep, updateBasicInfo, updateRuleSelection, updateEnvironment,
  replacePlacesAndConnections, createCharacter, updateCharacter, deleteCharacter, getCharacter, replaceRelationships,
  DEFAULT_HUMAN_STATE, DEFAULT_EMOTION,
  type CharacterInput, type IncomingPlace, type IncomingConnection, type IncomingRelationship,
} from '../domain/worldDrafts.ts'
import { generateCharacters, contextFromDraft } from '../domain/characterGen.ts'
import { validateDraftForStart } from '../world/builderValidation.ts'
import { startWorldFromDraft } from '../domain/worldLaunch.ts'
import { config } from '../config.ts'
import { randomUUID } from 'node:crypto'
import { saveStudio } from '../domain/studioStore.ts'
import { recommendStudio } from '../domain/studioRecommendations.ts'
import { createTestIsland } from '../domain/studioExample.ts'
import type { DraftDTO } from '../domain/worldDrafts.ts'

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function parseCharacterInput(body: Record<string, unknown>): CharacterInput {
  const hs = (typeof body.humanState === 'object' && body.humanState !== null ? body.humanState : {}) as Record<string, unknown>
  const emo = (typeof body.emotion === 'object' && body.emotion !== null ? body.emotion : {}) as Record<string, unknown>
  const clamp = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
    return Math.min(10, Math.max(1, n))
  }
  const knowledge = Array.isArray(body.knowledge)
    ? body.knowledge.map(k => ({ summary: str((k as Record<string, unknown>)?.summary) })).filter(k => k.summary.trim())
    : []
  return {
    name: str(body.name), age: typeof body.age === 'number' ? body.age : null, gender: str(body.gender),
    appearance: str(body.appearance), background: str(body.background), occupation: str(body.occupation),
    personality: str(body.personality), goal: str(body.goal), strengths: strArray(body.strengths), weaknesses: strArray(body.weaknesses),
    provider: str(body.provider, 'openai'), model: str(body.model),
    humanState: {
      survival_need: clamp(hs.survival_need, DEFAULT_HUMAN_STATE.survival_need), fatigue: clamp(hs.fatigue, DEFAULT_HUMAN_STATE.fatigue),
      stress: clamp(hs.stress, DEFAULT_HUMAN_STATE.stress), sexual_desire: clamp(hs.sexual_desire, DEFAULT_HUMAN_STATE.sexual_desire),
      greed: clamp(hs.greed, DEFAULT_HUMAN_STATE.greed), ambition: clamp(hs.ambition, DEFAULT_HUMAN_STATE.ambition),
    },
    emotion: { mood: clamp(emo.mood, DEFAULT_EMOTION.mood), anger: clamp(emo.anger, DEFAULT_EMOTION.anger), fear: clamp(emo.fear, DEFAULT_EMOTION.fear) },
    knowledge, privateInfo: str(body.privateInfo), inventory: strArray(body.inventory),
    initialPlaceId: typeof body.initialPlaceId === 'string' && body.initialPlaceId ? body.initialPlaceId : null,
  }
}

function requireDraft(db: DatabaseSync, id: string) {
  const draft = getDraft(db, id)
  if (!draft) throw new HttpError(404, 'draft_not_found')
  return draft
}

export function registerWorldBuilderRoutes(router: Router, db: DatabaseSync): void {
  router.post('/api/admin/world/examples/island', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 201, { draft: createTestIsland(db) })
  })
  router.post('/api/admin/world/drafts/:id/recommend', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { suggestions: await recommendStudio(db, requireDraft(db, ctx.params.id)) })
  })
  router.put('/api/admin/world/drafts/:id/studio', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<DraftDTO>(ctx.req, 1_048_576)
    sendJson(ctx.res, 200, { draft: saveStudio(db, ctx.params.id, body) })
  })
  // --- WORLD RULE PRESET ------------------------------------------------------
  router.get('/api/admin/world/rule-presets', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { presets: listRulePresets(db), categories: RULE_CATEGORIES })
  })

  router.post('/api/admin/world/rule-presets', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ name?: string; description?: string }>(ctx.req)
    if (!body.name?.trim()) throw new HttpError(400, 'name_required')
    sendJson(ctx.res, 201, { preset: createRulePreset(db, { name: body.name.trim(), description: body.description }) })
  })

  router.get('/api/admin/world/rule-presets/:id', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const preset = getRulePreset(db, ctx.params.id)
    if (!preset) throw new HttpError(404, 'preset_not_found')
    sendJson(ctx.res, 200, { preset })
  })

  router.put('/api/admin/world/rule-presets/:id', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ name?: string; description?: string; rules?: IncomingRule[] }>(ctx.req)
    const updated = updateRulePresetMeta(db, ctx.params.id, { name: body.name, description: body.description })
    if (!updated) throw new HttpError(404, 'preset_not_found')
    if (Array.isArray(body.rules)) {
      const validCategories = new Set<string>(RULE_CATEGORIES)
      const rules: IncomingRule[] = body.rules.map(r => ({
        id: typeof r.id === 'string' ? r.id : undefined,
        category: (validCategories.has(r.category) ? r.category : 'CUSTOM') as RuleCategory,
        title: str(r.title), description: str(r.description), enabled: bool(r.enabled, true), priority: num(r.priority, 0),
      }))
      setPresetRules(db, ctx.params.id, rules)
    }
    sendJson(ctx.res, 200, { preset: getRulePreset(db, ctx.params.id) })
  })

  router.post('/api/admin/world/rule-presets/:id/duplicate', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ name?: string }>(ctx.req)
    const source = getRulePreset(db, ctx.params.id)
    if (!source) throw new HttpError(404, 'preset_not_found')
    const duplicate = duplicateRulePreset(db, ctx.params.id, body.name?.trim() || `${source.name} (복제)`)
    sendJson(ctx.res, 201, { preset: duplicate })
  })

  router.delete('/api/admin/world/rule-presets/:id', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const result = deleteRulePreset(db, ctx.params.id)
    if (!result.ok) throw new HttpError(result.error === 'preset_not_found' ? 404 : 409, result.error)
    sendJson(ctx.res, 200, { ok: true })
  })

  // --- DRAFT WORLD -------------------------------------------------------------
  router.get('/api/admin/world/drafts', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { drafts: listDrafts(db) })
  })

  router.post('/api/admin/world/drafts', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ name?: string }>(ctx.req)
    sendJson(ctx.res, 201, { draft: createDraft(db, body.name) })
  })

  router.get('/api/admin/world/drafts/:id', ctx => {
    if (!requireAdminRole(ctx, db)) return
    sendJson(ctx.res, 200, { draft: requireDraft(db, ctx.params.id) })
  })

  router.delete('/api/admin/world/drafts/:id', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const result = deleteDraft(db, ctx.params.id)
    if (!result.ok) throw new HttpError(result.error === 'draft_not_found' ? 404 : 409, result.error)
    sendJson(ctx.res, 200, { ok: true })
  })

  router.put('/api/admin/world/drafts/:id/step', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    const body = await readJsonBody<{ step?: number }>(ctx.req)
    requireDraft(db, ctx.params.id)
    setWizardStep(db, ctx.params.id, Math.min(10, Math.max(1, Math.round(num(body.step, 1)))))
    sendJson(ctx.res, 200, { ok: true })
  })

  router.put('/api/admin/world/drafts/:id/basic-info', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const body = await readJsonBody<Record<string, unknown>>(ctx.req)
    if (typeof body.targetPopulation === 'number' && (!Number.isInteger(body.targetPopulation) || body.targetPopulation < 1 || body.targetPopulation > config.maxActiveCharacters)) throw new HttpError(400, `max_active_characters_${config.maxActiveCharacters}`)
    const draft = updateBasicInfo(db, ctx.params.id, {
      name: str(body.name), intro: str(body.intro), genre: str(body.genre), background: str(body.background),
      seasonName: str(body.seasonName), maxDays: typeof body.maxDays === 'number' ? body.maxDays : null,
      simSpeedMs: num(body.simSpeedMs, 60_000), targetPopulation: num(body.targetPopulation, config.maxActiveCharacters),
      isPublic: bool(body.isPublic, true),
    })
    if (!draft) throw new HttpError(404, 'draft_not_found')
    sendJson(ctx.res, 200, { draft })
  })

  router.put('/api/admin/world/drafts/:id/rules', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const body = await readJsonBody<{ rulePresetId?: string | null }>(ctx.req)
    const draft = updateRuleSelection(db, ctx.params.id, body.rulePresetId ?? null)
    if (!draft) throw new HttpError(404, 'draft_or_preset_not_found')
    sendJson(ctx.res, 200, { draft })
  })

  router.put('/api/admin/world/drafts/:id/environment', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const body = await readJsonBody<Record<string, unknown>>(ctx.req)
    const resources = Array.isArray(body.initialResources)
      ? body.initialResources.map(r => {
          const row = r as Record<string, unknown>
          return { key: str(row.key), label: str(row.label), level: num(row.level, 0), max: num(row.max, 100), unit: typeof row.unit === 'string' ? row.unit : undefined }
        })
      : []
    const draft = updateEnvironment(db, ctx.params.id, {
      startDay: Math.max(1, num(body.startDay, 1)), startTime: str(body.startTime, '08:00'), startWeather: str(body.startWeather, 'clear'),
      startTemperatureC: num(body.startTemperatureC, 20), backgroundSituation: str(body.backgroundSituation), initialEvent: str(body.initialEvent),
      powerStatus: str(body.powerStatus), initialResources: resources, facilityStatus: str(body.facilityStatus),
      hiddenWorldTruth: str(body.hiddenWorldTruth), endCondition: str(body.endCondition),
      discoverableTruths: Array.isArray(body.discoverableTruths) ? body.discoverableTruths.map(raw => {
        const truth = raw as Record<string, unknown>
        return { id: str(truth.id) || randomUUID(), summary: str(truth.summary), placeId: str(truth.placeId), revealedPlaceId: str(truth.revealedPlaceId) || undefined }
      }) : undefined,
    })
    if (!draft) throw new HttpError(404, 'draft_not_found')
    sendJson(ctx.res, 200, { draft })
  })

  router.put('/api/admin/world/drafts/:id/places', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const body = await readJsonBody<{ places?: unknown[]; connections?: unknown[] }>(ctx.req)
    const places: IncomingPlace[] = (body.places ?? []).map(raw => {
      const p = raw as Record<string, unknown>
      return {
        id: typeof p.id === 'string' ? p.id : undefined, tempId: typeof p.tempId === 'string' ? p.tempId : undefined,
        name: str(p.name), description: str(p.description), type: str(p.type, 'GENERIC'), x: num(p.x, 0), y: num(p.y, 0),
        isPublic: bool(p.isPublic, true), isDiscovered: bool(p.isDiscovered, true), capacity: typeof p.capacity === 'number' ? p.capacity : null,
        resources: Array.isArray(p.resources) ? p.resources.map(r => {
          const row = r as Record<string, unknown>
          return { key: str(row.key), label: str(row.label), level: num(row.level, 0), max: num(row.max, 100), unit: typeof row.unit === 'string' ? row.unit : undefined }
        }) : [],
        items: strArray(p.items), facilityStatus: str(p.facilityStatus),
      }
    })
    const connections: IncomingConnection[] = (body.connections ?? []).map(raw => {
      const c = raw as Record<string, unknown>
      return {
        id: typeof c.id === 'string' ? c.id : undefined, fromPlaceRef: str(c.fromPlaceRef), toPlaceRef: str(c.toPlaceRef),
        travelTime: num(c.travelTime, 5), connectionType: str(c.connectionType, 'PATH'), blocked: bool(c.blocked, false), requirements: str(c.requirements),
      }
    })
    if (places.some(p => !p.name.trim())) throw new HttpError(400, 'place_name_required')
    const draft = replacePlacesAndConnections(db, ctx.params.id, places, connections)
    if (!draft) throw new HttpError(404, 'draft_not_found')
    sendJson(ctx.res, 200, { draft })
  })

  // --- CHARACTERS (3 modes) ----------------------------------------------------
  router.post('/api/admin/world/drafts/:id/characters/generate', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const draft = requireDraft(db, ctx.params.id)
    const body = await readJsonBody<{ count?: number; provider?: string }>(ctx.req)
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'openai'
    const count = num(body.count, draft.targetPopulation)
    if (!Number.isInteger(count) || count < 1 || draft.characters.length + count > (draft.studio ? 100 : config.maxActiveCharacters)) throw new HttpError(400, 'character_count_exceeded')
    const result = await generateCharacters(provider, count, contextFromDraft(draft, draft.characters.map(c => c.name)), db)
    if (requireDraft(db, draft.id).characters.length + result.characters.length > (draft.studio ? 100 : config.maxActiveCharacters)) throw new HttpError(409, 'character_capacity_changed')
    if (!['DRAFT', 'READY'].includes(requireDraft(db, draft.id).status)) throw new HttpError(409, 'world_design_locked')
    const created = result.characters.map(gc => createCharacter(db, draft.id, {
      ...gc, provider, model: '', privateInfo: '', inventory: [], initialPlaceId: null, knowledge: [],
    }, 'AI_AUTO'))
    sendJson(ctx.res, 201, { characters: created, usedDemo: result.usedDemo, errors: result.errors })
  })

  router.post('/api/admin/world/drafts/:id/characters', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    requireDraft(db, ctx.params.id)
    const body = await readJsonBody<Record<string, unknown>>(ctx.req)
    const input = parseCharacterInput(body)
    if (!input.name.trim()) throw new HttpError(400, 'name_required')
    if (requireDraft(db, ctx.params.id).characters.length >= config.maxActiveCharacters) throw new HttpError(400, `max_active_characters_${config.maxActiveCharacters}`)
    const character = createCharacter(db, ctx.params.id, input, 'MANUAL')
    sendJson(ctx.res, 201, { character })
  })

  router.put('/api/admin/world/drafts/:id/characters/:charId', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    requireDraft(db, ctx.params.id)
    const body = await readJsonBody<Record<string, unknown>>(ctx.req)
    const input = parseCharacterInput(body)
    if (!input.name.trim()) throw new HttpError(400, 'name_required')
    const character = updateCharacter(db, ctx.params.id, ctx.params.charId, input)
    if (!character) throw new HttpError(404, 'character_not_found')
    sendJson(ctx.res, 200, { character })
  })

  router.post('/api/admin/world/drafts/:id/characters/:charId/regenerate', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    const draft = requireDraft(db, ctx.params.id)
    const existing = getCharacter(db, draft.id, ctx.params.charId)
    if (!existing) throw new HttpError(404, 'character_not_found')
    const body = await readJsonBody<{ provider?: string }>(ctx.req)
    const provider = body.provider === 'anthropic' ? 'anthropic' : (existing.provider === 'anthropic' ? 'anthropic' : 'openai')
    const result = await generateCharacters(provider, 1, contextFromDraft(draft, draft.characters.filter(c => c.id !== existing.id).map(c => c.name)), db)
    const generated = result.characters[0]
    if (!generated) throw new HttpError(502, result.errors[0] ?? 'character_generation_failed')
    if (!['DRAFT', 'READY'].includes(requireDraft(db, draft.id).status)) throw new HttpError(409, 'world_design_locked')
    const character = updateCharacter(db, draft.id, existing.id, {
      ...generated, provider, model: existing.model, privateInfo: existing.privateInfo, inventory: existing.inventory,
      initialPlaceId: existing.initialPlaceId, knowledge: existing.knowledge,
    })
    sendJson(ctx.res, 200, { character, usedDemo: result.usedDemo, errors: result.errors })
  })

  router.delete('/api/admin/world/drafts/:id/characters/:charId', ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    requireDraft(db, ctx.params.id)
    if (!deleteCharacter(db, ctx.params.id, ctx.params.charId)) throw new HttpError(404, 'character_not_found')
    sendJson(ctx.res, 200, { ok: true })
  })

  router.put('/api/admin/world/drafts/:id/relationships', async ctx => {
    if (!requireAdminRole(ctx, db)) return
    if (!['DRAFT', 'READY'].includes(requireDraft(db, ctx.params.id).status)) throw new HttpError(409, 'world_design_locked')
    requireDraft(db, ctx.params.id)
    const body = await readJsonBody<{ relationships?: unknown[] }>(ctx.req)
    const clamp = (v: unknown) => Math.min(10, Math.max(1, Math.round(num(v, 5))))
    const relationships: IncomingRelationship[] = (body.relationships ?? []).map(raw => {
      const r = raw as Record<string, unknown>
      return { fromCharacterId: str(r.fromCharacterId), toCharacterId: str(r.toCharacterId), trust: clamp(r.trust), affection: clamp(r.affection), attraction: clamp(r.attraction), note: str(r.note) }
    })
    const saved = replaceRelationships(db, ctx.params.id, relationships)
    if (!saved) throw new HttpError(404, 'draft_not_found')
    sendJson(ctx.res, 200, { relationships: saved })
  })

  // --- REVIEW / START -----------------------------------------------------------
  router.get('/api/admin/world/drafts/:id/validate', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const draft = requireDraft(db, ctx.params.id)
    sendJson(ctx.res, 200, validateDraftForStart(draft))
  })

  router.post('/api/admin/world/drafts/:id/start', ctx => {
    if (!requireAdminRole(ctx, db)) return
    const draft = requireDraft(db, ctx.params.id)
    const result = startWorldFromDraft(db, draft)
    if (!result.ok) {
      sendJson(ctx.res, 422, { error: 'validation_failed', errors: result.errors, warnings: result.warnings })
      return
    }
    sendJson(ctx.res, 200, { ok: true, warnings: result.warnings })
  })
}
