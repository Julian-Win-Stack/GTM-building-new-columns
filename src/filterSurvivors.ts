import type { GateRule, StageCompany, StageResult } from './stages/types.js';

export type CacheGate = (cached: string) => boolean;

export type Rejection = { company: StageCompany; reason: string };

export function filterSurvivors<T>(
  stageName: string,
  results: StageResult<T>[],
  gate: GateRule<T>,
  reasonFn: (data: T) => string
): { survivors: StageCompany[]; rejected: Rejection[] } {
  let passed = 0;
  let errored = 0;
  const survivors: StageCompany[] = [];
  const rejected: Rejection[] = [];

  for (const result of results) {
    if (result.error !== undefined) {
      errored++;
      continue;
    }
    if (gate(result.data)) {
      survivors.push(result.company);
      passed++;
    } else {
      rejected.push({ company: result.company, reason: reasonFn(result.data) });
    }
  }

  console.log(`[${stageName}] passed=${passed} rejected=${rejected.length} errored=${errored}`);
  return { survivors, rejected };
}

export function filterCachedSurvivors(
  stageName: string,
  done: StageCompany[],
  attioCache: Map<string, Record<string, string>>,
  slug: string,
  cacheGate: CacheGate,
  reasonFn: (cached: string) => string
): { survivors: StageCompany[]; rejected: Rejection[] } {
  let passed = 0;
  const survivors: StageCompany[] = [];
  const rejected: Rejection[] = [];

  for (const company of done) {
    const cached = attioCache.get(company.domain)?.[slug] ?? '';
    if (cacheGate(cached)) {
      survivors.push(company);
      passed++;
    } else {
      rejected.push({ company, reason: reasonFn(cached) });
    }
  }

  if (done.length > 0) {
    console.log(`[${stageName}] cached passed=${passed} rejected=${rejected.length}`);
  }
  return { survivors, rejected };
}
