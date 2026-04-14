import pLimit from 'p-limit';
import { PATHS, CONCURRENCY } from './config.js';
import { readCsv, ensureOutputCsv, loadProcessedKeys, appendRow, companyKey } from './csv.js';
import { processCompany } from './pipeline.js';
import { nowIso } from './util.js';
import type { InputRow } from './types.js';

type Args = { limit: number; retryErrors: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: Infinity, retryErrors: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--retry-errors') args.retryErrors = true;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  await ensureOutputCsv(PATHS.output);

  const input = await readCsv<InputRow>(PATHS.input);
  const done = await loadProcessedKeys(PATHS.output, companyKey);

  const pending = input
    .filter((row) => !done.has(companyKey(row)))
    .slice(0, Number.isFinite(args.limit) ? args.limit : input.length);

  console.log(
    `[start] total=${input.length} done=${done.size} pending=${pending.length} concurrency=${CONCURRENCY}`
  );

  const limit = pLimit(CONCURRENCY);
  let processed = 0;
  let failed = 0;

  await Promise.all(
    pending.map((row) =>
      limit(async () => {
        const label = row['Company Name'] || row['Website'] || '(unknown)';
        try {
          const out = await processCompany(row);
          appendRow(PATHS.output, out);
          processed++;
          console.log(`[ok ${processed}/${pending.length}] ${label}`);
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          appendRow(PATHS.output, {
            'Company Name': row['Company Name'] ?? '',
            'Domain': '',
            'Status': 'error',
            'Last Attempt': nowIso(),
            'Error': msg,
          });
          console.error(`[fail] ${label}: ${msg}`);
        }
      })
    )
  );

  console.log(`[done] processed=${processed} failed=${failed}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
