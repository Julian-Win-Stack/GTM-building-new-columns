import express, { type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stringify as csvStringify } from 'csv-stringify/sync';
import { enrichAll } from '../src/commands/enrichAll.js';
import { readInputCsv } from '../src/csv.js';
import { deriveDomain } from '../src/util.js';
import {
  appendEvent,
  attachLiveCache,
  clearDirty,
  completeRun,
  createRun,
  deleteOldRuns,
  failRun,
  getRun,
  isRunCancelled,
  listDirtyRunningRuns,
  requestCancel,
  serializeRun,
} from './runRegistry.js';
import {
  deleteSnapshot,
  findResumableSnapshot,
  getSnapshotDir,
  loadSnapshot,
  sweepOldSnapshots,
  writeSnapshot,
} from './snapshotStore.js';
import { renderCsv } from './csvOutput.js';
import { CSV_COLUMNS, IDENTITY_COLUMNS, STAGE_COLUMNS, DEVELOPER_COLUMNS } from './columns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const PROJECT_ROOT = path.resolve(__dirname, '..');
// Uploaded CSVs go to UPLOAD_DIR (persistent volume on Railway, tmp/uploads locally) so a
// redeploy mid-run doesn't lose the source CSV. Default keeps backwards compat with tmp/.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(PROJECT_ROOT, 'tmp', 'uploads');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

console.log(`[server] upload dir: ${UPLOAD_DIR}`);
console.log(`[server] snapshot dir: ${getSnapshotDir()}`);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/columns', (_req: Request, res: Response) => {
  res.json({
    csvColumns: CSV_COLUMNS,
    identityColumns: IDENTITY_COLUMNS,
    stageColumns: STAGE_COLUMNS,
    developerColumns: DEVELOPER_COLUMNS,
  });
});

// Where the actual run kickoff happens — shared by /start (fresh) and /resume (with snapshot).
function startRunAsync(opts: {
  runId: string;
  csvPath: string;
  accountPurpose?: string;
  writeToAttio: boolean;
  resumeCache?: Map<string, Record<string, string>>;
  resumeFromSnapshotId?: string;
}): void {
  const { runId, csvPath, accountPurpose, writeToAttio, resumeCache, resumeFromSnapshotId } = opts;
  const record = getRun(runId);
  if (!record) return;

  void (async () => {
    try {
      const cache = await enrichAll({
        csv: csvPath,
        accountPurpose,
        writeToAttio,
        skipConfirm: true,
        onEvent: (event) => appendEvent(runId, event),
        isCancelled: () => isRunCancelled(runId),
        cancelSignal: record.cancelSignal,
        resumeCache,
        onCacheReady: (live) => attachLiveCache(runId, live),
      });
      // enrichAll returns gracefully on cancel (via bailIfCancelled) instead of throwing —
      // so we have to check cancelRequested here, otherwise we'd delete the snapshot the user
      // needs to resume from.
      const cancelled = isRunCancelled(runId);
      completeRun(runId, cache);
      if (!cancelled) {
        await deleteSnapshot(runId);
        if (resumeFromSnapshotId && resumeFromSnapshotId !== runId) {
          await deleteSnapshot(resumeFromSnapshotId);
        }
      } else {
        console.log(`[run ${runId}] cancelled by user — snapshot kept for resume`);
      }
    } catch (err) {
      // Defensive: enrichAll's bail path normally returns rather than throws on cancel, but if
      // an in-flight Promise.race surfaces the cancel error past the bail check, treat it as a
      // normal cancellation, not a hard failure.
      if (isRunCancelled(runId)) {
        console.log(`[run ${runId}] cancelled by user`);
        completeRun(runId, new Map());
        // Snapshot is intentionally kept on cancel so the user can resume later.
      } else {
        const msg = err instanceof Error ? err.stack ?? err.message : String(err);
        console.error(`[run ${runId}] failed:`, msg);
        appendEvent(runId, { type: 'run-failed', error: msg });
        failRun(runId, msg);
        // Snapshot kept on failure so the user can resume after fixing the cause.
      }
    } finally {
      try {
        await fs.unlink(csvPath);
      } catch {
        // already deleted
      }
    }
  })();
}

