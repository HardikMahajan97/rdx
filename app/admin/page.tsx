import { Suspense } from 'react';
import { sql, type Batch, type Player } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import { batchName, translator, type T } from '@/lib/i18n';
import { getBatches } from '@/lib/sessions';
import { fmtTime, istDate, istInstant } from '@/lib/time';
import { removeStaff, resetPin, saveBatch, saveStaff } from '../staff-actions';
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

  return (
    <>
      <Toolbar me={me} t={t} here="/admin" lang={me.lang} />
      <Msg t={t} msg={msg} mv={mv} />

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
    </>
  );
}

function BatchForm({ t, batch }: { t: T; batch: Batch }) {
  return (
    <form action={saveBatch} className="card stack">
      <input type="hidden" name="id" value={batch.id} />
      <h2>{batchName(t, batch)} · {fmtTime(istInstant(istDate(), batch.start_time))}</h2>
      <div className="grid2">
        <label>{t('courts')}<input name="courts" type="number" min="0" defaultValue={batch.courts} /></label>
        <label>{t('perCourt')}<input name="playersPerCourt" type="number" min="1" defaultValue={batch.players_per_court} /></label>
        <label>{t('price')}<input name="price" type="number" min="0" defaultValue={batch.price_rupees} /></label>
      </div>
      <button>{t('save')}</button>
    </form>
  );
}
