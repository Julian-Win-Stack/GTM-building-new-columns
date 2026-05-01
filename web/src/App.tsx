import { useEffect, useState } from 'react';
import { ControlDeck, type SubmitArgs } from './components/ControlDeck.js';
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
  // Set when a run is started with writeToAttio=false: on successful completion the CSV is the
  // only output, so we trigger the download automatically. Cleared after firing (or on cancel).
  const [shouldAutoDownload, setShouldAutoDownload] = useState(false);
  // Lifted out of ControlDeck so the toggle stays interactive while the resume banner is up:
  // the user can switch between CSV-only and Attio modes before picking Resume / Start fresh.
  const [writeToAttio, setWriteToAttio] = useState(false);

  const { state, cancel } = useRunStream(runId);
  const isRunning =
    state.status === 'starting' || state.status === 'running' || state.status === 'cancelling';
  // While the resume banner would otherwise block the form, flipping Attio ON dismisses
  // the banner and unlocks the form: Attio prefetch handles resume natively, so the user
  // just clicks Start enrichment again to fire a fresh Attio-mode run.
  const blockControlDeck = isRunning || (pending !== null && !writeToAttio);

  // When the run finishes cancelling, snapshot the relevant info, then clear runId so
  // RunStatus + ActivityFeed unmount and the file input resets for the next upload.
  useEffect(() => {
    if (state.status === 'cancelled' && runId) {
      setCancelledSnapshot({ runId, stagesCompleted: state.stagesCompleted });
      setRunId(null);
      setControlDeckKey((k) => k + 1);
      setShouldAutoDownload(false);
      setWriteToAttio(false);
    }
  }, [state.status, state.stagesCompleted, runId]);

  // Auto-download the CSV when a run completes successfully and the user opted out of Attio
  // writes — the CSV is the only artifact in that case, so saving them a click.
  useEffect(() => {
    if (state.status === 'completed' && shouldAutoDownload && runId) {
      window.location.href = `/api/runs/${runId}/csv`;
      setShouldAutoDownload(false);
    }
  }, [state.status, shouldAutoDownload, runId]);

  async function startRun(args: SubmitArgs) {
    // Starting a new run dismisses any leftover cancelled banner.
    setCancelledSnapshot(null);
    setShouldAutoDownload(!writeToAttio);
    let res: Response;
    if (args.mode === 'csv') {
      const fd = new FormData();
      fd.append('csv', args.file);
      if (args.accountPurpose) fd.append('accountPurpose', args.accountPurpose);
      fd.append('writeToAttio', String(writeToAttio));
      res = await fetch('/api/runs', { method: 'POST', body: fd });
    } else {
      res = await fetch('/api/runs/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: args.manual.companyName,
          website: args.manual.website,
          linkedinUrl: args.manual.linkedinUrl,
          description: args.manual.description,
          accountPurpose: args.accountPurpose,
          writeToAttio,
        }),
      });
    }
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
    setPending(null);
    setRunId(body.runId);
  }

  async function chooseResume() {
    if (!pending) return;
    setResumeBusy(true);
    setShouldAutoDownload(!writeToAttio);
    try {
      const res = await fetch(`/api/runs/${pending.runId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: pending.resumable.snapshotId,
          writeToAttio,
        }),
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
    setShouldAutoDownload(!writeToAttio);
    try {
      const res = await fetch(`/api/runs/${pending.runId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writeToAttio }),
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
        <ControlDeck
          key={controlDeckKey}
          disabled={blockControlDeck}
          toggleLocked={isRunning}
          writeToAttio={writeToAttio}
          onWriteToAttioChange={setWriteToAttio}
          onSubmit={startRun}
        />
        {pending && !writeToAttio && (
          <ResumeBanner
            info={pending.resumable}
            currentWriteToAttio={writeToAttio}
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
