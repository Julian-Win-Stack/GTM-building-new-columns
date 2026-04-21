import type { ExaSearchResponse } from '../apis/exa.js';
import type { GateRule, StageCompany, StageResult } from './types.js';

export type DigitalNativeCategory =
  | 'Digital-native B2C'
  | 'Digital-native B2B'
  | 'Digital-native B2B2C'
  | 'Digital-native B2C2B'
  | 'NOT Digital-native';

export type DigitalNativeData = {
  category: DigitalNativeCategory;
  confidence: string;
  reason: string;
  source_links: string[];
};

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'Digital-native B2C',
  'Digital-native B2B',
  'Digital-native B2B2C',
  'Digital-native B2C2B',
  'NOT Digital-native',
]);

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseDigitalNativeResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<DigitalNativeData>[] {
  const parsedMap = new Map<string, DigitalNativeData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const category = typeof rec['category'] === 'string' ? rec['category'] : '';
    const confidence = typeof rec['confidence'] === 'string' ? rec['confidence'] : '';
    const reason = typeof rec['reason'] === 'string' ? rec['reason'] : '';
    const source_links = Array.isArray(rec['source_links'])
      ? (rec['source_links'] as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];
    if (!domainRaw || !category || !confidence || !reason) continue;
    if (!VALID_CATEGORIES.has(category)) continue;
    parsedMap.set(normalizeDomain(domainRaw), {
      category: category as DigitalNativeCategory,
      confidence,
      reason,
      source_links,
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
      `[digitalNative] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );

  }

  return results;
}

export const digitalNativeGate: GateRule<DigitalNativeData> = (d) =>
  d.category !== 'NOT Digital-native';

export function formatDigitalNativeForAttio(d: DigitalNativeData): string {
  const parts = [`${d.category}`, `Confidence: ${d.confidence}`, `Reasoning: ${d.reason}`];
  if (d.source_links.length > 0) {
    parts.push(`Sources:\n${d.source_links.join('\n')}`);
  }
  return parts.join('\n\n');
}

export const digitalNativeCacheGate = (cached: string): boolean => {
  const category = getDigitalNativeCategoryFromCached(cached);
  return category !== null && category !== 'NOT Digital-native';
};

export function getDigitalNativeCategoryFromCached(cached: string): DigitalNativeCategory | null {
  const firstLine = cached.split('\n')[0]?.trim() ?? '';
  if (VALID_CATEGORIES.has(firstLine)) return firstLine as DigitalNativeCategory;
  return null;
}
