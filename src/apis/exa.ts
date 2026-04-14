import axios from 'axios';
import { KEYS } from '../config.js';

const http = axios.create({
  baseURL: 'https://api.exa.ai',
  headers: { 'x-api-key': KEYS.exa, 'content-type': 'application/json' },
  timeout: 60_000,
});

export type ExaSearchParams = {
  query: string;
  numResults?: number;
  useAutoprompt?: boolean;
  type?: 'auto' | 'neural' | 'keyword';
  includeDomains?: string[];
  excludeDomains?: string[];
  contents?: Record<string, unknown>;
};

export async function exaSearch(params: ExaSearchParams): Promise<unknown> {
  const { data } = await http.post('/search', {
    numResults: 5,
    useAutoprompt: true,
    type: 'auto',
    ...params,
  });
  return data;
}
