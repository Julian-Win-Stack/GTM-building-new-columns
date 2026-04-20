import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type AiAdoptionMindsetData = { text: string };

function extractTextContent(raw: ExaSearchResponse): string | null {
  const content = raw.output?.content;
  if (typeof content === 'string' && content.trim().length > 0) return content.trim();
  return null;
}

export function parseAiAdoptionMindsetResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<AiAdoptionMindsetData>[] {
  const text = extractTextContent(raw);
  return companies.map((company) =>
    text ? { company, data: { text } } : { company, error: 'no output from Exa' }
  );
}

export function formatAiAdoptionMindsetForAttio(d: AiAdoptionMindsetData): string {
  return d.text;
}
