import { config } from '../config.ts'
import { ACTION_JSON_SCHEMA, ACTION_TOOL_NAME } from '../domain/actionSchema.ts'
import { buildUserPrompt } from '../domain/promptBuilder.ts'
import type { ModelActionResponse, ProviderAdapter, ProviderCallInput, ProviderCallResult } from '../domain/types.ts'
import { fetchWithLimits, ProviderCallError } from './httpUtil.ts'

// Server-side only. This module must never be imported from client code.
export const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',
  isConfigured: () => Boolean(config.anthropicApiKey),

  async generateAction(input: ProviderCallInput): Promise<ProviderCallResult> {
    if (!config.anthropicApiKey) throw new ProviderCallError('PROVIDER_KEY_MISSING', 'ANTHROPIC_API_KEY missing')
    const started = Date.now()

    const response = await fetchWithLimits('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.agent.model,
        max_tokens: input.maxOutputTokens,
        system: input.agent.systemPrompt,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
        tools: [{ name: ACTION_TOOL_NAME, description: 'Submit exactly one community action.', input_schema: ACTION_JSON_SCHEMA }],
        tool_choice: { type: 'tool', name: ACTION_TOOL_NAME },
      }),
    })

    if (!response.ok) {
      throw new ProviderCallError(`ANTHROPIC_HTTP_${response.status}`, 'anthropic request failed')
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; input?: ModelActionResponse }>
      usage?: { input_tokens: number; output_tokens: number }
    }

    const toolUse = data.content.find(block => block.type === 'tool_use')
    if (!toolUse?.input) throw new ProviderCallError('ANTHROPIC_EMPTY_RESPONSE', 'no tool_use block in response')

    return {
      raw: toolUse.input,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      latencyMs: Date.now() - started,
    }
  },
}
