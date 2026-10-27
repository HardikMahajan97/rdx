import { Suspense } from 'react';
import { sql, type Batch, type Player } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, translator, type Key, type T } from '@/lib/i18n';
import { getBatches, seatFee } from '@/lib/sessions';
import { fmtDate, fmtTime, istDate, istInstant } from '@/lib/time';
import { deactivatePlayer, reactivatePlayer, removeStaff, resetPin, saveBatch, saveStaff } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { PostsAdmin } from '../ui/PostsAdmin';
import { initials, Msg, Skeleton, Toolbar } from '../ui/Shared';

type Props = { searchParams: Promise<{ msg?: string; mv?: string }> };

export default function Admin(props: Props) {
  return (
    <Suspense fallback={<Skeleton tiles={0} blocks={2} />}>
      <AdminContent {...props} />
    </Suspense>
  );
}

async function AdminContent({ searchParams }: Props) {
  const me = await requireStaff('staff');
  const t = translator(me.lang);
  const { msg, mv } = await searchParams;
  const batches = await getBatches();
  const staff = await sql<Player[]>`select * from players where role <> 'player' order by role, name`;
  // Inactive = added but no PIN yet (never signed in, or PIN was reset), or switched off by an admin.
  const people = await sql<Player[]>`select * from players where id <> ${me.id} order by name`;
  const noPin = people.filter((p) => !p.deactivated_at && !p.pin_hash && p.approved_at);
  const waiting = people.filter((p) => !p.deactivated_at && !p.approved_at);
  const deactivated = people.filter((p) => p.deactivated_at);
  const active = people.filter((p) => !p.deactivated_at && p.pin_hash && p.role === 'player');
  const day = (d: Date) => fmtDate(istDate(0, d.getTime()), me.lang);
  const person = (p: Player, sub: React.ReactNode) => (
    <span className="person">
      <span className={`av ${p.deactivated_at ? '' : 'floater'}`}>{initials(p.name)}</span>
      <span className="pname">{p.name}<small><a href={`tel:${p.phone}`}>{p.phone}</a> · {sub}</small></span>
    </span>
  );
  const deactivate = (p: Player) => p.role === 'player' && (
    <details className="status-edit">
      <summary>{t('deactivate')}</summary>
      <p className="muted">{t('deactivateHint')}</p>
      <form action={deactivatePlayer}>
        <input type="hidden" name="id" value={p.id} />
        <Submit className="btn-sm btn-danger">{t('deactivateConfirm', { name: p.first_name })}</Submit>
      </form>
    </details>
  );

  return (
    <>
      <Toolbar me={me} t={t} here="/admin" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />
      <AutoRefresh seconds={30} />

      <div className="cols">
      <div>
      <h3>{t('staff')}</h3>
      <form action={saveStaff} className="card stack">
        <h2>{t('addStaff')}</h2>
        <p className="muted">{t('staffHint')}</p>
        <div className="grid2">
          <label>{t('phone')}<input name="phone" type="tel" inputMode="numeric" required /></label>
        </div>
        <div className="grid2">
          <label>{t('firstName')}<input name="firstName" maxLength={40} /></label>
          <label>{t('lastName')}<input name="lastName" maxLength={40} /></label>
        </div>
        <label>
          {t('role')}
          <select name="role" defaultValue="core">
            <option value="core">{t('role_core')}</option>
            <option value="admin">{t('role_admin')}</option>
          </select>
        </label>
        <button className="btn-primary">{t('save')}</button>
      </form>

      <div className="card">
        <ul className="list">
          {staff.map((s) => (
            <li key={s.id}>
              <div className="spread">
                <span><span className="name">{s.name}</span> <span className="muted">{s.phone}</span></span>
                <span className="row">
                  <span className={`pill ${s.role === 'admin' ? 'warn' : 'ok'}`}>{t(`role_${s.role}`)}</span>
                  {!s.pin_hash && <span className="pill bad">{t('pinNotSet')}</span>}
                  {s.pin_reset_requested_at && <span className="pill warn">{t('pinRequests')}</span>}
                </span>
              </div>
              {s.id !== me.id && (
                <div className="row" style={{ marginTop: 8 }}>
                  <form action={saveStaff}>
                    <input type="hidden" name="phone" value={s.phone} />
                    <input type="hidden" name="role" value={s.role === 'admin' ? 'core' : 'admin'} />
                    <button className="btn-sm btn-ghost">→ {t(s.role === 'admin' ? 'role_core' : 'role_admin')}</button>
                  </form>
                  {s.pin_hash && (
                    <form action={resetPin}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="back" value="/admin" />
                      <button className="btn-sm btn-ghost">{t('resetPin')}</button>
                    </form>
                  )}
                  <form action={removeStaff}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn-sm btn-danger">{t('removeStaff')}</button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      </div>
      <div>
      <h3>{t('batches')}</h3>
      {batches.map((b) => <BatchForm key={b.id} t={t} batch={b} />)}
      </div>
      </div>

      <PostsAdmin />

      <h3>{t('players')}</h3>
      <div className="cols">
        <section className="card">
          <h2>{t('inactiveUsers')} <span className="muted">({noPin.length + deactivated.length + waiting.length})</span></h2>
          <p className="muted">{t('inactiveHint')}</p>
          {noPin.length + deactivated.length + waiting.length === 0 && <p className="muted">{t('noInactive')}</p>}
          {waiting.length > 0 && <a className="status warn" href="/members">{t('signupsCount', { n: waiting.length })} →</a>}
          {noPin.length > 0 && <div className="eyebrow">{t('noPinYet')}</div>}
          <ul className="list">
            {noPin.map((p) => (
              <li key={p.id}>
                <div className="spread" style={{ flexWrap: 'nowrap' }}>
                  {person(p, t('addedOn', { date: day(p.created_at) }))}
                  <span className="pill warn">{p.role === 'player' ? t('pinNotSet') : t(`role_${p.role}` as Key)}</span>
                </div>
                {deactivate(p)}
              </li>
            ))}
          </ul>
          {deactivated.length > 0 && <div className="eyebrow">{t('deactivatedList')}</div>}
          <ul className="list">
            {deactivated.map((p) => (
              <li key={p.id} className="spread" style={{ flexWrap: 'nowrap' }}>
                {person(p, t('deactivatedOn', { date: day(p.deactivated_at!) }))}
                <form action={reactivatePlayer}>
                  <input type="hidden" name="id" value={p.id} />
                  <Submit className="btn-sm btn-ok">{t('reactivate')}</Submit>
                </form>
              </li>
            ))}
          </ul>
        </section>
        <details className="card">
          <summary>{t('activePlayers')} <span className="muted">({active.length})</span></summary>
          <ul className="list">
            {active.map((p) => (
              <li key={p.id}>
                {person(p, t('addedOn', { date: day(p.created_at) }))}
                {deactivate(p)}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </>
  );
}

function BatchForm({ t, batch }: { t: T; batch: Batch }) {
  return (
    <form action={saveBatch} className="card stack">
      <input type="hidden" name="id" value={batch.id} />
      <h2>{batchName(t, batch)} · {fmtTime(istInstant(istDate(), batch.start_time))}</h2>
      <div className="grid2">
        <label>{t('courtNumbers')}<input name="courtNumbers" inputMode="numeric" placeholder="1, 2" defaultValue={(batch.court_numbers.length ? batch.court_numbers : Array.from({ length: batch.courts }, (_, i) => i + 1)).join(', ')} required /></label>
        <label>{t('perCourt')}<input name="playersPerCourt" type="number" min="1" defaultValue={batch.players_per_court} /></label>
        <label>{t('price')}<input name="price" type="number" min="0" defaultValue={batch.price_rupees} /></label>
      </div>
      {batch.duration_min !== 60 && <p className="muted">{t('perSession', { amount: seatFee(batch), min: batch.duration_min })}</p>}
      <button>{t('save')}</button>
    </form>
  );
}
