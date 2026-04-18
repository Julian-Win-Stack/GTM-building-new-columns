import { upsertCompanyByDomain } from '../apis/attio.js';
import { attioWriteLimit } from '../rateLimit.js';
import type { EnrichableColumn } from '../types.js';
import type { StageResult } from './types.js';

export async function writeStageColumn<T>(
  column: EnrichableColumn,
  results: StageResult<T>[],
  format: (data: T) => string
): Promise<void> {
  let written = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(
    results.map((result) =>
      attioWriteLimit(async () => {
        if (result.error !== undefined) {
          skipped++;
          return;
        }
        const value = format(result.data);
        try {
          await upsertCompanyByDomain({
            'Company Name': result.company.companyName,
            'Domain': result.company.domain,
            [column]: value,
          });
          written++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[writeStageColumn] Attio write failed for ${result.company.domain} column="${column}": ${msg}`
          );
        }
      })
    )
  );

  console.log(`[writeStageColumn] column="${column}" written=${written} skipped=${skipped} failed=${failed}`);
}
