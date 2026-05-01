import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCsv, makeExaResponse, makeExaTextResponse } from './enrichAll.e2e.helpers.js';
import { computeInputHash } from '../stages/companyContextScore.js';
import { FIELD_SLUGS } from '../apis/attio.js';
import type { RunEvent } from '../runTypes.js';

// Slug shortcuts for Attio cache fixtures. Sourced from FIELD_SLUGS so swapping objects
// only requires editing src/apis/attio.ts; these tests follow automatically.
const S = (display: string): string => {
  const slug = FIELD_SLUGS[display];
  if (!slug) throw new Error(`e2e fixture: no FIELD_SLUGS entry for "${display}"`);
  return slug;
};

// ---------------------------------------------------------------------------
// 1. Pre-import env setup — must run before any module is loaded
// ---------------------------------------------------------------------------
const m = vi.hoisted(() => {
  // High QPS / low retry so rate limiters pass through instantly
  process.env['EXA_QPS'] = '1000';
  process.env['EXA_RETRY_TRIES'] = '1';
  process.env['EXA_RETRY_BASE_MS'] = '1';
  process.env['THEIRSTACK_QPS'] = '1000';
  process.env['THEIRSTACK_RETRY_TRIES'] = '1';
  process.env['THEIRSTACK_RETRY_BASE_MS'] = '1';
  process.env['APOLLO_QPS'] = '1000';
  process.env['APOLLO_RETRY_TRIES'] = '1';
  process.env['APOLLO_RETRY_BASE_MS'] = '1';
  process.env['APIFY_CONCURRENCY'] = '100';
  process.env['APIFY_RETRY_TRIES'] = '1';
  process.env['APIFY_RETRY_BASE_MS'] = '1';
  process.env['TWITTER_API_QPS'] = '1000';
  process.env['TWITTER_API_RETRY_TRIES'] = '1';
  process.env['TWITTER_API_RETRY_BASE_MS'] = '1';
  process.env['STATUSPAGE_CONCURRENCY'] = '100';
  process.env['STATUSPAGE_RETRY_TRIES'] = '1';
  process.env['STATUSPAGE_RETRY_BASE_MS'] = '1';
  process.env['ATTIO_WRITE_CONCURRENCY'] = '100';
  process.env['OPENAI_CONCURRENCY'] = '100';
  // Fake secrets so config.ts doesn't throw
  process.env['ATTIO_API_KEY'] = 'test-attio';
  process.env['EXA_API_KEY'] = 'test-exa';
  process.env['THEIRSTACK_API_KEY'] = 'test-theirstack';
  process.env['APOLLO_API_KEY'] = 'test-apollo';
  process.env['APIFY_TOKEN'] = 'test-apify';
  process.env['AZURE_OPENAI_API_KEY'] = 'test-openai';
  process.env['AZURE_OPENAI_BASE_URL'] = 'https://test.openai.azure.com';
  process.env['X_API_KEY'] = 'test-x';

  return {
    // Attio
    fetchAllRecords: vi.fn(),
    upsertByDomain: vi.fn(),
    // Exa
    digitalNativeExaSearch: vi.fn(),
    numberOfUsersExaSearch: vi.fn(),
    observabilityToolExaSearch: vi.fn(),
    cloudToolExaSearch: vi.fn(),
    fundingGrowthExaSearch: vi.fn(),
    revenueGrowthExaSearch: vi.fn(),
    industryExaSearch: vi.fn(),
    aiAdoptionMindsetExaSearch: vi.fn(),
    aiSreMaturityExaSearch: vi.fn(),
    // TheirStack
    theirstackJobsByTechnology: vi.fn(),
    theirstackJobsByAnySlugs: vi.fn(),
    // Apollo
    apolloMixedPeopleApiSearch: vi.fn(),
    // Apify
    runHarvestLinkedInEmployees: vi.fn(),
    runCareerSiteJobListings: vi.fn(),
    // Twitter / Statuspage
    fetchComplaintTweets: vi.fn(),
    fetchRecentIncidents: vi.fn(),
    // OpenAI
    judge: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// 2. Module mocks
// ---------------------------------------------------------------------------
vi.mock('../apis/attio.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/attio.js')>('../apis/attio.js');
  return {
    ...actual,
    fetchAllRecords: m.fetchAllRecords,
    upsertCompanyByDomain: m.upsertByDomain,
  };
});

vi.mock('../apis/theirstack.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/theirstack.js')>('../apis/theirstack.js');
  return {
    ...actual,
    theirstackJobsByTechnology: m.theirstackJobsByTechnology,
    theirstackJobsByAnySlugs: m.theirstackJobsByAnySlugs,
  };
});

vi.mock('../apis/exa.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/exa.js')>('../apis/exa.js');
  return {
    ...actual,
    digitalNativeExaSearch: m.digitalNativeExaSearch,
    numberOfUsersExaSearch: m.numberOfUsersExaSearch,
    observabilityToolExaSearch: m.observabilityToolExaSearch,
    cloudToolExaSearch: m.cloudToolExaSearch,
    fundingGrowthExaSearch: m.fundingGrowthExaSearch,
    revenueGrowthExaSearch: m.revenueGrowthExaSearch,
    industryExaSearch: m.industryExaSearch,
    aiAdoptionMindsetExaSearch: m.aiAdoptionMindsetExaSearch,
    aiSreMaturityExaSearch: m.aiSreMaturityExaSearch,
  };
});

vi.mock('../apis/apollo.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/apollo.js')>('../apis/apollo.js');
  return { ...actual, apolloMixedPeopleApiSearch: m.apolloMixedPeopleApiSearch };
});

