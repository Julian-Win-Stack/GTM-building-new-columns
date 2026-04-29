import { useRef, useState, type FormEvent } from 'react';
import './ControlDeck.css';

type Props = {
  disabled: boolean;
  onSubmit: (args: { file: File; accountPurpose: string; writeToAttio: boolean }) => Promise<void> | void;
};

export function ControlDeck({ disabled, onSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [accountPurpose, setAccountPurpose] = useState('');
  const [writeToAttio, setWriteToAttio] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) setFile(f);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || disabled) return;
    await onSubmit({ file, accountPurpose, writeToAttio });
  }

  return (
    <form className="ctrl" onSubmit={handleSubmit}>
      <div className="ctrl__header">
        <span className="ctrl__eyebrow">Step 1</span>
        <h2 className="ctrl__title">Configure the run</h2>
      </div>

      <div className="ctrl__grid">
        <label className="ctrl__field ctrl__field--file">
          <span className="ctrl__label">Source CSV</span>
          <div
            className={`drop ${dragOver ? 'drop--over' : ''} ${file ? 'drop--has-file' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
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
        </label>

        <label className="ctrl__field">
          <span className="ctrl__label">Account Purpose <span className="ctrl__optional">optional</span></span>
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

        <label className="ctrl__field ctrl__field--toggle">
          <span className="ctrl__label">Push results to Attio</span>
          <button
            type="button"
            role="switch"
            aria-checked={writeToAttio}
            className={`toggle ${writeToAttio ? 'toggle--on' : ''}`}
            onClick={() => setWriteToAttio((v) => !v)}
            disabled={disabled}
          >
            <span className="toggle__track" />
            <span className="toggle__thumb" />
          </button>
          <span className="ctrl__hint">
            {writeToAttio
              ? 'Each enriched cell will upsert into Attio in real time.'
              : 'CSV-only run. Nothing is written to Attio.'}
          </span>
          {!writeToAttio && (
            <span className="ctrl__hint ctrl__hint--reassure">
              <span className="ctrl__hint-mark" aria-hidden>◆</span>
              Auto-saved every second on disk. If the server restarts, re-upload the same CSV to resume where you left off. Drafts kept for 7 days.
            </span>
          )}
        </label>
      </div>

      <div className="ctrl__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={disabled || !file}
        >
          Start enrichment
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
