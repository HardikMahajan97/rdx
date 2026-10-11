'use client';

import { useState } from 'react';
import { book } from '../actions';
import { Submit } from './Client';

type Labels = Record<'justMe' | 'meAndFriends' | 'friends' | 'you' | 'total' | 'covered' | 'bookSlot', string>;

/** "Just me" or "Me + friends" with a counter; the total updates as the counter changes. */
export function BookForm({ sessionId, price, selfCovered, maxFriends, labels }: {
  sessionId: number; price: number; selfCovered: boolean; maxFriends: number; labels: Labels;
}) {
  const [mode, setMode] = useState<'me' | 'friends'>('me');
  const [friends, setFriends] = useState(1);
  const n = mode === 'friends' ? Math.min(friends, maxFriends) : 0;
  const total = (selfCovered ? 0 : price) + n * price;

  return (
    <form action={book} className="stack">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="guests" value={n} />
      <div className="seg" role="radiogroup">
        <button type="button" role="radio" aria-checked={mode === 'me'} className={mode === 'me' ? 'on' : ''} onClick={() => setMode('me')}>
          {labels.justMe}
        </button>
        <button type="button" role="radio" aria-checked={mode === 'friends'} disabled={maxFriends < 1}
          className={mode === 'friends' ? 'on' : ''} onClick={() => setMode('friends')}>
          {labels.meAndFriends}
        </button>
      </div>

      {mode === 'friends' && (
        <div className="spread">
          <span>{labels.friends}</span>
          <div className="stepper">
            <button type="button" aria-label="−" onClick={() => setFriends((f) => Math.max(1, f - 1))} disabled={n <= 1}>−</button>
            <output aria-live="polite">{n}</output>
            <button type="button" aria-label="+" onClick={() => setFriends((f) => Math.min(maxFriends, f + 1))} disabled={n >= maxFriends}>+</button>
          </div>
        </div>
      )}

      <div className="price">
        <div className="spread"><span>{labels.you}</span><span>{selfCovered ? labels.covered : `₹${price}`}</span></div>
        {n > 0 && <div className="spread"><span>{labels.friends} × {n}</span><span>₹{n * price}</span></div>}
        <div className="spread total"><span>{labels.total}</span><span>₹{total}</span></div>
      </div>

      <Submit className="btn-big">{labels.bookSlot}</Submit>
    </form>
  );
}