vi.mock('../apis/apify.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/apify.js')>('../apis/apify.js');
  return {
    ...actual,
    runHarvestLinkedInEmployees: m.runHarvestLinkedInEmployees,
    runCareerSiteJobListings: m.runCareerSiteJobListings,
  };
});

vi.mock('../apis/twitterapi.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/twitterapi.js')>('../apis/twitterapi.js');
  return { ...actual, fetchComplaintTweets: m.fetchComplaintTweets };
});

vi.mock('../apis/statuspage.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/statuspage.js')>('../apis/statuspage.js');
  return { ...actual, fetchRecentIncidents: m.fetchRecentIncidents };
});

vi.mock('../apis/openai.js', async () => {
  const actual = await vi.importActual<typeof import('../apis/openai.js')>('../apis/openai.js');
  return { ...actual, judge: m.judge };
});

// ---------------------------------------------------------------------------
// 3. Dynamic import of the SUT — after all mocks are registered
// ---------------------------------------------------------------------------
const { enrichAll } = await import('./enrichAll.js');

// ---------------------------------------------------------------------------
// 4. Helpers: default mock responses
// ---------------------------------------------------------------------------
function defaultExaMocks(domains: string[]) {
  m.digitalNativeExaSearch.mockResolvedValue(
    makeExaResponse(
      domains.map((d) => ({
        domain: d,
        category: 'Digital-native B2B',
        confidence: 'high',
        reason: 'SaaS platform',
        digital_criticality_signals: [],
        source_links: [],
      }))
    )
  );
  m.numberOfUsersExaSearch.mockResolvedValue(
    makeExaResponse(
      domains.map((d) => ({
        domain: d,
        user_count: '5M MAU',
        user_count_bucket: '100K+',
        reasoning: '',
        source_link: '',
        source_date: '',
        confidence: 'medium',
      }))
    )
  );
  m.observabilityToolExaSearch.mockResolvedValue(
    makeExaResponse(domains.map((d) => ({ domain: d, toolsText: 'Datadog: https://jobs.example.com/dd' })))
  );
  m.cloudToolExaSearch.mockResolvedValue(
    makeExaResponse(
      domains.map((d) => ({ domain: d, tool: 'AWS', evidence: 'https://example.com', confidence: 'high' }))
    )
  );
  m.fundingGrowthExaSearch.mockResolvedValue(
    makeExaResponse(
      domains.map((d) => ({ domain: d, growth: 'Series B, $50M', timeframe: '2024', evidence: '' }))
    )
  );
  m.revenueGrowthExaSearch.mockResolvedValue(
    makeExaResponse(
      domains.map((d) => ({
        domain: d,
        growth: '~$15M ARR',
        evidence: '',
        source_date: '',
        reasoning: '',
        confidence: 'medium',
      }))
    )
  );
  m.industryExaSearch.mockResolvedValue(
    makeExaResponse(domains.map((d) => ({ domain: d, industry: 'SaaS (B2B)', reason: 'B2B software' })))
  );
  m.aiAdoptionMindsetExaSearch.mockResolvedValue(
    makeExaTextResponse(
      'Classification: Neutral\nConfidence: Low\nEvidence:\n- "test" (https://example.com)\nReasoning:\n- test'
    )
  );
  m.aiSreMaturityExaSearch.mockResolvedValue(
    makeExaTextResponse(
      'Classification: ideating\nConfidence: Low\nSales signal: High potential\nEvidence:\n- "test" (https://example.com)\nReasoning:\n- test'
    )
  );
}

// ---------------------------------------------------------------------------
// 5. Lifecycle
// ---------------------------------------------------------------------------
let tmpDir = '';

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enrichall-e2e-'));

  // Attio defaults
  m.fetchAllRecords.mockResolvedValue(new Map());
  m.upsertByDomain.mockResolvedValue({ id: 'rec', values: {} });

  // TheirStack defaults: Slack found, Teams not found
  m.theirstackJobsByTechnology.mockImplementation(
    (_domain: string, slug: string) => {
      if (slug === 'slack')
        return Promise.resolve({ data: [{ source_url: 'https://jobs.example.com/slack', url: null, final_url: null }] });
      return Promise.resolve({ data: [] });
    }
  );
  m.theirstackJobsByAnySlugs.mockResolvedValue({ data: [] });

  // Apollo / Apify / Twitter / Statuspage / OpenAI defaults
  m.apolloMixedPeopleApiSearch.mockResolvedValue({ total_entries: 10 });
  m.runHarvestLinkedInEmployees.mockResolvedValue({
    items: [{ linkedinUrl: 'https://linkedin.com/in/joe' }],
  });
  m.runCareerSiteJobListings.mockResolvedValue({
    items: [{ title: 'Software Engineer', url: 'https://jobs.example.com/1' }],
  });
  m.fetchComplaintTweets.mockResolvedValue([]);
  m.fetchRecentIncidents.mockResolvedValue({ kind: 'notFound' });
  m.judge.mockImplementation((args: { schema?: { name?: string } }) => {
    if (args.schema?.name === 'company_context_score') {
      return Promise.resolve({ score: 4.5, reasoning: 'High-scale platform.' });
    }
    if (args.schema?.name === 'tooling_match_score') {
      return Promise.resolve({
        communication_tool_score: 5,
        competitor_tooling_score: 5,
        observability_tool_score: 5,
        cloud_tool_score: 5,
        justification: {
          communication_tool: 'Slack confirmed',
          competitor_tooling: 'No competitors',
          observability_tool: 'Datadog sole',
          cloud_tool: 'AWS confirmed',
        },
      });
    }
    if (args.schema?.name === 'intent_signal_score') {
      return Promise.resolve({ score: 4.5, reasoning: 'Strong intent signals.' });
    }
    if (args.schema?.name === 'final_score_reasoning') {
      return Promise.resolve({ reasoning: 'Strong overall ICP fit with clear intent signals.' });
    }
    return Promise.resolve({ verdict: 'yes', reason: 'confirmed' });
  });

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { exaLimiter, theirstackLimiter, apolloLimiter } = await import('../rateLimit.js');
  await exaLimiter.stop();
  await theirstackLimiter.stop();
  await apolloLimiter.stop();
});

