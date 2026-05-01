import OpenAI from 'openai';
import { KEYS } from '../config.js';

// Azure OpenAI exposes an OpenAI-compatible /openai/v1 endpoint.
// Pass baseURL + the Azure api-key header so the standard SDK just works.
export const openai = new OpenAI({
  apiKey: KEYS.azureOpenAIKey,
  baseURL: KEYS.azureOpenAIBaseUrl,
  defaultHeaders: { 'api-key': KEYS.azureOpenAIKey },
});

// Hardcoded Azure deployment names. Single source of truth so dev and Railway
// can never drift. Update both deployments in Azure first, then change here.
export const AZURE_DEPLOYMENT_DEFAULT = 'gpt-5.4';
export const AZURE_DEPLOYMENT_PRO = 'gpt-5.4-pro';

export type JudgeArgs = {
  system: string;
  user: string;
  model?: string;
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
};

export async function judge<T = Record<string, unknown>>(args: JudgeArgs): Promise<T> {
  const { system, user, model = AZURE_DEPLOYMENT_DEFAULT, schema } = args;
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
