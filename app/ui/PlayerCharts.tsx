import type { Batch, Lang } from '@/lib/db';
import { batchName, type Key, type T } from '@/lib/i18n';
import { GROUPS, playerMix, type PlayerGroup } from '@/lib/stats';
import { ChartTips } from './ChartTip';

// Player dashboards. Colours follow the group everywhere (validated for the dark card surface, adjacent order):
// fixed-plan members red, wallet members blue, floaters yellow. Every chart has a legend, labels where they fit,
// a tap/hover readout and a table view, so colour is never the only way to read it.

type Row = { key: string; label: string; href?: string; values: Record<PlayerGroup, number> };

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function Legend({ t, total }: { t: T; total?: Record<PlayerGroup, number> }) {
  return (
    <ul className="legend-keys">
      {GROUPS.map((g) => (
        <li key={g}><i className={`key s-${g}`} />{t(`grp_${g}` as Key)}{total && <b>{total[g]}</b>}</li>
      ))}
    </ul>
  );
}

/** One bar per row, split into the three groups. Bars share one scale, so rows compare by length too. */
function StackedRows({ t, rows, caption }: { t: T; rows: Row[]; caption: string }) {
  const max = Math.max(1, ...rows.map((r) => GROUPS.reduce((n, g) => n + r.values[g], 0)));
  return (
    <>
      <div className="hbars">
        {rows.map((r) => {
          const sum = GROUPS.reduce((n, g) => n + r.values[g], 0);
          const parts = GROUPS.filter((g) => r.values[g] > 0);
          const Label = r.href ? 'a' : 'span';
          return (
            <div key={r.key} className="hbar-row">
              <Label className="hbar-label" {...(r.href ? { href: r.href } : {})}>{r.label}</Label>
              <div className="hbar-track">
                <div className="hbar" style={{ width: `${(sum / max) * 100}%` }}>
                  {parts.map((g) => (
                    <span key={g} className={`part s-${g}`} style={{ flexGrow: r.values[g] }} tabIndex={0}
                      data-tip={`${r.label} · ${t(`grp_${g}` as Key)}`} data-tip-value={String(r.values[g])}
                      aria-label={`${r.label}, ${t(`grp_${g}` as Key)}: ${r.values[g]}`}>
                      {/* a number inside only when the piece is wide enough for it */}
                      {(r.values[g] / max) * 100 >= 12 && <em>{r.values[g]}</em>}
                    </span>
                  ))}
                </div>
                <b className="hbar-total">{sum}</b>
              </div>
            </div>
          );
        })}
      </div>
      <TableView t={t} rows={rows} caption={caption} />
    </>
  );
}

