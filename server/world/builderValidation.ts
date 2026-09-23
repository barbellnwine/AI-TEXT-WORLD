// START WORLD validation (builder spec section 34). Pure function over a DraftDTO — no DB access,
// so it's cheap to call from both the "GET /validate" preview endpoint and the START endpoint
// itself (which re-validates right before launch so nothing can slip through a stale UI state).
import type { DraftDTO } from '../domain/worldDrafts.ts'
import { config } from '../config.ts'

export interface ValidationIssue { code: string; message: string }
export interface ValidationResult { ok: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }

export function validateDraftForStart(draft: DraftDTO): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (code: string, message: string) => errors.push({ code, message })
  const warn = (code: string, message: string) => warnings.push({ code, message })

  if (!draft.name.trim()) err('NAME_REQUIRED', 'WORLD 이름이 비어 있습니다.')
  if (!draft.rulePresetId) err('RULE_PRESET_REQUIRED', 'WORLD RULES 프리셋이 선택되지 않았습니다.')
  if (!draft.startDay || draft.startDay < 1) err('START_DAY_REQUIRED', 'DAY 1 설정이 없습니다.')
  if (!draft.startTime.trim()) err('START_TIME_REQUIRED', '시작 시간이 설정되지 않았습니다.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime)) err('INVALID_START_TIME', '시작 시간은 HH:MM 형식이어야 합니다.')
  if (!Number.isInteger(draft.startDay) || draft.startDay < 1) err('INVALID_START_DAY', '시작 DAY는 양의 정수여야 합니다.')
  if (!Number.isFinite(draft.simSpeedMs) || draft.simSpeedMs < 5000 || draft.simSpeedMs > 3600000) err('INVALID_TICK_INTERVAL', 'tick 간격은 5초~1시간이어야 합니다.')
  if (draft.maxDays !== null && (!Number.isInteger(draft.maxDays) || draft.maxDays < 1)) err('INVALID_MAX_DAYS', '최대 일수는 양의 정수여야 합니다.')
  if (draft.places.length === 0) err('NO_PLACES', '장소가 하나도 없습니다. 최소 1개 이상의 장소가 필요합니다.')

  const placeIds = new Set(draft.places.map(p => p.id))
  if (!Number.isInteger(draft.targetPopulation) || draft.targetPopulation < 1) err('INVALID_POPULATION', '참가 인원은 양의 정수여야 합니다.')
  for (const truth of draft.discoverableTruths ?? []) if (!truth.summary.trim() || !placeIds.has(truth.placeId) || truth.revealedPlaceId && !placeIds.has(truth.revealedPlaceId)) err('INVALID_DISCOVERABLE_TRUTH', '발견 가능한 진실에는 내용과 실제 발견 장소가 필요합니다.')
  for (const conn of draft.connections) {
    if (!placeIds.has(conn.fromPlaceId) || !placeIds.has(conn.toPlaceId)) {
      err('INVALID_CONNECTION', `연결 정보가 존재하지 않는 장소를 참조합니다 (${conn.fromPlaceId} ↔ ${conn.toPlaceId}).`)
    }
  }
  if (draft.places.length > 1) {
    const connected = new Set<string>()
    for (const conn of draft.connections) { connected.add(conn.fromPlaceId); connected.add(conn.toPlaceId) }
    for (const place of draft.places) {
      if (!connected.has(place.id)) warn('ISOLATED_PLACE', `장소 "${place.name}"는 어떤 장소와도 연결되어 있지 않습니다.`)
    }
  }

  if (draft.characters.length === 0) {
    err('NO_CHARACTERS', '캐릭터가 한 명도 없습니다.')
  } else if (draft.characters.length !== draft.targetPopulation) {
    warn('POPULATION_MISMATCH', `설정된 참가 인원(${draft.targetPopulation}명)과 실제 캐릭터 수(${draft.characters.length}명)가 다릅니다.`)
  }
  if (draft.studio ? draft.characters.length > 100 || draft.studio.activeLimit > config.maxActiveCharacters : draft.characters.length > config.maxActiveCharacters || draft.targetPopulation > config.maxActiveCharacters) err('MAX_ACTIVE_CHARACTERS', `동시 활성 캐릭터 한도를 확인하세요 (${config.maxActiveCharacters}명).`)
  if (draft.studio) {
    const s = draft.studio
    if (!Number.isInteger(s.activeLimit) || s.activeLimit < 1) err('ACTIVE_LIMIT', '동시 활성 캐릭터는 1명 이상이어야 합니다.')
    for (const e of s.events) {
      if (!e.name.trim()) err('EVENT_NAME', '사건 이름이 비어 있습니다.')
      if (['flood','resource'].includes(e.effect) && !placeIds.has(e.placeId)) err('EVENT_PLACE', '사건의 영향 장소를 선택하세요.')
      if (e.effect === 'resource' && !draft.places.find(p=>p.id===e.placeId)?.resources.some(r=>r.key===e.resourceKey)) err('EVENT_RESOURCE', '사건의 대상 자원이 장소에 존재하지 않습니다.')
      if (e.effect === 'goal' && !e.goalId.trim()) err('EVENT_GOAL', '달성할 목표 식별자를 입력하세요.')
    }
    for (const t of s.truths) if (!t.summary.trim() || t.discoverable && !placeIds.has(t.placeId) || t.revealedPlaceId && !placeIds.has(t.revealedPlaceId) || t.itemId && !s.items.some(i=>i.id===t.itemId) || t.eventId && !s.events.some(e=>e.id===t.eventId)) err('TRUTH_REFERENCE', '숨겨진 진실의 내용·발견 장소·연결 조건을 확인하세요.')
    for (const e of s.endings) if (e.type==='place'&&!placeIds.has(e.ref)||e.type==='event'&&!s.events.some(v=>v.id===e.ref)||e.type==='goal'&&!s.events.some(v=>v.goalId===e.ref&&v.effect==='goal')) err('END_REFERENCE', '종료 조건이 참조하는 장소·사건·목표를 확인하세요.')
    for (const p of draft.places) if (new Set(p.resources.map(r=>r.key)).size!==p.resources.length) err('DUPLICATE_RESOURCE', `${p.name}: 같은 종류의 자원은 하나의 수량으로 합쳐 주세요.`)
    for (const i of s.items) if (!i.name.trim()) err('ITEM_NAME', '아이템 이름을 입력하세요.')
    const pairs = new Set<string>()
    for (const r of s.relationships) {
      const key = [r.from,r.to].sort().join(':')
      if (pairs.has(key)) err('DUPLICATE_RELATIONSHIP','같은 두 캐릭터의 초기 관계를 중복 지정하지 마세요.')
      pairs.add(key)
      if (r.kind==='lover') {
        const a=draft.characters.find(c=>c.id===r.from),b=draft.characters.find(c=>c.id===r.to)
        const aSame=s.characters[r.from]?.orientation==='동성애',bSame=s.characters[r.to]?.orientation==='동성애'
        if(!a?.gender||!b?.gender||aSame!==(a.gender===b.gender)||bSame!==(a.gender===b.gender))err('RELATIONSHIP_ORIENTATION','연인 초기 관계가 두 사람의 성별·성적 지향과 맞지 않습니다.')
      }
    }
  }
  const itemLocations = new Map<string, string>()
  for (const place of draft.places) for (const item of place.items) {
    if (itemLocations.has(item)) err('DUPLICATE_WORLD_ITEM', `고유 물건 ${item}이 여러 장소에 지정되어 있습니다.`)
    itemLocations.set(item, place.id)
  }
  for (const connection of draft.connections) if (!Number.isFinite(connection.travelTime) || connection.travelTime < 1) err('INVALID_TRAVEL_TIME', '이동 시간은 1분 이상이어야 합니다.')

  const placeOccupancy = new Map<string, number>()
  draft.characters.forEach((c, index) => {
    const label = c.name.trim() || `캐릭터 ${index + 1}`
    if (!c.initialPlaceId) {
      err('MISSING_INITIAL_LOCATION', `${label}의 초기 위치가 설정되지 않았습니다.`)
    } else if (!placeIds.has(c.initialPlaceId)) {
      err('INVALID_INITIAL_LOCATION', `${label}의 초기 위치가 존재하지 않는 장소를 가리킵니다.`)
    } else {
      placeOccupancy.set(c.initialPlaceId, (placeOccupancy.get(c.initialPlaceId) ?? 0) + 1)
    }
    if (!c.name.trim()) err('MISSING_NAME', `이름이 비어 있는 캐릭터가 있습니다 (순번 ${index + 1}).`)
    if (!['openai', 'anthropic'].includes(c.provider)) err('INVALID_PROVIDER', `${label}의 provider 설정이 올바르지 않습니다.`)
    if (!config.worldDemoMode && c.provider === 'openai' && !config.openaiApiKey) err('OPENAI_KEY_REQUIRED', `${label}은 OpenAI를 사용하지만 서버에 OPENAI_API_KEY가 없습니다.`)
    if (!config.worldDemoMode && c.provider === 'anthropic' && !config.anthropicApiKey) err('ANTHROPIC_KEY_REQUIRED', `${label}은 Anthropic을 사용하지만 서버에 ANTHROPIC_API_KEY가 없습니다.`)
    for (const value of [...Object.values(c.humanState), ...Object.values(c.emotion)]) if (!Number.isInteger(value) || value < 0 || value > 10) err('INVALID_CHARACTER_STATE', `${label}의 상태값은 0~10 정수여야 합니다.`)
  })
  for (const place of draft.places) {
    const occupancy = placeOccupancy.get(place.id) ?? 0
    if (place.capacity !== null && occupancy > place.capacity) {
      err('CAPACITY_EXCEEDED', `장소 "${place.name}"의 수용 인원(${place.capacity}명)을 초과하는 캐릭터(${occupancy}명)가 배치되었습니다.`)
    }
  }

  // Section 28: a unique world item can never be handed to two characters at once. A declared
  // place item catalog exists to sanity-check inventory references, but personal items with no
  // catalog match are only a soft warning — the admin may legitimately type free-text belongings.
  const itemCatalog = new Set(draft.places.flatMap(p => p.items))
  const itemOwners = new Map<string, string[]>()
  draft.characters.forEach((c, index) => {
    const label = c.name.trim() || `캐릭터 ${index + 1}`
    for (const item of c.inventory) {
      itemOwners.set(item, [...(itemOwners.get(item) ?? []), label])
      if (itemCatalog.size > 0 && !itemCatalog.has(item)) {
        warn('ITEM_NOT_IN_CATALOG', `${label}에게 지정된 아이템 "${item}"이 장소 물품 목록에 존재하지 않습니다.`)
      }
    }
  })
  for (const [item, owners] of itemOwners) {
    if (owners.length > 1) err('DUPLICATE_ITEM', `동일한 고유 ITEM "${item}"이 여러 캐릭터(${owners.join(', ')})에게 동시에 지정되어 있습니다.`)
  }

  for (const place of draft.places) {
    if (!Number.isFinite(place.x) || !Number.isFinite(place.y)) err('INVALID_COORDINATES', '지도 좌표는 유한한 수여야 합니다.')
    if (place.capacity !== null && (!Number.isInteger(place.capacity) || place.capacity < 1)) err('INVALID_CAPACITY', '수용 인원은 양의 정수여야 합니다.')
    if (new Set(place.resources.map(r => r.key)).size !== place.resources.length) err('DUPLICATE_RESOURCE', '한 장소에 같은 키의 자원을 중복 지정할 수 없습니다.')
    for (const resource of place.resources) {
      if (!resource.key.trim() || resource.key.includes(':') || !Number.isFinite(resource.level) || !Number.isFinite(resource.max) || resource.level < 0 || resource.max < 0 || resource.level > resource.max) {
        err('INVALID_RESOURCE', `장소 "${place.name}"의 자원 "${resource.label}" 수치가 유효하지 않습니다.`)
      }
    }
  }
  for (const resource of draft.initialResources) {
    if (draft.places[0]?.resources.some(r => r.key === resource.key)) err('DUPLICATE_INITIAL_RESOURCE', '첫 장소의 자원과 세계 초기 자원의 키가 겹칩니다.')
    if (!resource.key.trim() || resource.key.includes(':') || !Number.isFinite(resource.level) || !Number.isFinite(resource.max) || resource.level < 0 || resource.max < 0 || resource.level > resource.max) {
      err('INVALID_RESOURCE', `세계 초기 자원 "${resource.label}" 수치가 유효하지 않습니다.`)
    }
  }

  if (new Set(draft.initialResources.map(r => r.key)).size !== draft.initialResources.length) err('DUPLICATE_RESOURCE', '초기 자원 키가 중복되었습니다.')

  const characterIds = new Set(draft.characters.map(c => c.id))
  for (const rel of draft.relationships) {
    if (!characterIds.has(rel.fromCharacterId) || !characterIds.has(rel.toCharacterId)) {
      err('INVALID_RELATIONSHIP', '존재하지 않는 캐릭터를 참조하는 관계 정보가 있습니다.')
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
