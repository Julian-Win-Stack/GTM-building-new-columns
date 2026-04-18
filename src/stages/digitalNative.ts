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
    if (!domainRaw || !category || !confidence || !reason) continue;
    if (!VALID_CATEGORIES.has(category)) continue;
    parsedMap.set(normalizeDomain(domainRaw), {
      category: category as DigitalNativeCategory,
      confidence,
      reason,
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
    console.log('[digitalNative] raw Exa output.content:');
    console.log(typeof raw.output?.content === 'string' ? raw.output.content : JSON.stringify(raw.output?.content, null, 2));
  }

  return results;
}

export const digitalNativeGate: GateRule<DigitalNativeData> = (d) =>
  d.category !== 'NOT Digital-native';

export function formatDigitalNativeForAttio(d: DigitalNativeData): string {
  return `${d.category}\n\nConfidence: ${d.confidence}\n\nReasoning: ${d.reason}`;
}
