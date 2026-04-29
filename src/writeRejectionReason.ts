import { upsertCompanyByDomain } from './apis/attio.js';
import { attioWriteLimit } from './rateLimit.js';
import type { StageCompany } from './stages/types.js';
import type { RunCtx } from './runTypes.js';

export async function writeRejectionReasons(
  rejected: Array<{ company: StageCompany; reason: string }>,
  ctx: RunCtx
): Promise<void> {
  if (rejected.length === 0) return;
  await Promise.all(
    rejected.map(({ company, reason }) =>
      attioWriteLimit(async () => {
        if (ctx.isCancelled?.()) return;
        if (ctx.writeToAttio) {
          try {
            const upsert = upsertCompanyByDomain({
              'Company Name': company.companyName,
              'Domain': company.domain,
              'Reason for Rejection': reason,
            });
            await (ctx.cancelSignal ? Promise.race([upsert, ctx.cancelSignal]) : upsert);
          } catch (err) {
            if (ctx.isCancelled?.()) return;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[rejection-reason] failed for ${company.domain}: ${msg}`);
          }
        }
        ctx.emit({ type: 'cell-updated', domain: company.domain, column: 'Reason for Rejection', value: reason });
        ctx.emit({ type: 'company-rejected', domain: company.domain, reason });
      })
    )
  );
}
