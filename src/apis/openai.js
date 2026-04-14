import OpenAI from 'openai';
import { KEYS } from '../config.js';

export const openai = new OpenAI({ apiKey: KEYS.openai });

export async function judge({ system, user, model = 'gpt-4o-mini', schema }) {
  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(schema
      ? { response_format: { type: 'json_schema', json_schema: schema } }
      : { response_format: { type: 'json_object' } }),
  });
  const text = res.choices[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}
