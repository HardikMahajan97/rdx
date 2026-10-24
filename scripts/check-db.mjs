// Read-only health check: is this database ready for the current app? Run: npm run db:check (local) / db:check:prod (Neon)
// Prints ✓ ok, ! warning, ✗ missing. Exits 1 if anything required is missing. Never writes.
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('✗ DATABASE_URL is not set'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const bad = (m) => { failed++; console.log(`  ✗ ${m}`); };
const check = (cond, good, missing) => (cond ? ok(good) : bad(missing));

const REQUIRED = {
  batches: ['id', 'label', 'start_time', 'duration_min', 'courts', 'players_per_court', 'price_rupees'],
  players: ['id', 'first_name', 'last_name', 'name', 'phone', 'role', 'pin_hash', 'pin_reset_requested_at', 'deactivated_at', 'lang'],
  memberships: ['id', 'player_id', 'kind', 'batch_id', 'days', 'sessions_total', 'sessions_used', 'starts_on', 'ends_on', 'amount_rupees', 'status'],
  plan_ledger: ['id', 'membership_id', 'delta', 'reason', 'booking_id', 'amount_rupees', 'by_player'],
  membership_requests: ['id', 'player_id', 'batch_id', 'plan', 'sessions_requested', 'amount_rupees', 'status'],
  sessions: ['id', 'batch_id', 'date', 'starts_at', 'capacity', 'locked', 'closed', 'cancelled'],
  bookings: ['id', 'session_id', 'player_id', 'guests', 'status', 'membership_id', 'charged', 'paid', 'confirmed_at', 'attended_at'],
  rate_limits: ['key', 'count', 'window_start'],
};

try {
  const host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
  console.log(`\nDatabase: ${host}\n`);

  console.log('Connection');
  const [{ version }] = await sql`select version()`;
  ok(version.split(' ').slice(0, 2).join(' '));
  if (host.includes('neon.tech')) {
    check(/sslmode=require/.test(url), 'SSL required in the connection string', 'add ?sslmode=require to DATABASE_URL');
    if (host.includes('-pooler')) ok('using the pooled endpoint (right for Vercel)');
    else warn('not the pooled endpoint; use the "-pooler" host on Vercel');
  }

  console.log('\nTables and columns');
  const cols = await sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`;
  if (!Object.keys(REQUIRED).some((t) => cols.some((c) => c.table_name === t))) {
    bad('empty database: none of the app tables exist yet');
    console.log('\n✗ Run the matching db:setup (db:setup:prod for Neon) to create everything, then check again.\n');
    await sql.end();
    process.exit(1);
  }
  for (const [table, need] of Object.entries(REQUIRED)) {
    const have = new Set(cols.filter((c) => c.table_name === table).map((c) => c.column_name));
    if (have.size === 0) { bad(`${table}: table missing`); continue; }
    const missing = need.filter((c) => !have.has(c));
    check(missing.length === 0, table, `${table}: missing ${missing.join(', ')}`);
  }
  const nullable = (t, c) => cols.find((x) => x.table_name === t && x.column_name === c)?.is_nullable === 'YES';
  check(nullable('memberships', 'batch_id'), 'wallet plans allowed (memberships.batch_id nullable)', 'memberships.batch_id is still NOT NULL');
  check(nullable('membership_requests', 'batch_id'), 'wallet requests allowed (membership_requests.batch_id nullable)', 'membership_requests.batch_id is still NOT NULL');

  console.log('\nRules (constraints and indexes)');
  const cons = await sql`
    select conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and contype = 'c'`;
  const def = (n) => cons.find((c) => c.conname === n)?.def ?? '';
  check(def('bookings_status_check').includes('confirmed'), "bookings accept 'confirmed'", "bookings_status_check doesn't allow 'confirmed'");
  check(def('membership_requests_plan_check').includes('wallet'), "requests accept 'wallet'", "membership_requests_plan_check doesn't allow 'wallet'");
  check(def('membership_requests_status_check').includes('quoted'), "requests accept 'quoted'", "membership_requests_status_check doesn't allow 'quoted'");
  check(!!def('memberships_kind_check'), 'plan kinds limited to fixed / wallet', 'memberships_kind_check missing');
  const idx = new Set((await sql`select indexname from pg_indexes where schemaname = 'public'`).map((r) => r.indexname));
  check(idx.has('one_active_membership'), 'one active plan per player', 'index one_active_membership missing');
  check(idx.has('one_open_request'), 'one open request per player', 'index one_open_request missing');
  check(!idx.has('one_pending_request'), 'old one_pending_request index removed', 'old index one_pending_request still there (blocks quoted requests)');

  if (failed === 0) {
    console.log('\nData');
    const batches = await sql`select id, courts, players_per_court, price_rupees from batches order by start_time`;
    check(batches.length > 0, `batches: ${batches.map((b) => `${b.id} (${b.courts} courts, ₹${b.price_rupees})`).join(', ')}`, 'no batches; run db:setup');
    const staff = await sql`select role, count(*)::int as n, count(pin_hash)::int as pins from players where role <> 'player' group by role`;
    const admins = staff.find((s) => s.role === 'admin');
    check(!!admins, `admins: ${admins?.n ?? 0}, core: ${staff.find((s) => s.role === 'core')?.n ?? 0}`, 'no admin; set ADMIN_PHONE and run db:setup');
    for (const s of staff) if (s.pins < s.n) warn(`${s.n - s.pins} ${s.role} account(s) haven't set a PIN yet (they do it at first sign-in)`);
    const [{ other }] = await sql`select count(*)::int as other from membership_requests where plan = 'other'`;
    check(other === 0, "no leftover 'other' plan requests", `${other} request(s) still use the old 'other' plan`);
    const [{ auto }] = await sql`
      select count(*)::int as auto from bookings b join sessions s on s.id = b.session_id
      where b.source = 'auto' and b.status = 'booked' and s.starts_at > now()`;
    check(auto === 0, 'no future auto-votes (everyone votes now)', `${auto} future auto-vote(s) left from the old flow`);
    const [{ players, plans, wallets }] = await sql`
      select (select count(*) from players)::int as players,
        (select count(*) from memberships where status = 'active')::int as plans,
        (select count(*) from memberships where status = 'active' and kind = 'wallet')::int as wallets`;
    ok(`${players} players, ${plans} active plans (${wallets} wallets)`);
  }

  console.log('\nApp settings (this shell)');
  const secret = process.env.SESSION_SECRET ?? '';
  check(secret.length >= 32 && !secret.startsWith('change-me'), 'SESSION_SECRET looks strong', 'SESSION_SECRET missing, too short, or still the example value');
} catch (e) {
  bad(`could not check: ${e.message}`);
} finally {
  await sql.end();
}

console.log(failed ? `\n✗ ${failed} problem(s). Run the matching db:setup, then check again.\n` : '\n✓ Ready.\n');
process.exit(failed ? 1 : 0);
