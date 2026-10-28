import { Suspense } from 'react';
import { sql, type Batch, type Player } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, translator, type T } from '@/lib/i18n';
import { getBatches, seatFee } from '@/lib/sessions';
import { fmtTime, istDate, istInstant } from '@/lib/time';
import { removeStaff, resetPin, saveBatch, saveStaff } from '../staff-actions';
import { AutoRefresh } from '../ui/Client';
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
  const batches = await getBatches();
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
      <div>
      <h3>{t('batches')}</h3>
      {batches.map((b) => <BatchForm key={b.id} t={t} batch={b} />)}
      </div>
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
