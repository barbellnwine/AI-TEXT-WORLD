import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluation } from './fixture.ts'
import { parseAIResponse } from '../src/utils/parseAIResponse.ts'
import { calculateTier } from '../src/utils/calculateTier.ts'
const json = JSON.stringify(evaluation)
for (const [name, input] of [ ['plain', json], ['prose', '평가 설명\n' + json + '\n끝'], ['json fence', '```json\n' + json + '\n```'], ['plain fence', '```\n' + json + '\n```'] ]) {
  test('parses ' + name, () => assert.deepEqual(parseAIResponse(input).evaluation, evaluation))
}
test('corrects total using subscores', () => assert.equal(parseAIResponse(JSON.stringify({ ...evaluation, total_score: 3 })).correctedFrom, 3))
test('holds verdict without evidence', () => assert.equal(calculateTier(95, false).grade, '보류'))
test('tier boundaries', () => {
  for (const [score, grade] of [[0,'F'],[29,'F'],[30,'D'],[49,'D'],[50,'C'],[64,'C'],[65,'B'],[79,'B'],[80,'A'],[89,'A'],[90,'S'],[100,'S']] as const) assert.equal(calculateTier(score).grade, grade)
})
test('rejects malformed, absent, excessive and mistyped data', () => {
  for (const input of ['', 'not json', '{"scores":}', 'x'.repeat(100001), JSON.stringify({...evaluation, evidence_available: 'false'}), JSON.stringify({...evaluation, scores: {...evaluation.scores, respect: 26}}), JSON.stringify({...evaluation, scores: {...evaluation.scores, safety: -1}}), JSON.stringify({...evaluation, positive_traits: [123]})]) assert.throws(() => parseAIResponse(input))
})
