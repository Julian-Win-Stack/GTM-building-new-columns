import type { StageCompany, StageResult } from './types.js';

type RunStageOptions<TRaw, TData> = {
  name: string;
  companies: StageCompany[];
  batchSize: number;
  call: (domains: string[]) => Promise<TRaw>;
  parse: (raw: TRaw, batch: StageCompany[]) => StageResult<TData>[];
  afterBatch?: (batchResults: StageResult<TData>[]) => Promise<void>;
  retry?: { tries: number; baseMs: number };
};

async function runOneBatch<TRaw, TData>(
  name: string,
  batch: StageCompany[],
  call: (domains: string[]) => Promise<TRaw>,
  parse: (raw: TRaw, batch: StageCompany[]) => StageResult<TData>[],
  retry: { tries: number; baseMs: number }
): Promise<StageResult<TData>[]> {
  const domains = batch.map((c) => c.domain);
  let lastErr: unknown;
  for (let attempt = 0; attempt < retry.tries; attempt++) {
    try {
      const raw = await call(domains);
      return parse(raw, batch);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isLast = attempt === retry.tries - 1;
      if (isLast) {
        console.error(`[${name}] batch failed (${domains.join(', ')}): ${msg}`);
        break;
      }
      const wait = retry.baseMs * Math.pow(4, attempt);
      console.warn(
        `[${name}] batch attempt ${attempt + 1}/${retry.tries} failed (${domains.join(', ')}): ${msg}. waiting ${wait}ms`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return batch.map((company) => ({ company, error: msg }));
}

export async function runStage<TRaw, TData>(
  opts: RunStageOptions<TRaw, TData>
): Promise<StageResult<TData>[]> {
  const { name, companies, batchSize, call, parse, afterBatch } = opts;
  const retry = opts.retry ?? { tries: 1, baseMs: 1000 };

  const batches: StageCompany[][] = [];
  for (let i = 0; i < companies.length; i += batchSize) {
    batches.push(companies.slice(i, i + batchSize));
  }

  console.log(`[${name}] companies=${companies.length} batches=${batches.length}`);

  const perBatch: StageResult<TData>[][] = new Array(batches.length);
  await Promise.all(
    batches.map(async (batch, i) => {
      const results = await runOneBatch(name, batch, call, parse, retry);
      perBatch[i] = results;
      if (afterBatch) {
        try {
          await afterBatch(results);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[${name}] afterBatch threw (${batch.map((c) => c.domain).join(', ')}): ${msg}`);
        }
      }
    })
  );

  return perBatch.flat();
}
