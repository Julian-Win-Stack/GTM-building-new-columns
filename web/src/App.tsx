import { useEffect, useState } from 'react';
import { ControlDeck, type SubmitArgs } from './components/ControlDeck.js';
import { RunStatus } from './components/RunStatus.js';
import { SkippedPanel } from './components/SkippedPanel.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import { BaccaMark } from './components/BaccaMark.js';
import { useRunStream } from './lib/useRunStream.js';
import './App.css';

export function App() {
  const [runId, setRunId] = useState<string | null>(null);
  // Bumping this key force-remounts ControlDeck, which clears its internal file/account-purpose
  // state — the cleanest way to "reset the file input" without lifting all of its state up.
  const [controlDeckKey, setControlDeckKey] = useState(0);

  const { state, cancel } = useRunStream(runId);
  const isRunning =
    state.status === 'starting' || state.status === 'running' || state.status === 'cancelling';

  // When the run finishes cancelling, clear runId so the file input resets for the next upload.
  useEffect(() => {
    if (state.status === 'cancelled' && runId) {
      setRunId(null);
      setControlDeckKey((k) => k + 1);
    }
  }, [state.status, runId]);

  async function startRun(args: SubmitArgs) {
    setRunId(null);
    let res: Response;
    if (args.mode === 'csv') {
      const fd = new FormData();
      fd.append('csv', args.file);
      if (args.accountPurpose) fd.append('accountPurpose', args.accountPurpose);
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
        }),
      });
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? `Server returned ${res.status}`);
      return;
    }
    const body = (await res.json()) as { runId: string };
    setRunId(body.runId);
  }

  function downloadCsv() {
    if (!runId) return;
    window.location.href = `/api/runs/${runId}/csv`;
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
          disabled={isRunning}
          onSubmit={startRun}
        />
        <RunStatus state={state} runId={runId} onDownload={downloadCsv} onCancel={cancel} />
        <SkippedPanel skippedRows={state.skippedRows} />
        <ActivityFeed state={state} />
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
