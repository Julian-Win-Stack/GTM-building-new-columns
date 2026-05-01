import { useRef, useState, type FormEvent } from 'react';
import './ControlDeck.css';

export type RunMode = 'csv' | 'manual';

export type ManualCompany = {
  companyName: string;
  website: string;
  linkedinUrl: string;
  description: string;
};

export type SubmitArgs =
  | { mode: 'csv'; file: File; accountPurpose: string }
  | { mode: 'manual'; manual: ManualCompany; accountPurpose: string };

type Props = {
  disabled: boolean;
  onSubmit: (args: SubmitArgs) => Promise<void> | void;
};

export function ControlDeck({
  disabled,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<RunMode>('csv');
  const [file, setFile] = useState<File | null>(null);
  const [manual, setManual] = useState<ManualCompany>({
    companyName: '',
    website: '',
    linkedinUrl: '',
    description: '',
  });
  const [accountPurpose, setAccountPurpose] = useState('');
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) setFile(f);
  }

  const manualValid =
    manual.companyName.trim() !== '' &&
    manual.website.trim() !== '' &&
    manual.linkedinUrl.trim() !== '';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (mode === 'csv') {
      if (!file) return;
      await onSubmit({ mode: 'csv', file, accountPurpose });
    } else {
      if (!manualValid) return;
      await onSubmit({
        mode: 'manual',
        manual: {
          companyName: manual.companyName.trim(),
          website: manual.website.trim(),
          linkedinUrl: manual.linkedinUrl.trim(),
          description: manual.description.trim(),
        },
        accountPurpose,
      });
    }
  }

  const submitDisabled = disabled || (mode === 'csv' ? !file : !manualValid);

  return (
    <form className="ctrl" onSubmit={handleSubmit}>
      <div className="ctrl__header">
        <div className="ctrl__header-left">
          <span className="ctrl__eyebrow">Step 1</span>
          <h2 className="ctrl__title">Configure the run</h2>
        </div>
        <div className="seg" role="tablist" aria-label="Run input mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'csv'}
            className={`seg__opt ${mode === 'csv' ? 'seg__opt--active' : ''}`}
            onClick={() => setMode('csv')}
            disabled={disabled}
          >
            CSV upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'manual'}
            className={`seg__opt ${mode === 'manual' ? 'seg__opt--active' : ''}`}
            onClick={() => setMode('manual')}
            disabled={disabled}
          >
            Single company
          </button>
          <span className={`seg__rail seg__rail--${mode}`} aria-hidden />
        </div>
      </div>

      {mode === 'csv' ? (
        <div className="ctrl__grid">
          <div className="ctrl__field ctrl__field--file">
            <span className="ctrl__label">Source CSV</span>
            <div
              className={`drop ${dragOver ? 'drop--over' : ''} ${file ? 'drop--has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              {file ? (
                <div className="drop__file">
                  <span className="drop__filename">{file.name}</span>
                  <span className="drop__filesize num">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    className="drop__clear"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (inputRef.current) inputRef.current.value = '';
                    }}
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="drop__empty">
                  <span className="drop__primary">Drop a CSV here</span>
                  <span className="drop__secondary">or click to browse</span>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
            </div>
          </div>

          <label className="ctrl__field">
            <span className="ctrl__label">
              Account Purpose <span className="ctrl__optional">optional</span>
            </span>
            <input
              type="text"
              className="ctrl__input"
              placeholder="e.g. Q1 2026 ABM"
              value={accountPurpose}
              onChange={(e) => setAccountPurpose(e.target.value)}
              disabled={disabled}
            />
            <span className="ctrl__hint">Tags every CSV row with this label in the output.</span>
          </label>

          <span className="ctrl__hint">
            Each enriched cell upserts into Attio in real time. Already populated columns are skipped, so previously enriched companies pick up where they left off.
          </span>
        </div>
      ) : (
        <div className="ctrl__manual">
          <div className="manual__grid">
            <label className="ctrl__field manual__field">
              <span className="ctrl__label">
                Company Name <span className="ctrl__required">required</span>
              </span>
              <input
                type="text"
                className="ctrl__input"
                placeholder="Acme Inc."
                value={manual.companyName}
                onChange={(e) => setManual((m) => ({ ...m, companyName: e.target.value }))}
                disabled={disabled}
                autoComplete="off"
              />
            </label>

            <label className="ctrl__field manual__field">
              <span className="ctrl__label">
                Website <span className="ctrl__required">required</span>
              </span>
              <input
                type="text"
                className="ctrl__input"
                placeholder="www.acme.com or acme.com"
                value={manual.website}
                onChange={(e) => setManual((m) => ({ ...m, website: e.target.value }))}
                disabled={disabled}
                autoComplete="off"
              />
            </label>

            <label className="ctrl__field manual__field manual__field--wide">
              <span className="ctrl__label">
                LinkedIn URL <span className="ctrl__required">required</span>
              </span>
              <input
                type="text"
                className="ctrl__input"
                placeholder="https://www.linkedin.com/company/acme"
                value={manual.linkedinUrl}
                onChange={(e) => setManual((m) => ({ ...m, linkedinUrl: e.target.value }))}
                disabled={disabled}
                autoComplete="off"
              />
            </label>

            <label className="ctrl__field manual__field manual__field--wide">
              <span className="ctrl__label">
                Description <span className="ctrl__optional">optional · recommended</span>
              </span>
              <textarea
                className="ctrl__input ctrl__textarea"
                placeholder="One or two sentences about what the company does."
                value={manual.description}
                onChange={(e) => setManual((m) => ({ ...m, description: e.target.value }))}
                disabled={disabled}
                rows={3}
              />
              <span className="ctrl__hint">
                Optional, but a clean description noticeably improves account scoring accuracy.
                If you don't have one handy, ask any AI tool for a one-line summary of the company.
              </span>
            </label>

            <label className="ctrl__field manual__field">
              <span className="ctrl__label">
                Account Purpose <span className="ctrl__optional">optional</span>
              </span>
              <input
                type="text"
                className="ctrl__input"
                placeholder="e.g. Q1 2026 ABM"
                value={accountPurpose}
                onChange={(e) => setAccountPurpose(e.target.value)}
                disabled={disabled}
              />
            </label>

            <span className="ctrl__hint">
              Each enriched cell upserts into Attio in real time. Already populated columns are skipped, so previously enriched companies pick up where they left off.
            </span>
          </div>

          <div className="notice notice--apollo" role="note">
            <span className="notice__mark" aria-hidden>!</span>
            <div className="notice__body">
              <span className="notice__title">No Apollo Account ID on this path</span>
              <span className="notice__text">
                Companies entered manually do not carry an Apollo Account ID, so the in-house{' '}
                <strong>Outreach Automation</strong> tool will not pick this account up — that tool
                requires an Apollo Account ID to push results back into Apollo. Use a CSV import if
                you need the Outreach Automation.
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="ctrl__actions">
        <button type="submit" className="btn btn--primary" disabled={submitDisabled}>
          {mode === 'manual' ? 'Enrich company' : 'Start enrichment'}
          <span className="btn__arrow">→</span>
        </button>
      </div>
    </form>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
