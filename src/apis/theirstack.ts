import axios from 'axios';
import { KEYS } from '../config.js';

const http = axios.create({
  baseURL: 'https://api.theirstack.com/v1',
  headers: { Authorization: `Bearer ${KEYS.theirstack}`, 'content-type': 'application/json' },
  timeout: 60_000,
});

export async function theirstackJobsSearch(payload: Record<string, unknown>): Promise<unknown> {
  // TODO: confirm endpoint path + payload shape when you share the spec
  const { data } = await http.post('/jobs/search', payload);
  return data;
}
