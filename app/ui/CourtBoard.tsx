import { initials } from './Shared';

export type BoardPerson = { name: string; kind: 'member' | 'floater'; guests: number; here?: boolean; me?: boolean };

type Seat = { kind: 'member' | 'floater' | 'guest'; text: string; title: string; here?: boolean; me?: boolean };

/**
 * The hall at a glance: one rectangle per court, one circle per spot, filled in booking order.
 * Members are red circles, floaters beige squares, friends outlined squares; anyone past capacity
 * shows below the courts. Shape carries the type too, so it never relies on colour alone.
 */
export function CourtBoard({ capacity, perCourt, people, showNames, labels }: {
  capacity: number; perCourt: number; people: BoardPerson[]; showNames: boolean;
  labels: { court: string; member: string; floater: string; friend: string; open: string; extra: string };
}) {
  const seats: Seat[] = people.flatMap((p) => [
    { kind: p.kind, text: showNames ? initials(p.name) : '', title: showNames ? p.name : '', here: p.here, me: p.me },
    ...Array.from({ length: p.guests }, () => ({
      kind: 'guest' as const, text: '+', title: showNames ? `${p.name} +1` : '', here: p.here,
    })),
  ]);
  const courts = Math.max(1, Math.ceil(capacity / Math.max(1, perCourt)));
  const left = Math.ceil(perCourt / 2);
  const extra = seats.slice(courts * perCourt);

  const seatEl = (s: Seat | undefined, key: number, inCourt: boolean) =>
    s ? (
      <span key={key} className={`seat ${s.kind}${s.here ? ' here' : ''}${s.me ? ' me' : ''}`} title={s.title || undefined}
        aria-label={s.title || labels[s.kind === 'guest' ? 'friend' : s.kind]} style={{ animationDelay: `${key * 25}ms` }}>
        {s.text}
      </span>
    ) : (
      <span key={key} className="seat empty" aria-label={inCourt ? labels.open : undefined} />
    );

  return (
    <div>
      <div className="courts">
        {Array.from({ length: courts }, (_, c) => {
          const base = c * perCourt;
          const spots = Array.from({ length: perCourt }, (_, i) => (base + i < capacity ? seats[base + i] : undefined));
          return (
            <div key={c} className="court" role="group" aria-label={`${labels.court} ${c + 1}`}>
              <span className="tag">{labels.court} {c + 1}</span>
              <div className="half">{spots.slice(0, left).map((s, i) => seatEl(s, base + i, true))}</div>
              <div className="half">{spots.slice(left).map((s, i) => seatEl(s, base + left + i, true))}</div>
            </div>
          );
        })}
      </div>
      {extra.length > 0 && (
        <div className="overflow">
          <span className="pill bad">{labels.extra} +{extra.length}</span>
          {extra.map((s, i) => seatEl(s, courts * perCourt + i, false))}
        </div>
      )}
      <div className="legend">
        <span><i className="member" />{labels.member}</span>
        <span><i className="floater" />{labels.floater}</span>
        <span><i className="guest" />{labels.friend}</span>
        <span><i className="empty" />{labels.open}</span>
      </div>
    </div>
  );
}
