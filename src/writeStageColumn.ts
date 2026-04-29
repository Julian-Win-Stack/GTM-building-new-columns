import { upsertCompanyByDomain } from './apis/attio.js';
import { attioWriteLimit } from './rateLimit.js';
import type { EnrichableColumn } from './types.js';
import type { StageResult } from './stages/types.js';
import type { RunCtx } from './runTypes.js';

export async function writeStageColumn<T>(
  column: EnrichableColumn,
  results: StageResult<T>[],
  format: (data: T) => string,
  ctx: RunCtx
): Promise<void> {
  let written = 0;
  let skipped = 0;
  let failed = 0;
  let cancelled = 0;

  await Promise.all(
    results.map((result) =>
      attioWriteLimit(async () => {
        if (ctx.isCancelled?.()) {
          cancelled++;
          return;
        }
        if (result.error !== undefined) {
          skipped++;
          return;
        }
        const value = format(result.data);
        if (ctx.writeToAttio) {
          try {
            const upsert = upsertCompanyByDomain({
              'Company Name': result.company.companyName,
              'Domain': result.company.domain,
              [column]: value,
            });
            await (ctx.cancelSignal ? Promise.race([upsert, ctx.cancelSignal]) : upsert);
            written++;
          } catch (err) {
            if (ctx.isCancelled?.()) {
              cancelled++;
              return;
            }
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[writeStageColumn] Attio write failed for ${result.company.domain} column="${column}": ${msg}`
            );
          }
        } else {
          written++;
        }
        ctx.emit({ type: 'cell-updated', domain: result.company.domain, column, value });
      })
    )
  );

  console.log(
    `[writeStageColumn] column="${column}" written=${written} skipped=${skipped} failed=${failed}${cancelled ? ` cancelled=${cancelled}` : ''}${ctx.writeToAttio ? '' : ' (CSV-only mode)'}`
  );
}
