import { Suspense } from 'react';
import { sql, type Batch, type Player, type Venue } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, translator, type Key, type T } from '@/lib/i18n';
import { getBatches, getVenues, seatFee } from '@/lib/sessions';
import { fmtTime, istDate, istInstant } from '@/lib/time';
import { removeStaff, resetPin, saveBatch, saveStaff, saveVenue } from '../staff-actions';
import { AutoRefresh, Submit } from '../ui/Client';
import { PostsAdmin } from '../ui/PostsAdmin';
import { Msg, Skeleton, Toolbar } from '../ui/Shared';

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
  const batches = await getBatches({ all: true });
  const venues = await getVenues({ all: true });
  const staff = await sql<Player[]>`select * from players where role <> 'player' order by role, name`;
  // The full list, with filters, is on /players; this is just the headline numbers.
  const [n] = await sql<{ active: number; nopin: number; pending: number; deactivated: number; deleted: number }[]>`
    select
      count(*) filter (where deleted_at is null and deactivated_at is null and approved_at is not null and pin_hash is not null)::int as active,
      count(*) filter (where deleted_at is null and deactivated_at is null and approved_at is not null and pin_hash is null)::int as nopin,
      count(*) filter (where deleted_at is null and deactivated_at is null and approved_at is null)::int as pending,
      count(*) filter (where deleted_at is null and deactivated_at is not null)::int as deactivated,
      count(*) filter (where deleted_at is not null)::int as deleted
    from players where role = 'player'`;

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
      </div>

      <h3 id="halls">{t('hallsTitle')}</h3>
      <p className="muted">{t('hallsHint')}</p>
      <div className="cols">
        {venues.map((v) => (
          <section key={v.id} className={`card hall ${v.active ? '' : 'off'}`}>
            <div className="spread">
              <h2>{v.name}</h2>
              <span className="row">
                <span className="pill">{t('nCourts', { n: v.courts })}</span>
                {!v.active && <span className="pill bad">{t('switchedOff')}</span>}
              </span>
            </div>
            {v.address && <p className="muted">{v.address}</p>}
            <ul className="list">
              {batches.filter((b) => b.venue_id === v.id).map((b) => (
                <li key={b.id}>
                  <details>
                    <summary className="batch-summary">
                      <b>{batchName(t, b)}</b>
                      <span className="muted batch-meta">{fmtTime(istInstant(istDate(), b.start_time))} · {t(b.court_numbers.length === 1 ? 'court' : 'courtsLabel')} {b.court_numbers.join(', ')} · ₹{b.price_rupees}/h</span>
                      {!b.active && <span className="pill bad">{t('switchedOff')}</span>}
                    </summary>
                    <BatchForm t={t} batch={b} venues={venues} />
                  </details>
                </li>
              ))}
            </ul>
            <details className="card-nested">
              <summary>＋ {t('addBatchAt', { name: v.name })}</summary>
              <div><BatchForm t={t} venues={venues} venueId={v.id} /></div>
            </details>
            <details className="card-nested">
              <summary>{t('editHall')}</summary>
              <div><VenueForm t={t} venue={v} /></div>
            </details>
          </section>
        ))}
        <details className="card">
          <summary>＋ {t('addHall')}</summary>
          <div style={{ marginTop: 12 }}><VenueForm t={t} /></div>
        </details>
      </div>

      <PostsAdmin />

      <h3>{t('players')}</h3>
      <a className="card players-link" href="/players">
        <span className="spread"><b>{t('allPlayers')}</b><span aria-hidden>→</span></span>
        <span className="member-meta">
          <span className="pill ok">{t('pst_active')} {n.active}</span>
          {n.pending > 0 && <span className="pill warn">{t('pst_pending')} {n.pending}</span>}
          {n.nopin > 0 && <span className="pill warn">{t('pst_nopin')} {n.nopin}</span>}
          {n.deactivated > 0 && <span className="pill bad">{t('pst_deactivated')} {n.deactivated}</span>}
          {n.deleted > 0 && <span className="pill">{t('pst_deleted')} {n.deleted}</span>}
        </span>
      </a>
    </>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon first

