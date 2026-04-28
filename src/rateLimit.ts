import Bottleneck from 'bottleneck';
import pLimit from 'p-limit';
import { EXA_QPS, THEIRSTACK_QPS, APOLLO_QPS, ATTIO_WRITE_CONCURRENCY, OPENAI_CONCURRENCY, APIFY_CONCURRENCY, TWITTER_API_QPS, STATUSPAGE_CONCURRENCY, XAPI_KEYS } from './config.js';

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

if (XAPI_KEYS.length === 0) {
  throw new Error('No twitterapi.io key(s) configured — set X_API_KEYS or X_API_KEY in .env');
}

const TWITTER_MIN_MS = Math.ceil(1000 / TWITTER_API_QPS);

type TwitterSlot = { apiKey: string; keyIndex: number; mutex: ReturnType<typeof pLimit>; lastCallAt: number };

const twitterSlots: TwitterSlot[] = XAPI_KEYS.map((apiKey, i) => ({
  apiKey,
  keyIndex: i,
  mutex: pLimit(1),
  lastCallAt: 0,
}));

let nextSlot = 0;

export function scheduleTwitterApi<T>(fn: (apiKey: string, keyIndex: number, keyCount: number) => Promise<T>): Promise<T> {
  const slot = twitterSlots[nextSlot % twitterSlots.length]!;
  nextSlot++;
  return slot.mutex(async () => {
    const wait = TWITTER_MIN_MS - (Date.now() - slot.lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn(slot.apiKey, slot.keyIndex, twitterSlots.length);
    } finally {
      slot.lastCallAt = Date.now();
    }
  });
}

export const statuspageLimit = pLimit(STATUSPAGE_CONCURRENCY);
export function scheduleStatuspage<T>(fn: () => Promise<T>): Promise<T> {
  return statuspageLimit(fn);
}
