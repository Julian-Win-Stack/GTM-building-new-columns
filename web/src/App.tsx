import { useEffect, useState } from 'react';
import { ControlDeck } from './components/ControlDeck.js';
import { RunStatus } from './components/RunStatus.js';
import { SkippedPanel } from './components/SkippedPanel.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { BaccaMark } from './components/BaccaMark.js';
import { ResumeBanner, type ResumableInfo } from './components/ResumeBanner.js';
import { CancelledBanner } from './components/CancelledBanner.js';
import { useRunStream } from './lib/useRunStream.js';
import './App.css';

type Pending = { runId: string; resumable: ResumableInfo };
type CancelledSnapshot = { runId: string; stagesCompleted: number };

export function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  // After a run is cancelled we hide RunStatus / ActivityFeed and surface a slim banner with
  // download access. The banner stays until the user dismisses it or starts a new run.
  const [cancelledSnapshot, setCancelledSnapshot] = useState<CancelledSnapshot | null>(null);
  // Bumping this key force-remounts ControlDeck, which clears its internal file/account-purpose
  // state — the cleanest way to "reset the file input" without lifting all of its state up.
  const [controlDeckKey, setControlDeckKey] = useState(0);

  const { state, cancel } = useRunStream(runId);
  const isRunning =
    state.status === 'starting' || state.status === 'running' || state.status === 'cancelling';
  const blockControlDeck = isRunning || pending !== null;

  // When the run finishes cancelling, snapshot the relevant info, then clear runId so
  // RunStatus + ActivityFeed unmount and the file input resets for the next upload.
  useEffect(() => {
    if (state.status === 'cancelled' && runId) {
      setCancelledSnapshot({ runId, stagesCompleted: state.stagesCompleted });
      setRunId(null);
      setControlDeckKey((k) => k + 1);
    }
  }, [state.status, state.stagesCompleted, runId]);

  async function startRun(args: { file: File; accountPurpose: string; writeToAttio: boolean }) {
    // Starting a new run dismisses any leftover cancelled banner.
    setCancelledSnapshot(null);
    const fd = new FormData();
    fd.append('csv', args.file);
    if (args.accountPurpose) fd.append('accountPurpose', args.accountPurpose);
    fd.append('writeToAttio', String(args.writeToAttio));
    const res = await fetch('/api/runs', { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? `Server returned ${res.status}`);
      return;
    }
    const body = (await res.json()) as { runId: string; resumable?: ResumableInfo };
    if (body.resumable) {
      setPending({ runId: body.runId, resumable: body.resumable });
      return;
    }
    setRunId(body.runId);
  }

  async function chooseResume() {
    if (!pending) return;
    setResumeBusy(true);
    try {
      const res = await fetch(`/api/runs/${pending.runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: pending.resumable.snapshotId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `Server returned ${res.status}`);
        setResumeBusy(false);
        return;
      }
      const id = pending.runId;
      setPending(null);
      setRunId(id);
    } finally {
      setResumeBusy(false);
    }
  }

  async function chooseStartFresh() {
    if (!pending) return;
    setResumeBusy(true);
    try {
      const res = await fetch(`/api/runs/${pending.runId}/start`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? `Server returned ${res.status}`);
        setResumeBusy(false);
        return;
      }
      const id = pending.runId;
      setPending(null);
      setRunId(id);
    } finally {
      setResumeBusy(false);
    }
  }

  function downloadCsv() {
    if (!runId) return;
    window.location.href = `/api/runs/${runId}/csv`;
  }

  function downloadCancelledCsv() {
    if (!cancelledSnapshot) return;
    window.location.href = `/api/runs/${cancelledSnapshot.runId}/csv`;
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <BaccaMark size={24} className="app__mark" />
          <span className="app__name">Bacca</span>
          <span className="app__divider">·</span>
          <span className="app__product">Account Enrichment</span>
        </div>
        <div className="app__status">
          <span className={`app__indicator app__indicator--${state.status}`} />
          <span className="app__status-label">{statusLabel(state.status)}</span>
        </div>
      </header>

      <main className="app__main">
        <ControlDeck key={controlDeckKey} disabled={blockControlDeck} onSubmit={startRun} />
        {pending && (
          <ResumeBanner
            info={pending.resumable}
            onResume={chooseResume}
            onStartFresh={chooseStartFresh}
            busy={resumeBusy}
          />
        )}
        {cancelledSnapshot && (
          <CancelledBanner
            stagesCompleted={cancelledSnapshot.stagesCompleted}
            onDownload={downloadCancelledCsv}
            onDismiss={() => setCancelledSnapshot(null)}
          />
        )}
        {state.status !== 'cancelled' && (
          <>
            <RunStatus state={state} runId={runId} onDownload={downloadCsv} onCancel={cancel} />
            <SkippedPanel skippedRows={state.skippedRows} />
            <ActivityFeed state={state} />
          </>
        )}
      </main>

      <footer className="app__footer">
        <span>Internal · GTM tooling</span>
      </footer>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'starting':
      return 'Initializing…';
    case 'running':
      return 'Enriching';
    case 'cancelling':
      return 'Cancelling…';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Run complete';
    case 'failed':
      return 'Run failed';
    default:
      return '';
  }
}