// ---------------------------------------------------------------------------
// Group 1 — Input routing
// ---------------------------------------------------------------------------
describe('input routing', () => {
  it('skips a LinkedIn-only row with no website at preflight — no Attio writes, no stage calls', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Ghost Co',
        Website: '',
        'Company Linkedin Url': 'https://linkedin.com/company/ghost-co',
        'Short Description': 'Mystery company',
      },
    ]);
    m.fetchAllRecords.mockResolvedValue(new Map());

    await enrichAll({ csv: csvPath, skipConfirm: true });

    expect(m.upsertByDomain).not.toHaveBeenCalled();
    expect(m.digitalNativeExaSearch).not.toHaveBeenCalled();
  });

  it('identity write fills only empty Attio slots — never overwrites existing values', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme Corp',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'A SaaS company',
      },
    ]);
    // Attio has Company Name and Domain filled, LinkedIn Page and Description empty.
    // All 17 stage columns are pre-populated so no stage writes fire —
    // the only upsertByDomain call will be the identity write itself.
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'acme.com',
          {
            ...ALL_17_COLS,
            [S('Company Name')]: 'Acme Corp (existing)',
            [S('Domain')]: 'acme.com',
            [S('LinkedIn Page')]: '',
            [S('Description')]: '',
            // Override two stage cells to validate "no overwrite" path
            [S('Digital Native')]: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            [S('Funding Growth')]: 'Growth: Series B',
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // With all 17 stage columns cached, Stages 18/19/20/21 fire (no hashes stored yet)
    // plus the identity write = 5 total upsertByDomain calls.
    expect(m.upsertByDomain).toHaveBeenCalledTimes(5);
    const [identityWriteArg] = m.upsertByDomain.mock.calls[0] as [Record<string, unknown>];

    expect(identityWriteArg['Company Name']).toBeUndefined();
    // Domain is always the lookup key — it's present but that's structural, not "written"
    // What matters is the toWrite fields:
    // LinkedIn Page is normalized to a bare slug for Attio's `linkedin` handle field —
    // full URLs get rejected with "LinkedIn handle is not valid".
    expect(identityWriteArg['LinkedIn Page']).toBe('acme');
    expect(identityWriteArg['Description']).toBe('A SaaS company');
  });

  it('writes Account Purpose for CSV rows when --account-purpose is set, even when all other identity columns are already filled', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme Corp',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'A SaaS company',
      },
    ]);
    // All identity columns already filled — without accountPurpose, toWrite would be empty and no upsert fires.
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'acme.com',
          {
            ...ALL_17_COLS,
            [S('Company Name')]: 'Acme Corp',
            [S('Domain')]: 'acme.com',
            [S('LinkedIn Page')]: 'https://linkedin.com/company/acme',
            [S('Description')]: 'A SaaS company',
            [S('Website')]: 'acme.com',
            [S('Digital Native')]: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            [S('Funding Growth')]: 'Growth: Series B',
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, accountPurpose: 'Q1 ABM', skipConfirm: true });

    // Account Purpose makes toWrite non-empty even when all other identity columns are already filled,
    // so the upsert fires. It must appear in at least one upsertByDomain call.
    expect(m.upsertByDomain).toHaveBeenCalledWith(
      expect.objectContaining({ 'Account Purpose': 'Q1 ABM' })
    );
  });

  it('does not write Account Purpose when --account-purpose is not provided', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme Corp',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'A SaaS company',
      },
    ]);
    m.fetchAllRecords.mockResolvedValue(new Map());

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // None of the upsert calls should include Account Purpose
    for (const [callArg] of m.upsertByDomain.mock.calls as [Record<string, unknown>][]) {
      expect(callArg['Account Purpose']).toBeUndefined();
    }
  });

});

