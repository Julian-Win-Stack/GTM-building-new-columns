import pLimit from 'p-limit';
import { PATHS, CONCURRENCY } from '../config.js';
import { readInputCsv } from '../csv.js';
import { runPipeline } from '../pipeline.js';
import { createCompany, findCompanyByDomain, findEmptyColumns, updateCompany } from '../apis/attio.js';
import { deriveDomain, nowIso } from '../util.js';
import type { EnrichableColumn, InputRow } from '../types.js';

export type EnrichAllOptions = {
  csv?: string;
  limit?: number;
  dryRun?: boolean;
};

export async function enrichAll(opts: EnrichAllOptions): Promise<void> {
  const csvPath = opts.csv ?? PATHS.defaultInputCsv;
  const rows = await readInputCsv(csvPath);
  const subset = opts.limit ? rows.slice(0, opts.limit) : rows;

  console.log(
    `[enrich-all] csv=${csvPath} rows=${subset.length}/${rows.length} concurrency=${CONCURRENCY} dryRun=${!!opts.dryRun}`
  );

  const limit = pLimit(CONCURRENCY);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(
    subset.map((row) =>
      limit(async () => {
        const label = row['Company Name'] || row['Website'] || '(unknown)';
        const domain = deriveDomain(row['Website']);
        if (!domain) {
          failed++;
          console.error(`[fail] ${label}: no parseable domain in Website column — skipping`);
          return;
        }
        try {
          const existing = await findCompanyByDomain(domain);

          if (existing) {
            const emptyCols = findEmptyColumns(existing) as EnrichableColumn[];
            if (emptyCols.length === 0) {
              skipped++;
              console.log(`[skip] ${label} — already fully enriched`);
              return;
            }
            if (opts.dryRun) {
              console.log(`[dry] UPDATE ${label} missing=${emptyCols.length}`);
              return;
            }
            const result = await runPipeline(row, emptyCols);
            await updateCompany(existing.id, result);
            updated++;
            console.log(`[update ${updated}] ${label}`);
          } else {
            if (opts.dryRun) {
              console.log(`[dry] CREATE ${label}`);
              return;
            }
            const result = await runPipeline(row);
            await createCompany(result);
            created++;
            console.log(`[create ${created}] ${label}`);
          }
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[fail] ${label}: ${msg}`);
          if (!opts.dryRun) {
            try {
              const existing = await findCompanyByDomain(domain);
              const errPayload = {
                'Company Name': row['Company Name'],
                'Domain': domain,
                'Status': 'error' as const,
                'Last Attempt': nowIso(),
                'Error': msg,
              };
              if (existing) await updateCompany(existing.id, errPayload);
              else await createCompany(errPayload);
            } catch {
              /* swallow — we already logged the primary failure */
            }
          }
        }
      })
    )
  );

  console.log(`[done] created=${created} updated=${updated} skipped=${skipped} failed=${failed}`);
}
