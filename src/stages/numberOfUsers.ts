import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type UserCountBucket = '<100' | '100–1K' | '1K–10K' | '10K–100K' | '100K+' | 'unknown';

export type NumberOfUsersData = {
  user_count: string;
  user_count_bucket: UserCountBucket;
  reasoning: string;
  source_link: string;
  source_date: string;
  confidence: 'high' | 'medium' | 'low';
};

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(['high', 'medium', 'low']);
const VALID_BUCKET: ReadonlySet<string> = new Set(['<100', '100–1K', '1K–10K', '10K–100K', '100K+', 'unknown']);

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
    const bucketRaw = typeof rec['user_count_bucket'] === 'string' ? rec['user_count_bucket'] : '';
    const reasoning = typeof rec['reasoning'] === 'string' ? rec['reasoning'] : '';
    const source_link = typeof rec['source_link'] === 'string' ? rec['source_link'] : '';
    const source_date = typeof rec['source_date'] === 'string' ? rec['source_date'] : '';
    const confidenceRaw = typeof rec['confidence'] === 'string' ? rec['confidence'].toLowerCase() : '';
    if (!domainRaw || !user_count || !VALID_BUCKET.has(bucketRaw) || !VALID_CONFIDENCE.has(confidenceRaw)) continue;
    parsedMap.set(normalizeDomain(domainRaw), {
      user_count,
      user_count_bucket: bucketRaw as UserCountBucket,
      reasoning,
      source_link,
      source_date,
      confidence: confidenceRaw as NumberOfUsersData['confidence'],
    });
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
  parts.push(`User count bucket: ${d.user_count_bucket}`);
  if (d.reasoning) parts.push(`Reasoning: ${d.reasoning}`);
  if (d.source_link) parts.push(`Source link: ${d.source_link}`);
  if (d.source_date) parts.push(`Source date: ${d.source_date}`);
  parts.push(`Confidence: ${d.confidence}`);
  return parts.join('\n\n');
}

export function extractUserCountBucketFromCached(cached: string): UserCountBucket | null {
  const PREFIX = 'User count bucket: ';
  for (const line of cached.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(PREFIX)) {
      const val = trimmed.slice(PREFIX.length).trim();
      if (VALID_BUCKET.has(val)) return val as UserCountBucket;
    }
  }
  return null;
}
