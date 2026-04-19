import Bottleneck from 'bottleneck';
import pLimit from 'p-limit';
import { EXA_QPS, ATTIO_WRITE_CONCURRENCY, OPENAI_CONCURRENCY } from './config.js';

export const exaLimiter = new Bottleneck({
  reservoir: EXA_QPS,
  reservoirRefreshAmount: EXA_QPS,
  reservoirRefreshInterval: 1000,
  minTime: Math.floor(1000 / EXA_QPS),
});

export const attioWriteLimit = pLimit(ATTIO_WRITE_CONCURRENCY);
export const openaiLimit = pLimit(OPENAI_CONCURRENCY);

export function scheduleExa<T>(fn: () => Promise<T>): Promise<T> {
  return exaLimiter.schedule(fn);
}
