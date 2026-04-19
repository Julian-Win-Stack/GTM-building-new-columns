import type { GateRule, StageCompany, StageResult } from './stages/types.js';

export type CacheGate = (cached: string) => boolean;

export function filterSurvivors<T>(
  stageName: string,
  results: StageResult<T>[],
  gate: GateRule<T>
): StageCompany[] {
  let passed = 0;
  let rejected = 0;
  let errored = 0;
  const survivors: StageCompany[] = [];

  for (const result of results) {
    if (result.error !== undefined) {
      errored++;
      continue;
    }
    if (gate(result.data)) {
      survivors.push(result.company);
      passed++;
    } else {
      rejected++;
    }
  }

  console.log(`[${stageName}] passed=${passed} rejected=${rejected} errored=${errored}`);
  return survivors;
}

export function filterCachedSurvivors(
  stageName: string,
  done: StageCompany[],
  attioCache: Map<string, Record<string, string>>,
  slug: string,
  cacheGate: CacheGate
): StageCompany[] {
  let passed = 0;
  let rejected = 0;
  const survivors: StageCompany[] = [];

  for (const company of done) {
    const cached = attioCache.get(company.domain)?.[slug] ?? '';
    if (cacheGate(cached)) {
      survivors.push(company);
      passed++;
    } else {
      rejected++;
    }
  }

  if (done.length > 0) {
    console.log(`[${stageName}] cached passed=${passed} rejected=${rejected}`);
  }
  return survivors;
}
