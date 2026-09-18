import { ACTION_JSON_SCHEMA, ACTION_TOOL_NAME } from '../domain/actionSchema.ts'
import { buildUserPrompt } from '../domain/promptBuilder.ts'
import type { Provider, ProviderCallInput } from '../domain/types.ts'

export const MAX_PROVIDER_REQUEST_BYTES = 12_000

export function providerRequestBody(provider: Provider, input: ProviderCallInput): string {
  const messages = [{ role: 'user', content: buildUserPrompt(input) }]
  const common = { model: input.agent.model, max_tokens: Math.min(400, input.maxOutputTokens) }
  return JSON.stringify(provider === 'openai' ? {
    ...common,
    messages: [{ role: 'system', content: input.agent.systemPrompt }, ...messages],
    response_format: { type: 'json_schema', json_schema: { name: 'agent_action', strict: true, schema: ACTION_JSON_SCHEMA } },
  } : {
    ...common, system: input.agent.systemPrompt, messages,
    tools: [{ name: ACTION_TOOL_NAME, description: 'Submit exactly one community action.', input_schema: ACTION_JSON_SCHEMA }],
    tool_choice: { type: 'tool', name: ACTION_TOOL_NAME },
  })
}

export function boundCallInput(provider: Provider, input: ProviderCallInput): ProviderCallInput {
  const bounded = { ...input, privateMemories: [...input.privateMemories], recentPublicPosts: [...input.recentPublicPosts] }
  while (Buffer.byteLength(providerRequestBody(provider, bounded)) > MAX_PROVIDER_REQUEST_BYTES) {
    if (bounded.privateMemories.length) bounded.privateMemories.shift()
    else if (bounded.recentPublicPosts.length) bounded.recentPublicPosts.pop()
    else throw new Error('provider_context_too_large')
  }
  return bounded
}

// Conservative reservation based on the full serialized request, including schema
// and persona, with protocol overhead. Not the provider's authoritative tokenizer.
export function reservedInputTokens(provider: Provider, input: ProviderCallInput): number {
  return Buffer.byteLength(providerRequestBody(provider, input)) + 1024
}
