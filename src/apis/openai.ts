import OpenAI from 'openai';
import { KEYS } from '../config.js';

// Azure OpenAI exposes an OpenAI-compatible /openai/v1 endpoint.
// Pass baseURL + the Azure api-key header so the standard SDK just works.
export const openai = new OpenAI({
  apiKey: KEYS.azureOpenAIKey,
  baseURL: KEYS.azureOpenAIBaseUrl,
  defaultHeaders: { 'api-key': KEYS.azureOpenAIKey },
});

export type JudgeArgs = {
  system: string;
  user: string;
  model?: string;
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
};

export async function judge<T = Record<string, unknown>>(args: JudgeArgs): Promise<T> {
  // `model` here must be an Azure deployment name (set via AZURE_OPENAI_DEPLOYMENT).
  const { system, user, model = KEYS.azureOpenAIDeployment || 'gpt-5.4', schema } = args;
  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(schema
      ? { response_format: { type: 'json_schema', json_schema: schema } as const }
      : { response_format: { type: 'json_object' } as const }),
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(text) as T;
  } catch {
    return { _raw: text } as unknown as T;
  }
}
