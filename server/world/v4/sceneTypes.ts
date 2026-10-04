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
  // A fight, threat or chase that has NOT ended yet: the spotlight stays on these people until it
  // actually resolves, and the GM is pushed harder to settle it the longer it runs.
  standoff?: { ids: string[]; startedMinute: number; scenes: number; note: string }
  // Fresh meetings from continuous movement, waiting for a scene (cleared once narrated).
  encounters?: Array<{ ids: string[]; minute: number; sense: 'sight' | 'hearing' }>
  director: {
    enabled: boolean
    nextEventMinute: number
    dropCount: number
    // Places that become dangerous at effectiveMinute; staying there hurts every hour.
    closures: Array<{ placeId: string; effectiveMinute: number; lastDamageMinute: number }>
    // World minute of the last death, and the toll it was counted from. A long stretch without
    // a death makes the director squeeze harder, whatever killed the last person.
    lastDeathMinute?: number
    deadCount?: number
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

// One thing that actually happened: who did what and how it turned out. Atmosphere, thought and
// foreshadowing are not beats — they are what padding is made of.
export interface SceneBeat { who: string; did: string }

export type ConflictResolution = 'none' | 'fled' | 'yielded' | 'subdued' | 'killed' | 'separated' | 'settled'

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
  beats: SceneBeat[]
  // Whether the same conflict is still running after this scene, and if not, how it ended.
  // Running away is not an ending: fleeing names who ran, chasing names who went after them
  // (empty = they let them go), and the engine resolves the chase on the actual ground.
  conflict: { active: boolean; resolution: ConflictResolution; fleeing: string | null; chasing: string[] }
  outcomes: GmOutcomes
}
