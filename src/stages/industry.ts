import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany, StageResult } from './types.js';

export type IndustryData = { industry: string; reason: string };

export const ALLOWED_INDUSTRIES: ReadonlySet<string> = new Set([
  'E-commerce',
  'Marketplaces',
  'Fintech',
  'Payments',
  'Crypto / Web3',
  'Consumer social',
  'Media / Streaming',
  'Gaming',
  'On-demand / Delivery',
  'Logistics / Mobility',
  'Travel / Booking',
  'SaaS (B2B)',
  'SaaS (prosumer / PLG)',
  'Developer tools / APIs',
  'Data / AI platforms',
  'Cybersecurity',
  'Adtech / Martech',
  'Ride-sharing / transportation networks',
  'Food tech',
  'Creator economy platforms',
  'Market data / trading platforms',
  'Real-time communications (chat, voice, video APIs)',
  'IoT / connected devices platforms',
  'Unknown',
]);

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '');
}

function extractParsedObject(raw: ExaSearchResponse): Record<string, unknown> | null {
  const content = raw.output?.content;
  if (content && typeof content === 'object') return content as Record<string, unknown>;
  return null;
}

export function parseIndustryResponse(
  raw: ExaSearchResponse,
  companies: StageCompany[]
): StageResult<IndustryData>[] {
  const parsedMap = new Map<string, IndustryData>();
  const payload = extractParsedObject(raw);
  const items = Array.isArray(payload?.['companies']) ? (payload!['companies'] as unknown[]) : [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const domainRaw = typeof rec['domain'] === 'string' ? rec['domain'] : '';
    const industryRaw = typeof rec['industry'] === 'string' ? rec['industry'] : '';
    const reason = typeof rec['reason'] === 'string' ? rec['reason'] : '';
    if (!domainRaw || !industryRaw) continue;
    parsedMap.set(normalizeDomain(domainRaw), { industry: industryRaw, reason });
  }

  const results = companies.map((company): StageResult<IndustryData> => {
    const data = parsedMap.get(company.domain);
    if (!data) return { company, error: 'industry: no data returned' };
    if (!ALLOWED_INDUSTRIES.has(data.industry)) {
      return { company, error: `industry: off-enum value "${data.industry}"` };
    }
    return { company, data };
  });

  const missing = results.filter((r) => r.error !== undefined).map((r) => r.company.domain);
  if (missing.length > 0) {
    console.log(
      `[industry] parse miss — expected=[${companies.map((c) => c.domain).join(', ')}] parsed=[${[...parsedMap.keys()].join(', ')}] missing=[${missing.join(', ')}]`
    );
  }

  return results;
}

export function formatIndustryForAttio(d: IndustryData): string {
  return `industry: ${d.industry}\nreason: ${d.reason}`;
}
