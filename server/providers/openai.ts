import { config } from '../config.ts'
import { providerRequestBody } from './requestBody.ts'
import type { ModelActionResponse, ProviderAdapter, ProviderCallInput, ProviderCallResult } from '../domain/types.ts'
import { fetchWithLimits, ProviderCallError } from './httpUtil.ts'

// Server-side only. This module must never be imported from client code.
export const openaiAdapter: ProviderAdapter = {
  provider: 'openai',
  isConfigured: () => Boolean(config.openaiApiKey),

  async generateAction(input: ProviderCallInput): Promise<ProviderCallResult> {
    if (!config.openaiApiKey) throw new ProviderCallError('PROVIDER_KEY_MISSING', 'OPENAI_API_KEY missing')
    const started = Date.now()

    const response = await fetchWithLimits('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: providerRequestBody('openai', input),
    })

    if (!response.ok) {
      throw new ProviderCallError(`OPENAI_HTTP_${response.status}`, 'openai request failed')
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    const content = data.choices[0]?.message?.content
    if (!content) throw new ProviderCallError('OPENAI_EMPTY_RESPONSE', 'empty model response')

    let parsed: ModelActionResponse
    try {
      parsed = JSON.parse(content) as ModelActionResponse
    } catch {
      throw new ProviderCallError('OPENAI_INVALID_JSON', 'model returned invalid json')
    }

    return {
      raw: parsed,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      latencyMs: Date.now() - started,
    }
  },
}
