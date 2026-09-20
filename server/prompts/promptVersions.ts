// Version registry for every prompt role. Every EVENT LOG entry produced by a real model call
// should record which promptVersionId was active (see ModelCallProvenance in
// server/domain/worldTypes.ts), so a past season's behavior stays reconstructable even after a
// prompt's wording changes later.
import { createHash } from 'node:crypto'
import { AGENT_PROMPT_INSTRUCTIONS, AGENT_PROMPT_VERSION } from './agentPrompt.ts'
import { CHRONICLE_PROMPT_INSTRUCTIONS, CHRONICLE_PROMPT_VERSION } from './chroniclePrompt.ts'
import { GM_PROMPT_INSTRUCTIONS, GM_PROMPT_VERSION } from './gmPrompt.ts'
import { MEMORY_PROMPT_INSTRUCTIONS, MEMORY_PROMPT_VERSION } from './memoryPrompt.ts'
import { NARRATOR_PROMPT_INSTRUCTIONS, NARRATOR_PROMPT_VERSION } from './narratorPrompt.ts'
import { WORLD_RULES_TEXT } from './worldRules.ts'

export type PromptRole = 'WORLD_RULES' | 'AGENT' | 'GM' | 'NARRATOR' | 'MEMORY' | 'CHRONICLE' | 'WORLD_ENGINE'

export interface PromptVersion {
  id: string
  role: PromptRole
  version: string
  contentHash: string
  createdAt: string
  isActive: boolean
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

// A fixed "as of build" timestamp would require persistence; this mock phase computes it once at
// module load, which is enough to prove the shape. A real registry would persist createdAt per
// version instead of recomputing it every boot.
const REGISTERED_AT = new Date().toISOString()

function version(role: PromptRole, version: string, content: string): PromptVersion {
  return { id: `${role.toLowerCase()}@${version}`, role, version, contentHash: hashContent(content), createdAt: REGISTERED_AT, isActive: true }
}

export const PROMPT_REGISTRY: PromptVersion[] = [
  version('WORLD_RULES', '1.0.0', WORLD_RULES_TEXT),
  version('AGENT', AGENT_PROMPT_VERSION, AGENT_PROMPT_INSTRUCTIONS),
  version('GM', GM_PROMPT_VERSION, GM_PROMPT_INSTRUCTIONS),
  version('NARRATOR', NARRATOR_PROMPT_VERSION, NARRATOR_PROMPT_INSTRUCTIONS),
  version('MEMORY', MEMORY_PROMPT_VERSION, MEMORY_PROMPT_INSTRUCTIONS),
  version('CHRONICLE', CHRONICLE_PROMPT_VERSION, CHRONICLE_PROMPT_INSTRUCTIONS),
  version('WORLD_ENGINE', '1.0.0', 'code-only, no prompt text — see server/world/worldValidator.ts'),
]

export function getActivePromptVersion(role: PromptRole): PromptVersion | undefined {
  return PROMPT_REGISTRY.find(p => p.role === role && p.isActive)
}
