import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCsv, makeExaResponse, makeExaTextResponse } from './enrichAll.e2e.helpers.js';
import { computeInputHash } from '../stages/companyContextScore.js';

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
  process.env['AZURE_OPENAI_DEPLOYMENT'] = 'test-deployment';
  process.env['X_API_KEY'] = 'test-x';

  return {
    // Attio
    fetchAllRecords: vi.fn(),
    upsertByDomain: vi.fn(),
    upsertByLinkedIn: vi.fn(),
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
    upsertCompanyByLinkedInUrl: m.upsertByLinkedIn,
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
  m.upsertByLinkedIn.mockResolvedValue({ id: 'rec', values: {} });

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
  it('resolves LinkedIn-only CSV row domain via Attio cache and runs the pipeline', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Acme',
        Website: '',
        'Company Linkedin Url': 'https://linkedin.com/company/acme',
        'Short Description': '',
      },
    ]);
    // Attio already has a record for acme.com linked to this LinkedIn URL
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'acme.com',
          {
            linkedin_page: 'https://linkedin.com/company/acme',
            company_name: 'Acme',
            domain: 'acme.com',
          },
        ],
      ])
    );
    defaultExaMocks(['acme.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Domain resolved → Stage 2 (digitalNative) called for acme.com
    expect(m.digitalNativeExaSearch).toHaveBeenCalled();
    const [[domains]] = m.digitalNativeExaSearch.mock.calls as [[string[]]];
    expect(domains).toContain('acme.com');
  });

  it('calls upsertByLinkedInUrl for LinkedIn-only row that cannot be resolved', async () => {
    const csvPath = await makeCsv(tmpDir, [
      {
        'Company Name': 'Ghost Co',
        Website: '',
        'Company Linkedin Url': 'https://linkedin.com/company/ghost-co',
        'Short Description': 'Mystery company',
      },
    ]);
    // Attio cache has no matching record
    m.fetchAllRecords.mockResolvedValue(new Map());

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Identity write goes through upsertByLinkedIn
    expect(m.upsertByLinkedIn).toHaveBeenCalledWith(
      expect.objectContaining({ 'LinkedIn Page': 'https://linkedin.com/company/ghost-co' })
    );
    // No domain available → no stage API calls
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
            company_name: 'Acme Corp (existing)',
            domain: 'acme.com',
            linkedin_page: '',
            description: '',
            // Stage columns pre-populated so all stages are skipped
            competitor_tooling: 'Not using any competitor tools',
            digital_native: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            number_of_users: 'User count: 5M MAU\n\nUser count bucket: 100K+\n\nConfidence: medium',
            observability_tool: 'Datadog: https://example.com',
            communication_tool: 'Slack: https://example.com',
            cloud_tool: 'AWS: https://example.com',
            funding_growth: 'Growth: Series B',
            revenue_growth: 'Growth: ~$15M ARR\n\nConfidence: medium',
            number_of_engineers: '10',
            number_of_sres: '3\n\nhttps://linkedin.com/in/joe',
            engineer_hiring: '2\n\nSoftware Engineer: https://jobs.example.com/1',
            sre_hiring: '0',
            customer_complains_on_x: 'Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0',
            recent_incidents_official: 'No status page found',
            ai_adoption_mindset: 'Classification: Neutral\nConfidence: Low',
            ai_sre_maturity: 'Classification: ideating\nConfidence: Low\nSales signal: High potential',
            industry: 'industry: SaaS (B2B)\nreason: B2B software',
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
    expect(identityWriteArg['LinkedIn Page']).toBe('https://linkedin.com/company/acme');
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
            company_name: 'Acme Corp',
            domain: 'acme.com',
            linkedin_page: 'https://linkedin.com/company/acme',
            description: 'A SaaS company',
            website: 'acme.com',
            competitor_tooling: 'Not using any competitor tools',
            digital_native: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            number_of_users: 'User count: 5M MAU\n\nUser count bucket: 100K+\n\nConfidence: medium',
            observability_tool: 'Datadog: https://example.com',
            communication_tool: 'Slack: https://example.com',
            cloud_tool: 'AWS: https://example.com',
            funding_growth: 'Growth: Series B',
            revenue_growth: 'Growth: ~$15M ARR\n\nConfidence: medium',
            number_of_engineers: '10',
            number_of_sres: '3\n\nhttps://linkedin.com/in/joe',
            engineer_hiring: '2\n\nSoftware Engineer: https://jobs.example.com/1',
            sre_hiring: '0',
            customer_complains_on_x: 'Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0',
            recent_incidents_official: 'No status page found',
            ai_adoption_mindset: 'Classification: Neutral\nConfidence: Low',
            ai_sre_maturity: 'Classification: ideating\nConfidence: Low\nSales signal: High potential',
            industry: 'industry: SaaS (B2B)\nreason: B2B software',
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
        'Company Linkedin Url': '',
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

  it('does not write Account Purpose to Attio-only records even when --account-purpose is set', async () => {
    // No CSV rows — the only company in the pipeline is an Attio-only carry-over.
    const csvPath = await makeCsv(tmpDir, []);
    m.fetchAllRecords.mockResolvedValue(
      new Map([['attio-only.com', { company_name: 'Carry Co', domain: 'attio-only.com' }]])
    );
    defaultExaMocks(['attio-only.com']);

    await enrichAll({ csv: csvPath, accountPurpose: 'Q1 ABM', skipConfirm: true });

    // No identity write fires for Attio-only records; Account Purpose must not appear.
    for (const [callArg] of m.upsertByDomain.mock.calls as [Record<string, unknown>][]) {
      expect(callArg['Account Purpose']).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3 — CSV ∪ Attio merge
// ---------------------------------------------------------------------------
describe('csv-attio merge', () => {
  it('includes Attio-only record (no Reason for Rejection) in the pipeline', async () => {
    // CSV has no rows — pipeline set comes entirely from Attio
    const csvPath = await makeCsv(tmpDir, []);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'attio-only.com',
          { company_name: 'Attio Only Co', domain: 'attio-only.com' },
        ],
      ])
    );
    defaultExaMocks(['attio-only.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    expect(m.digitalNativeExaSearch).toHaveBeenCalled();
    const [[domains]] = m.digitalNativeExaSearch.mock.calls as [[string[]]];
    expect(domains).toContain('attio-only.com');
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
      'Change Detection Column for Developer',
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
            company_name: 'Acme',
            domain: 'acme.com',
            linkedin_page: 'https://linkedin.com/company/acme',
            description: 'SaaS platform',
            competitor_tooling: 'Rootly\n\nEvidence: (Rootly\'s customer page)',
            digital_native: 'Digital-native B2B\n\nConfidence: High\n\nReasoning: test',
            number_of_users: 'User count: 5M MAU\n\nUser count bucket: 100K+\n\nConfidence: medium',
            observability_tool: 'Datadog: https://example.com',
            communication_tool: 'Slack: https://example.com',
            cloud_tool: 'AWS: https://example.com',
            funding_growth: 'Growth: Series B',
            revenue_growth: 'Growth: ~$15M ARR\n\nConfidence: medium',
            number_of_engineers: '10',
            number_of_sres: '3\n\nhttps://linkedin.com/in/joe',
            engineer_hiring: '2\n\nSoftware Engineer: https://jobs.example.com/1',
            sre_hiring: '0',
            customer_complains_on_x: 'Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0',
            recent_incidents_official: 'No status page found',
            ai_adoption_mindset: 'Classification: Neutral\nConfidence: Low',
            ai_sre_maturity: '',
            industry: 'industry: SaaS (B2B)\nreason: B2B software',
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
      { 'Company Name': 'Reject Co', Website: 'reject.com', 'Company Linkedin Url': '', 'Short Description': '' },
    ]);

    // Stage 2 returns NOT Digital-native → should be rejected
    m.digitalNativeExaSearch.mockResolvedValue(
      makeExaResponse([
        {
          domain: 'reject.com',
          category: 'NOT Digital-native',
          confidence: 'high',
          reason: 'traditional retail chain',
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
      { 'Company Name': 'Stale Co', Website: 'stale.com', 'Company Linkedin Url': '', 'Short Description': '' },
    ]);

    // Attio already has Digital Native = "NOT Digital-native …"
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'stale.com',
          {
            digital_native:
              'NOT Digital-native\n\nConfidence: High\n\nReasoning: traditional firm\n\nSources:\nhttps://example.com',
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
  ];

  for (const tc of cases) {
    it(tc.label, async () => {
      const csvPath = await makeCsv(tmpDir, [
        { 'Company Name': 'Test Co', Website: tc.domain, 'Company Linkedin Url': '', 'Short Description': '' },
      ]);

      m.digitalNativeExaSearch.mockResolvedValue(
        makeExaResponse([
          {
            domain: tc.domain,
            category: tc.dnCategory,
            confidence: 'high',
            reason: 'test',
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
// Group 8a — Stage 10 N/A branch
// ---------------------------------------------------------------------------
describe('Stage 10 N/A branch', () => {
  it('writes N/A and skips Apify when company has no LinkedIn URL', async () => {
    const csvPath = await makeCsv(tmpDir, [
      // No LinkedIn URL in CSV
      { 'Company Name': 'No-LI Co', Website: 'no-li.com', 'Company Linkedin Url': '', 'Short Description': '' },
    ]);
    defaultExaMocks(['no-li.com']);

    await enrichAll({ csv: csvPath, skipConfirm: true });

    // Apify harvest should NOT be called
    expect(m.runHarvestLinkedInEmployees).not.toHaveBeenCalled();

    // 'Number of SREs' column must be written as 'N/A'
    const sreCall = m.upsertByDomain.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.['Number of SREs'] !== undefined
    );
    expect(sreCall).toBeDefined();
    expect((sreCall![0] as Record<string, unknown>)['Number of SREs']).toBe('N/A');
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
        'Company Linkedin Url': '',
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
  'digital_native', 'cloud_tool', 'observability_tool', 'communication_tool',
  'number_of_users', 'competitor_tooling', 'number_of_engineers', 'number_of_sres',
  'engineer_hiring', 'sre_hiring', 'customer_complains_on_x', 'recent_incidents_official',
  'funding_growth', 'revenue_growth', 'ai_adoption_mindset', 'ai_sre_maturity', 'industry',
];

const ALL_17_COLS: Record<string, string> = {
  digital_native: 'Digital-native B2C\n\nConfidence: High\n\nReasoning: test',
  cloud_tool: 'AWS: https://example.com',
  observability_tool: 'Datadog: https://example.com',
  communication_tool: 'Slack: https://example.com',
  number_of_users: 'User count: 5M MAU\n\nUser count bucket: 100K+\n\nConfidence: medium',
  competitor_tooling: 'Not using any competitor tools',
  number_of_engineers: '10',
  number_of_sres: '3\n\nhttps://linkedin.com/in/joe',
  engineer_hiring: '2\n\nSoftware Engineer: https://jobs.example.com/1',
  sre_hiring: '0',
  customer_complains_on_x: 'Full outage: 0\nPartial outage: 0\nPerformance degradation: 0\nUnclear: 0',
  recent_incidents_official: 'No status page found',
  funding_growth: 'Growth: Series B\n\nTimeframe: 2024',
  revenue_growth: 'Growth: ~$15M ARR\n\nConfidence: medium',
  ai_adoption_mindset: 'Classification: Neutral\nConfidence: Low',
  ai_sre_maturity: 'Classification: ideating\nConfidence: Low\nSales signal: High potential',
  industry: 'industry: SaaS (B2B)\nreason: B2B software',
};

describe('Stage 18 hash-gate', () => {
  it('re-scores when stored hash is stale', async () => {
    const csvPath = await makeCsv(tmpDir, [
      { 'Company Name': 'Hash Co', Website: 'hash.com', 'Company Linkedin Url': '', 'Short Description': '' },
    ]);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'hash.com',
          {
            ...ALL_17_COLS,
            company_context_score: '3\n\nReasoning: old.',
            change_detection_column_for_developer: 'stale-hash',
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
      { 'Company Name': 'Hash Co', Website: 'hash.com', 'Company Linkedin Url': '', 'Short Description': '' },
    ]);
    const correctHash = computeInputHash(ALL_17_COLS, ENRICHABLE_SLUGS_FOR_HASH);
    m.fetchAllRecords.mockResolvedValue(
      new Map([
        [
          'hash.com',
          {
            ...ALL_17_COLS,
            company_context_score: '4.5\n\nReasoning: existing.',
            change_detection_column_for_developer: correctHash,
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
