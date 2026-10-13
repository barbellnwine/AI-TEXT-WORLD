// Everything the character popup says about a person beyond their face: what they are carrying,
// how body and mind are holding up, and what is still torn. The panel is then only markup — which
// way a gauge reads (건강 10 is good news, 허기 10 is not), what a carried thing is worth in a
// fight, and which wounds are still open are all decided here, where a test can check them
// without a browser.
import type { Agent, WorldState } from './types'

export type EngineObject = NonNullable<NonNullable<WorldState['engine']>['objects']>[number]
type Injury = NonNullable<Agent['trauma']>['injuries'][number]
type FunctionKey = keyof NonNullable<Agent['trauma']>['functions']

export type GaugeKey = 'health' | 'energy' | 'hunger' | 'thirst' | 'loneliness' | 'fatigue' | 'stress'
  | 'mood' | 'anger' | 'fear' | 'wetness' | 'cold' | 'heat' | 'skin' | 'infection'
export type GroupKey = 'body' | 'mind' | 'exposure'
export type Tone = 'good' | 'watch' | 'bad'

export interface Gauge { key: GaugeKey; value: number; worseWhen: 'high' | 'low'; tone: Tone }
export interface GaugeGroup { key: GroupKey; gauges: Gauge[] }

interface GaugeSpec { key: GaugeKey; worseWhen: 'high' | 'low'; read: (agent: Agent) => number | undefined }

// Every one of these runs 0–10 in the public payload. A world launched before a field existed
// simply omits it, so a missing reading is left out of the sheet rather than drawn as a zero:
// "허기 0" and "we were never told" are not the same thing to read.
const GROUPS: Array<[GroupKey, GaugeSpec[]]> = [
  ['body', [
    { key: 'health', worseWhen: 'low', read: a => a.vitals?.health },
    { key: 'energy', worseWhen: 'low', read: a => a.vitals?.energy },
    { key: 'hunger', worseWhen: 'high', read: a => a.vitals?.hunger },
    { key: 'thirst', worseWhen: 'high', read: a => a.vitals?.thirst },
  ]],
  ['mind', [
    { key: 'fatigue', worseWhen: 'high', read: a => a.humanState?.fatigue },
    { key: 'stress', worseWhen: 'high', read: a => a.humanState?.stress },
    { key: 'mood', worseWhen: 'low', read: a => a.emotion?.mood },
    { key: 'anger', worseWhen: 'high', read: a => a.emotion?.anger },
    { key: 'fear', worseWhen: 'high', read: a => a.emotion?.fear },
    { key: 'loneliness', worseWhen: 'high', read: a => a.vitals?.loneliness },
  ]],
  ['exposure', [
    { key: 'wetness', worseWhen: 'high', read: a => a.exposure?.wetness },
    { key: 'cold', worseWhen: 'high', read: a => a.exposure?.coldExposure },
    { key: 'heat', worseWhen: 'high', read: a => a.exposure?.heatExposure },
    { key: 'skin', worseWhen: 'low', read: a => a.exposure?.skinCondition },
    { key: 'infection', worseWhen: 'high', read: a => a.exposure?.infectionRisk },
  ]],
]

export function gaugeTone(value: number, worseWhen: 'high' | 'low'): Tone {
  const severity = worseWhen === 'high' ? value : 10 - value
  return severity >= 7 ? 'bad' : severity >= 4 ? 'watch' : 'good'
}

export function conditionGroups(agent: Agent): GaugeGroup[] {
  return GROUPS
    .map(([key, specs]) => ({
      key,
      gauges: specs.flatMap<Gauge>(spec => {
        const value = spec.read(agent)
        if (typeof value !== 'number' || !Number.isFinite(value)) return []
        return [{ key: spec.key, value, worseWhen: spec.worseWhen, tone: gaugeTone(value, spec.worseWhen) }]
      }),
    }))
    .filter(group => group.gauges.length > 0)
}

export interface Gear {
  id: string; name: string; kind: string; quantity: number; condition: string
  edge?: 'sharp' | 'blunt'; attackPower: number; cover: number; material?: string
}

// A thing is carried when the engine says this person is holding it. Weapons sort to the front:
// on this island, what someone has in their hands is the first thing a reader looks for.
export function carriedGear(agentId: string, objects: EngineObject[] = []): Gear[] {
  return objects
    .filter(object => object.location.kind === 'agent' && object.location.id === agentId)
    .map(object => ({
      id: object.id, name: object.name, kind: object.kind, quantity: object.quantity, condition: object.condition,
      edge: object.physical?.edge, attackPower: object.physical?.attackPower ?? 0,
      cover: object.physical?.cover ?? 0, material: object.physical?.material,
    }))
    .sort((a, b) => b.attackPower - a.attackPower || a.name.localeCompare(b.name))
}

// Whatever the older string-list inventory mentions that no carried object accounts for. A season
// from before the object engine has only the strings, so dropping them would empty the shelf.
export function looseInventory(agent: Agent, gear: Gear[]): string[] {
  const held = new Set(gear.map(item => item.name))
  return agent.inventory.filter(name => !held.has(name))
}

export interface WoundReport {
  pain: number; bloodLoss: number; untreated: number
  injuries: Injury[]
  functions: Array<{ key: FunctionKey; loss: number }>
}