/** Add or edit a batch. Every setting a batch has, so new ones need no code. */
function BatchForm({ t, batch, venues, venueId }: { t: T; batch?: Batch; venues: Venue[]; venueId?: number }) {
  const days = batch?.days ?? [0, 1, 2, 3, 4, 5, 6];
  return (
    <form action={saveBatch} className="stack batch-form">
      {batch && <input type="hidden" name="id" value={batch.id} />}
      <div className="grid2">
        <label>{t('batchLabel')}<input name="label" defaultValue={batch?.label ?? ''} maxLength={40} placeholder={t('batchLabelHint')} required /></label>
        <label>{t('hall')}
          <select name="venueId" defaultValue={batch?.venue_id ?? venueId}>
            {venues.filter((v) => v.active || v.id === batch?.venue_id).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label>{t('startTime')}<input name="startTime" type="time" defaultValue={batch?.start_time.slice(0, 5) ?? ''} required /></label>
        <label>{t('durationMin')}<input name="duration" type="number" min="15" max="300" step="5" defaultValue={batch?.duration_min ?? 60} /></label>
      </div>
      <fieldset className="days-pick">
        <legend>{t('runsOn')}</legend>
        {DAYS.map((d) => (
          <label key={d} className="day-check"><input type="checkbox" name="days" value={d} defaultChecked={days.includes(d)} /> {t(`d${d}` as Key)}</label>
        ))}
      </fieldset>
      <div className="grid2">
        <label>{t('courtNumbers')}<input name="courtNumbers" inputMode="numeric" placeholder="1, 2" defaultValue={batch ? (batch.court_numbers.length ? batch.court_numbers : Array.from({ length: batch.courts }, (_, i) => i + 1)).join(', ') : ''} required /></label>
        <label>{t('perCourt')}<input name="playersPerCourt" type="number" min="1" max="12" defaultValue={batch?.players_per_court ?? 4} /></label>
      </div>
      <label>{t('price')}<input name="price" type="number" min="0" defaultValue={batch?.price_rupees ?? 100} /></label>
      {batch && batch.duration_min !== 60 && <p className="muted">{t('perSession', { amount: seatFee(batch), min: batch.duration_min })}</p>}
      {batch && (
        <label className="check-row"><input type="checkbox" name="active" value="1" defaultChecked={batch.active} /> {t('batchOn')}</label>
      )}
      {batch && <p className="hint">{t('batchOffHint')}</p>}
      <Submit className="btn-primary">{batch ? t('save') : t('addBatch')}</Submit>
    </form>
  );
}

/** Add or edit a hall. */
function VenueForm({ t, venue }: { t: T; venue?: Venue }) {
  return (
    <form action={saveVenue} className="stack">
      {venue && <input type="hidden" name="id" value={venue.id} />}
      <label>{t('hallName')}<input name="name" defaultValue={venue?.name ?? ''} maxLength={80} required /></label>
      <label>{t('hallAddress')}<input name="address" defaultValue={venue?.address ?? ''} maxLength={200} /></label>
      <div className="grid2">
        <label>{t('hallMap')}<input name="mapUrl" type="url" defaultValue={venue?.map_url ?? ''} placeholder="https://maps.app.goo.gl/…" /></label>
        <label>{t('hallCourts')}<input name="courts" type="number" min="1" max="99" defaultValue={venue?.courts ?? 6} required /></label>
      </div>
      {venue && <label className="check-row"><input type="checkbox" name="active" value="1" defaultChecked={venue.active} /> {t('hallOn')}</label>}
      {venue && <p className="hint">{t('hallOffHint')}</p>}
      <Submit className="btn-primary">{venue ? t('save') : t('addHall')}</Submit>
    </form>
  );
}
