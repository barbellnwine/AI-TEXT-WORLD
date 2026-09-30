// v4 SCENE ENGINE — shared types.
// The engine owns only HARD facts (alive/dead, injury burden, location, inventory, time).
// Characters decide freely; a GM model adjudicates a whole scene and writes its prose in one pass.

export interface JournalEntry { minute: number; text: string }

export interface DirectorAnnouncement { minute: number; text: string; kind: 'SUPPLY_DROP' | 'ZONE_WARNING' | 'ZONE_CLOSED' }

export interface V4State {
  version: 1
  sceneCount: number
  // Engine minute of the last scene each character appeared in — drives spotlight rotation.
  lastSceneMinute: Record<string, number>
  lastGroupKey?: string
  repeatCount: number
  consecutiveFailures: number
  // Fresh meetings from continuous movement, waiting for a scene (cleared once narrated).
  encounters?: Array<{ ids: string[]; minute: number; sense: 'sight' | 'hearing' }>
  director: {
    enabled: boolean
    nextEventMinute: number
    dropCount: number
    // Places that become dangerous at effectiveMinute; staying there hurts every hour.
    closures: Array<{ placeId: string; effectiveMinute: number; lastDamageMinute: number }>
    announcements: DirectorAnnouncement[]
  }
}

export interface CharacterIntent {
  agentId: string
  thought: string
  action: string
  speech: string | null
  targetName: string | null
  moveTo: string | null
}

export interface GmOutcomes {
  moves: Array<{ who: string; to: string }>
  injuries: Array<{ who: string; severity: number; description: string; by: string | null }>
  deaths: Array<{ who: string; cause: string; by: string | null }>
  created: Array<{ name: string; kind: string; holder: string | null; description: string }>
  transfers: Array<{ item: string; to: string | null }>
  consumed: Array<{ item: string }>
  // How much the scene relieved each need (0–10). Needs only grow with world time, never here.
  needs: Array<{ who: string; ate: number; drank: number; rested: number }>
  relations: Array<{ from: string; to: string; trust: number; note: string }>
  memories: Array<{ who: string; text: string }>
}

export interface GmResult {
  title: string
  prose: string
  durationMinutes: number
  outcomes: GmOutcomes
}