// ---------------------------------------------------------------------------
// Group 3 — Scope: CSV-only (Attio records outside the CSV are ignored)
// ---------------------------------------------------------------------------
describe('scope: CSV-only', () => {
  it('does not enrich Attio records whose domain is not in the CSV', async () => {
    // CSV has acme.com only. Attio additionally has stranger.com (no Reason for Rejection,
    // empty stage columns) — under the old union rule it would be picked up; under the
    // current rule it must be ignored entirely.
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'SaaS platform',
      },
    ]);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'stranger.com',
          { [S('Company Name')]: 'Stranger Co', [S('Domain')]: 'stranger.com' },
        ],
      ])
    );
    defaultExaMocks(['acme.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Stage 2 (digitalNative) must have been called only for acme.com — never for stranger.com.
    const allDigitalNativeDomains = m.digitalNativeExaSearch.mock.calls.flatMap(
      (c: unknown[]) => (c[0] as string[]) ?? []
    ) as string[];
    expect(allDigitalNativeDomains).toContain('acme.com');
    expect(allDigitalNativeDomains).not.toContain('stranger.com');

    // No upsert (identity, stage column, or rejection) ever targets stranger.com.
    const upsertedDomains = m.upsertByDomain.mock.calls.map(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Domain']
    );
    expect(upsertedDomains).not.toContain('stranger.com');
  });

  it('passes only CSV domains to fetchAllRecords (narrows the prefetch)', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': '',
      },
      {
        'Company Name': 'Beta',
        Website: 'beta.com',
        'Company Linkedin Url': 'https://linkedin.com/company/beta',
        'Short Description': '',
      },
    ]);
    defaultExaMocks(['acme.com', 'beta.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    expect(m.fetchAllRecords).toHaveBeenCalledTimes(1);
    const [domainsArg] = m.fetchAllRecords.mock.calls[0] as [string[]];
    expect(domainsArg).toEqual(expect.arrayContaining(['acme.com', 'beta.com']));
    expect(domainsArg).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — Happy path (all 17 stages)
// ---------------------------------------------------------------------------
describe('happy path', () => {
  it('runs a single company through all 21 stages and writes each column', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'SaaS platform',
      },
    ]);
    defaultExaMocks(['acme.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // All 17 stage columns + identity columns must have been written via upsertByDomain
    const allColumnArgs = m.upsertByDomain.mock.calls.flatMap(
      (c: unknown[]) => Object.keys((c[0] as Record<string, unknown>) ?? {})
    ) as string[];

    const expectedColumns = [
      'Competitor Tooling',
      'Digital Native',
      'Number of Users',
      'Observability Tool',
      'Communication Tool',
      'Cloud Tool',
      'Funding Growth',
      'Revenue Growth',
      'Number of Engineers',
      'Number of SREs',
      'Engineer Hiring',
      'SRE Hiring',
      'Customer complains on X',
      'Recent incidents ( Official )',
      'AI adoption mindset',
      'AI SRE maturity',
      'Industry',
      'Company Context Score',
      'Company Context Score Change Detection for Developer',
      'Tooling Match Score',
      'Tooling Match Change Detection for Developer',
      'Intent Signal Score',
      'Intent Signal Change Detection for Developer',
      'Final Score',
      'Final Score Change Detection for Developer',
    ];
    for (const col of expectedColumns) {
      expect(allColumnArgs, `expected "${col}" to be written`).toContain(col);
    }

    // No rejection reason written
    expect(allColumnArgs).not.toContain('Reason for Rejection');

    // Identity write happened before Stage 1 (Competitor Tooling appears in calls)
    const competitorCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Competitor Tooling'] !== undefined
    );
    expect(competitorCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Group 5 — Stage 16 competitor shortcut
// ---------------------------------------------------------------------------
describe('Stage 16 competitor shortcut', () => {
  it('skips Exa and writes "Working with vendor:" prefix when Competitor Tooling is non-empty', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': 'SaaS platform',
      },
    ]);

    // All stage columns pre-populated except ai_sre_maturity, which is blank so Stage 16 fires.
    // competitor_tooling has a real competitor hit → shortcut should activate.
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'acme.com',
          {
            ...ALL_17_COLS,
            [S('Company Name')]: 'Acme',
            [S('Domain')]: 'acme.com',
            [S('LinkedIn Page')]: 'https://linkedin.com/company/acme',
            [S('Description')]: 'SaaS platform',
            [S('Competitor Tooling')]: 'Rootly\n\nEvidence: (Rootly\'s customer page)',
            [S('Digital Native')]: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            [S('Funding Growth')]: 'Growth: Series B',
            [S('AI SRE maturity')]: '',
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    expect(m.aiSreMaturityExaSearch).not.toHaveBeenCalled();

    const sreMaturityCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['AI SRE maturity'] !== undefined
    );
    expect(sreMaturityCall).toBeDefined();
    expect((sreMaturityCall![0] as Record<string, unknown>)['AI SRE maturity']).toBe(
      "Working with vendor: Rootly\n\nEvidence: (Rootly's customer page)"
    );
  });
});

