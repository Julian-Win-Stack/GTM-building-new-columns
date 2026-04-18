import type { StageCompany, StageResult } from './types.js';

type RunStageOptions<TRaw, TData> = {
  name: string;
  companies: StageCompany[];
  batchSize: number;
  call: (domains: string[]) => Promise<TRaw>;
  parse: (raw: TRaw, batch: StageCompany[]) => StageResult<TData>[];
  afterBatch?: (batchResults: StageResult<TData>[]) => Promise<void>;
};

export async function runStage<TRaw, TData>(
  opts: RunStageOptions<TRaw, TData>
): Promise<StageResult<TData>[]> {
  const { name, companies, batchSize, call, parse } = opts;
  const batches: StageCompany[][] = [];
  for (let i = 0; i < companies.length; i += batchSize) {
    batches.push(companies.slice(i, i + batchSize));
  }

  console.log(`[${name}] companies=${companies.length} batches=${batches.length}`);

  const all: StageResult<TData>[] = [];
  for (const batch of batches) {
    const domains = batch.map((c) => c.domain);
    console.log(`[${name}] batch: ${domains.join(', ')}`);
    let batchResults: StageResult<TData>[];
    try {
      const raw = await call(domains);
      batchResults = parse(raw, batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] batch failed (${domains.join(', ')}): ${msg}`);
      batchResults = batch.map((company) => ({ company, error: msg }));
    }
    all.push(...batchResults);
    await opts.afterBatch?.(batchResults);
  }
  return all;
}
