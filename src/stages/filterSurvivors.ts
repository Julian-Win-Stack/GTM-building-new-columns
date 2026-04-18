import type { GateRule, StageCompany, StageResult } from './types.js';

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
