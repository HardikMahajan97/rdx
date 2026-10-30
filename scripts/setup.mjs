// Creates tables, default batches, and the first admin/core accounts. Run: npm run db:setup
// Admin and core set their own PIN the first time they sign in.
//
// Safe to rerun on a live database. For the ADMIN_* / CORE_* accounts it only ever:
//   - creates the account if the number isn't there yet;
//   - raises the role (player → core → admin), never lowers it, so someone promoted to admin in the app stays admin;
//   - fills in the name from .env only while the account still has a placeholder name ("Admin", "Core member", or empty).
// It never touches PINs, and never changes a real name someone has set.
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} }); // "already exists, skipping" notices are expected on re-runs
await sql.file(new URL('../db/schema.sql', import.meta.url).pathname);

// The two first batches, at the first hall (only on a new database; admins add more from the Admin page).
await sql`
  insert into batches (id, label, start_time, courts, court_numbers, venue_id)
  select x.id, x.label, x.start_time::time, x.courts, x.court_numbers::int[], (select min(id) from venues)
  from (values ('morning', 'Morning', '07:00', 2, '{1,2}'), ('evening', 'Evening', '19:00', 3, '{4,5,6}'))
    as x(id, label, start_time, courts, court_numbers)
  where not exists (select 1 from batches)
  on conflict (id) do nothing`;

const RANK = { player: 0, core: 1, admin: 2 };
const PLACEHOLDER_NAMES = ['', 'admin', 'core', 'core member'];

for (const [role, phone, name] of [
  ['admin', process.env.ADMIN_PHONE, process.env.ADMIN_NAME || 'Admin'],
  ['core', process.env.CORE_PHONE, process.env.CORE_NAME || 'Core member'],
]) {
  if (!phone) continue;
  // ADMIN_NAME / CORE_NAME: first word is the first name, the rest the last name ('x' if none).
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(' ') || 'x';

  const [existing] = await sql`select id, first_name, last_name, name, role from players where phone = ${phone}`;
  if (!existing) {
    await sql`
      insert into players (first_name, last_name, phone, role, approved_at)
      values (${first}, ${last}, ${phone}, ${role}, now())
      on conflict (phone) do nothing`;
    console.log(`${role}: ${phone} added as ${name} (sets PIN on first sign-in)`);
    continue;
  }

  const newRole = RANK[role] > RANK[existing.role] ? role : existing.role;
  const placeholder = existing.last_name === 'x' && PLACEHOLDER_NAMES.includes(existing.first_name.trim().toLowerCase());
  const rename = placeholder && `${first} ${last}` !== `${existing.first_name} ${existing.last_name}`;
  await sql`
    update players set role = ${newRole}, approved_at = coalesce(approved_at, now()),
      first_name = ${rename ? first : existing.first_name}, last_name = ${rename ? last : existing.last_name}
    where id = ${existing.id}`;

  const notes = [];
  notes.push(newRole === existing.role ? `role kept: ${existing.role}` : `role raised: ${existing.role} → ${newRole}`);
  if (rename) notes.push(`name: ${existing.name} → ${name.trim()}`);
  console.log(`${role}: ${phone} already there (${notes.join(', ')})`);
}
console.log('Database ready');
await sql.end();
