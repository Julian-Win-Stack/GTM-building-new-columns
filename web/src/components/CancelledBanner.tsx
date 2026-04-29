import './CancelledBanner.css';

type Props = {
  stagesCompleted: number;
  onDownload: () => void;
  onDismiss: () => void;
};

const TOTAL_STAGES = 21;

export function CancelledBanner({ stagesCompleted, onDownload, onDismiss }: Props) {
  return (
    <section className="cancelled-banner">
      <div className="cancelled-banner__head">
        <span className="cancelled-banner__dot" />
        <span className="cancelled-banner__title">Run cancelled</span>
        <span className="cancelled-banner__sep">·</span>
        <span className="cancelled-banner__detail">
          {stagesCompleted} of {TOTAL_STAGES} stages completed · saved for 7 days — re-upload the same CSV to resume
        </span>
      </div>
      <div className="cancelled-banner__actions">
        <button type="button" className="btn-secondary" onClick={onDownload}>
          <span>Download partial CSV</span>
          <span className="btn-secondary__arrow">↓</span>
        </button>
        <button
          type="button"
          className="cancelled-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </section>
  );
}
