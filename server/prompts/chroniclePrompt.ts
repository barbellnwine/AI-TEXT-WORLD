// CHRONICLE PROMPT — folds several ChronicleEntry scenes into one Chapter (a day or story-level
// summary). Input is already-narrated scenes, never raw WorldEvents and never HIDDEN WORLD TRUTH.
// This is the layer above NARRATOR: NARRATOR turns events into scenes, this turns scenes into a
// day's headline. See server/domain/worldMock.ts#CHAPTERS for the current hand-written mock output
// this would eventually replace.
import type { ChronicleEntry } from '../domain/worldTypes.ts'

export const CHRONICLE_PROMPT_VERSION = '1.0.0'

export const CHRONICLE_PROMPT_INSTRUCTIONS = [
  '당신은 하루 동안 있었던 여러 장면을 하나의 챕터로 요약하는 역할입니다.',
  '주어진 장면들에 이미 쓰인 사실만 사용하십시오. 장면에 없는 사건을 추가하지 마십시오.',
  '{title, summary, changes} 형식의 JSON으로만 응답하십시오.',
].join('\n')

export function buildChroniclePrompt(scenes: ChronicleEntry[], day: number): string {
  return [
    CHRONICLE_PROMPT_INSTRUCTIONS,
    `[DAY ${day} SCENES]`,
    JSON.stringify(scenes.map(s => ({ title: s.title, body: s.body, stateChanges: s.stateChanges })), null, 2),
  ].join('\n\n')
}
