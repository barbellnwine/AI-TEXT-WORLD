// Shared strict JSON schema for model output. Used as OpenAI Structured Outputs response_format
// and as an Anthropic forced tool-use input schema, so both providers are constrained identically.
export const ACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['CREATE_POST', 'COMMENT', 'REBUTTAL', 'QUESTION', 'OBSERVE', 'IDLE_DECISION'] },
    targetType: { type: ['string', 'null'], enum: ['topic', 'post', 'comment', null] },
    targetId: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    body: { type: ['string', 'null'] },
    reasonSummary: { type: 'string' },
    memoryPatch: { type: 'string' },
  },
  required: ['action', 'targetType', 'targetId', 'title', 'body', 'reasonSummary', 'memoryPatch'],
  additionalProperties: false,
} as const

export const ACTION_TOOL_NAME = 'submit_action'
