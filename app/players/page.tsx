import { Suspense } from 'react';
import { sql, GENDERS, SKILL_LEVELS, type Lang, type Player, type PlanType } from '@/lib/db';
import { can, canResetPin, requireStaff } from '@/lib/auth';
import { batchName, daysLabel, translator, type Key, type T } from '@/lib/i18n';
import { getBatches } from '@/lib/sessions';
import { fmtDate, istDate } from '@/lib/time';
import { deactivatePlayer, deletePlayer, reactivatePlayer, resetPin, restorePlayer } from '../staff-actions';
import { Submit } from '../ui/Client';
import { initials, Msg, Skeleton, Toolbar } from '../ui/Shared';

// Every player in one place, with filters. Filters live in the URL (a plain GET form), so a filtered view can be
// bookmarked or shared, and every action comes back to the same filters and page.

const PER_PAGE = 20;

const STATUSES = ['active', 'nopin', 'pending', 'pinreq', 'deactivated', 'deleted'] as const;
const PLANS = ['member', 'floater', 'fixed', 'wallet', 'low', 'over', 'none'] as const;
const ROLES = ['staff', 'all'] as const;
const PLAYED = ['7', '30', 'idle', 'never'] as const;
const SORTS = ['new', 'old', 'name', 'recent', 'most'] as const;
type Status = (typeof STATUSES)[number];

type Params = {
  q?: string; status?: string; plan?: string; batch?: string; skill?: string; gender?: string; role?: string;
  from?: string; to?: string; played?: string; sort?: string; page?: string; msg?: string; mv?: string;
};
type Props = { searchParams: Promise<Params> };

type Row = Pick<Player, 'id' | 'first_name' | 'name' | 'phone' | 'email' | 'role' | 'skill_level' | 'gender' | 'created_at'
  | 'approved_at' | 'deactivated_at' | 'deleted_at'> & {
  has_pin: boolean; pin_req: boolean;
  plan_id: number | null; kind: PlanType | null; batch_id: string | null; days: number[] | null;
  sessions_total: number | null; sessions_used: number | null; ends_on: string | null; live: boolean;
  played: number; no_shows: number; last_played: string | null; total: number;
};

const pick = <A extends readonly string[]>(list: A, v?: string) => (list.includes(v ?? '') ? (v as A[number]) : '');
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function Players(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={0} blocks={3} />}>
      <PlayersContent {...props} />
    </Suspense>
  );
}

