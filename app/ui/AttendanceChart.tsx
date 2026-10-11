import type { Lang } from '@/lib/db';
import { fmtDate } from '@/lib/time';

type Point = { date: string; showed: number; missed: number };

/** Path for a bar with 4px rounded top corners and a square base. */
function bar(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const niceMax = (n: number) => (n <= 4 ? 4 : n <= 8 ? 8 : Math.ceil(n / 4) * 4);

/**
 * Columns per finished session: solid red = showed up, hatched = booked but didn't come.
 * Stacked with a 2px gap; native tooltips per column; table view underneath.
 */
export function AttendanceChart({ id, data, lang, labels }: {
  id: string; data: Point[]; lang: Lang;
  labels: { showed: string; missed: string; table: string; date: string; empty: string };
}) {
  if (data.length === 0) return <p className="muted">{labels.empty}</p>;
  const slot = 40, bw = 22, top = 20, plotH = 110, left = 26;
  const W = left + data.length * slot, H = top + plotH + 22;
  const max = niceMax(Math.max(...data.map((d) => d.showed + d.missed)));
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const last = data.length - 1;

  return (
    <div className="chart">
      <div className="legend" style={{ marginTop: 0, marginBottom: 6 }}>
        <span><i style={{ background: 'var(--red)', borderRadius: 3 }} />{labels.showed}</span>
        <span><svg width="14" height="14" aria-hidden><rect width="14" height="14" rx="3" fill={`url(#hatch-${id})`} /></svg>{labels.missed}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels.showed} / ${labels.missed}`}>
        <defs>
          <pattern id={`hatch-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--card-2)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--muted)" strokeWidth="2" />
          </pattern>
        </defs>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line className="grid" x1={left} x2={W} y1={y(v)} y2={y(v)} />
            <text className="axis" x={left - 6} y={y(v) + 3} textAnchor="end">{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const showedTop = y(d.showed);
          const gap = d.showed > 0 && d.missed > 0 ? 2 : 0;
          const missedH = (d.missed / max) * plotH - gap;
          const day = fmtDate(d.date, lang);
          return (
            <g key={d.date} className="bar">
              <title>{`${day} · ${labels.showed}: ${d.showed} · ${labels.missed}: ${d.missed}`}</title>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent" />
              <path d={bar(x, showedTop, bw, top + plotH - showedTop, d.missed ? 0 : 4)} fill="var(--red)" />
              {d.missed > 0 && <path d={bar(x, showedTop - gap - missedH, bw, missedH)} fill={`url(#hatch-${id})`} />}
              {i === last && (
                <text className="lbl" x={x + bw / 2} y={y(d.showed + d.missed) - 6} textAnchor="middle">{d.showed}</text>
              )}
              <text className="axis" x={x + bw / 2} y={H - 6} textAnchor="middle">{d.date.slice(8)}</text>
            </g>
          );
        })}
      </svg>
      <details>
        <summary className="muted">{labels.table}</summary>
        <table>
          <thead><tr><th>{labels.date}</th><th>{labels.showed}</th><th>{labels.missed}</th></tr></thead>
          <tbody>{[...data].reverse().map((d) => <tr key={d.date}><td>{fmtDate(d.date, lang)}</td><td>{d.showed}</td><td>{d.missed}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
