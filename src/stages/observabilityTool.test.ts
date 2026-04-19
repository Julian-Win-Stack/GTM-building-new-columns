import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseObservabilityToolResponse,
  observabilityToolGate,
  formatObservabilityToolForAttio,
  type ObservabilityToolData,
} from './observabilityTool.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

vi.mock('../apis/openai.js', () => ({
  judge: vi.fn(),
}));

vi.mock('../rateLimit.js', () => ({
  openaiLimit: vi.fn((fn: () => unknown) => fn()),
  attioWriteLimit: vi.fn((fn: () => unknown) => fn()),
  scheduleExa: vi.fn((fn: () => unknown) => fn()),
}));

import { judge } from '../apis/openai.js';
const mockJudge = vi.mocked(judge);

function makeRaw(
  content: unknown,
  results: Array<{ url: string; text?: string }> = []
): ExaSearchResponse {
  return {
    results: results.map((r, i) => ({
      id: `r${i}`,
      url: r.url,
      title: '',
      text: r.text,
    })),
    searchTime: 0,
    output: { content: content as string | Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

const co1: StageCompany = { domain: 'quizlet.com', companyName: 'Quizlet' };
const co2: StageCompany = { domain: 'remitly.com', companyName: 'Remitly' };

beforeEach(() => {
  mockJudge.mockReset();
});

describe('parseObservabilityToolResponse', () => {
  it('happy path: two companies, mixed tool counts', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: 'Datadog: https://jobs.example.com/123\nGrafana: https://linkedin.com/in/abc',
        },
        { domain: 'remitly.com', toolsText: '' },
      ],
    });
    mockJudge.mockResolvedValue({ verdict: 'yes', reason: 'ok' });

    const results = await parseObservabilityToolResponse(raw, [co1, co2]);
    expect(results).toHaveLength(2);

    const r1 = results[0]!;
    expect(r1.error).toBeUndefined();
    expect(r1.data!.tools[0]).toEqual({ name: 'Datadog', sourceUrl: 'https://jobs.example.com/123' });

    const r2 = results[1]!;
    expect(r2.error).toBeUndefined();
    expect(r2.data!.tools).toHaveLength(0);
  });

  it('missing domain in payload yields error result', async () => {
    const raw = makeRaw({ companies: [{ domain: 'quizlet.com', toolsText: '' }] });
    const results = await parseObservabilityToolResponse(raw, [co1, co2]);
    expect(results[1]!.error).toBe('no output from Exa');
  });

  it('string content (JSON-string fallback) errors all companies', async () => {
    const raw = makeRaw('{"companies":[{"domain":"quizlet.com","toolsText":""}]}');
    const results = await parseObservabilityToolResponse(raw, [co1, co2]);
    expect(results[0]!.error).toBe('no output from Exa');
    expect(results[1]!.error).toBe('no output from Exa');
  });

  it('filters out tools with .html sourceUrl', async () => {
    mockJudge.mockResolvedValue({ verdict: 'yes', reason: 'ok' });
    const raw = makeRaw(
      {
        companies: [
          {
            domain: 'quizlet.com',
            toolsText: 'Datadog: https://example.com/page.html\nGrafana: https://linkedin.com/in/xyz',
          },
        ],
      },
      [{ url: 'https://linkedin.com/in/xyz', text: 'Quizlet engineer used Grafana' }]
    );
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(1);
    expect(results[0]!.data!.tools[0]!.name).toBe('Grafana');
  });

  it('normalizes domain: Www.Quizlet.com matches quizlet.com company', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'Www.Quizlet.com', toolsText: 'Prometheus: https://example.com/prom' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.data!.tools[0]!.name).toBe('Prometheus');
  });

  it('skips lines missing name, URL, or with malformed URLs', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: [
            ': https://example.com',
            'Datadog: ',
            'OrphanedText',
            'New Relic: not-a-url',
            'Grafana: https://valid.com/path',
          ].join('\n'),
        },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(1);
    expect(results[0]!.data!.tools[0]!.name).toBe('Grafana');
  });

  it('handles markdown-wrapped URL like [source](https://...)', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: 'Datadog: [source](https://jobs.example.com/abc)' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(1);
    expect(results[0]!.data!.tools[0]).toEqual({
      name: 'Datadog',
      sourceUrl: 'https://jobs.example.com/abc',
    });
  });

  it('strips markdown bold wrappers from name', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: '**Datadog**: https://example.com/a' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools[0]!.name).toBe('Datadog');
  });

  it('strips trailing punctuation from URL', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: 'Datadog: https://example.com/abc.' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools[0]!.sourceUrl).toBe('https://example.com/abc');
  });

  it('extracts URL even when line lacks the ": " separator', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: 'Datadog — https://example.com/evidence' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(1);
    expect(results[0]!.data!.tools[0]!.name).toBe('Datadog');
    expect(results[0]!.data!.tools[0]!.sourceUrl).toBe('https://example.com/evidence');
  });

  it('treats missing toolsText field as parse miss (error), not empty tools', async () => {
    const raw = makeRaw({ companies: [{ domain: 'quizlet.com' }] });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.error).toBe('no output from Exa');
  });

  it('strips bullet/markdown markers from tool lines', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: '- Datadog: https://a.com\n* Grafana: https://b.com\n• Prometheus: https://c.com',
        },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(3);
    expect(results[0]!.data!.tools.map((t) => t.name)).toEqual(['Datadog', 'Grafana', 'Prometheus']);
  });

  it('sorts allowlisted tools (Datadog/Grafana/Prometheus) before others, stable within each group', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: [
            'New Relic: https://nr.example.com',
            'Datadog: https://dd.example.com',
            'Splunk: https://sp.example.com',
            'Grafana: https://gr.example.com',
            'Dynatrace: https://dt.example.com',
            'Prometheus: https://pr.example.com',
          ].join('\n'),
        },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    const names = results[0]!.data!.tools.map((t) => t.name);
    expect(names).toEqual(['Datadog', 'Grafana', 'Prometheus', 'New Relic', 'Splunk', 'Dynatrace']);
  });

  it('sort is case-insensitive — lowercase datadog also moves to front', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: 'New Relic: https://nr.com\ndatadog: https://dd.com',
        },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools.map((t) => t.name)).toEqual(['datadog', 'New Relic']);
  });

  it('handles URL containing a colon (https://) correctly', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: 'Datadog: https://example.com:8080/path' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools[0]!.sourceUrl).toBe('https://example.com:8080/path');
  });

  it('preserves parentheses inside a name (e.g., "Elastic (ELK)")', async () => {
    const raw = makeRaw({
      companies: [
        { domain: 'quizlet.com', toolsText: 'Elastic (ELK): https://example.com/elk' },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools[0]!.name).toBe('Elastic (ELK)');
  });
});

