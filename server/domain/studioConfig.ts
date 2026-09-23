// Shared, dependency-free contract for the creator and deterministic engine.
export const CLIMATES = ['사계절', '건기', '우기', '극한 한랭', '사막', '열대', '온대', '실내 통제 환경', '사용자 정의'] as const
export const WEATHERS = { random: '랜덤', clear: '맑음', cloudy: '흐림', rain: '비', storm: '폭우', snow: '눈', blizzard: '폭설', fog: '안개', wind: '강풍' }
export const GENRES = ['생존', '미스터리', 'SF', '현대', '포스트 아포칼립스', '판타지', '스릴러', '사회 실험', '로맨스', '범죄', '권력 / 정치']
export const PERSONALITIES = ['논리적', '감정적', '침착함', '다혈질', '냉소적', '낙천적', '비관적', '이기적', '이타적', '충동적', '신중함', '사교적', '내향적', '외향적', '의심이 많음', '신뢰가 많음', '공격적', '평화적', '지도자 성향', '추종 성향', '독립적', '의존적', '계산적', '솔직함', '거짓말을 잘함', '호기심이 많음', '겁이 많음', '용감함', '집착적']
export const STRENGTHS = ['체력이 좋음', '판단력이 좋음', '리더십', '협상 능력', '의학 지식', '기계 지식', '생존 지식', '관찰력', '기억력', '사교성', '전투 능력', '침착함']
export const WEAKNESSES = ['겁이 많음', '충동적', '체력이 약함', '불신이 강함', '감정 조절이 어려움', '고집이 강함', '타인을 지나치게 믿음', '위험 감각 부족', '공격적', '사회성이 낮음']
export const PLACE_TYPES = ['실내', '실외', '건물', '자연', '통로', '거주 공간', '작업 공간', '위험 지역', '기타']
export const RESOURCE_PRESETS = { food: '식량', water: '식수', fuel: '연료', power: '전력', medicine: '의약품', wood: '목재', metal: '금속', ammunition: '탄약', money: '화폐' }
export const RELATIONS = { stranger: '모르는 사이', acquaintance: '지인', friend: '친구', lover: '연인', rival: '경쟁자', hostile: '적대' }
export type RelationKind = keyof typeof RELATIONS
export const RELATION_VALUES: Record<RelationKind, [number, number, number, number]> = { stranger: [2, 1, 0, 0], acquaintance: [4, 3, 0, 0], friend: [7, 7, 0, 0], lover: [9, 9, 0, 0], rival: [3, 2, 3, 7], hostile: [0, 0, 9, 5] }
export interface StudioCharacter { orientation: '이성애' | '동성애'; health: number; energy: number; hunger: number; thirst: number; loneliness: number }
export interface StudioItem { id: string; name: string; kind: 'item' | 'food' | 'water' | 'medicine' | 'tool' | 'fuel'; quantity: number; holderKind: 'place' | 'agent'; holderId: string }
export interface StudioEvent { id: string; name: string; description: string; day: number; time: string; placeId: string; visibility: 'public' | 'private'; effect: 'power_off' | 'power_on' | 'flood' | 'resource' | 'goal' | 'notice'; resourceKey: string; amount: number; goalId: string }
export interface StudioTruth { id: string; summary: string; placeId: string; itemId: string; eventId: string; discoverable: boolean; knownBy: string[]; revealedPlaceId: string }
export interface EndRule { id: string; type: 'day' | 'survivors' | 'place' | 'goal' | 'event' | 'all_dead'; value: number; ref: string }
export interface StudioConfig {
  version: 2; climate: typeof CLIMATES[number]; rainChance: number; persistence: number; baseTemperature: number
  activeLimit: number; minutesPerTick: number; seed: number
  characters: Record<string, StudioCharacter>; items: StudioItem[]; events: StudioEvent[]; truths: StudioTruth[]
  relationships: Array<{ from: string; to: string; kind: RelationKind }>
  endings: EndRule[]; endMode: 'AND' | 'OR'
}
export function defaultStudio(limit = 10): StudioConfig { return { version: 2, climate: '온대', rainChance: 35, persistence: 65, baseTemperature: 18, activeLimit: Math.min(3, limit), minutesPerTick: 5, seed: 12345, characters: {}, items: [], events: [], truths: [], relationships: [], endings: [], endMode: 'OR' } }
export function defaultCharacter(): StudioCharacter { return { orientation: '이성애', health: 10, energy: 8, hunger: 2, thirst: 2, loneliness: 2 } }