// ---------------------------------------------------------------------------
// Group 6 — Rejection propagation
// ---------------------------------------------------------------------------
describe('rejection propagation', () => {
  it('Stage 2 rejection stops the company from reaching Stage 3+, writes rejection reason', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Reject Co', Website: 'reject.com', 'Company Linkedin Url': 'https://linkedin.com/company/reject-co', 'Short Description': '' },
    ]);

    // Stage 2 returns NOT Digital-native or digitally critical → should be rejected
    m.digitalNativeExaSearch.mockResolvedValue(
      makeExaResponse([
        {
          domain: 'reject.com',
          category: 'NOT Digital-native or digitally critical',
          confidence: 'high',
          reason: 'traditional retail chain',
          digital_criticality_signals: [],
          source_links: [],
        },
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Rejection reason written
    const rejectionCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Reason for Rejection'] !== undefined
    );
    expect(rejectionCall).toBeDefined();
    expect((rejectionCall![0] as Record<string, unknown>)['Reason for Rejection']).toBe(
      'Digital Native: not a digital-native company'
    );

    // Stage 3+ not called for reject.com
    expect(m.numberOfUsersExaSearch).not.toHaveBeenCalled();
    expect(m.observabilityToolExaSearch).not.toHaveBeenCalled();
    expect(m.cloudToolExaSearch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Group 6 — Cache-gate wiring
// ---------------------------------------------------------------------------
describe('cache-gate', () => {
  it('Stage 2 cached rejection skips fresh Exa call and writes rejection reason', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Stale Co', Website: 'stale.com', 'Company Linkedin Url': 'https://linkedin.com/company/stale-co', 'Short Description': '' },
    ]);

    // Attio already has Digital Native = "NOT Digital-native or digitally critical …"
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'stale.com',
          {
            [S('Digital Native')]:
              'NOT Digital-native or digitally critical\n\nConfidence: High\n\nReasoning: traditional firm\n\nSources:\nhttps://example.com',
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Fresh Exa NOT called (already cached)
    expect(m.digitalNativeExaSearch).not.toHaveBeenCalled();

    // Rejection reason still written
    const rejectionCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Reason for Rejection'] !== undefined
    );
    expect(rejectionCall).toBeDefined();
    expect((rejectionCall![0] as Record<string, unknown>)['Reason for Rejection']).toBe(
      'Digital Native: not a digital-native company'
    );
  });
});

// ---------------------------------------------------------------------------
// Group 7 — Stage 3 hand-rolled conditional gate
// ---------------------------------------------------------------------------
describe('Stage 3 conditional gate', () => {
  const cases: Array<{
    label: string;
    domain: string;
    dnCategory: string;
    bucket: string;
    expectRejected: boolean;
  }> = [
    {
      label: 'B2B + 10K–100K bucket → rejected',
      domain: 'b2b-small.com',
      dnCategory: 'Digital-native B2B',
      bucket: '10K–100K',
      expectRejected: true,
    },
    {
      label: 'B2B + unknown bucket → passes (human review)',
      domain: 'b2b-unknown.com',
      dnCategory: 'Digital-native B2B',
      bucket: 'unknown',
      expectRejected: false,
    },
    {
      label: 'B2C + 10K–100K bucket → passes (gate is B2B-only)',
      domain: 'b2c-small.com',
      dnCategory: 'Digital-native B2C',
      bucket: '10K–100K',
      expectRejected: false,
    },
    {
      label: 'Digitally critical B2B + 10K–100K bucket → rejected',
      domain: 'dc-b2b-small.com',
      dnCategory: 'Digitally critical B2B',
      bucket: '10K–100K',
      expectRejected: true,
    },
    {
      label: 'Digitally critical B2C + 10K–100K bucket → passes (gate is B2B-only)',
      domain: 'dc-b2c-small.com',
      dnCategory: 'Digitally critical B2C',
      bucket: '10K–100K',
      expectRejected: false,
    },
  ];

  for (const tc of cases) {
    it(tc.label, async () => {
      const csvPath = await makeCsv(tmpDir, [
        { 'Company Name': 'Test Co', Website: tc.domain, 'Company Linkedin Url': 'https://linkedin.com/company/test-co', 'Short Description': '' },
      ]);

      m.digitalNativeExaSearch.mockResolvedValue(
        makeExaResponse([
          {
            domain: tc.domain,
            category: tc.dnCategory,
            confidence: 'high',
            reason: 'test',
            digital_criticality_signals: [],
            source_links: [],
          },
        ])
      );
      m.numberOfUsersExaSearch.mockResolvedValue(
        makeExaResponse([
          {
            domain: tc.domain,
            user_count: tc.bucket === 'unknown' ? 'unknown' : '50K MAU',
            user_count_bucket: tc.bucket,
            reasoning: '',
            source_link: '',
            source_date: '',
            confidence: 'medium',
          },
        ])
      );
      // Remaining gating stages: pass
      m.observabilityToolExaSearch.mockResolvedValue(
        makeExaResponse([{ domain: tc.domain, toolsText: 'Datadog: https://jobs.example.com/dd' }])
      );
      m.cloudToolExaSearch.mockResolvedValue(
        makeExaResponse([{ domain: tc.domain, tool: 'AWS', evidence: 'https://example.com', confidence: 'high' }])
      );
      m.theirstackJobsByTechnology.mockImplementation((_d: string, slug: string) =>
        slug === 'slack'
          ? Promise.resolve({ data: [{ source_url: 'https://jobs.example.com/slack', url: null, final_url: null }] })
          : Promise.resolve({ data: [] })
      );
      // Non-gating stages
      m.fundingGrowthExaSearch.mockResolvedValue(
        makeExaResponse([{ domain: tc.domain, growth: 'Series B', timeframe: '2024', evidence: '' }])
      );
      m.revenueGrowthExaSearch.mockResolvedValue(
        makeExaResponse([
          { domain: tc.domain, growth: '~$10M ARR', evidence: '', source_date: '', reasoning: '', confidence: 'low' },
        ])
      );
      m.industryExaSearch.mockResolvedValue(
        makeExaResponse([{ domain: tc.domain, industry: 'SaaS (B2B)', reason: 'B2B' }])
      );
      m.aiAdoptionMindsetExaSearch.mockResolvedValue(makeExaTextResponse('Classification: Neutral\nConfidence: Low'));
      m.aiSreMaturityExaSearch.mockResolvedValue(makeExaTextResponse('Classification: ideating\nConfidence: Low\nSales signal: High potential'));

      await enrichAll({ csv: csvPath, skipConfirm: true });

      const allArgs = m.upsertByDomain.mock.calls.flatMap(
        (c: unknown[]) => Object.keys((c[0] as Record<string, unknown>) ?? {})
      ) as string[];
      const rejectionCall = m.upsertByDomain.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Reason for Rejection'] !== undefined
      );

      if (tc.expectRejected) {
        expect(rejectionCall).toBeDefined();
        expect((rejectionCall![0] as Record<string, unknown>)['Reason for Rejection']).toContain('Number of Users');
        // Rejected companies must not reach Stage 4+
        expect(allArgs).not.toContain('Observability Tool');
      } else {
        expect(rejectionCall).toBeUndefined();
        // Company survived past Stage 3 — Stage 4 (Observability Tool) must have been called
        expect(allArgs).toContain('Observability Tool');
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Group 8a — Preflight LinkedIn URL gate
// ---------------------------------------------------------------------------
describe('Preflight LinkedIn URL gate', () => {
  it('skips rows missing LinkedIn URL and surfaces them on the run-started event', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'No-LI Co', Website: 'no-li.com', 'Company Linkedin Url': '', 'Short Description': '', 'Apollo Account Id': 'apollo-no-li' },
      { 'Company Name': 'Has-LI Co', Website: 'has-li.com', 'Company Linkedin Url': 'https://linkedin.com/company/has-li', 'Short Description': '', 'Apollo Account Id': 'apollo-has-li' },
    ]);
    defaultExaMocks(['has-li.com']);

    const events: RunEvent[] = [];
    await enrichAll({
      csv: csvPath,
      skipConfirm: true,
      onEvent: (e) => events.push(e),
    });

    const started = events.find(
      (e): e is Extract<RunEvent, { type: 'run-started' }> => e.type === 'run-started'
    );
    expect(started).toBeDefined();
    expect(started?.totalCompanies).toBe(1);
    expect(started?.skippedRows).toEqual([
      { name: 'No-LI Co', reason: 'Missing LinkedIn URL' },
    ]);

    // No Apify or Attio writes for the skipped row's domain.
    expect(m.runHarvestLinkedInEmployees).not.toHaveBeenCalledWith(
      expect.objectContaining({ linkedinUrl: expect.stringContaining('no-li') })
    );
    const upsertedDomains = m.upsertByDomain.mock.calls.map(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Domain']
    );
    expect(upsertedDomains).not.toContain('no-li.com');
  });

  it('skips rows missing both Website and LinkedIn URL with a combined reason', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Empty Co', Website: '', 'Company Linkedin Url': '', 'Short Description': '', 'Apollo Account Id': 'apollo-empty' },
      { 'Company Name': 'Good Co', Website: 'good.com', 'Company Linkedin Url': 'https://linkedin.com/company/good', 'Short Description': '', 'Apollo Account Id': 'apollo-good' },
    ]);
    defaultExaMocks(['good.com']);

    const events: RunEvent[] = [];
    await enrichAll({
      csv: csvPath,
      skipConfirm: true,
      onEvent: (e) => events.push(e),
    });

    const started = events.find(
      (e): e is Extract<RunEvent, { type: 'run-started' }> => e.type === 'run-started'
    );
    expect(started?.totalCompanies).toBe(1);
    expect(started?.skippedRows).toEqual([
      { name: 'Empty Co', reason: 'Missing Website and LinkedIn URL' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Group 8b — Stage 11+12 union-skip filter
// ---------------------------------------------------------------------------
describe('Stage 11+12 union-skip', () => {
  it('re-runs Apify when only one of the two hiring columns is cached', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Half Co',
        Website: 'half.com',
        'Company Linkedin Url': 'https://linkedin.com/company/half-co',
        'Short Description': '',
      },
    ]);

    // Attio has Engineer Hiring but NOT SRE Hiring
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'half.com',
          {
            engineer_hiring: '2\n\nSoftware Engineer: https://jobs.example.com/1',
          },
        ],
      ])
    );
    defaultExaMocks(['half.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Apify job listings should be called because SRE Hiring was missing
    expect(m.runCareerSiteJobListings).toHaveBeenCalled();

    // Both columns should have been written
    const allArgs = m.upsertByDomain.mock.calls.flatMap(
      (c: unknown[]) => Object.keys((c[0] as Record<string, unknown>) ?? {})
    ) as string[];
    expect(allArgs).toContain('Engineer Hiring');
    expect(allArgs).toContain('SRE Hiring');
  });
});