describe('parseObservabilityToolResponse — LinkedIn profile verification', () => {
  it('non-LinkedIn URL is accepted without calling OpenAI', async () => {
    const raw = makeRaw({
      companies: [{ domain: 'quizlet.com', toolsText: 'Datadog: https://jobs.example.com/1' }],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).not.toHaveBeenCalled();
    expect(results[0]!.data!.tools).toHaveLength(1);
  });

  it('LinkedIn job posting URL (/jobs/view/) is accepted without calling OpenAI', async () => {
    const raw = makeRaw({
      companies: [
        {
          domain: 'quizlet.com',
          toolsText: 'Datadog: https://www.linkedin.com/jobs/view/some-job-12345',
        },
      ],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).not.toHaveBeenCalled();
    expect(results[0]!.data!.tools).toHaveLength(1);
  });

  it('LinkedIn profile URL (/in/) with page text — verdict yes → kept', async () => {
    mockJudge.mockResolvedValue({ verdict: 'yes', reason: 'tool under Quizlet experience' });
    const raw = makeRaw(
      { companies: [{ domain: 'quizlet.com', toolsText: 'Datadog: https://www.linkedin.com/in/someone' }] },
      [{ url: 'https://www.linkedin.com/in/someone', text: 'Quizlet — Senior Engineer — used Datadog for APM' }]
    );
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).toHaveBeenCalledOnce();
    expect(results[0]!.data!.tools).toHaveLength(1);
    expect(results[0]!.data!.tools[0]!.name).toBe('Datadog');
  });

  it('LinkedIn profile URL with page text — verdict no → dropped', async () => {
    mockJudge.mockResolvedValue({ verdict: 'no', reason: 'tool under Acme experience, not Quizlet' });
    const raw = makeRaw(
      { companies: [{ domain: 'quizlet.com', toolsText: 'New Relic: https://www.linkedin.com/in/someone' }] },
      [{ url: 'https://www.linkedin.com/in/someone', text: 'Acme Corp — Engineer — used New Relic' }]
    );
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).toHaveBeenCalledOnce();
    expect(results[0]!.data!.tools).toHaveLength(0);
  });

  it('LinkedIn profile URL NOT in results[] — dropped without calling OpenAI', async () => {
    const raw = makeRaw({
      companies: [{ domain: 'quizlet.com', toolsText: 'Datadog: https://www.linkedin.com/in/someone' }],
    });
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).not.toHaveBeenCalled();
    expect(results[0]!.data!.tools).toHaveLength(0);
  });

  it('mixed tools: non-LinkedIn kept, LinkedIn profile (yes) kept, LinkedIn profile (no) dropped', async () => {
    mockJudge
      .mockResolvedValueOnce({ verdict: 'yes', reason: 'ok' })
      .mockResolvedValueOnce({ verdict: 'no', reason: 'wrong employer' });

    const raw = makeRaw(
      {
        companies: [
          {
            domain: 'quizlet.com',
            toolsText: [
              'Datadog: https://jobs.example.com/dd',
              'Grafana: https://www.linkedin.com/in/person-a',
              'New Relic: https://www.linkedin.com/in/person-b',
            ].join('\n'),
          },
        ],
      },
      [
        { url: 'https://www.linkedin.com/in/person-a', text: 'Quizlet engineer used Grafana' },
        { url: 'https://www.linkedin.com/in/person-b', text: 'Acme Corp engineer used New Relic' },
      ]
    );
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(mockJudge).toHaveBeenCalledTimes(2);
    const names = results[0]!.data!.tools.map((t) => t.name);
    expect(names).toContain('Datadog');
    expect(names).toContain('Grafana');
    expect(names).not.toContain('New Relic');
  });

  it('URL normalisation: trailing slash on result URL still matches toolsText URL', async () => {
    mockJudge.mockResolvedValue({ verdict: 'yes', reason: 'ok' });
    const raw = makeRaw(
      { companies: [{ domain: 'quizlet.com', toolsText: 'Datadog: https://www.linkedin.com/in/person' }] },
      [{ url: 'https://www.linkedin.com/in/person/', text: 'Quizlet uses Datadog' }]
    );
    const results = await parseObservabilityToolResponse(raw, [co1]);
    expect(results[0]!.data!.tools).toHaveLength(1);
  });
});

