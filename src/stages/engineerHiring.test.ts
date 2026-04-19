import { describe, it, expect } from 'vitest';
import {
  parseHiringResponse,
  formatEngineerHiringForAttio,
  formatSreHiringForAttio,
} from './engineerHiring.js';
import type { CareerSiteJobListingsResponse } from '../apis/apify.js';
import type { StageCompany } from './types.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

const emptyData = { engineer: { count: 0, posts: [] }, sre: { count: 0, posts: [] } };

describe('formatEngineerHiringForAttio', () => {
  it('returns "0" when count is zero', () => {
    expect(formatEngineerHiringForAttio(emptyData)).toBe('0');
  });

  it('returns count + blank line + title: url lines', () => {
    const d = {
      engineer: {
        count: 2,
        posts: [
          { title: 'Senior Engineer', url: 'https://acme.com/jobs/1' },
          { title: 'SRE', url: 'https://acme.com/jobs/2' },
        ],
      },
      sre: { count: 0, posts: [] },
    };
    expect(formatEngineerHiringForAttio(d)).toBe(
      '2\n\nSenior Engineer: https://acme.com/jobs/1\nSRE: https://acme.com/jobs/2'
    );
  });

  it('ignores sre field', () => {
    const d = {
      engineer: { count: 1, posts: [{ title: 'Backend Engineer', url: 'https://acme.com/1' }] },
      sre: { count: 5, posts: [] },
    };
    expect(formatEngineerHiringForAttio(d)).toBe('1\n\nBackend Engineer: https://acme.com/1');
  });
});

describe('formatSreHiringForAttio', () => {
  it('returns "0" when count is zero', () => {
    const d = {
      engineer: { count: 3, posts: [] },
      sre: { count: 0, posts: [] },
    };
    expect(formatSreHiringForAttio(d)).toBe('0');
  });

  it('returns count + blank line + title: url for SRE subset', () => {
    const d = {
      engineer: { count: 2, posts: [] },
      sre: { count: 1, posts: [{ title: 'Site Reliability Engineer', url: 'https://acme.com/sre' }] },
    };
    expect(formatSreHiringForAttio(d)).toBe('1\n\nSite Reliability Engineer: https://acme.com/sre');
  });
});

describe('parseHiringResponse', () => {
  it('returns [] when companies is empty', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [{ title: 'Engineer', url: 'https://acme.com/1' }],
    };
    expect(parseHiringResponse(raw, [])).toEqual([]);
  });

  it('maps title and url, returns correct counts', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [
        { title: 'Backend Engineer', url: 'https://acme.com/jobs/1' },
        { title: 'Frontend Engineer', url: 'https://acme.com/jobs/2' },
      ],
    };
    const results = parseHiringResponse(raw, [company]);
    expect(results).toHaveLength(1);
    expect(results[0]!.data?.engineer.count).toBe(2);
    expect(results[0]!.data?.engineer.posts).toEqual([
      { title: 'Backend Engineer', url: 'https://acme.com/jobs/1' },
      { title: 'Frontend Engineer', url: 'https://acme.com/jobs/2' },
    ]);
  });

  it('filters SRE subset case-insensitively on "sre" and "site reliability"', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [
        { title: 'Backend Engineer', url: 'https://acme.com/jobs/1' },
        { title: 'Sr. SRE', url: 'https://acme.com/jobs/2' },
        { title: 'site reliability engineer', url: 'https://acme.com/jobs/3' },
        { title: 'Senior Site Reliability', url: 'https://acme.com/jobs/4' },
      ],
    };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data?.sre.count).toBe(3);
    expect(results[0]!.data?.sre.posts.map((p) => p.title)).toEqual([
      'Sr. SRE',
      'site reliability engineer',
      'Senior Site Reliability',
    ]);
  });

  it('drops items missing title', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [
        { title: 'Engineer', url: 'https://acme.com/jobs/1' },
        { url: 'https://acme.com/jobs/2' },
      ],
    };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data?.engineer.count).toBe(1);
  });

  it('drops items missing url', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [
        { title: 'Engineer', url: 'https://acme.com/jobs/1' },
        { title: 'No URL Engineer' },
      ],
    };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data?.engineer.count).toBe(1);
  });

  it('drops items with empty title or url', () => {
    const raw: CareerSiteJobListingsResponse = {
      items: [
        { title: 'Engineer', url: 'https://acme.com/jobs/1' },
        { title: '', url: 'https://acme.com/jobs/2' },
        { title: 'Engineer 2', url: '' },
      ],
    };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data?.engineer.count).toBe(1);
  });

  it('handles empty items array', () => {
    const raw: CareerSiteJobListingsResponse = { items: [] };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data).toEqual({
      engineer: { count: 0, posts: [] },
      sre: { count: 0, posts: [] },
    });
  });

  it('handles undefined items', () => {
    const raw = { items: undefined as unknown as CareerSiteJobListingsResponse['items'] };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.data?.engineer.count).toBe(0);
    expect(results[0]!.data?.sre.count).toBe(0);
  });

  it('company is passed through to result', () => {
    const raw: CareerSiteJobListingsResponse = { items: [] };
    const results = parseHiringResponse(raw, [company]);
    expect(results[0]!.company).toEqual(company);
  });
});
