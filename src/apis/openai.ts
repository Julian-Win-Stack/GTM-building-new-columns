import OpenAI from 'openai';
import { KEYS } from '../config.js';

// Azure OpenAI exposes an OpenAI-compatible /openai/v1 endpoint.
// Pass baseURL + the Azure api-key header so the standard SDK just works.
export const openai = new OpenAI({
  apiKey: KEYS.azureOpenAIKey,
  baseURL: KEYS.azureOpenAIBaseUrl,
  defaultHeaders: { 'api-key': KEYS.azureOpenAIKey },
});

// Hardcoded Azure deployment name. Single source of truth so dev and Railway
// can never drift. Update the deployment in Azure first, then change here.
export const AZURE_DEPLOYMENT = 'gpt-5.4';

export type JudgeArgs = {
  system: string;
  user: string;
  model?: string;
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
};

export async function judge<T = Record<string, unknown>>(args: JudgeArgs): Promise<T> {
  const { system, user, model = AZURE_DEPLOYMENT, schema } = args;
  const responseFormat = schema
    ? ({ type: 'json_schema', json_schema: schema } as const)
    : ({ type: 'json_object' } as const);
  try {
    const res = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: responseFormat,
    });
    const text = res.choices[0]?.message?.content ?? '{}';
    try {
      return JSON.parse(text) as T;
    } catch {
      return { _raw: text } as unknown as T;
    }
  } catch (err) {
    const e = err as {
      status?: number;
      code?: string | null;
      type?: string | null;
      message?: string;
      error?: { code?: string; message?: string; type?: string; param?: string };
    };
    let body = '<no body>';
    try { body = JSON.stringify(e.error ?? {}).slice(0, 800); } catch { /* noop */ }
    console.error(
      `[openai.judge] FAILED model=${model} responseFormat=${responseFormat.type}` +
      ` status=${e.status} code=${e.code} type=${e.type} message=${e.message}` +
      ` body=${body}`
    );
    throw err;
  }
}
