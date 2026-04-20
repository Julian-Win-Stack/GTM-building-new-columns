import { describe, it, expect } from 'vitest';
import { slugCandidates } from './statuspage.js';

describe('slugCandidates', () => {
  it('single word — compact only (dedup)', () => {
    expect(slugCandidates('Datadog')).toEqual(['datadog']);
  });

  it('multi word — compact + dashed', () => {
    expect(slugCandidates('New Relic')).toEqual(['newrelic', 'new-relic']);
  });

  it('strips trailing ", Inc."', () => {
    expect(slugCandidates('Acme, Inc.')).toEqual(['acme']);
  });

  it('strips trailing " LLC"', () => {
    expect(slugCandidates('Acme LLC')).toEqual(['acme']);
  });

  it('strips multi-word + suffix', () => {
    expect(slugCandidates('Data Dog Inc.')).toEqual(['datadog', 'data-dog']);
  });

  it('strips "Corporation"', () => {
    expect(slugCandidates('Foo Bar Corporation')).toEqual(['foobar', 'foo-bar']);
  });

  it('strips "Ltd."', () => {
    expect(slugCandidates('Widgets Ltd.')).toEqual(['widgets']);
  });

  it('handles double suffix ", LLC."', () => {
    expect(slugCandidates('Acme, LLC.')).toEqual(['acme']);
  });

  it('empty returns empty', () => {
    expect(slugCandidates('')).toEqual([]);
    expect(slugCandidates('   ')).toEqual([]);
  });

  it('collapses punctuation in dashed form', () => {
    expect(slugCandidates('A&B Systems')).toEqual(['absystems', 'a-b-systems']);
  });
});