function TableView({ t, rows, caption }: { t: T; rows: Row[]; caption: string }) {
  return (
    <details className="table-view">
      <summary>{t('tableView')}</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col" /> {GROUPS.map((g) => <th key={g} scope="col">{t(`grp_${g}` as Key)}</th>)}<th scope="col">{t('total')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}><th scope="row">{r.label}</th>{GROUPS.map((g) => <td key={g}>{r.values[g]}</td>)}<td>{GROUPS.reduce((n, g) => n + r.values[g], 0)}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export async function PlayerCharts({ t, lang, batches }: { t: T; lang: Lang; batches: Batch[] }) {
  const mix = await playerMix();
  const all = GROUPS.reduce((n, g) => n + mix.total[g], 0);
  const skillOrder = ['advanced', 'intermediate', 'basic', 'none'];
  const genderOrder = ['female', 'male', 'other', 'none'];
  const groupHref: Record<PlayerGroup, string> = { fixed: 'plan=fixed', wallet: 'plan=wallet', floater: 'plan=floater' };

  const skillRows: Row[] = skillOrder.filter((k) => mix.bySkill.has(k)).map((k) => ({
    key: k, label: k === 'none' ? t('notGiven') : t(`skill_${k}` as Key), href: `/players?skill=${k}`, values: mix.bySkill.get(k)!,
  }));
  const genderRows: Row[] = genderOrder.filter((k) => mix.byGender.has(k)).map((k) => ({
    key: k, label: k === 'none' ? t('notGiven') : t(`gender_${k}` as Key), href: `/players?gender=${k}`, values: mix.byGender.get(k)!,
  }));
  const fixedBatches = batches.filter((b) => mix.byBatch.has(b.id) || b.active);
  const maxBatch = Math.max(1, ...fixedBatches.map((b) => mix.byBatch.get(b.id) ?? 0));
  const maxMonth = Math.max(1, ...mix.months.map((m) => m.n));
  const month = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { timeZone: 'UTC', month: 'short' });

  return (
    <ChartTips>
      <div className="cols">
        <section className="card chart-card">
          <h2>{t('whoPlays')}</h2>
          <p className="muted">{t('whoPlaysHint', { n: all })}</p>
          {/* Part-to-whole: one bar, the three groups. */}
          <div className="mix-bar" role="img" aria-label={GROUPS.map((g) => `${t(`grp_${g}` as Key)} ${mix.total[g]}`).join(', ')}>
            {GROUPS.filter((g) => mix.total[g] > 0).map((g) => (
              <a key={g} href={`/players?${groupHref[g]}`} className={`part s-${g}`} style={{ flexGrow: mix.total[g] }}
                data-tip={t(`grp_${g}` as Key)} data-tip-value={`${mix.total[g]} · ${pct(mix.total[g], all)}%`}>
                {pct(mix.total[g], all) >= 14 && <em>{pct(mix.total[g], all)}%</em>}
              </a>
            ))}
          </div>
          <Legend t={t} total={mix.total} />
          <div className="mini-tiles activity">
            <div><b>{mix.activity.recent}</b><span>{t('playedLast30')}</span></div>
            <div><b>{mix.activity.idle}</b><span>{t('notLately')}</span></div>
            <div><b>{mix.activity.never}</b><span>{t('fpl_never')}</span></div>
          </div>
        </section>

        <section className="card chart-card">
          <h2>{t('bySkill')}</h2>
          <Legend t={t} />
          <StackedRows t={t} rows={skillRows} caption={t('bySkill')} />
        </section>

        <section className="card chart-card">
          <h2>{t('byGender')}</h2>
          <Legend t={t} />
          <StackedRows t={t} rows={genderRows} caption={t('byGender')} />
        </section>

        <section className="card chart-card">
          <h2>{t('membersByBatch')}</h2>
          <p className="muted">{t('membersByBatchHint')}</p>
          <div className="hbars">
            {fixedBatches.map((b) => {
              const n = mix.byBatch.get(b.id) ?? 0;
              const name = b.multi_venue ? `${batchName(t, b)} · ${b.venue_name}` : batchName(t, b);
              return (
                <div key={b.id} className="hbar-row">
                  <a className="hbar-label" href={`/players?plan=fixed&batch=${b.id}`}>{name}</a>
                  <div className="hbar-track">
                    {n > 0 && <div className="hbar" style={{ width: `${(n / maxBatch) * 100}%` }}>
                      <span className="part s-fixed" style={{ flexGrow: 1 }} tabIndex={0} data-tip={name} data-tip-value={String(n)} aria-label={`${name}: ${n}`} />
                    </div>}
                    <b className="hbar-total">{n}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card chart-card">
          <h2>{t('newPlayers')}</h2>
          <p className="muted">{t('newPlayersHint')}</p>
          {/* One series over time: columns, value on the cap. */}
          <div className="cols-chart" role="img" aria-label={mix.months.map((m) => `${month(m.ym)} ${m.n}`).join(', ')}>
            {mix.months.map((m) => (
              <div key={m.ym} className="col-slot" tabIndex={0} data-tip={month(m.ym)} data-tip-value={String(m.n)}>
                <b>{m.n}</b>
                <span className="col" style={{ height: `${(m.n / maxMonth) * 100}%` }} />
                <small>{month(m.ym)}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ChartTips>
  );
}
