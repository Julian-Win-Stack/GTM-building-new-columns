import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkedInSlugForAttio, normalizeLinkedInUrl, deriveDomain, nowIso, withRetry } from './util.js';

describe('normalizeLinkedInUrl', () => {
  it('upgrades http:// to https://', () => {
    expect(normalizeLinkedInUrl('http://www.linkedin.com/company/acme')).toBe(
      'https://www.linkedin.com/company/acme'
    );
  });

  it('leaves https:// unchanged', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/company/acme')).toBe(
      'https://www.linkedin.com/company/acme'
    );
  });

  it('prepends https:// to a bare URL with no scheme', () => {
    expect(normalizeLinkedInUrl('www.linkedin.com/company/acme')).toBe(
      'https://www.linkedin.com/company/acme'
    );
  });

  it('returns empty string for empty input', () => {
    expect(normalizeLinkedInUrl('')).toBe('');
  });

  it('trims whitespace before processing', () => {
    expect(normalizeLinkedInUrl('  http://www.linkedin.com/company/acme  ')).toBe(
      'https://www.linkedin.com/company/acme'
    );
  });
});

describe('linkedInSlugForAttio', () => {
  it('extracts slug from a /company/ URL', () => {
    expect(linkedInSlugForAttio('https://www.linkedin.com/company/playstation-sony/')).toBe('playstation-sony');
  });

  it('extracts slug from a /showcase/ URL', () => {
    expect(linkedInSlugForAttio('https://www.linkedin.com/showcase/playstation-sony/')).toBe('playstation-sony');
  });

  it('extracts slug from /in/ and /school/ URLs', () => {
    expect(linkedInSlugForAttio('https://www.linkedin.com/in/jane-doe')).toBe('jane-doe');
    expect(linkedInSlugForAttio('https://www.linkedin.com/school/mit/')).toBe('mit');
  });

  it('strips query string and fragment from the slug', () => {
    expect(linkedInSlugForAttio('https://www.linkedin.com/company/acme?ref=foo#bar')).toBe('acme');
  });

  it('passes through a bare slug unchanged', () => {
    expect(linkedInSlugForAttio('playstation-sony')).toBe('playstation-sony');
  });

  it('returns empty string when nothing matches', () => {
    expect(linkedInSlugForAttio('https://example.com/foo/bar')).toBe('');
    expect(linkedInSlugForAttio('')).toBe('');
  });

  it('trims whitespace before processing', () => {
    expect(linkedInSlugForAttio('  https://www.linkedin.com/company/acme  ')).toBe('acme');
  });
});

describe('deriveDomain', () => {
  it('strips the https scheme and returns the bare host', () => {
    expect(deriveDomain('https://acme.com')).toBe('acme.com');
  });

  it('strips the http scheme and returns the bare host', () => {
    expect(deriveDomain('http://acme.com')).toBe('acme.com');
  });

  it('strips a leading www.', () => {
    expect(deriveDomain('https://www.acme.com')).toBe('acme.com');
  });

  it('lowercases the host', () => {
    expect(deriveDomain('https://ACME.com')).toBe('acme.com');
  });

  it('strips path, query, and fragment', () => {
    expect(deriveDomain('https://acme.com/about?x=1#y')).toBe('acme.com');
  });

  it('treats a bare hostname without a scheme as https', () => {
    expect(deriveDomain('acme.com')).toBe('acme.com');
  });

  it('strips a leading www. from a bare hostname too', () => {
    expect(deriveDomain('www.acme.com')).toBe('acme.com');
  });

  it('returns empty string when website is undefined', () => {
    expect(deriveDomain(undefined)).toBe('');
  });

  it('returns empty string when website is empty', () => {
    expect(deriveDomain('')).toBe('');
  });

  it('falls back to trimmed lowercase value when URL parsing throws', () => {
    // URL constructor throws on strings with spaces after the scheme is added
    expect(deriveDomain('  WWW.ACME.COM  ')).toBe('acme.com');
  });
});

describe('nowIso', () => {
  it('returns an ISO 8601 timestamp', () => {
    const result = nowIso();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the value when fn succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually returns the success value', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom1'))
      .mockRejectedValueOnce(new Error('boom2'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { tries: 3, baseMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once tries are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    const promise = withRetry(fn, { tries: 2, baseMs: 1 });
    const assertion = expect(promise).rejects.toThrow('permanent');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff between retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValue('ok');
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const promise = withRetry(fn, { tries: 3, baseMs: 100 });
    await vi.runAllTimersAsync();
    await promise;

    // First retry waits 100ms (100 * 2^0), second retry waits 200ms (100 * 2^1)
    const waits = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(waits).toContain(100);
    expect(waits).toContain(200);
  });

  it('stringifies non-Error throws in the retry log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject('string-error'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { tries: 2, baseMs: 1, label: 'myop' });
    await vi.runAllTimersAsync();
    await promise;

    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('myop');
    expect(logged).toContain('string-error');
  });
});
