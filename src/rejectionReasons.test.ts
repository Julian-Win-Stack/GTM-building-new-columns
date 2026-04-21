import { describe, it, expect } from 'vitest';
import {
  competitorToolRejectionReason,
  competitorToolCacheRejectionReason,
  digitalNativeRejectionReason,
  digitalNativeCacheRejectionReason,
  numberOfUsersRejectionReason,
  observabilityToolRejectionReason,
  observabilityToolCacheRejectionReason,
  communicationToolRejectionReason,
  communicationToolCacheRejectionReason,
  cloudToolRejectionReason,
  cloudToolCacheRejectionReason,
} from './rejectionReasons.js';

describe('competitorToolRejectionReason', () => {
  it('single tool', () => {
    expect(competitorToolRejectionReason({ matchedTools: ['Rootly'] })).toBe('Competitor Tooling: using Rootly');
  });

  it('multiple tools', () => {
    expect(competitorToolRejectionReason({ matchedTools: ['Rootly', 'BigPanda'] })).toBe('Competitor Tooling: using Rootly, BigPanda');
  });
});

describe('competitorToolCacheRejectionReason', () => {
  it('uses the cached string directly as tool names', () => {
    expect(competitorToolCacheRejectionReason('Rootly')).toBe('Competitor Tooling: using Rootly');
  });

  it('handles multiple tools in cache', () => {
    expect(competitorToolCacheRejectionReason('Rootly, BigPanda')).toBe('Competitor Tooling: using Rootly, BigPanda');
  });

  it('trims whitespace', () => {
    expect(competitorToolCacheRejectionReason('  PagerDuty  ')).toBe('Competitor Tooling: using PagerDuty');
  });
});

describe('digitalNativeRejectionReason', () => {
  it('returns the static reason regardless of data', () => {
    const result = digitalNativeRejectionReason({ category: 'NOT Digital-native', confidence: 'high', reason: 'no API' });
    expect(result).toBe('Digital Native: not a digital-native company');
  });
});

describe('digitalNativeCacheRejectionReason', () => {
  it('returns the static reason regardless of cached string', () => {
    expect(digitalNativeCacheRejectionReason('NOT Digital-native\n\nConfidence: high\n\nReasoning: ...')).toBe('Digital Native: not a digital-native company');
    expect(digitalNativeCacheRejectionReason('')).toBe('Digital Native: not a digital-native company');
  });
});

describe('numberOfUsersRejectionReason', () => {
  it('includes the bucket in the message', () => {
    expect(numberOfUsersRejectionReason('10K–100K')).toBe('Number of Users: B2B company in "10K–100K" bucket (requires 100K+)');
  });

  it('works for small buckets', () => {
    expect(numberOfUsersRejectionReason('1K–10K')).toBe('Number of Users: B2B company in "1K–10K" bucket (requires 100K+)');
  });
});

describe('observabilityToolRejectionReason', () => {
  it('single non-allowlisted tool', () => {
    expect(observabilityToolRejectionReason({ tools: [{ name: 'Dynatrace', sourceUrl: 'https://x.com' }] }))
      .toBe('Observability Tool: uses Dynatrace (not Datadog/Grafana/Prometheus)');
  });

  it('multiple non-allowlisted tools', () => {
    expect(observabilityToolRejectionReason({
      tools: [
        { name: 'Dynatrace', sourceUrl: 'https://x.com' },
        { name: 'New Relic', sourceUrl: 'https://y.com' },
      ],
    })).toBe('Observability Tool: uses Dynatrace, New Relic (not Datadog/Grafana/Prometheus)');
  });
});

describe('observabilityToolCacheRejectionReason', () => {
  it('parses tool names from cached lines', () => {
    expect(observabilityToolCacheRejectionReason('Dynatrace: https://x.com'))
      .toBe('Observability Tool: uses Dynatrace (not Datadog/Grafana/Prometheus)');
  });

  it('handles multiple cached tool lines', () => {
    expect(observabilityToolCacheRejectionReason('Dynatrace: https://x.com\nNew Relic: https://y.com'))
      .toBe('Observability Tool: uses Dynatrace, New Relic (not Datadog/Grafana/Prometheus)');
  });

  it('falls back to "unknown tools" for empty cached string', () => {
    expect(observabilityToolCacheRejectionReason('')).toBe('Observability Tool: uses unknown tools (not Datadog/Grafana/Prometheus)');
  });
});

describe('communicationToolRejectionReason', () => {
  it('returns the static reason', () => {
    expect(communicationToolRejectionReason({ tool: 'Microsoft Teams', sourceUrl: 'https://x.com' }))
      .toBe('Communication Tool: uses Microsoft Teams');
  });
});

describe('communicationToolCacheRejectionReason', () => {
  it('returns the static reason regardless of cached string', () => {
    expect(communicationToolCacheRejectionReason('Microsoft Teams: https://x.com'))
      .toBe('Communication Tool: uses Microsoft Teams');
  });
});

describe('cloudToolRejectionReason', () => {
  it('includes the rejected cloud name', () => {
    expect(cloudToolRejectionReason({ tool: 'Azure', evidence: 'https://x.com', confidence: 'high' }))
      .toBe('Cloud Tool: uses Azure (not AWS/GCP)');
  });
});

describe('cloudToolCacheRejectionReason', () => {
  it('parses the cloud name from the cached line', () => {
    expect(cloudToolCacheRejectionReason('Azure: https://x.com')).toBe('Cloud Tool: uses Azure (not AWS/GCP)');
  });

  it('falls back to "unknown cloud" for empty cached string', () => {
    expect(cloudToolCacheRejectionReason('')).toBe('Cloud Tool: uses unknown cloud (not AWS/GCP)');
  });
});
