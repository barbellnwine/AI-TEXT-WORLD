import type { ProposedAction } from './actionSchema.ts'

export interface HumanState { survival_need: number; fatigue: number; stress: number; sexual_desire: number; greed: number; ambition: number }
export interface EmotionState { mood: number; anger: number; fear: number }
export interface AgentMemory { id: string; summary: string; sourceEventIds: string[]; importance: 'normal' | 'high'; atMinute: number }
export interface WorldObject {
  id: string; name: string; kind: 'item' | 'food' | 'water' | 'medicine' | 'tool' | 'fuel'
  quantity: number; location: { kind: 'place' | 'agent'; id: string }; condition: 'intact' | 'damaged' | 'destroyed'
}
export interface WorldTruth {
  itemId?: string; eventId?: string
  id: string; summary: string; placeId: string | null; revealedPlaceId?: string
  discoveredBy: string[]
}
export interface WorldConnection { fromPlaceId: string; toPlaceId: string; travelMinutes: number; blocked: boolean; requirements: string }
export interface OngoingAction { id: string; proposal: ProposedAction; startedMinute: number; completesMinute: number; startEventId: string }
export interface EngineState {
  context?: { genre: string; background: string }
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