// ---------------------------------------------------------------------------
// Group 9 — Stage 18 hash-gate
// ---------------------------------------------------------------------------

const ENRICHABLE_SLUGS_FOR_HASH = [
  S('Digital Native'), S('Cloud Tool'), S('Observability Tool'), S('Communication Tool'),
  S('Number of Users'), S('Competitor Tooling'), S('Number of Engineers'), S('Number of SREs'),
  S('Engineer Hiring'), S('SRE Hiring'), S('Customer complains on X'), S('Recent incidents ( Official )'),
  S('Funding Growth'), S('Revenue Growth'), S('AI adoption mindset'), S('AI SRE maturity'), S('Industry'),
];

const ALL_17_COLS: Record<string, string> = {
  [S('Digital Native')]: 'Digital-native B2C\n\nConfidence: High\n\nReasoning: test',
  [S('Cloud Tool')]: 'AWS: https://example.com',
  [S('Observability Tool')]: 'Datadog: https://example.com',
  [S('Communication Tool')]: 'Slack: https://example.com',
  [S('Number of Users')]: 'User count: 5M MAU\n\nUser count bucket: 100K+\n\nConfidence: medium',
  [S('Competitor Tooling')]: 'Not using any competitor tools',
  [S('Number of Engineers')]: '10',
  [S('Number of SREs')]: '3\n\nhttps://linkedin.com/in/joe',
  [S('Engineer Hiring')]: '2\n\nSoftware Engineer: https://jobs.example.com/1',
  [S('SRE Hiring')]: '0',
  [S('Customer complains on X')]: 'Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0',
  [S('Recent incidents ( Official )')]: 'No status page found',
  [S('Funding Growth')]: 'Growth: Series B\n\nTimeframe: 2024',
  [S('Revenue Growth')]: 'Growth: ~$15M ARR\n\nConfidence: medium',
  [S('AI adoption mindset')]: 'Classification: Neutral\nConfidence: Low',
  [S('AI SRE maturity')]: 'Classification: ideating\nConfidence: Low\nSales signal: High potential',
  [S('Industry')]: 'industry: SaaS (B2B)\nreason: B2B software',
};

