import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpRoot: string;

vi.mock('./config.js', async () => {
  const real = await vi.importActual<typeof import('./config.js')>('./config.js');
  return {
    ...real,
    PATHS: {
      ...real.PATHS,
      get cache() {
        return tmpRoot;
      },
    },
  };
});

const { cached } = await import('./cache.js');

describe('cached', () => {
  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gtm-cache-test-'));
  });
  afterEach(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('calls fn and stores the result on first invocation', async () => {
    const fn = vi.fn().mockResolvedValue({ hello: 'world' });
    const result = await cached('ns', 'key1', fn);
    expect(result).toEqual({ hello: 'world' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the cached value on subsequent calls without calling fn again', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });
    const first = await cached('ns', 'same-key', fn);
    const second = await cached('ns', 'same-key', fn);
    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats different keys as different cache entries', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');
    const a = await cached('ns', 'k1', fn);
    const b = await cached('ns', 'k2', fn);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('isolates namespaces from one another', async () => {
    const fnA = vi.fn().mockResolvedValue('in-A');
    const fnB = vi.fn().mockResolvedValue('in-B');
    const a = await cached('nsA', 'shared-key', fnA);
    const b = await cached('nsB', 'shared-key', fnB);
    expect(a).toBe('in-A');
    expect(b).toBe('in-B');
  });

  it('persists the value on disk as JSON under the namespace directory', async () => {
    await cached('persist', 'k', async () => ({ n: 42 }));
    const entries = await fsp.readdir(path.join(tmpRoot, 'persist'));
    expect(entries).toHaveLength(1);
    const file = entries[0]!;
    const text = await fsp.readFile(path.join(tmpRoot, 'persist', file), 'utf8');
    expect(JSON.parse(text)).toEqual({ n: 42 });
  });

  it('creates the namespace directory if missing', async () => {
    const nsDir = path.join(tmpRoot, 'fresh-ns');
    await expect(fsp.access(nsDir)).rejects.toThrow();
    await cached('fresh-ns', 'k', async () => 'x');
    await expect(fsp.access(nsDir)).resolves.toBeUndefined();
  });
});