// Null when there is nothing to say. Someone grazed on day one and long since mended still carries
// a trauma record, and a sheet that opens on 부상 for them tells the reader something untrue about
// the shape they are in now.
export function woundReport(agent: Agent): WoundReport | null {
  const trauma = agent.trauma
  if (!trauma) return null
  const open = trauma.injuries.filter(wound => !wound.healed)
  const functions = (Object.entries(trauma.functions) as Array<[FunctionKey, number]>)
    .filter(([, loss]) => loss > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, loss]) => ({ key, loss }))
  if (open.length === 0 && functions.length === 0 && trauma.pain <= 0) return null
  return {
    pain: trauma.pain, bloodLoss: trauma.bloodLoss,
    untreated: open.filter(wound => wound.treatedAt === null).length,
    injuries: [...open].sort((a, b) => b.severity - a.severity),
    functions,
  }
}

// The sheet's own vocabulary, kept next to the derivation it names rather than in the site
// dictionary: these words exist nowhere else, and a reader of this file should be able to see what
// 'skin' or 'laceration' is going to read as on the page.
const LABELS: Record<string, readonly [ko: string, en: string]> = {
  'group:body': ['신체', 'Body'],
  'group:mind': ['정신', 'Mind'],
  'group:exposure': ['환경 노출', 'Exposure'],
  'gauge:health': ['건강', 'Health'],
  'gauge:energy': ['체력', 'Stamina'],
  'gauge:hunger': ['허기', 'Hunger'],
  'gauge:thirst': ['갈증', 'Thirst'],
  'gauge:loneliness': ['외로움', 'Loneliness'],
  'gauge:fatigue': ['피로', 'Fatigue'],
  'gauge:stress': ['스트레스', 'Stress'],
  'gauge:mood': ['기분', 'Mood'],
  'gauge:anger': ['분노', 'Anger'],
  'gauge:fear': ['공포', 'Fear'],
  'gauge:wetness': ['젖음', 'Wetness'],
  'gauge:cold': ['추위', 'Cold'],
  'gauge:heat': ['더위', 'Heat'],
  'gauge:skin': ['피부', 'Skin'],
  'gauge:infection': ['감염 위험', 'Infection risk'],
  'kind:item': ['물품', 'Item'],
  'kind:food': ['음식', 'Food'],
  'kind:water': ['물', 'Water'],
  'kind:medicine': ['의약품', 'Medicine'],
  'kind:tool': ['도구', 'Tool'],
  'kind:fuel': ['연료', 'Fuel'],
  'condition:intact': ['온전', 'Intact'],
  'condition:damaged': ['손상', 'Damaged'],
  'condition:destroyed': ['파손', 'Broken'],
  'edge:sharp': ['날붙이', 'Bladed'],
  'edge:blunt': ['둔기', 'Blunt'],
  'part:HEAD': ['머리', 'Head'],
  'part:TORSO': ['몸통', 'Torso'],
  'part:ARM': ['팔', 'Arm'],
  'part:LEG': ['다리', 'Leg'],
  'injury:abrasion': ['찰과상', 'Abrasion'],
  'injury:laceration': ['자상', 'Laceration'],
  'injury:contusion': ['타박상', 'Contusion'],
  'injury:fracture': ['골절', 'Fracture'],
  'site:scalp': ['두피', 'scalp'],
  'site:face': ['얼굴', 'face'],
  'site:eye': ['눈', 'eye'],
  'function:vision': ['시야', 'Vision'],
  'function:mobility': ['이동', 'Mobility'],
  'function:dexterity': ['손 사용', 'Hand use'],
  'function:attention': ['집중', 'Focus'],
  'stance:ally': ['동맹', 'Ally'],
  'stance:friendly': ['우호', 'Friendly'],
  'stance:neutral': ['중립', 'Neutral'],
  'stance:wary': ['경계', 'Wary'],
  'stance:hostile': ['적대', 'Hostile'],
  'text:gear': ['가진 장비', 'Carried gear'],
  'text:noGear': ['아무것도 가지고 있지 않습니다.', 'Carrying nothing.'],
  'text:wounds': ['부상', 'Injuries'],
  'text:ties': ['관계', 'Ties'],
  'text:noTies': ['알려진 관계가 없습니다.', 'No known ties.'],
  'text:record': ['전체 기록 보기', 'Open full record'],
  'text:goal': ['공개된 목표', 'Stated goal'],
  'text:noGoal': ['공개되지 않음', 'Not stated'],
  'text:noAction': ['기록된 행동이 없습니다.', 'Nothing recorded yet.'],
  'text:unknownPlace': ['위치 불명', 'Location unknown'],
  'text:lastActive': ['최근 활동', 'Last active'],
  'text:pain': ['통증', 'Pain'],
  'text:blood': ['출혈 부담', 'Blood loss'],
  'text:untreated': ['미처치 상처', 'Untreated wounds'],
  'text:treated': ['처치됨', 'treated'],
  'text:needsCare': ['처치 안 됨', 'untreated'],
  'text:severity': ['심각도', 'Severity'],
  'text:impairment': ['제약', 'Impairment'],
  'text:attack': ['공격력', 'Attack'],
  'text:cover': ['엄폐', 'Cover'],
  'text:travel': ['이동 중', 'On the move'],
}

// An unlisted key reads as its own tail rather than blanking the row: a season that invents a new
// object kind should show that kind, not an empty cell.
export function sheetLabel(key: string, locale: string): string {
  const pair = LABELS[key]
  return pair ? pair[locale === 'en-US' ? 1 : 0] : key.slice(key.indexOf(':') + 1)
}

export const SHEET_LABEL_KEYS = Object.keys(LABELS)
