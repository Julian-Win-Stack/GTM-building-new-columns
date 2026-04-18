import { upsertCompanyByDomain } from '../apis/attio.js';
import type { EnrichableColumn } from '../types.js';
import type { StageResult } from './types.js';

export async function writeStageColumn<T>(
  column: EnrichableColumn,
  results: StageResult<T>[],
  format: (data: T) => string
): Promise<void> {
  let written = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.error !== undefined) {
      skipped++;
      continue;
    }
    const value = format(result.data);
    await upsertCompanyByDomain({
      'Company Name': result.company.companyName,
      'Domain': result.company.domain,
      [column]: value,
    });
    written++;
  }
  console.log(`[writeStageColumn] column="${column}" written=${written} skipped=${skipped}`);
}
