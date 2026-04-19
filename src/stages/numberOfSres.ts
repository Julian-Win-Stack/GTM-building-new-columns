import type { HarvestEmployeesResponse } from '../apis/apify.js';
import type { StageCompany, StageResult } from './types.js';

export const SRE_TITLES = ['SRE', 'Site Reliability', 'Site Reliability Engineer'] as const;

export type NumberOfSresData = { count: number; linkedinUrls: string[]; na?: boolean };

export function parseNumberOfSresResponse(
  raw: HarvestEmployeesResponse,
  companies: StageCompany[]
): StageResult<NumberOfSresData>[] {
  const company = companies[0];
  if (!company) return [];
  const items = raw.items ?? [];
  const linkedinUrls = items
    .map((item) => (typeof item['linkedinUrl'] === 'string' ? item['linkedinUrl'].trim() : ''))
    .filter(Boolean);
  return [{ company, data: { count: items.length, linkedinUrls } }];
}

export function formatNumberOfSresForAttio(d: NumberOfSresData): string {
  if (d.na) return 'N/A';
  if (d.linkedinUrls.length === 0) return String(d.count);
  return `${d.count}\n\n${d.linkedinUrls.join('\n')}`;
}