describe('Stage 18 hash-gate', () => {
  it('re-scores when stored hash is stale', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Hash Co', Website: 'hash.com', 'Company Linkedin Url': 'https://linkedin.com/company/hash-co', 'Short Description': '' },
    ]);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'hash.com',
          {
            ...ALL_17_COLS,
            [S('Company Context Score')]: '3\n\nReasoning: old.',
            [S('Company Context Score Change Detection for Developer')]: 'stale-hash',
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    const scoreCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Company Context Score'] !== undefined
    );
    expect(scoreCall).toBeDefined();
    expect((scoreCall![0] as Record<string, unknown>)['Company Context Score']).toBe(
      '4.5\n\nReasoning: High-scale platform.'
    );
  });

  it('skips Stage 18 when hash matches stored value', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Hash Co', Website: 'hash.com', 'Company Linkedin Url': 'https://linkedin.com/company/hash-co', 'Short Description': '' },
    ]);
    const correctHash = computeInputHash(ALL_17_COLS, ENRICHABLE_SLUGS_FOR_HASH);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'hash.com',
          {
            ...ALL_17_COLS,
            [S('Company Context Score')]: '4.5\n\nReasoning: existing.',
            [S('Company Context Score Change Detection for Developer')]: correctHash,
          },
        ],
      ])
    );

    await enrichAll({ csv: csvPath, skipConfirm: true });

    const stage18JudgeCalls = (m.judge.mock.calls as Array<[{ schema?: { name?: string } }]>).filter(
      ([args]) => args.schema?.name === 'company_context_score'
    );
    expect(stage18JudgeCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cancel coverage — mid-stage (the realistic case)
//
// User cost concern: when cancel fires mid-fetch in stage N, no API belonging
// to any stage > N may be called. Cancel triggers from *inside* the stage's
// own API mock so it races against the in-flight call. Parameterized across
// all 21 stages — sampling cannot catch a single missing bailIfCancelled.
// ---------------------------------------------------------------------------
describe('cancel coverage — mid-stage', () => {
  // Default judge responses (mirrors the beforeEach default) — used as the
  // fallback for unrelated schemas when overriding judge for score-stage cancels.
  function defaultJudgeResponse(args: { schema?: { name?: string } }): Promise<unknown> {
    switch (args.schema?.name) {
      case 'company_context_score':
        return Promise.resolve({ score: 4.5, reasoning: 'High-scale platform.' });
      case 'tooling_match_score':
        return Promise.resolve({
          communication_tool_score: 5,
          competitor_tooling_score: 5,
          observability_tool_score: 5,
          cloud_tool_score: 5,
          justification: {
            communication_tool: 'Slack confirmed',
            competitor_tooling: 'No competitors',
            observability_tool: 'Datadog sole',
            cloud_tool: 'AWS confirmed',
          },
        });
      case 'intent_signal_score':
        return Promise.resolve({ score: 4.5, reasoning: 'Strong intent signals.' });
      case 'final_score_reasoning':
        return Promise.resolve({ reasoning: 'Strong overall ICP fit with clear intent signals.' });
      default:
        return Promise.resolve({ verdict: 'yes', reason: 'confirmed' });
    }
  }

  // Same stage→mock count helper as the between-stages block.
  function stageApiCalls(stage: number): Array<{ name: string; count: number }> {
    const judgeCallsBySchema = (schemaName: string): number =>
      (m.judge.mock.calls as Array<[{ schema?: { name?: string } }]>).filter(
        ([args]) => args.schema?.name === schemaName
      ).length;

    switch (stage) {
      case 1: return [{ name: 'theirstackJobsByAnySlugs', count: m.theirstackJobsByAnySlugs.mock.calls.length }];
      case 2: return [{ name: 'digitalNativeExaSearch', count: m.digitalNativeExaSearch.mock.calls.length }];
      case 3: return [{ name: 'numberOfUsersExaSearch', count: m.numberOfUsersExaSearch.mock.calls.length }];
      case 4: return [{ name: 'observabilityToolExaSearch', count: m.observabilityToolExaSearch.mock.calls.length }];
      case 5: return [{ name: 'theirstackJobsByTechnology', count: m.theirstackJobsByTechnology.mock.calls.length }];
      case 6: return [{ name: 'cloudToolExaSearch', count: m.cloudToolExaSearch.mock.calls.length }];
      case 7: return [{ name: 'fundingGrowthExaSearch', count: m.fundingGrowthExaSearch.mock.calls.length }];
      case 8: return [{ name: 'revenueGrowthExaSearch', count: m.revenueGrowthExaSearch.mock.calls.length }];
      case 9: return [{ name: 'apolloMixedPeopleApiSearch', count: m.apolloMixedPeopleApiSearch.mock.calls.length }];
      case 10: return [{ name: 'runHarvestLinkedInEmployees', count: m.runHarvestLinkedInEmployees.mock.calls.length }];
      case 11:
      case 12: return [{ name: 'runCareerSiteJobListings (stages 11+12)', count: m.runCareerSiteJobListings.mock.calls.length }];
      case 13: return [{ name: 'fetchComplaintTweets', count: m.fetchComplaintTweets.mock.calls.length }];
      case 14: return [{ name: 'fetchRecentIncidents', count: m.fetchRecentIncidents.mock.calls.length }];
      case 15: return [{ name: 'aiAdoptionMindsetExaSearch', count: m.aiAdoptionMindsetExaSearch.mock.calls.length }];
      case 16: return [{ name: 'aiSreMaturityExaSearch', count: m.aiSreMaturityExaSearch.mock.calls.length }];
      case 17: return [{ name: 'industryExaSearch', count: m.industryExaSearch.mock.calls.length }];
      case 18: return [{ name: 'judge(company_context_score)', count: judgeCallsBySchema('company_context_score') }];
      case 19: return [{ name: 'judge(tooling_match_score)', count: judgeCallsBySchema('tooling_match_score') }];
      case 20: return [{ name: 'judge(intent_signal_score)', count: judgeCallsBySchema('intent_signal_score') }];
      case 21: return [{ name: 'judge(final_score_reasoning)', count: judgeCallsBySchema('final_score_reasoning') }];
      default: return [];
    }
  }

  // Stage 12 shares Apify with Stage 11 — there's no distinct stage-12 call
  // we can interrupt mid-flight. Cancel during the shared call is exactly
  // "cancel during stages 11+12" and is already covered by stage 11.
  const stages = Array.from({ length: 21 }, (_, i) => i + 1).filter((s) => s !== 12);

  it.each(stages)(
    'cancel during stage %i (mid-API-call): no API call for any later stage',
    async (cancelDuringStage) => {
      const csvPath = await makeCsv(tmpDir, [
        {
          'Company Name': 'Acme',
          Website: 'acme.com',
          'Company Linkedin Url': 'https://linkedin.com/company/acme',
          'Short Description': 'SaaS platform',
        },
      ]);
      defaultExaMocks(['acme.com']);

      let triggerCancel: () => void = () => {};
      const cancelSignal = new Promise<never>((_, reject) => {
        triggerCancel = () => reject(new Error('cancelled'));
      });
      cancelSignal.catch(() => {});

      let cancelFlag = false;
      const isCancelled = (): boolean => cancelFlag;
      const onEvent = (): void => {};

      // The "user clicks Cancel mid-fetch" simulator. Called from inside the
      // target stage's mock: synchronously trips both cancel signals, then
      // throws so the rate-limiter queue releases. The pipeline's runStage
      // catches the rejection, sees isCancelled is true on the next retry
      // attempt, and bails out — same end state as a real mid-flight cancel.
      const fireCancel = async (): Promise<never> => {
        cancelFlag = true;
        triggerCancel();
        throw new Error('cancelled');
      };

      switch (cancelDuringStage) {
        case 1:
          m.theirstackJobsByAnySlugs.mockImplementationOnce(fireCancel);
          break;
        case 2:
          m.digitalNativeExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 3:
          m.numberOfUsersExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 4:
          m.observabilityToolExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 5:
          // Stage 5 calls theirstackJobsByTechnology twice (slack + msteams probes
          // per company). Override the FIRST call to fire cancel; the others won't
          // run because the runStage cancels the batch.
          m.theirstackJobsByTechnology.mockImplementationOnce(fireCancel);
          break;
        case 6:
          m.cloudToolExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 7:
          m.fundingGrowthExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 8:
          m.revenueGrowthExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 9:
          m.apolloMixedPeopleApiSearch.mockImplementationOnce(fireCancel);
          break;
        case 10:
          m.runHarvestLinkedInEmployees.mockImplementationOnce(fireCancel);
          break;
        case 11:
          m.runCareerSiteJobListings.mockImplementationOnce(fireCancel);
          break;
        case 13:
          m.fetchComplaintTweets.mockImplementationOnce(fireCancel);
          break;
        case 14:
          m.fetchRecentIncidents.mockImplementationOnce(fireCancel);
          break;
        case 15:
          m.aiAdoptionMindsetExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 16:
          m.aiSreMaturityExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 17:
          m.industryExaSearch.mockImplementationOnce(fireCancel);
          break;
        case 18:
        case 19:
        case 20:
        case 21: {
          // Score stages share judge. Override its implementation so the FIRST
          // call matching the target schema fires cancel; everything else
          // returns the default response so unrelated stage 18 → 21 plumbing
          // (which shouldn't run anyway after cancel) doesn't deadlock.
          const targetSchema =
            cancelDuringStage === 18 ? 'company_context_score'
            : cancelDuringStage === 19 ? 'tooling_match_score'
            : cancelDuringStage === 20 ? 'intent_signal_score'
            : 'final_score_reasoning';
          let fired = false;
          m.judge.mockImplementation(async (args: { schema?: { name?: string } }) => {
            if (!fired && args.schema?.name === targetSchema) {
              fired = true;
              return fireCancel();
            }
            return defaultJudgeResponse(args);
          });
          break;
        }
      }

      await enrichAll({
        csv: csvPath,
        skipConfirm: true,
        onEvent,
        isCancelled,
        cancelSignal,
      });

      // Cancel must have actually fired — guards against a silently broken
      // override that lets the run finish normally.
      expect(cancelFlag).toBe(true);

      // Every stage strictly after the cancel point must have made zero API
      // calls. Failure here = a missing bailIfCancelled or cancelSignal race.
      for (let later = cancelDuringStage + 1; later <= 21; later++) {
        // Same shared-call edge case as the between-stages block.
        if (cancelDuringStage === 11 && later === 12) continue;
        for (const { name, count } of stageApiCalls(later)) {
          expect(
            count,
            `stage ${later} API "${name}" was called ${count} time(s) after cancel triggered during stage ${cancelDuringStage}`
          ).toBe(0);
        }
      }
    },
    10_000
  );
});
