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
  if (draft.characters.length > config.maxActiveCharacters || draft.targetPopulation > config.maxActiveCharacters) err('MAX_ACTIVE_CHARACTERS', `현재 WORLD의 활성 캐릭터는 최대 ${config.maxActiveCharacters}명입니다.`)
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
    for (const value of [...Object.values(c.humanState), ...Object.values(c.emotion)]) if (!Number.isInteger(value) || value < 1 || value > 10) err('INVALID_CHARACTER_STATE', `${label}의 상태값은 1~10 정수여야 합니다.`)
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
