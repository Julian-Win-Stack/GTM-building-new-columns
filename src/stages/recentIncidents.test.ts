import { describe, it, expect } from 'vitest';
import {
  parseRecentIncidentsResponse,
  formatRecentIncidentsForAttio,
  type RecentIncidentsData,
} from './recentIncidents.js';
import type { StageCompany } from './types.js';
import type { FetchOutcome } from '../apis/statuspage.js';

const company: StageCompany = { companyName: 'Acme', domain: 'acme.com' };

describe('parseRecentIncidentsResponse', () => {
  it('maps private', () => {
    const raw: FetchOutcome = { kind: 'private' };
    const out = parseRecentIncidentsResponse(raw, [company]);
    expect(out).toEqual([{ company, data: { kind: 'private' } }]);
  });

  it('maps notFound', () => {
    const raw: FetchOutcome = { kind: 'notFound' };
    const out = parseRecentIncidentsResponse(raw, [company]);
    expect(out).toEqual([{ company, data: { kind: 'notFound' } }]);
  });

  it('maps ok + normalises components', () => {
    const raw: FetchOutcome = {
      kind: 'ok',
      incidents: [
        {
          impact: 'major',
          name: 'Dashboard slow',
          created_at: '2026-03-01T00:00:00Z',
          components: [{ name: 'Dashboard' }, { name: 'API' }],
        },
        {
          impact: 'minor',
          name: 'Edge blip',
          created_at: '2026-03-05T00:00:00Z',
        },
      ],
    };
    const out = parseRecentIncidentsResponse(raw, [company]);
    expect(out).toHaveLength(1);
    const ok = out[0];
    if (!ok || ok.error !== undefined) throw new Error('expected ok');
    expect(ok.data.kind).toBe('incidents');
    if (ok.data.kind !== 'incidents') throw new Error('expected incidents');
    expect(ok.data.rows).toEqual([
      { impact: 'major', name: 'Dashboard slow', components: ['Dashboard', 'API'] },
      { impact: 'minor', name: 'Edge blip', components: [] },
    ]);
  });

  it('empty batch → empty', () => {
    const raw: FetchOutcome = { kind: 'notFound' };
    expect(parseRecentIncidentsResponse(raw, [])).toEqual([]);
  });
});

describe('formatRecentIncidentsForAttio', () => {
  it('private', () => {
    expect(formatRecentIncidentsForAttio({ kind: 'private' })).toBe('Private status page');
  });

  it('notFound', () => {
    expect(formatRecentIncidentsForAttio({ kind: 'notFound' })).toBe('No status page found');
  });

  it('zero incidents (page exists)', () => {
    expect(formatRecentIncidentsForAttio({ kind: 'incidents', rows: [] })).toBe('0 incidents (last 90 days)');
  });

  it('mixed incidents — counts, components sorted desc, list order preserved', () => {
    const d: RecentIncidentsData = {
      kind: 'incidents',
      rows: [
        { impact: 'critical', name: 'API outage', components: ['API', 'Edge Network'] },
        { impact: 'major', name: 'Dashboard slowness', components: ['Dashboard'] },
        { impact: 'minor', name: 'Elevated errors', components: ['Edge Network'] },
        { impact: 'major', name: 'API degraded', components: ['API'] },
      ],
    };
    const out = formatRecentIncidentsForAttio(d);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Critical: 1  |  Major: 2  |  Minor: 1  |  None: 0');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Top affected components: API (2), Edge Network (2), Dashboard (1)');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('Incidents (last 90 days):');
    expect(lines[5]).toBe('- [critical] API outage — API, Edge Network');
    expect(lines[6]).toBe('- [major] Dashboard slowness — Dashboard');
    expect(lines[7]).toBe('- [minor] Elevated errors — Edge Network');
    expect(lines[8]).toBe('- [major] API degraded — API');
  });

  it('incident with no components has no em-dash trailing', () => {
    const d: RecentIncidentsData = {
      kind: 'incidents',
      rows: [{ impact: 'none', name: 'Scheduled maintenance', components: [] }],
    };
    const out = formatRecentIncidentsForAttio(d);
    const lines = out.split('\n');
    expect(lines[2]).toBe('Top affected components: (none reported)');
    expect(lines[5]).toBe('- [none] Scheduled maintenance');
  });
});
