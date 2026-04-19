import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type NumberOfUsersData = {
  user_count: string;
  reasoning: string;
  source_link: string;
};

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseNumberOfUsersResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<NumberOfUsersData>[] {
  const parsedMap = new Map<string, NumberOfUsersData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const user_count = typeof rec['user_count'] === 'string' ? rec['user_count'] : '';
    const reasoning = typeof rec['reasoning'] === 'string' ? rec['reasoning'] : '';
    const source_link = typeof rec['source_link'] === 'string' ? rec['source_link'] : '';
    if (!domainRaw || !user_count) continue;
    parsedMap.set(normalizeDomain(domainRaw), { user_count, reasoning, source_link });
  }

  const results = companies.map((company) => {
    const data = parsedMap.get(company.domain);
    if (!data) return { company, error: 'no output from Exa' };
    return { company, data };
  });

  const missing = results.filter((r) => r.error !== undefined).map((r) => r.company.domain);
  if (missing.length > 0) {
    console.log(
      `[numberOfUsers] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export function formatNumberOfUsersForAttio(d: NumberOfUsersData): string {
  const parts = [`User count: ${d.user_count}`];
  if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
  if (d.source_link) parts.push(`Source link: ${d.source_link}`);
  return parts.join('\n\n');
}
