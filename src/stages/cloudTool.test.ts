import { describe, it, expect } from 'vitest';
import {
  parseCloudToolResponse,
  cloudToolGate,
  formatCloudToolForAttio,
  cloudToolCacheGate,
  type CloudToolData,
} from './cloudTool.js';
import type { ExaSearchResponse } from '../apis/exa.js';
import type { StageCompany } from './types.js';

function buildResponse(content: unknown): ExaSearchResponse {
  return {
    results: [],
    searchTime: 0,
    output: { content: content as Record<string, unknown>, grounding: [] },
    costDollars: { total: 0 },
  };
}

describe('parseCloudToolResponse', () => {
  it('parses a well-formed structured response for a single company', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://example.com/aws', confidence: 'high' },
      ],
    });
    const companies: StageCompany[] = [{ companyName: 'Acme', domain: 'acme.com' }];
    const out = parseCloudToolResponse(raw, companies);
    expect(out).toHaveLength(1);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data).toEqual({ tool: 'AWS', evidence: 'https://example.com/aws', confidence: 'high' });
  });

  it('parses multiple companies in the structured response', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://a.com', confidence: 'high' },
        { domain: 'beta.io', tool: 'GCP', evidence: 'https://b.com', confidence: 'medium' },
      ],
    });
    const companies: StageCompany[] = [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ];
    const out = parseCloudToolResponse(raw, companies);
    expect(out[0]!.data?.tool).toBe('AWS');
    expect(out[1]!.data?.tool).toBe('GCP');
  });

  it('strips a leading www. from the domain when matching', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'www.acme.com', tool: 'GCP', evidence: 'https://x.com', confidence: 'high' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases the parsed domain when matching', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'ACME.COM', tool: 'AWS', evidence: 'https://x.com', confidence: 'low' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
  });

  it('lowercases confidence before validating (Exa may return "High")', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://x.com', confidence: 'High' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.confidence).toBe('high');
  });

  it('allows empty evidence when tool is "Not publicly confirmed"', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'Not publicly confirmed', evidence: '', confidence: 'low' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBeUndefined();
    expect(out[0]!.data?.tool).toBe('Not publicly confirmed');
  });

  it('returns "no output from Exa" when a company is not present in the response', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://x.com', confidence: 'high' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Missing', domain: 'missing.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips items with missing required fields', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://x.com' },
        { domain: 'beta.io', tool: 'GCP', evidence: 'https://y.com', confidence: 'medium' },
      ],
    });
    const out = parseCloudToolResponse(raw, [
      { companyName: 'Acme', domain: 'acme.com' },
      { companyName: 'Beta', domain: 'beta.io' },
    ]);
    expect(out[0]!.error).toBe('no output from Exa');
    expect(out[1]!.data?.tool).toBe('GCP');
  });

  it('skips items with an invalid confidence value', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: 'AWS', evidence: 'https://x.com', confidence: 'very-high' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips items with an empty tool string', () => {
    const raw = buildResponse({
      companies: [
        { domain: 'acme.com', tool: '', evidence: 'https://x.com', confidence: 'high' },
      ],
    });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('skips the company when Exa returns content as a JSON string instead of an object', () => {
    const raw = buildResponse(
      JSON.stringify({
        companies: [
          { domain: 'acme.com', tool: 'AWS', evidence: 'https://x.com', confidence: 'high' },
        ],
      })
    );
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });

  it('handles an empty companies array gracefully', () => {
    const raw = buildResponse({ companies: [] });
    const out = parseCloudToolResponse(raw, [{ companyName: 'Acme', domain: 'acme.com' }]);
    expect(out[0]!.error).toBe('no output from Exa');
  });
});

describe('cloudToolGate', () => {
  it('passes AWS', () => {
    expect(cloudToolGate({ tool: 'AWS', evidence: 'https://x.com', confidence: 'high' })).toBe(true);
  });

  it('passes GCP', () => {
    expect(cloudToolGate({ tool: 'GCP', evidence: 'https://x.com', confidence: 'high' })).toBe(true);
  });

  it('passes Both', () => {
    expect(cloudToolGate({ tool: 'Both', evidence: 'https://x.com', confidence: 'high' })).toBe(true);
  });

  it('passes No evidence found', () => {
    expect(cloudToolGate({ tool: 'No evidence found', evidence: '', confidence: 'low' })).toBe(true);
  });

  it('passes case-insensitively (lowercase aws)', () => {
    expect(cloudToolGate({ tool: 'aws', evidence: 'https://x.com', confidence: 'high' })).toBe(true);
  });

  it('passes with surrounding whitespace', () => {
    expect(cloudToolGate({ tool: ' Both ', evidence: 'https://x.com', confidence: 'high' })).toBe(true);
  });

  it('rejects Azure', () => {
    expect(cloudToolGate({ tool: 'Azure', evidence: 'https://x.com', confidence: 'high' })).toBe(false);
  });

  it('rejects IBM Cloud', () => {
    expect(cloudToolGate({ tool: 'IBM Cloud', evidence: 'https://x.com', confidence: 'medium' })).toBe(false);
  });

  it('rejects Alibaba Cloud', () => {
    expect(cloudToolGate({ tool: 'Alibaba Cloud', evidence: 'https://x.com', confidence: 'low' })).toBe(false);
  });
});

describe('formatCloudToolForAttio', () => {
  it('renders tool: evidence for a known cloud', () => {
    const data: CloudToolData = { tool: 'GCP', evidence: 'https://cloud.google.com/customers/acme', confidence: 'high' };
    expect(formatCloudToolForAttio(data)).toBe('GCP: https://cloud.google.com/customers/acme');
  });

  it('renders tool: evidence for AWS', () => {
    const data: CloudToolData = { tool: 'AWS', evidence: 'https://aws.amazon.com/solutions/razer', confidence: 'high' };
    expect(formatCloudToolForAttio(data)).toBe('AWS: https://aws.amazon.com/solutions/razer');
  });

  it('renders "No evidence found" when tool is No evidence found', () => {
    const data: CloudToolData = { tool: 'No evidence found', evidence: '', confidence: 'low' };
    expect(formatCloudToolForAttio(data)).toBe('No evidence found');
  });

  it('renders "No evidence found" case-insensitively', () => {
    const data: CloudToolData = { tool: 'NO EVIDENCE FOUND', evidence: '', confidence: 'low' };
    expect(formatCloudToolForAttio(data)).toBe('No evidence found');
  });
});

describe('cloudToolCacheGate', () => {
  it('passes AWS cached value', () => {
    expect(cloudToolCacheGate('AWS: https://x.com')).toBe(true);
  });

  it('passes GCP cached value', () => {
    expect(cloudToolCacheGate('GCP: https://x.com')).toBe(true);
  });

  it('passes Both cached value', () => {
    expect(cloudToolCacheGate('Both: https://x.com')).toBe(true);
  });

  it('passes No evidence found', () => {
    expect(cloudToolCacheGate('No evidence found')).toBe(true);
  });

  it('rejects Azure cached value', () => {
    expect(cloudToolCacheGate('Azure: https://x.com')).toBe(false);
  });

  it('rejects IBM Cloud cached value', () => {
    expect(cloudToolCacheGate('IBM Cloud: https://x.com')).toBe(false);
  });

  it('rejects empty cached value', () => {
    expect(cloudToolCacheGate('')).toBe(false);
  });
});