app.post('/api/runs', upload.single('csv'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'CSV file is required (form field name: csv)' });
    return;
  }
  const csvPath = req.file.path;
  const accountPurposeRaw = (req.body?.accountPurpose as string | undefined) ?? '';
  const accountPurpose = accountPurposeRaw.trim() || undefined;
  const writeToAttioRaw = req.body?.writeToAttio;
  const writeToAttio = writeToAttioRaw === 'true' || writeToAttioRaw === true;

  // Detect resumable snapshot. We parse the CSV here (cheap — a few KB) and compare its
  // domain set to every saved snapshot. Match → return resumable info; no run starts yet.
  let resumable: { snapshotId: string; stagesCompleted: number; completedStageNames: string[]; savedAt: number; writeToAttio: boolean } | null = null;
  try {
    const rows = await readInputCsv(csvPath);
    const domains: string[] = [];
    for (const row of rows) {
      const domain = deriveDomain(row['Website'] ?? '');
      if (domain) domains.push(domain);
    }
    const snap = await findResumableSnapshot(domains);
    if (snap) {
      resumable = {
        snapshotId: snap.runId,
        stagesCompleted: snap.stagesCompleted,
        completedStageNames: snap.completedStageNames,
        savedAt: snap.savedAt,
        writeToAttio: snap.writeToAttio,
      };
    }
  } catch (err) {
    // CSV parse failure is surfaced when the run actually starts; don't block resume detection.
    console.warn(`[runs] resume detection skipped (csv parse failed): ${err instanceof Error ? err.message : String(err)}`);
  }

  const runId = randomUUID();
  createRun(runId, { writeToAttio, accountPurpose });

  if (resumable) {
    // Don't start yet — return the resumable info and let the client choose /resume or /start.
    // Stash the upload path on the run record for the follow-up call to find.
    pendingUploads.set(runId, { csvPath, accountPurpose, writeToAttio });
    res.json({ runId, resumable });
    return;
  }

  res.json({ runId });
  startRunAsync({ runId, csvPath, accountPurpose, writeToAttio });
});

// Pending uploads keyed by runId, used between POST /api/runs (when resumable) and the
// follow-up /resume or /start call. Cleared as soon as the run actually starts.
const pendingUploads = new Map<string, { csvPath: string; accountPurpose?: string; writeToAttio: boolean }>();

// Single-line fields reject every C0 control char and DEL. Multi-line (description) keeps
// \t \n \r and rejects the rest — null bytes from a malicious client never reach the CSV
// writer, downstream Attio strings, or our own logs.
const SINGLE_LINE_CONTROL_RE = /[\x00-\x1F\x7F]/;
const MULTI_LINE_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

type ManualFieldRule = {
  label: string;
  required: boolean;
  maxLength: number;
  allowNewlines: boolean;
};

const MANUAL_FIELD_RULES = {
  companyName: { label: 'Company Name', required: true, maxLength: 600, allowNewlines: false },
  website: { label: 'Website', required: true, maxLength: 1500, allowNewlines: false },
  linkedinUrl: { label: 'LinkedIn URL', required: true, maxLength: 1500, allowNewlines: false },
  description: { label: 'Description', required: false, maxLength: 15000, allowNewlines: true },
  accountPurpose: { label: 'Account Purpose', required: false, maxLength: 600, allowNewlines: false },
} as const satisfies Record<string, ManualFieldRule>;

