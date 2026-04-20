import { upsertCompanyByDomain } from './apis/attio.js';
import { attioWriteLimit } from './rateLimit.js';
import type { StageCompany } from './stages/types.js';

export async function writeRejectionReasons(
  rejected: Array<{ company: StageCompany; reason: string }>
): Promise<void> {
  if (rejected.length === 0) return;
  await Promise.all(
    rejected.map(({ company, reason }) =>
      attioWriteLimit(async () => {
        try {
          await upsertCompanyByDomain({
            'Company Name': company.companyName,
            'Domain': company.domain,
            'Reason for Rejection': reason,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[rejection-reason] failed for ${company.domain}: ${msg}`);
        }
      })
    )
  );
}
