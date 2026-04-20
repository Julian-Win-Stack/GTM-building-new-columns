import type { StageCompany, StageResult } from './types.js';
import type { FetchOutcome, StatuspageIncident } from '../apis/statuspage.js';

export type IncidentRow = {
  impact: 'critical' | 'major' | 'minor' | 'none';
  name: string;
  components: string[];
};

export type RecentIncidentsData =
  | { kind: 'incidents'; rows: IncidentRow[] }
  | { kind: 'private' }
  | { kind: 'notFound' };

function toRow(inc: StatuspageIncident): IncidentRow {
  return {
    impact: inc.impact,
    name: inc.name,
    components: (inc.components ?? []).map((c) => c.name).filter((n) => !!n),
  };
}

export function parseRecentIncidentsResponse(
  raw: FetchOutcome,
  batch: StageCompany[]
): StageResult<RecentIncidentsData>[] {
  const company = batch[0];
  if (!company) return [];
  if (raw.kind === 'private') return [{ company, data: { kind: 'private' } }];
  if (raw.kind === 'notFound') return [{ company, data: { kind: 'notFound' } }];
  const rows = raw.incidents.map(toRow);
  return [{ company, data: { kind: 'incidents', rows } }];
}

export function formatRecentIncidentsForAttio(d: RecentIncidentsData): string {
  if (d.kind === 'private') return 'Private status page';
  if (d.kind === 'notFound') return 'No status page found';
  if (d.rows.length === 0) return '0 incidents (last 90 days)';

  const counts = { critical: 0, major: 0, minor: 0, none: 0 };
  for (const r of d.rows) counts[r.impact]++;
  const countsLine = `Critical: ${counts.critical}  |  Major: ${counts.major}  |  Minor: ${counts.minor}  |  None: ${counts.none}`;

  const componentCounts = new Map<string, number>();
  for (const r of d.rows) {
    for (const name of r.components) {
      componentCounts.set(name, (componentCounts.get(name) ?? 0) + 1);
    }
  }
  const sortedComponents = [...componentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const componentsLine =
    sortedComponents.length === 0
      ? 'Top affected components: (none reported)'
      : `Top affected components: ${sortedComponents.map(([n, c]) => `${n} (${c})`).join(', ')}`;

  const listHeader = 'Incidents (last 90 days):';
  const listLines = d.rows.map((r) => {
    const base = `- [${r.impact}] ${r.name}`;
    return r.components.length > 0 ? `${base} — ${r.components.join(', ')}` : base;
  });

  return [countsLine, '', componentsLine, '', listHeader, ...listLines].join('\n');
}