function validateManualField(
  raw: unknown,
  rule: ManualFieldRule
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    if (rule.required) return { ok: false, error: `${rule.label} is required.` };
    return { ok: true, value: '' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${rule.label} must be a string.` };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    if (rule.required) return { ok: false, error: `${rule.label} is required.` };
    return { ok: true, value: '' };
  }
  if (trimmed.length > rule.maxLength) {
    return { ok: false, error: `${rule.label} must be ${rule.maxLength} characters or fewer.` };
  }
  const re = rule.allowNewlines ? MULTI_LINE_CONTROL_RE : SINGLE_LINE_CONTROL_RE;
  if (re.test(trimmed)) {
    return {
      ok: false,
      error: rule.allowNewlines
        ? `${rule.label} contains disallowed control characters.`
        : `${rule.label} contains disallowed control characters or line breaks.`,
    };
  }
  return { ok: true, value: trimmed };
}

// Manual single-company run. Materializes a one-row CSV from JSON, then routes through the
// same enrichAll pipeline. No resume detection — manual runs are short-lived and one-shot.
app.post('/api/runs/manual', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const companyNameResult = validateManualField(body.companyName, MANUAL_FIELD_RULES.companyName);
  if (!companyNameResult.ok) {
    res.status(400).json({ error: companyNameResult.error });
    return;
  }
  const websiteResult = validateManualField(body.website, MANUAL_FIELD_RULES.website);
  if (!websiteResult.ok) {
    res.status(400).json({ error: websiteResult.error });
    return;
  }
  const linkedinUrlResult = validateManualField(body.linkedinUrl, MANUAL_FIELD_RULES.linkedinUrl);
  if (!linkedinUrlResult.ok) {
    res.status(400).json({ error: linkedinUrlResult.error });
    return;
  }
  const descriptionResult = validateManualField(body.description, MANUAL_FIELD_RULES.description);
  if (!descriptionResult.ok) {
    res.status(400).json({ error: descriptionResult.error });
    return;
  }
  const accountPurposeResult = validateManualField(body.accountPurpose, MANUAL_FIELD_RULES.accountPurpose);
  if (!accountPurposeResult.ok) {
    res.status(400).json({ error: accountPurposeResult.error });
    return;
  }

  const companyName = companyNameResult.value;
  const website = websiteResult.value;
  const linkedinUrl = linkedinUrlResult.value;
  const description = descriptionResult.value;
  const accountPurpose = accountPurposeResult.value || undefined;
  const writeToAttio = body.writeToAttio === true || body.writeToAttio === 'true';

  // deriveDomain is intentionally lenient (accepts www., bare hosts, paths, ports) — but a
  // result with no dot means we got something like "foobar" or "localhost", which is never
  // a real company website.
  const derived = deriveDomain(website);
  if (!derived.includes('.')) {
    res.status(400).json({ error: 'Website does not look like a valid URL or domain.' });
    return;
  }

  const csvPath = path.join(UPLOAD_DIR, `manual-${randomUUID()}.csv`);
  const csvText = csvStringify(
    [
      {
        'Company Name': companyName,
        'Website': website,
        'Company Linkedin Url': linkedinUrl,
        'Short Description': description,
        'Apollo Account Id': '',
      },
    ],
    {
      header: true,
      columns: ['Company Name', 'Website', 'Company Linkedin Url', 'Short Description', 'Apollo Account Id'],
    }
  );
  await fs.writeFile(csvPath, csvText, 'utf8');

  const runId = randomUUID();
  createRun(runId, { writeToAttio, accountPurpose });
  res.json({ runId });
  startRunAsync({ runId, csvPath, accountPurpose, writeToAttio });
});

app.post('/api/runs/:id/start', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id ?? '';
  const pending = pendingUploads.get(id);
  if (!pending) {
    res.status(404).json({ error: 'no pending upload for this run id (already started or unknown)' });
    return;
  }
  pendingUploads.delete(id);
  res.json({ ok: true });
  startRunAsync({ runId: id, ...pending });
});

app.post('/api/runs/:id/resume', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id ?? '';
  const pending = pendingUploads.get(id);
  if (!pending) {
    res.status(404).json({ error: 'no pending upload for this run id (already started or unknown)' });
    return;
  }
  const snapshotId = (req.body?.snapshotId as string | undefined) ?? '';
  if (!snapshotId) {
    res.status(400).json({ error: 'snapshotId is required' });
    return;
  }
  const snap = await loadSnapshot(snapshotId);
  if (!snap) {
    res.status(404).json({ error: 'snapshot not found (it may have been deleted by the TTL sweep)' });
    return;
  }
  pendingUploads.delete(id);
  const resumeCache = new Map<string, Record<string, string>>();
  for (const [domain, values] of Object.entries(snap.cache)) {
    resumeCache.set(domain, values);
  }
  res.json({ ok: true });
  startRunAsync({
    runId: id,
    csvPath: pending.csvPath,
    accountPurpose: pending.accountPurpose ?? snap.accountPurpose,
    writeToAttio: pending.writeToAttio,
    resumeCache,
    resumeFromSnapshotId: snap.runId,
  });
});

// Frontend polls this once per second. Returns the full UI state in one short JSON payload.
// Replaces the old SSE stream — short-lived requests are more robust on flaky networks
// (cafés, hotel WiFi, mobile tethering) and don't require any special proxy behavior.
app.get('/api/runs/:id/state', (req: Request, res: Response): void => {
  const id = req.params.id ?? '';
  const run = getRun(id);
  if (!run) {
    res.status(404).json({ error: 'run not found' });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.json(serializeRun(run));
});

app.post('/api/runs/:id/cancel', (req: Request, res: Response): void => {
  const id = req.params.id ?? '';
  const ok = requestCancel(id);
  if (!ok) {
    const run = getRun(id);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    res.status(409).json({ error: `run is already ${run.status}` });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/runs/:id', (req: Request, res: Response): void => {
  const run = getRun(req.params.id ?? '');
  if (!run) {
    res.status(404).end();
    return;
  }
  res.json({
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    error: run.error,
  });
});

app.get('/api/runs/:id/csv', (req: Request, res: Response): void => {
  const run = getRun(req.params.id ?? '');
  if (!run) {
    res.status(404).end();
    return;
  }
  if (!run.cache) {
    res.status(409).json({ error: 'Run is not yet complete' });
    return;
  }
  const csv = renderCsv(run.cache);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="enrichment-${run.id.slice(0, 8)}.csv"`,
  });
  res.send(csv);
});

