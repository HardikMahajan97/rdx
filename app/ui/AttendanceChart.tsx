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

/** Responsive layout calculations based on data count. */
function getChartLayout(count: number) {
  const minSlot = 24, maxSlot = 34, bw = 16, top = 16, plotH = 75, left = 20;
  const slot = Math.min(maxSlot, Math.max(minSlot, 280 / Math.max(count, 1)));
  const W = left + count * slot + 10;
  const H = top + plotH + 24;
  return { slot, bw, top, plotH, left, W, H };
}

/**
 * Columns per finished session: solid red = showed up, hatched = booked but didn't come.
 * Responsive width, stacked bars, native tooltips, collapsible table view.
 */
export function AttendanceChart({ id, data, lang, labels }: {
  id: string; data: Point[]; lang: Lang;
  labels: { showed: string; missed: string; table: string; date: string; empty: string };
}) {
  if (data.length === 0) return <p className="muted">{labels.empty}</p>;
  const { slot, bw, top, plotH, left, W, H } = getChartLayout(data.length);
  const maxVal = Math.max(...data.map((d) => d.showed + d.missed), 1);
  const scale = plotH / niceMax(maxVal);

  return (
    <div className="chart" role="img" aria-label={labels.table}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', maxWidth: '100%', height: 'auto', display: 'block' }}>
        {/* grid */}
        <g className="grid" strokeWidth="1" stroke="var(--line)">
          {[2, 4, 6, 8].filter((n) => n <= niceMax(maxVal)).map((n) => (
            <line key={n} x1={left} y1={top + plotH - n * scale} x2={W - 8} y2={top + plotH - n * scale} />
          ))}
        </g>
        {/* bars */}
        <g>
          {data.map((d, i) => {
            const x = left + i * slot + (slot - bw * 2 - 2) / 2;
            const showedH = d.showed * scale;
            const missedH = d.missed * scale;
            const yBase = top + plotH;
            const showedY = yBase - showedH;
            const missedY = showedY - missedH;
            return (
              <g key={d.date} className="bar" aria-label={`${d.showed} ${labels.showed}, ${d.missed} ${labels.missed} — ${fmtDate(d.date, lang)}`}>
                {showedH > 0 && <path d={bar(x, showedY, bw, showedH)} fill="var(--red)" />}
                {missedH > 0 && (
                  <g>
                    <path d={bar(x + bw + 2, missedY, bw, missedH)} fill="var(--red)" fillOpacity={0.35} />
                    <defs>
                      <pattern id={`hatch-${id}-${i}`} patternUnits="userSpaceOnUse" width={4} height={4}>
                        <line x1={0} y1={4} x2={4} y2={0} stroke="var(--red)" strokeWidth={1} opacity={0.5} />
                      </pattern>
                    </defs>
                    <rect x={x + bw + 2} y={missedY} width={bw} height={missedH} fill={`url(#hatch-${id}-${i})`} />
                  </g>
                )}
                <text x={x + bw} y={yBase + 14} className="axis" textAnchor="middle" fontSize={9}>{fmtDate(d.date, lang).slice(5)}</text>
              </g>
            );
          })}
        </g>
        {/* y axis labels */}
        <g className="axis" textAnchor="end">
          {[0, 2, 4, 6, 8].filter((n) => n <= niceMax(maxVal)).map((n) => (
            <text key={n} x={left - 4} y={top + plotH - n * scale + 3} fontSize={9} fill="var(--muted)">{n}</text>
          ))}
        </g>
        {/* legend */}
        <g>
          <rect x={left} y={top - 18} width={14} height={10} fill="var(--red)" rx={2} />
          <text x={left + 18} y={top - 10} className="lbl" fontSize={10} fill="var(--text)">{labels.showed}</text>
          <rect x={left + 80} y={top - 18} width={14} height={10} fill="var(--red)" fillOpacity={0.35} rx={2} />
          <text x={left + 98} y={top - 10} className="lbl" fontSize={10} fill="var(--text)">{labels.missed}</text>
        </g>
      </svg>
      {/* Table view for mobile/overflow */}
      <details className="card-nested" style={{ marginTop: 10 }}>
        <summary className="muted">{labels.table}</summary>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>{labels.date}</th><th>{labels.showed}</th><th>{labels.missed}</th></tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}><td>{fmtDate(d.date, lang)}</td><td>{d.showed}</td><td>{d.missed}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}