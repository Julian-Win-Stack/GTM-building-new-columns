import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnricherFn, EnrichableColumn } from './types.js';

const { enrichersMock, columnListMock } = vi.hoisted(() => {
  const columns: EnrichableColumn[] = [
    'Digital Native',
    'Cloud Tool',
    'Observability Tool',
    'Communication Tool',
    'Number of Users',
    'Competitor Tooling',
    'Number of Engineers',
    'Number of SREs',
    'Engineer Hiring',
    'SRE Hiring',
    'Customer complains on X',
    'Recent incidents ( Official )',
    'Funding Growth',
    'Revenue Growth',
    'AI adoption mindset',
    'AI SRE maturity',
  ];
  const enrichers: Record<EnrichableColumn, ReturnType<typeof vi.fn>> = Object.fromEntries(
    columns.map((c) => [c, vi.fn()])
  ) as Record<EnrichableColumn, ReturnType<typeof vi.fn>>;
  return { enrichersMock: enrichers, columnListMock: columns };
});

vi.mock('./enrichers/index.js', () => ({
  ENRICHERS: enrichersMock,
  ENRICHABLE_COLUMN_LIST: columnListMock,
}));

const { runPipeline, runSingleEnricher } = await import('./pipeline.js');

beforeEach(() => {
  for (const col of columnListMock) {
    enrichersMock[col].mockReset();
    enrichersMock[col].mockResolvedValue(`v:${col}`);
  }
});

describe('runPipeline', () => {
  it('calls every enricher and writes each result into the matching column', async () => {
    const out = await runPipeline({
      'Company Name': 'Acme',
      Website: 'https://acme.com',
      'Company Linkedin Url': 'https://linkedin.com/company/acme',
    });
    for (const col of columnListMock) {
      expect(enrichersMock[col]).toHaveBeenCalledTimes(1);
      expect(out[col]).toBe(`v:${col}`);
    }
  });

  it('includes Company Name and derived Domain in the result', async () => {
    const out = await runPipeline({
      'Company Name': 'Acme',
      Website: 'https://WWW.acme.com/about',
      'Company Linkedin Url': '',
    });
    expect(out['Company Name']).toBe('Acme');
    expect(out.Domain).toBe('acme.com');
  });

  it('passes a fully-populated EnricherInput to each enricher', async () => {
    await runPipeline({
      'Company Name': 'Acme',
      Website: 'https://acme.com',
      'Company Linkedin Url': 'https://linkedin.com/company/acme',
    });
    const passed = enrichersMock['Digital Native'].mock.calls[0]![0];
    expect(passed).toEqual({
      companyName: 'Acme',
      domain: 'acme.com',
      website: 'https://acme.com',
      linkedinUrl: 'https://linkedin.com/company/acme',
    });
  });

  it('only runs the enrichers listed in onlyColumns', async () => {
    await runPipeline(
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': '',
      },
      ['Digital Native', 'Cloud Tool']
    );
    expect(enrichersMock['Digital Native']).toHaveBeenCalledTimes(1);
    expect(enrichersMock['Cloud Tool']).toHaveBeenCalledTimes(1);
    expect(enrichersMock['Observability Tool']).not.toHaveBeenCalled();
    expect(enrichersMock['Funding Growth']).not.toHaveBeenCalled();
  });

  it('fills unrun columns with empty strings when onlyColumns is used', async () => {
    const out = await runPipeline(
      {
        'Company Name': 'Acme',
        Website: 'acme.com',
        'Company Linkedin Url': '',
      },
      ['Digital Native']
    );
    expect(out['Digital Native']).toBe('v:Digital Native');
    expect(out['Cloud Tool']).toBe('');
    expect(out['Funding Growth']).toBe('');
  });
});

describe('runSingleEnricher', () => {
  it('invokes exactly the requested enricher and returns its value', async () => {
    enrichersMock['Cloud Tool'].mockResolvedValue('AWS');
    const out = await runSingleEnricher(
      { 'Company Name': 'Acme', Website: 'acme.com', 'Company Linkedin Url': '' },
      'Cloud Tool'
    );
    expect(out).toBe('AWS');
    expect(enrichersMock['Cloud Tool']).toHaveBeenCalledTimes(1);
    expect(enrichersMock['Digital Native']).not.toHaveBeenCalled();
  });

  it('passes derived input fields to the enricher', async () => {
    const spy: EnricherFn = vi.fn().mockResolvedValue('x') as unknown as EnricherFn;
    enrichersMock['Digital Native'].mockImplementation(spy);
    await runSingleEnricher(
      {
        'Company Name': 'Acme',
        Website: 'https://www.acme.com/',
        'Company Linkedin Url': 'li',
      },
      'Digital Native'
    );
    expect(spy).toHaveBeenCalledWith({
      companyName: 'Acme',
      domain: 'acme.com',
      website: 'https://www.acme.com/',
      linkedinUrl: 'li',
    });
  });
});