// Serve the built React app in production. In dev, Vite serves the frontend on its own port.
const webDist = path.join(PROJECT_ROOT, 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log(`[server] serving static frontend from ${webDist}`);
} else {
  console.log(`[server] no web/dist found — running API-only (run the Vite dev server separately)`);
}

// 1-second snapshot flusher. Walks runs whose dirty flag is set, writes the live cache to
// disk, clears dirty. Async so a slow disk doesn't block the timer; concurrent flushes for
// different runs are fine (different files).
setInterval(() => {
  const dirty = listDirtyRunningRuns();
  for (const run of dirty) {
    if (!run.liveCache) continue;
    // Clear the dirty flag *before* the write so any concurrent cell update during the write
    // doesn't get lost — it'll re-flag and the next tick picks it up.
    clearDirty(run.id);
    const cache: Record<string, Record<string, string>> = {};
    for (const [domain, values] of run.liveCache) cache[domain] = values;
    writeSnapshot({
      version: 1,
      runId: run.id,
      savedAt: Date.now(),
      domains: run.domains,
      accountPurpose: run.accountPurpose,
      writeToAttio: run.writeToAttio,
      stagesCompleted: run.stagesCompleted,
      completedStageNames: run.completedStageNames,
      cache,
    }).catch((err) => {
      console.error(`[snapshot] flush failed for run ${run.id}:`, err);
    });
  }
}, 1000);

// In-memory run sweeper — drops finished runs older than 1 hour from RAM (does not touch
// the disk snapshots; those have their own 7-day TTL).
setInterval(() => {
  const removed = deleteOldRuns(60 * 60 * 1000);
  if (removed > 0) console.log(`[runRegistry] swept ${removed} old run(s) from memory`);
}, 5 * 60 * 1000);

// Daily TTL sweep of disk snapshots: anything not touched in 7 days gets removed.
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
setInterval(() => {
  void sweepOldSnapshots(SNAPSHOT_TTL_MS).then((deleted) => {
    if (deleted > 0) console.log(`[snapshotStore] swept ${deleted} stale snapshot(s)`);
  });
}, 24 * 60 * 60 * 1000);
// Run once on boot too so a long-down-then-restart server cleans up immediately.
void sweepOldSnapshots(SNAPSHOT_TTL_MS).then((deleted) => {
  if (deleted > 0) console.log(`[snapshotStore] startup sweep removed ${deleted} stale snapshot(s)`);
});

// Skip the listen when imported as a module (tests mount the app on a random port).
if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

export { app };
