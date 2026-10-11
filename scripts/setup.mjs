// Creates tables, default batches, and the first admin/core accounts. Run: npm run db:setup
// Admin and core set their own PIN the first time they sign in.
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);
await sql.file(new URL('../db/schema.sql', import.meta.url).pathname);

await sql`
  insert into batches (id, label, start_time, courts) values
    ('morning', 'Morning', '07:00', 2),
    ('evening', 'Evening', '19:00', 3)
  on conflict (id) do nothing`;

for (const [role, phone, name] of [
  ['admin', process.env.ADMIN_PHONE, process.env.ADMIN_NAME || 'Admin'],
  ['core', process.env.CORE_PHONE, process.env.CORE_NAME || 'Core member'],
]) {
  if (!phone) continue;
  await sql`
    insert into players (name, phone, role) values (${name}, ${phone}, ${role})
    on conflict (phone) do update set role = excluded.role`;
  console.log(`${role}: ${phone} (sets PIN on first sign-in)`);
}
console.log('Database ready');
await sql.end();
