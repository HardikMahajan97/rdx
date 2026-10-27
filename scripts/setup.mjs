// Creates tables, default batches, and the first admin/core accounts. Run: npm run db:setup
// Admin and core set their own PIN the first time they sign in.
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} }); // "already exists, skipping" notices are expected on re-runs
await sql.file(new URL('../db/schema.sql', import.meta.url).pathname);

await sql`
  insert into batches (id, label, start_time, courts, court_numbers) values
    ('morning', 'Morning', '07:00', 2, '{1,2}'),
    ('evening', 'Evening', '19:00', 3, '{4,5,6}')
  on conflict (id) do nothing`;

for (const [role, phone, name] of [
  ['admin', process.env.ADMIN_PHONE, process.env.ADMIN_NAME || 'Admin'],
  ['core', process.env.CORE_PHONE, process.env.CORE_NAME || 'Core member'],
]) {
  if (!phone) continue;
  // ADMIN_NAME / CORE_NAME: first word is the first name, the rest the last name ('x' if none).
  const [first, ...rest] = name.trim().split(/\s+/);
  await sql`
    insert into players (first_name, last_name, phone, role, approved_at) values (${first}, ${rest.join(' ') || 'x'}, ${phone}, ${role}, now())
    on conflict (phone) do update set role = excluded.role, approved_at = coalesce(players.approved_at, now())`;
  console.log(`${role}: ${phone} (sets PIN on first sign-in)`);
}
console.log('Database ready');
await sql.end();