describe('observabilityToolGate', () => {
  const make = (names: string[]): ObservabilityToolData => ({
    tools: names.map((name) => ({ name, sourceUrl: 'https://example.com' })),
  });

  it('empty tools → pass', () => {
    expect(observabilityToolGate({ tools: [] })).toBe(true);
  });

  it('[Datadog, New Relic] → pass (permissive)', () => {
    expect(observabilityToolGate(make(['Datadog', 'New Relic']))).toBe(true);
  });

  it('[Grafana] → pass', () => {
    expect(observabilityToolGate(make(['Grafana']))).toBe(true);
  });

  it('[Prometheus] → pass', () => {
    expect(observabilityToolGate(make(['Prometheus']))).toBe(true);
  });

  it('[New Relic] → reject', () => {
    expect(observabilityToolGate(make(['New Relic']))).toBe(false);
  });

  it('[Splunk, Dynatrace] → reject', () => {
    expect(observabilityToolGate(make(['Splunk', 'Dynatrace']))).toBe(false);
  });

  it('case-insensitive: [datadog] → pass', () => {
    expect(observabilityToolGate(make(['datadog']))).toBe(true);
  });

  it('case-insensitive: [GRAFANA] → pass', () => {
    expect(observabilityToolGate(make(['GRAFANA']))).toBe(true);
  });
});

describe('formatObservabilityToolForAttio', () => {
  it('empty tools → "No evidence found"', () => {
    expect(formatObservabilityToolForAttio({ tools: [] })).toBe('No evidence found');
  });

  it('two tools → name: url lines joined by newline', () => {
    const data: ObservabilityToolData = {
      tools: [
        { name: 'Datadog', sourceUrl: 'https://a.com' },
        { name: 'Grafana', sourceUrl: 'https://b.com' },
      ],
    };
    expect(formatObservabilityToolForAttio(data)).toBe('Datadog: https://a.com\nGrafana: https://b.com');
  });
});
