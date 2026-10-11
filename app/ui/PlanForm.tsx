'use client';

import { useState, useEffect } from 'react';
import { savePlan } from '../staff-actions';

type Preset = 'all' | 'weekdays' | 'weekends' | 'other' | 'custom';
const PRESET_DAYS: Record<Exclude<Preset, 'custom' | 'other'>, number[]> = {
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

/** Check if a date matches the allowed day pattern. */
function dateMatchesPattern(date: string, allowedDays: number[]): boolean {
  const d = new Date(`${date}T12:00:00Z`);
  return allowedDays.includes(d.getUTCDay());
}

/** Validate that startsOn and endsOn only contain allowed days. */
function validateDateRange(startsOn: string, endsOn: string, allowedDays: number[]): string | null {
  if (!startsOn || !endsOn) return null;
  if (startsOn > endsOn) return 'Start date must be before end date';
  for (let d = new Date(`${startsOn}T12:00:00Z`); d <= new Date(`${endsOn}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    if (!allowedDays.includes(d.getUTCDay())) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `Date ${dateStr} (${dayNames[d.getUTCDay()]}) is not in the allowed days pattern`;
    }
  }
  return null;
}

export type PlanDefaults = {
  planId?: number; requestId?: number; batchId: string; days: number[];
  sessionsTotal?: number; startsOn: string; endsOn?: string | null; note?: string | null;
};

export function PlanForm({ batches, defaults, withPhone, labels, dayNames }: {
  batches: { id: string; name: string }[];
  defaults: PlanDefaults;
  withPhone?: boolean;
  labels: Record<'phone' | 'name' | 'batch' | 'days' | 'all' | 'weekdays' | 'weekends' | 'other' | 'otherHint' | 'sessions' | 'wholeMonth' | 'startsOn' | 'endsOn' | 'note' | 'submit', string>;
  dayNames: string[]; // index 0 = Sun
}) {
  const initialPreset = (Object.entries(PRESET_DAYS).find(([, d]) => d.join() === [...defaults.days].sort().join())?.[0] ?? 'custom') as Preset;
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [days, setDays] = useState<number[]>(defaults.days);
  const [startsOn, setStartsOn] = useState(defaults.startsOn);
  const [endsOn, setEndsOn] = useState(defaults.endsOn ?? '');
  const [total, setTotal] = useState(String(defaults.sessionsTotal ?? ''));
  const [dateError, setDateError] = useState<string | null>(null);

  // When preset changes (not custom/other), update days
  const pick = (p: Preset) => { 
    setPreset(p); 
    if (p !== 'custom' && p !== 'other') {
      setDays(PRESET_DAYS[p]);
    }
  };
  
  // When days change via day buttons, switch to custom
  const toggleDay = (d: number) => {
    setPreset('custom');
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };
  
  const wholeMonth = () => {
    const end = addMonth(startsOn);
    setEndsOn(end);
    setTotal(String(countDays(startsOn, end, days)));
  };

  // Validate dates when they change (for 'other' preset)
  useEffect(() => {
    if (preset === 'other' && startsOn && endsOn) {
      const error = validateDateRange(startsOn, endsOn, days);
      setDateError(error);
    } else {
      setDateError(null);
    }
  }, [preset, startsOn, endsOn, days]);

  // Auto-calculate total when dates or days change for 'other' preset
  useEffect(() => {
    if (preset === 'other' && startsOn && endsOn && !dateError) {
      setTotal(String(countDays(startsOn, endsOn, days)));
    }
  }, [preset, startsOn, endsOn, days, dateError]);

  const allowedDays = preset === 'other' ? days : (PRESET_DAYS[preset as Exclude<Preset, 'custom' | 'other'>] ?? days);

  return (
    <form action={savePlan} className="stack">
      {defaults.planId && <input type="hidden" name="planId" value={defaults.planId} />}
      {defaults.requestId && <input type="hidden" name="requestId" value={defaults.requestId} />}
      {days.map((d) => <input key={d} type="hidden" name="days" value={d} />)}
      {withPhone && (
        <div className="grid2">
          <label>{labels.phone}<input name="phone" type="tel" inputMode="numeric" required /></label>
          <label>{labels.name}<input name="name" /></label>
        </div>
      )}
      <label>
        {labels.batch}
        <select name="batchId" defaultValue={defaults.batchId}>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <div>
        <div className="muted">{labels.days}</div>
        <div className="seg">
          {(['all', 'weekdays', 'weekends', 'other'] as const).map((p) => (
            <button key={p} type="button" className={preset === p ? 'on' : ''} onClick={() => pick(p)}>{labels[p]}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {WEEK.map((d) => (
            <button key={d} type="button" className={`btn-sm day ${days.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(d)} disabled={preset !== 'custom' && preset !== 'other'}>
              {dayNames[d]}
            </button>
          ))}
        </div>
        {preset === 'other' && (
          <p className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>
            {labels.otherHint || 'Select custom days above, then pick a date range that only includes those days.'}
          </p>
        )}
      </div>
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
      {dateError && <p className="error" style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: -8, marginBottom: 8 }}>{dateError}</p>}
      <label>
        {labels.sessions}
        <input name="sessionsTotal" type="number" min="1" max="400" value={total} onChange={(e) => setTotal(e.target.value)} required />
      </label>
      <div className="row">
        {[15, 22].map((n) => <button key={n} type="button" className="btn-sm" onClick={() => setTotal(String(n))}>{n}</button>)}
        <button type="button" className="btn-sm" onClick={wholeMonth} disabled={preset !== 'all'}>{labels.wholeMonth}</button>
      </div>
      <label>{labels.note}<input name="note" defaultValue={defaults.note ?? ''} /></label>
      <button className="btn-primary" disabled={!!dateError}>{labels.submit}</button>
    </form>
  );
}