async function PlayersContent({ searchParams }: Props) {
  const me = await requireStaff('members');
  const t = translator(me.lang);
  const admin = can(me.role, 'staff');
  const params = await searchParams;
  const batches = await getBatches();
  const today = istDate();

  // Only known values get through; anything else is ignored.
  const f = {
    q: (params.q ?? '').trim().slice(0, 60),
    status: (pick(STATUSES, params.status) === 'deleted' && !admin ? '' : pick(STATUSES, params.status)) as Status | '', // deleted: admins only
    plan: pick(PLANS, params.plan),
    batch: batches.some((b) => b.id === params.batch) ? params.batch! : '',
    skill: pick([...SKILL_LEVELS, 'none'] as const, params.skill),
    gender: pick([...GENDERS, 'none'] as const, params.gender),
    role: pick(ROLES, params.role),
    from: isDate(params.from) ? params.from! : '',
    to: isDate(params.to) ? params.to! : '',
    played: pick(PLAYED, params.played),
    sort: pick(SORTS, params.sort) || 'new',
  };
  const page = Math.max(1, Math.trunc(Number(params.page)) || 1);

  const href = (change: Partial<typeof f> & { page?: number }) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, page: undefined, ...change })) {
      if (v && !(k === 'sort' && v === 'new') && !(k === 'page' && v === 1)) u.set(k, String(v));
    }
    const s = u.toString();
    return s ? `/players?${s}` : '/players';
  };
  const here = href({ page });

  // ---------- Query ----------
  // Each call builds a fresh fragment (a fragment can only be used in one query).
  const live = () => sql`(m.id is not null and m.sessions_used < m.sessions_total and (m.ends_on is null or m.ends_on >= ${today}))`;
  const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = f.q.replace(/\D/g, '');
  const filters = () => sql`
    ${f.role === 'staff' ? sql`p.role <> 'player'` : f.role === 'all' ? sql`true` : sql`p.role = 'player'`}
    ${f.q ? sql`and (p.name ilike ${like} or p.email ilike ${like} ${digits.length >= 3 ? sql`or p.phone like ${`%${digits}%`}` : sql``})` : sql``}
    ${f.plan === 'member' ? sql`and ${live()}`
      : f.plan === 'floater' ? sql`and not ${live()}`
      : f.plan === 'fixed' ? sql`and ${live()} and m.kind = 'fixed'`
      : f.plan === 'wallet' ? sql`and ${live()} and m.kind = 'wallet'`
      : f.plan === 'low' ? sql`and ${live()} and m.sessions_total - m.sessions_used <= 3`
      : f.plan === 'over' ? sql`and m.id is not null and not ${live()}`
      : f.plan === 'none' ? sql`and not exists (select 1 from memberships x where x.player_id = p.id)`
      : sql``}
    ${f.batch ? sql`and m.batch_id = ${f.batch}` : sql``}
    ${f.skill === 'none' ? sql`and p.skill_level is null` : f.skill ? sql`and p.skill_level = ${f.skill}` : sql``}
    ${f.gender === 'none' ? sql`and p.gender is null` : f.gender ? sql`and p.gender = ${f.gender}` : sql``}
    ${f.from ? sql`and (p.created_at at time zone 'Asia/Kolkata')::date >= ${f.from}::date` : sql``}
    ${f.to ? sql`and (p.created_at at time zone 'Asia/Kolkata')::date <= ${f.to}::date` : sql``}
    ${f.played === '7' ? sql`and a.last_played >= ${istDate(-7)}::date`
      : f.played === '30' ? sql`and a.last_played >= ${istDate(-30)}::date`
      : f.played === 'idle' ? sql`and a.last_played < ${istDate(-30)}::date`
      : f.played === 'never' ? sql`and a.last_played is null`
      : sql``}`;
  const from = () => sql`
    from players p
    left join memberships m on m.player_id = p.id and m.status = 'active'
    left join lateral (
      select count(*) filter (where b.status = 'present')::int as played,
             count(*) filter (where b.status = 'no_show')::int as no_shows,
             max(s.date) filter (where b.status = 'present') as last_played
      from bookings b join sessions s on s.id = b.session_id where b.player_id = p.id
    ) a on true`;
  const statusSql = (s: Status | '') => {
    switch (s) {
      case 'active': return sql`p.deleted_at is null and p.deactivated_at is null and p.approved_at is not null and p.pin_hash is not null`;
      case 'nopin': return sql`p.deleted_at is null and p.deactivated_at is null and p.approved_at is not null and p.pin_hash is null`;
      case 'pending': return sql`p.deleted_at is null and p.deactivated_at is null and p.approved_at is null`;
      case 'pinreq': return sql`p.deleted_at is null and p.deactivated_at is null and p.pin_reset_requested_at is not null and p.pin_hash is not null`;
      case 'deactivated': return sql`p.deleted_at is null and p.deactivated_at is not null`;
      case 'deleted': return sql`p.deleted_at is not null`;
      default: return sql`p.deleted_at is null`; // "All" never includes deleted players
    }
  };
  const order = {
    new: sql`p.created_at desc, p.id desc`,
    old: sql`p.created_at, p.id`,
    name: sql`lower(p.name), p.id`,
    recent: sql`a.last_played desc nulls last, lower(p.name)`,
    most: sql`coalesce(a.played, 0) desc, lower(p.name)`,
  }[f.sort];

  // One count per status chip, within the other filters.
  const [counts] = await sql<Record<'all' | Status, number>[]>`
    select count(*) filter (where ${statusSql('')})::int as "all",
      count(*) filter (where ${statusSql('active')})::int as active,
      count(*) filter (where ${statusSql('nopin')})::int as nopin,
      count(*) filter (where ${statusSql('pending')})::int as pending,
      count(*) filter (where ${statusSql('pinreq')})::int as pinreq,
      count(*) filter (where ${statusSql('deactivated')})::int as deactivated,
      count(*) filter (where ${statusSql('deleted')})::int as deleted
    ${from()} where ${filters()}`;
  const rows = await sql<Row[]>`
    select p.id, p.first_name, p.name, p.phone, p.email, p.role, p.skill_level, p.gender, p.created_at, p.approved_at,
      p.deactivated_at, p.deleted_at, p.pin_hash is not null as has_pin,
      (p.pin_reset_requested_at is not null and p.pin_hash is not null) as pin_req,
      m.id as plan_id, m.kind, m.batch_id, m.days, m.sessions_total, m.sessions_used, m.ends_on, ${live()} as live,
      coalesce(a.played, 0) as played, coalesce(a.no_shows, 0) as no_shows, a.last_played,
      count(*) over ()::int as total
    ${from()}
    where ${filters()} and ${statusSql(f.status)}
    order by ${order}
    limit ${PER_PAGE} offset ${(page - 1) * PER_PAGE}`;

  const total = rows[0]?.total ?? (f.status ? counts[f.status] : counts.all);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const nameOf = (id: string | null) => {
    const b = batches.find((x) => x.id === id);
    return b ? batchName(t, b) : t('wallet');
  };
  const nFilters = [f.q, f.plan, f.batch, f.skill, f.gender, f.role, f.from || f.to, f.played].filter(Boolean).length;

  return (
    <>
      <Toolbar me={me} t={t} here="/players" lang={me.lang} />
      <Msg t={t} msg={params.msg} mv={params.mv} />

      <div className="hero">
        <div>
          <div className="eyebrow">{t('navPlayers')}</div>
          <h1>{t('playersTitle')}</h1>
        </div>
      </div>

      <form action="/players" method="get" className="card stack filters">
        <div className="search-row">
          <input name="q" type="search" defaultValue={f.q} placeholder={t('searchPlayers')} aria-label={t('searchPlayers')} enterKeyHint="search" />
          <button className="btn-primary">{t('apply')}</button>
        </div>
        {f.status && <input type="hidden" name="status" value={f.status} />}
        <details open={nFilters > (f.q ? 1 : 0)}>
          <summary className="filters-summary">
            {nFilters ? t('filtersN', { n: nFilters }) : t('filters')}
          </summary>
          <div className="filter-grid">
            <label>{t('fPlan')}
              <select name="plan" defaultValue={f.plan}>
                <option value="">{t('any')}</option>
                {PLANS.map((p) => <option key={p} value={p}>{t(`fp_${p}` as Key)}</option>)}
              </select>
            </label>
            <label>{t('fBatch')}
              <select name="batch" defaultValue={f.batch}>
                <option value="">{t('any')}</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{batchName(t, b)}</option>)}
              </select>
            </label>
            <label>{t('skillLevel')}
              <select name="skill" defaultValue={f.skill}>
                <option value="">{t('any')}</option>
                {SKILL_LEVELS.map((s) => <option key={s} value={s}>{t(`skill_${s}`)}</option>)}
                <option value="none">{t('notGiven')}</option>
              </select>
            </label>
            <label>{t('gender')}
              <select name="gender" defaultValue={f.gender}>
                <option value="">{t('any')}</option>
                {GENDERS.map((g) => <option key={g} value={g}>{t(`gender_${g}`)}</option>)}
                <option value="none">{t('notGiven')}</option>
              </select>
            </label>
            <label>{t('fPlayed')}
              <select name="played" defaultValue={f.played}>
                <option value="">{t('any')}</option>
                {PLAYED.map((p) => <option key={p} value={p}>{t(`fpl_${p}` as Key)}</option>)}
              </select>
            </label>
            <label>{t('fRole')}
              <select name="role" defaultValue={f.role}>
                <option value="">{t('fr_player')}</option>
                <option value="staff">{t('fr_staff')}</option>
                <option value="all">{t('fr_all')}</option>
              </select>
            </label>
            <label>{t('fRegFrom')}<input name="from" type="date" defaultValue={f.from} max={today} /></label>
            <label>{t('fRegTo')}<input name="to" type="date" defaultValue={f.to} max={today} /></label>
            <label className="span2">{t('sortBy')}
              <select name="sort" defaultValue={f.sort}>
                {SORTS.map((s) => <option key={s} value={s}>{t(`so_${s}` as Key)}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn-primary">{t('apply')}</button>
            {(nFilters > 0 || f.status || f.sort !== 'new') && <a className="btn btn-ghost" href="/players">{t('clearFilters')}</a>}
          </div>
        </details>
      </form>

      <nav className="chips" aria-label={t('fStatus')}>
        <a href={href({ status: '' })} className={!f.status ? 'on' : ''}>{t('pst_all')} <b>{counts.all}</b></a>
        {STATUSES.filter((s) => s !== 'deleted' || admin).map((s) => (
          <a key={s} href={href({ status: s })} className={f.status === s ? 'on' : ''}>{t(`pst_${s}` as Key)} <b>{counts[s]}</b></a>
        ))}
      </nav>

      <section className="card">
        {rows.length === 0 ? <p className="muted">{t('noPlayersMatch')}</p> : (
          <>
            <p className="muted">{t('showingRange', { from: (page - 1) * PER_PAGE + 1, to: (page - 1) * PER_PAGE + rows.length, n: total })}</p>
            <ul className="list player-list">
              {rows.map((p) => (
                <PlayerRow key={p.id} p={p} t={t} lang={me.lang} nameOf={nameOf} back={here}
                  admin={admin && p.role === 'player' && p.id !== me.id} canReset={canResetPin(me, p)} />
              ))}
            </ul>
          </>
        )}
        {pages > 1 && (
          <nav className="pager" aria-label={t('pageOf', { n: page, of: pages })}>
            {page > 1 ? <a className="btn btn-sm" href={href({ page: page - 1 })}>← {t('prevPage')}</a> : <span />}
            <span className="muted">{t('pageOf', { n: page, of: pages })}</span>
            {page < pages ? <a className="btn btn-sm" href={href({ page: page + 1 })}>{t('nextPage')} →</a> : <span />}
          </nav>
        )}
      </section>
    </>
  );
}

