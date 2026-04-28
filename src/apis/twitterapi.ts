import axios from 'axios';
import { scheduleTwitterApi } from '../rateLimit.js';

export type TwitterTweet = { text: string; id?: string; url?: string };
export type TwitterSearchResponse = {
  tweets: TwitterTweet[];
  has_next_page: boolean;
  next_cursor: string;
};

export type TweetItem = { text: string; url: string };

function shortCursor(c: string): string {
  if (!c) return '<empty>';
  return c.length <= 12 ? c : `${c.slice(0, 6)}…${c.slice(-4)}`;
}

export async function twitterAdvancedSearch(
  query: string,
  cursor: string,
  apiKey: string
): Promise<TwitterSearchResponse> {
  const { data } = await axios.get<TwitterSearchResponse>(
    'https://api.twitterapi.io/twitter/tweet/advanced_search',
    {
      headers: { 'X-API-Key': apiKey },
      params: { query, queryType: 'Latest', cursor },
      timeout: 30_000,
    }
  );
  return data;
}

function tweetUrl(tweet: TwitterTweet): string {
  if (tweet.url) return tweet.url;
  if (tweet.id) return `https://x.com/i/status/${tweet.id}`;
  return '';
}

export async function fetchComplaintTweets(domain: string, companyName: string): Promise<TweetItem[]> {
  const handle = domain.split('.')[0] ?? domain;
  const sinceTime = Math.floor((Date.now() - 90 * 86400 * 1000) / 1000);
  const escapedName = companyName.replace(/"/g, '\\"');
  const query =
    `(@${handle} OR ${domain} OR "${escapedName}") ` +
    `("app down" OR "site down" OR "website down" OR "is down" OR "won't load" OR "not loading" OR "not working" OR outage OR offline) ` +
    `since_time:${sinceTime}`;

  console.log(`[twitterapi] ${domain} query (len=${query.length}): ${query}`);

  const accumulated: TweetItem[] = [];
  let cursor = '';
  let page = 0;

  while (accumulated.length < 50) {
    page++;
    const cursorIn = cursor;
    try {
      let usedKeyIndex = 0;
      let keyCount = 1;
      const res = await scheduleTwitterApi((apiKey, ki, kc) => {
        usedKeyIndex = ki;
        keyCount = kc;
        return twitterAdvancedSearch(query, cursor, apiKey);
      });
      for (const tweet of res.tweets) accumulated.push({ text: tweet.text, url: tweetUrl(tweet) });
      console.log(
        `[twitterapi] ${domain} page ${page} key=${usedKeyIndex + 1}/${keyCount}: tweets=${res.tweets.length} total=${accumulated.length} has_next=${res.has_next_page} cursor_in=${shortCursor(cursorIn)} cursor_out=${shortCursor(res.next_cursor)}`
      );
      if (!res.has_next_page) break;
      cursor = res.next_cursor;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status ?? '?';
        const headers = err.response?.headers ?? {};
        const body = err.response?.data;
        const bodyStr =
          typeof body === 'string' ? body : body === undefined ? '<no body>' : JSON.stringify(body);
        console.error(
          `[twitterapi] ${domain} page ${page} FAILED: status=${status} cursor_in=${shortCursor(cursorIn)}`
        );
        console.error(`[twitterapi] ${domain} response headers: ${JSON.stringify(headers)}`);
        console.error(`[twitterapi] ${domain} response body: ${bodyStr}`);
      } else {
        console.error(
          `[twitterapi] ${domain} page ${page} FAILED (non-axios): ${err instanceof Error ? err.message : String(err)}`
        );
      }
      throw err;
    }
  }

  const final = accumulated.slice(0, 50);
  console.log(`[twitterapi] ${domain} done: fetched=${accumulated.length} returned=${final.length}`);
  const sampleCount = Math.min(final.length, 10);
  for (let i = 0; i < sampleCount; i++) {
    const t = final[i]!;
    const preview = t.text.length > 200 ? `${t.text.slice(0, 200)}…` : t.text;
    console.log(`[twitterapi] ${domain} tweet[${i + 1}]: ${preview.replace(/\n/g, ' ')}`);
  }
  if (final.length > sampleCount) {
    console.log(`[twitterapi] ${domain} … and ${final.length - sampleCount} more`);
  }
  return final;
}
