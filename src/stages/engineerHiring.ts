import type { CareerSiteJobListingsResponse } from '../apis/apify.js';
import type { StageCompany, StageResult } from './types.js';

export const ENGINEER_HIRING_TITLE_SEARCH = [
  'SRE',
  'Site Reliability Engineer',
  'engineer',
  'Site Reliability',
] as const;

export const ENGINEER_HIRING_TITLE_EXCLUSIONS = [
  'Hardware',
  'Electrical',
  'Mechanical',
  'Civil',
  'Firmware',
  'Embedded',
  'RF',
  'Manufacturing',
  'Process',
  'product',
] as const;

export type JobPost = { title: string; url: string };
export type EngineerHiringData = { count: number; posts: JobPost[] };
export type SreHiringData = { count: number; posts: JobPost[] };
export type CombinedHiringData = { engineer: EngineerHiringData; sre: SreHiringData };

const SRE_KEYWORDS = [/sre/i, /site reliability/i];

function isSrePost(title: string): boolean {
  return SRE_KEYWORDS.some((re) => re.test(title));
}

export function parseHiringResponse(
  raw: CareerSiteJobListingsResponse,
  companies: StageCompany[]
): StageResult<CombinedHiringData>[] {
  const company = companies[0];
  if (!company) return [];
  const items = raw.items ?? [];
  const posts: JobPost[] = items
    .filter(
      (item) =>
        typeof item.title === 'string' &&
        typeof item.url === 'string' &&
        item.title.trim().length > 0 &&
        item.url.trim().length > 0
    )
    .map((item) => ({ title: (item.title as string).trim(), url: (item.url as string).trim() }));
  const srePosts = posts.filter((p) => isSrePost(p.title));
  return [
    {
      company,
      data: {
        engineer: { count: posts.length, posts },
        sre: { count: srePosts.length, posts: srePosts },
      },
    },
  ];
}

function formatHiringData(d: EngineerHiringData | SreHiringData): string {
  if (d.count === 0) return '0';
  return `${d.count}\n\n${d.posts.map((p) => `${p.title}: ${p.url}`).join('\n')}`;
}

export function formatEngineerHiringForAttio(d: CombinedHiringData): string {
  return formatHiringData(d.engineer);
}

export function formatSreHiringForAttio(d: CombinedHiringData): string {
  return formatHiringData(d.sre);
}
