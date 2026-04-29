import { useEffect, useState } from 'react';
import './ActivityFeed.css';
import type { RunStreamState } from '../lib/useRunStream.js';

type Props = {
  state: RunStreamState;
};

export function ActivityFeed({ state }: Props) {
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second so the "X seconds ago" labels stay current without depending on
  // event arrival.
  useEffect(() => {
    if (state.status !== 'running' && state.status !== 'cancelling') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  if (state.status === 'idle') return null;

  const isLive = state.status === 'running' || state.status === 'cancelling';
  const idleSecs = state.lastEventAt ? Math.max(0, Math.floor((now - state.lastEventAt) / 1000)) : null;
  const idleSeverity = !isLive
    ? 'finished'
    : idleSecs == null
      ? 'unknown'
      : idleSecs > 90
        ? 'stuck'
        : idleSecs > 30
          ? 'slow'
          : 'fresh';

  const heartbeatLabel =
    state.status === 'completed'
      ? 'Run complete'
      : state.status === 'cancelled'
        ? 'Run cancelled'
        : state.status === 'failed'
          ? 'Run failed'
          : idleSecs == null
            ? 'Waiting for first result…'
            : `Last update ${formatRelative(idleSecs)} ago`;

  return (
    <section className={`activity activity--${idleSeverity}`}>
      <div className="activity__head">
        <span className={`activity__pulse activity__pulse--${idleSeverity}`} />
        <span className="activity__label">{heartbeatLabel}</span>
        <span className="activity__sep">·</span>
        <span className="activity__caption">
          {isLive ? 'live feed of cells being filled' : 'recent activity'}
        </span>
      </div>

      <ol className="activity__list" aria-live="polite">
        {state.recentActivity.length === 0 && isLive && (
          <li className="activity__empty">Waiting on the first result from the API…</li>
        )}
        {state.recentActivity.length === 0 && !isLive && (
          <li className="activity__empty">No activity yet.</li>
        )}
        {state.recentActivity.map((entry) => (
          <li
            key={`${entry.ts}-${entry.domain}-${entry.column}`}
            className={`activity__row activity__row--${entry.kind}`}
          >
            <span className="activity__when">{formatRelative(Math.max(0, Math.floor((now - entry.ts) / 1000)))}</span>
            <span className="activity__company">{entry.companyName || entry.domain}</span>
            <span className="activity__col">{entry.column}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatRelative(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hours}h ${remMins}m` : `${hours}h`;
}
