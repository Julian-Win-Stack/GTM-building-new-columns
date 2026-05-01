import './ResumeBanner.css';

export type ResumableInfo = {
  snapshotId: string;
  stagesCompleted: number;
  completedStageNames: string[];
  savedAt: number;
  writeToAttio: boolean;
};

type Props = {
  info: ResumableInfo;
  currentWriteToAttio: boolean;
  onResume: () => void;
  onStartFresh: () => void;
  busy: boolean;
};

const TOTAL_STAGES = 21;

export function ResumeBanner({ info, currentWriteToAttio, onResume, onStartFresh, busy }: Props) {
  const lastStage =
    info.completedStageNames.length > 0
      ? info.completedStageNames[info.completedStageNames.length - 1]
      : '—';
  return (
    <section className="resume-banner">
      <div className="resume-banner__head">
        <span className="resume-banner__pulse" />
        <span className="resume-banner__title">A saved draft from this set is on disk</span>
      </div>
      <div className="resume-banner__detail">
        Local snapshot: Stage {info.stagesCompleted} of {TOTAL_STAGES} · last finished: <span className="resume-banner__stage">{lastStage}</span>
        <span className="resume-banner__sep">·</span>
        saved {formatRelative(info.savedAt)} ago
      </div>
      <div className="resume-banner__actions">
        <button type="button" className="btn-ghost" onClick={onStartFresh} disabled={busy}>
          <span className="btn-ghost__dot" />
          <span>{currentWriteToAttio ? 'Use Attio as the source' : 'Start fresh'}</span>
        </button>
        <button type="button" className="btn-secondary" onClick={onResume} disabled={busy}>
          <span>Resume from snapshot (Stage {Math.min(info.stagesCompleted + 1, TOTAL_STAGES)})</span>
          <span className="btn-secondary__arrow">→</span>
        </button>
      </div>
    </section>
  );
}

function formatRelative(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
