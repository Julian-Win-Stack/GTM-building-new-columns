import { useState } from 'react';
import './SkippedPanel.css';

type Props = {
  skippedRows: Array<{ name: string; reason: string }>;
};

export function SkippedPanel({ skippedRows }: Props) {
  const [open, setOpen] = useState(skippedRows.length <= 3);
  if (skippedRows.length === 0) return null;

  return (
    <section className={`skipped ${open ? 'skipped--open' : ''}`}>
      <button className="skipped__header" onClick={() => setOpen((v) => !v)} type="button">
        <span className="skipped__rule" />
        <span className="skipped__title">
          <span className="num skipped__count">{skippedRows.length}</span>
          {skippedRows.length === 1 ? ' row skipped from upload' : ' rows skipped from upload'}
        </span>
        <span className={`skipped__chev ${open ? 'skipped__chev--open' : ''}`}>›</span>
      </button>

      {open && (
        <ul className="skipped__list">
          {skippedRows.map((s, i) => (
            <li key={`${s.name}-${i}`} className="skipped__item">
              <span className="skipped__bar" />
              <span className="skipped__name" title={s.name}>
                {s.name}
              </span>
              <span className="skipped__reason">{s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
