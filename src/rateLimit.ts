import Bottleneck from 'bottleneck';
import pLimit from 'p-limit';
import { EXA_QPS, THEIRSTACK_QPS, APOLLO_QPS, ATTIO_WRITE_CONCURRENCY, OPENAI_CONCURRENCY, APIFY_CONCURRENCY, TWITTER_API_QPS } from './config.js';

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

export const theirstackLimiter = new Bottleneck({
  reservoir: THEIRSTACK_QPS,
  reservoirRefreshAmount: THEIRSTACK_QPS,
  reservoirRefreshInterval: 1000,
  minTime: Math.floor(1000 / THEIRSTACK_QPS),
});

export function scheduleTheirstack<T>(fn: () => Promise<T>): Promise<T> {
  return theirstackLimiter.schedule(fn);
}

export const apolloLimiter = new Bottleneck({
  reservoir: APOLLO_QPS,
  reservoirRefreshAmount: APOLLO_QPS,
  reservoirRefreshInterval: 1000,
  minTime: Math.floor(1000 / APOLLO_QPS),
});

export function scheduleApollo<T>(fn: () => Promise<T>): Promise<T> {
  return apolloLimiter.schedule(fn);
}

export const apifyLimit = pLimit(APIFY_CONCURRENCY);
export function scheduleApify<T>(fn: () => Promise<T>): Promise<T> {
  return apifyLimit(fn);
}

const twitterMutex = pLimit(1);
const TWITTER_MIN_MS = Math.ceil(1000 / TWITTER_API_QPS);
let lastTwitterCallAt = 0;

export function scheduleTwitterApi<T>(fn: () => Promise<T>): Promise<T> {
  return twitterMutex(async () => {
    const wait = TWITTER_MIN_MS - (Date.now() - lastTwitterCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastTwitterCallAt = Date.now();
    }
  });
}
