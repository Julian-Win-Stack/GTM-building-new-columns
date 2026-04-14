import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS } from './config.js';

function hash(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

export async function cached(namespace, key, fn) {
  const dir = path.join(PATHS.cache, namespace);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${hash(key)}.json`);
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {}
  const result = await fn();
  await fsp.writeFile(file, JSON.stringify(result), 'utf8');
  return result;
}
