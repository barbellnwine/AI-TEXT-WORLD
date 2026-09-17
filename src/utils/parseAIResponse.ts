import type { ParsedEvaluation } from '../types/evaluation.ts'
import { validateEvaluation } from './validateEvaluation.ts'
export const PARSE_GUIDANCE = '판정문에서 평가 데이터를 찾지 못했습니다. AI 답변 전체를 복사했는지 확인하거나, AI에게 ‘마지막 JSON 형식을 정확히 지켜서 다시 작성해줘’라고 요청해주세요.'
export const MAX_RESPONSE_LENGTH = 100_000
// Quoted braces and escapes must not terminate a JSON object.
function extractObjects(text: string): string[] {
  const starts: number[] = []
  const objects: { start: number; text: string }[] = []
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"' && starts.length) quoted = true
    else if (char === '{') {
      starts.push(index)
      if (starts.length > 64) throw new Error('판정문의 데이터가 너무 복잡합니다. AI에게 지정된 JSON 형식으로 다시 작성해달라고 요청해주세요.')
    } else if (char === '}' && starts.length) {
      const start = starts.pop()!
      objects.push({ start, text: text.slice(start, index + 1) })
    }
  }
  return objects.sort((a, b) => a.start - b.start).map(object => object.text)
}
export function parseAIResponse(input: string): ParsedEvaluation {
  if (!input.trim()) throw new Error('아직 판정문이 없습니다. AI가 작성한 전체 답변을 먼저 붙여 넣어주세요.')
  if (input.length > MAX_RESPONSE_LENGTH) throw new Error('판정문이 너무 깁니다. AI의 평가 설명과 JSON만 100,000자 이내로 붙여 넣어주세요.')
  const fence = String.fromCharCode(96).repeat(3)
  const fences = [...input.matchAll(new RegExp(fence + '(?:json)?\\s*\\n?([\\s\\S]*?)' + fence, 'gi'))].map(match => match[1])
  let validationMessage = ''
  for (const source of [...fences, input]) {
    for (const candidate of extractObjects(source)) {
      let value: unknown
      try { value = JSON.parse(candidate) } catch { continue }
      try { return validateEvaluation(value) }
      catch (error) {
        if (value && typeof value === 'object' && ('scores' in value || 'evidence_available' in value)) {
          validationMessage = error instanceof Error ? error.message : ''
        }
      }
    }
  }
  throw new Error(validationMessage ? PARSE_GUIDANCE + '\n확인 사항: ' + validationMessage : PARSE_GUIDANCE)
}