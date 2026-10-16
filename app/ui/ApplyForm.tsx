'use client';

import { useState } from 'react';
import { applyMembership } from '../actions';
import { Submit } from './Client';

type Kind = 'month' | 'weekdays' | 'weekends' | 'wallet';
type Labels = Record<Kind | 'batch' | 'plan' | 'walletHint' | 'sessions' | 'note' | 'submit', string>;

/** Plan request. A wallet has no batch or days: the player just says how many sessions to load. */
export function ApplyForm({ batches, walletOnly, labels }: {
  batches: { id: string; name: string }[]; walletOnly: boolean; labels: Labels;
}) {
  const [kind, setKind] = useState<Kind>(walletOnly ? 'wallet' : 'month');
  const [sessions, setSessions] = useState(10);
  const kinds: Kind[] = walletOnly ? ['wallet'] : ['month', 'weekdays', 'weekends', 'wallet'];

  return (
    <form action={applyMembership} className="stack">
      <input type="hidden" name="plan" value={kind} />
      {kinds.length > 1 && (
        <div className="plan-pick" role="radiogroup" aria-label={labels.plan}>
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {labels[k]}
            </button>
          ))}
        </div>
      )}
      {kind === 'wallet' ? (
        <>
          <p className="hint">{labels.walletHint}</p>
          <div className="spread">
            <span>{labels.sessions}</span>
            <div className="stepper">
              <button type="button" aria-label="−" onClick={() => setSessions((n) => Math.max(1, n - 1))} disabled={sessions <= 1}>−</button>
              <output aria-live="polite">{sessions}</output>
              <button type="button" aria-label="+" onClick={() => setSessions((n) => Math.min(100, n + 1))}>+</button>
            </div>
          </div>
          <div className="row">
            {[5, 10, 15, 20].map((n) => (
              <button key={n} type="button" className={`btn-sm chip-btn ${sessions === n ? 'on' : ''}`} onClick={() => setSessions(n)}>{n}</button>
            ))}
          </div>
          <input type="hidden" name="sessions" value={sessions} />
        </>
      ) : (
        <label>
          {labels.batch}
          <select name="batchId">
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <label>{labels.note}<input name="note" maxLength={200} /></label>
      <Submit className="btn-primary">{labels.submit}</Submit>
    </form>
  );
}
