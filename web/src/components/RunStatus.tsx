import './RunStatus.css';
import type { RunStreamState } from '../lib/useRunStream.js';

const TOTAL_STAGES = 21;

type Props = {
  state: RunStreamState;
  runId: string | null;
  onDownload: () => void;
  onCancel: () => void;
};

export function RunStatus({ state, runId, onDownload, onCancel }: Props) {
  const { status, currentStage, stagesCompleted, totalCompanies, surviving, rejected } = state;
  if (status === 'idle') return null;

  const stageNumber = currentStage?.stageNumber ?? 0;
  const stageName = currentStage?.stageName ?? '—';
  const progressPct = Math.round((stagesCompleted / TOTAL_STAGES) * 100);

  const headline =
    status === 'running'
      ? `Stage ${stageNumber} of ${TOTAL_STAGES} · ${stageName}`
      : status === 'cancelling'
        ? 'Cancelling — letting in-flight calls finish…'
        : status === 'cancelled'
          ? 'Run cancelled — partial results ready'
          : status === 'completed'
            ? 'Run complete'
            : status === 'failed'
              ? 'Run failed'
              : 'Initializing run…';

  const isLive = status === 'running' || status === 'cancelling';
  const isFinished = status === 'completed' || status === 'cancelled';
  const canDownload = isFinished;

  return (
    <section className={`runstatus runstatus--${status}`}>
      <div className="runstatus__row">
        <div className="runstatus__headline">
          <span className={`runstatus__pulse runstatus__pulse--${status}`} />
          <span className="runstatus__title">{headline}</span>
        </div>
        <div className="runstatus__stats">
          {isLive && totalCompanies > 0 && (
            <>
              <Stat label="Companies" value={totalCompanies} />
              <Stat label="Stages done" value={`${stagesCompleted}/${TOTAL_STAGES}`} />
            </>
          )}
          {status === 'completed' && (
            <>
              <Stat label="Surviving" value={surviving ?? 0} accent="accent" />
              <Stat label="Rejected" value={rejected ?? 0} accent="muted" />
            </>
          )}
          {status === 'cancelled' && (
            <Stat
              label="Stages done"
              value={`${stagesCompleted}/${TOTAL_STAGES}`}
              accent="muted"
            />
          )}
        </div>
      </div>

      <div className="runstatus__progress">
        <div
          className={`runstatus__bar runstatus__bar--${status}`}
          style={{ width: `${isLive ? Math.max(progressPct, 4) : 100}%` }}
        />
      </div>

      {isLive && (
        <p className="runstatus__safety">
          Auto-saving every second · safe to close the tab and come back · drafts kept 7 days
        </p>
      )}

      {state.error && <div className="runstatus__error">{state.error}</div>}

      {(isLive || isFinished) && runId && (
        <div className="runstatus__actions">
          {isLive && (
            <button
              type="button"
              className="btn-ghost"
              onClick={onCancel}
              disabled={status === 'cancelling'}
              title={
                status === 'cancelling'
                  ? 'Cancellation in progress — waiting for in-flight calls to finish.'
                  : 'Stop the run after the current API calls finish. Partial results stay downloadable.'
              }
            >
              <span className="btn-ghost__dot" />
              <span>{status === 'cancelling' ? 'Cancelling…' : 'Cancel run'}</span>
            </button>
          )}
          <button className="btn-secondary" onClick={onDownload} disabled={!canDownload}>
            <span>Download CSV</span>
            <span className="btn-secondary__arrow">↓</span>
          </button>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: 'accent' | 'muted' }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value num ${accent ? `stat__value--${accent}` : ''}`}>{value}</span>
    </div>
  );
}