/** 13 Oct 2026, in IST. */
const longDate = (d: Date | string, lang: Lang) =>
  new Date(typeof d === 'string' ? `${d}T12:00:00Z` : d).toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, {
    timeZone: typeof d === 'string' ? 'UTC' : 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
  });

function PlayerRow({ p, t, lang, nameOf, back, admin, canReset }: {
  p: Row; t: T; lang: Lang; nameOf: (id: string | null) => string; back: string; admin: boolean; canReset: boolean;
}) {
  const left = p.plan_id ? p.sessions_total! - p.sessions_used! : 0;
  const state: [Key, string] | null =
    p.deleted_at ? ['pst_deleted', 'bad']
    : p.deactivated_at ? ['pst_deactivated', 'bad']
    : !p.approved_at ? ['pst_pending', 'warn']
    : !p.has_pin ? ['pst_nopin', 'warn']
    : p.pin_req ? ['pst_pinreq', 'warn']
    : null;
  const hidden = (
    <>
      <input type="hidden" name="id" value={p.id} />
      <input type="hidden" name="back" value={back} />
    </>
  );

  return (
    <li>
      <details className="player">
        <summary>
          <span className="person">
            <span className={`av ${p.live ? (p.kind === 'wallet' ? 'wallet' : 'member') : p.deactivated_at ? 'out' : 'floater'}`}>{initials(p.name)}</span>
            <span className="pname">{p.name}<small>{p.phone} · {t('registeredOn', { date: longDate(p.created_at, lang) })}</small></span>
          </span>
          <div className="member-meta">
            {state && <span className={`pill ${state[1]}`}>{t(state[0])}</span>}
            {p.role !== 'player' && <span className="pill red">{t(`role_${p.role}`)}</span>}
            {p.live
              ? <span className={`pill ${p.kind === 'wallet' ? 'blue' : 'ok'}`}>{p.kind === 'wallet' ? t('wallet') : nameOf(p.batch_id)} · {t('left', { n: left })}</span>
              : p.plan_id ? <span className="pill">{t('fp_over')}</span>
              : <span className="pill">{t('floater')}</span>}
            {p.skill_level && <span className="pill">{t(`skill_${p.skill_level}`)}</span>}
            {p.gender && <span className="pill">{t(`gender_${p.gender}`)}</span>}
            <span className="pill">{p.played ? t('playedN', { n: p.played }) : t('neverPlayed')}</span>
          </div>
        </summary>

        <dl className="facts">
          <dt>{t('phone')}</dt><dd><a href={`tel:${p.phone}`}>{p.phone}</a></dd>
          <dt>{t('email')}</dt><dd>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : <span className="faint">{t('notGiven')}</span>}</dd>
          <dt>{t('fRegistered')}</dt><dd>{longDate(p.created_at, lang)}</dd>
          <dt>{t('fPlayed')}</dt>
          <dd>{p.last_played ? fmtDate(p.last_played, lang) : t('neverPlayed')}{p.no_shows ? ` · ${t('noShowsN', { n: p.no_shows })}` : ''}</dd>
          {p.plan_id && (
            <>
              <dt>{t('fPlan')}</dt>
              <dd>
                {p.kind === 'wallet' ? t('walletAnyDay') : `${nameOf(p.batch_id)} · ${daysLabel(t, p.days ?? [])}`}
                {' · '}{t('planLeft', { left, total: p.sessions_total! })}
                {' · '}{p.ends_on ? t('planUntil', { date: fmtDate(p.ends_on, lang) }) : t('noExpiry')}
              </dd>
            </>
          )}
          {p.deactivated_at && !p.deleted_at && <><dt>{t('pst_deactivated')}</dt><dd>{longDate(p.deactivated_at, lang)}</dd></>}
          {p.deleted_at && <><dt>{t('pst_deleted')}</dt><dd>{longDate(p.deleted_at, lang)}</dd></>}
        </dl>

        <div className="row player-actions">
          {!p.approved_at && !p.deleted_at && <a className="btn btn-sm btn-ok" href="/members">{t('approveOnMembers')}</a>}
          {canReset && p.has_pin && !p.deactivated_at && (
            <form action={resetPin}>{hidden}<Submit className="btn-sm btn-ghost">{t('resetPin')}</Submit></form>
          )}
          {admin && p.deactivated_at && !p.deleted_at && (
            <form action={reactivatePlayer}>{hidden}<Submit className="btn-sm btn-ok">{t('reactivate')}</Submit></form>
          )}
          {admin && p.deleted_at && (
            <form action={restorePlayer}>{hidden}<Submit className="btn-sm btn-ok">{t('restore')}</Submit></form>
          )}
        </div>
        {admin && p.deleted_at && <p className="hint">{t('restoreHint')}</p>}
        {admin && !p.deactivated_at && (
          <details className="status-edit">
            <summary>{t('deactivate')}</summary>
            <p className="muted">{t('deactivateHint')}</p>
            <form action={deactivatePlayer}>{hidden}<Submit className="btn-sm btn-danger">{t('deactivateConfirm', { name: p.first_name })}</Submit></form>
          </details>
        )}
        {admin && !p.deleted_at && (
          <details className="status-edit">
            <summary className="danger-summary">{t('deletePlayer')}</summary>
            <p className="muted">{t('deleteHint')}</p>
            <form action={deletePlayer}>{hidden}<Submit className="btn-sm btn-danger">{t('deleteConfirm', { name: p.first_name })}</Submit></form>
          </details>
        )}
      </details>
    </li>
  );
}
