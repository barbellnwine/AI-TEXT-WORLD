import type { ProposedAction } from './actionSchema.ts'

export interface HumanState { survival_need: number; fatigue: number; stress: number; sexual_desire: number; greed: number; ambition: number }
export interface EmotionState { mood: number; anger: number; fear: number }
export interface AgentMemory { id: string; summary: string; sourceEventIds: string[]; importance: 'normal' | 'high'; atMinute: number }
export interface WorldObject {
  mass?: number
  provenance?: { sourceObjectIds: string[]; transformation: 'separate' | 'alter' | 'combine'; sourceActionId: string }
  form?: string
  materials?: string[]
  position?: import('./spatialWorld.ts').Point
  physical?: PhysicalProperties
  localArea?: string
  concealedBy?: string
  id: string; name: string; kind: 'item' | 'food' | 'water' | 'medicine' | 'tool' | 'fuel'
  quantity: number; location: { kind: 'place' | 'agent'; id: string }; condition: 'intact' | 'damaged' | 'destroyed'
}
export interface PhysicalProperties { material: string; edge?: 'sharp'|'blunt'; portable: boolean; attackPower: number; cover: number; hardness?: number; modifiable?: boolean; separable?: boolean; combinable?: boolean }
export interface ActionDetail {
  exchange?: {id:string;role:"initiator"|"response"|"simultaneous"|"unlinked";responseToActionId?:string;noticedEventId?:string}

  adjudication?:import('./traumaAdjudication.ts').Adjudication
  version: 1
  startedMinute: number; endedMinute: number
  intent: string
  steps: Array<{ minute:number; actorId:string; kind:'NOTICE'|'PICK_UP'|'AIM'|'STRIKE'|'DEFEND'|'CONSUME'|'WITNESS'|'RESULT'; text:string; objectId?:string }>
  equipment?: {id:string|null;name:string;source:'unarmed'|'inventory'|'ground';sourceId?:string}
  combat?: { method:'CONTACT'; attackerId:string; targetId:string; tool:{id:string|null;name:string;source:'unarmed'|'inventory'|'ground';sourceId?:string}; toolAfter:{kind:'agent';id:string}|null; aimedPart:'HEAD'|'TORSO'|'ARM'|'LEG'; reaction:{kind:'DODGE'|'BLOCK'|'COUNTER'|'SIMULTANEOUS'|'CONTINUE_ATTACK'|'BRACE'|'UNAWARE';source:'chosen_action'|'reflex';reason:string}; outcome:'HIT'|'DODGED'|'BLOCKED'|'MISSED'; injuredPart:string|null; damage:number; roll:number; hitChance:number }
  resource?: {key:string;quantity:number;sourcePlaceId:string;discovererId:null}
  speech?: {speakerAge:number|null;listenerAge:number|null;relation:string;tone:string;anger:number;fear:number}
  witnesses?: Array<{actorId:string;concern:'self_safety'|'ally_safety'|'resource_availability';nextDecisionAt:number}>
}
export interface WorldTruth {
  localArea?: string
  position?: import('./spatialWorld.ts').Point
  itemId?: string; eventId?: string
  id: string; summary: string; placeId: string | null; revealedPlaceId?: string
  discoveredBy: string[]
}
export interface WorldConnection { fromPlaceId: string; toPlaceId: string; travelMinutes: number; blocked: boolean; requirements: string }
export interface OngoingAction { causalEventIds?:string[]; responseToActionId?:string; noticedEventId?:string; adjudication?:import('./traumaAdjudication.ts').Adjudication; detail?:ActionDetail; id: string; proposal: ProposedAction; startedMinute: number; completesMinute: number; startEventId: string }
export interface EngineState {
  objectiveStatus?: { elapsedMinute: number; remainingMinutes: number|null; remainingCompetitors: number|null; targets: Array<{type:'time'|'survivors'|'place'; target:number|string; current:number|string; gap:number}> }
  competition?: { endMinute: number|null; lastSurvivor: boolean }
  requireCombatAdjudication?:boolean
  noticedThreats?:Record<string,{actionId:string;eventId:string;minute:number}>
  combatRng?:number
  defenses?:Record<string,{againstId:string;kind:'DODGE'|'BLOCK';until:number;reason:string}>
  decisions?: Record<string, { intent: string; actionType: string; minute: number; basisEventIds: string[]; candidateId?: string; reasonCodes?: string[]; evaluation?: Array<{ id: string; goal: string; actionType: string; score: number; benefit: number; cost: number; risk: number; fit: number; relationship: number; reasonCodes?: string[] }> }>
  termination?: { minute: number; reason: string; evidenceEventIds: string[]; survivors: number }
  interactions?: Array<{ id: string; actorId: string; targetId: string; placeId: string; area: string; minute: number; expiresMinute: number; intent: string; quote?: string; offerItemId?: string; requestItemId?: string; status: 'pending' | 'accepted' | 'refused'; sourceEventId?: string }>
  outcomes?: Record<string, Array<{ eventId: string; minute: number; actionType: string; area: string; summary: string; failed: boolean }>>
  combatAlerts?: Record<string, number>
  behavior?: {
    history: Array<{ key: string; actorId: string; type: string; minute: number }>
    plans: Array<{ id: string; sourceEventId?: string; placeId: string; proposerId: string; participantIds: string[]; createdMinute: number; expiresMinute: number; status: 'proposed' | 'active' | 'completed' | 'exhausted' | 'expired'; tasks: Array<{ id: string; actorId: string; intent: import('./actionSchema.ts').ActionIntent; status: 'invited' | 'suggested' | 'in_progress' | 'completed' | 'blocked'; result?: string }> }>
  }
  context?: { genre: string; background: string }
  v4?: import('./v4/sceneTypes.ts').V4State
  geo?: import('./geo/geoTypes.ts').WorldGeo
  studio?: import('./studioEngine.ts').StudioRuntime
  weather?: import('./studioEngine.ts').WeatherState
  version: 1
  minute: number
  lastVitalsMinute: number
  connections: WorldConnection[]
  objects: WorldObject[]
  truths: WorldTruth[]
  ongoingActions: OngoingAction[]
  environment: { powerStatus: string; facilityStatus: string }
  // Background narration does not have permission to mutate any of these fields.
}
