'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { savePlan } from '../staff-actions';
import { Submit } from './Client';

type Preset = 'all' | 'weekdays' | 'weekends' | 'custom' | 'wallet';
const PRESET_DAYS: Record<'all' | 'weekdays' | 'weekends', number[]> = {
  all: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon first

function addMonth(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Matching days from `start` to `end` inclusive. */
function countDays(start: string, end: string, days: number[]) {
  let n = 0;
  for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (days.includes(d.getUTCDay())) n++;
  }
  return n;
}

export type PlanDefaults = {
  planId?: number; requestId?: number; phone?: string; kind: 'fixed' | 'wallet'; batchId: string | null; days: number[];
  sessionsTotal?: number; startsOn: string; endsOn?: string | null; note?: string | null; amount?: number | null;
};

export function PlanForm({ batches, defaults, withPhone, topUp, labels, dayNames, back }: {
  batches: { id: string; name: string }[];
  /** Page to come back to after saving (default: Members). */
  back?: string;
  defaults: PlanDefaults;
  withPhone?: boolean;
  /** Activating adds to the player's live wallet instead of creating a plan. */
  topUp?: boolean;
  labels: Record<'phone' | 'firstName' | 'lastName' | 'batch' | 'days' | 'all' | 'weekdays' | 'weekends' | 'custom' | 'wallet' | 'walletHint'
    | 'sessions' | 'topUpSessions' | 'wholeMonth' | 'startsOn' | 'endsOn' | 'note' | 'amount' | 'submit', string>;
  dayNames: string[]; // index 0 = Sun
}) {
  // One-time token, filled in on first submit and renewed after each result message (the URL changes),
  // so a replayed submit can't apply twice.
  const params = useSearchParams().toString();
  const sorted = [...defaults.days].sort().join();
  const initial: Preset = defaults.kind === 'wallet' ? 'wallet'
    : ((Object.entries(PRESET_DAYS).find(([, d]) => d.join() === sorted)?.[0] ?? 'custom') as Preset);
  const [preset, setPreset] = useState<Preset>(initial);
  const [days, setDays] = useState<number[]>(defaults.days);
  const [startsOn, setStartsOn] = useState(defaults.startsOn);
  const [endsOn, setEndsOn] = useState(defaults.endsOn ?? '');
  const [total, setTotal] = useState(String(defaults.sessionsTotal ?? ''));
  const wallet = preset === 'wallet';

  const pick = (p: Preset) => {
    setPreset(p);
    if (p === 'all' || p === 'weekdays' || p === 'weekends') setDays(PRESET_DAYS[p]);
    if (p === 'wallet') setDays(PRESET_DAYS.all);
  };
  const toggleDay = (d: number) => {
    setPreset('custom');
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };
  const wholeMonth = () => {
    const end = addMonth(startsOn);
    setEndsOn(end);
    setTotal(String(countDays(startsOn, end, days)));
  };
  const dateError = endsOn && startsOn > endsOn;

  return (
    <form action={savePlan} className="stack"
      onSubmit={(e) => { const t = e.currentTarget.elements.namedItem('token') as HTMLInputElement; if (!t.value) t.value = crypto.randomUUID(); }}>
      <input key={params} type="hidden" name="token" defaultValue="" />
      {defaults.planId && <input type="hidden" name="planId" value={defaults.planId} />}
      {defaults.requestId && <input type="hidden" name="requestId" value={defaults.requestId} />}
      {defaults.phone && <input type="hidden" name="phone" value={defaults.phone} />}
      {back && <input type="hidden" name="back" value={back} />}
      <input type="hidden" name="kind" value={wallet ? 'wallet' : 'fixed'} />
      {!wallet && days.map((d) => <input key={d} type="hidden" name="days" value={d} />)}
      {withPhone && (
        <>
          <label>{labels.phone}<input name="phone" type="tel" inputMode="numeric" required /></label>
          <div className="grid2">
            <label>{labels.firstName}<input name="firstName" maxLength={40} /></label>
            <label>{labels.lastName}<input name="lastName" maxLength={40} /></label>
          </div>
        </>
      )}
      {!topUp && (
        <div>
          <div className="eyebrow">{labels.days}</div>
          <div className="seg wrap">
            {(['all', 'weekdays', 'weekends', 'custom', 'wallet'] as const).map((p) => (
              <button key={p} type="button" className={preset === p ? 'on' : ''} onClick={() => pick(p)}>{labels[p]}</button>
            ))}
          </div>
          {wallet ? <p className="hint">{labels.walletHint}</p> : (
            <div className="row" style={{ marginTop: 8 }}>
              {WEEK.map((d) => (
                <button key={d} type="button" className={`btn-sm day ${days.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(d)}>
                  {dayNames[d]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!wallet && (
        <label>
          {labels.batch}
          <select name="batchId" defaultValue={defaults.batchId ?? batches[0]?.id}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {!topUp && (
        <div className="grid2">
          <label>
            {labels.startsOn}
            <input name="startsOn" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          </label>
          <label>
            {labels.endsOn}
            <input name="endsOn" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
        </div>
      )}
      <div className="grid2">
        <label>
          {topUp ? labels.topUpSessions : labels.sessions}
          <input name="sessionsTotal" type="number" min="1" max="400" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} required />
        </label>
        <label>
          {labels.amount}
          <input name="amount" type="number" min="0" inputMode="numeric" defaultValue={defaults.amount ?? ''} />
        </label>
      </div>
      <div className="row">
        {(wallet ? [5, 10, 15, 20] : [15, 22]).map((n) => <button key={n} type="button" className="btn-sm chip-btn" onClick={() => setTotal(String(n))}>{n}</button>)}
        {!wallet && !topUp && <button type="button" className="btn-sm chip-btn" onClick={wholeMonth}>{labels.wholeMonth}</button>}
      </div>
      <label>{labels.note}<input name="note" defaultValue={defaults.note ?? ''} maxLength={200} /></label>
      <Submit className="btn-primary" disabled={!!dateError}>{labels.submit}</Submit>
    </form>
  );
}
