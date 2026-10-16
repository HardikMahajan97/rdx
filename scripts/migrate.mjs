#!/usr/bin/env node
/**
 * Migrate local database → Neon
 * Usage:
 *   # 1. Dump from local
 *   node scripts/migrate.mjs dump --source=local --out=dump.sql
 *
 *   # 2. Restore to Neon (run against Neon DB)
 *   node scripts/migrate.mjs restore --target=neon --in=dump.sql
 *
 *   # Or one-shot (pipe): dump local → restore neon
 *   node scripts/migrate.mjs dump --source=local | node scripts/migrate.mjs restore --target=neon
 *
 * Env vars:
 *   LOCAL_DATABASE_URL   - local Postgres (default: postgresql://postgres:postgres@localhost:5432/badminton)
 *   NEON_DATABASE_URL    - Neon connection string (required for restore)
 */

import postgres from 'postgres';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- Config ----
const LOCAL_URL = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/badminton';
const NEON_URL = process.env.NEON_DATABASE_URL;

const TABLES_IN_ORDER = [
  'batches',
  'players',
  'memberships',
  'plan_ledger',
  'membership_requests',
  'sessions',
  'bookings',
  'rate_limits',
];

const TABLES_REVERSE = [...TABLES_IN_ORDER].reverse();

function connect(url: string) {
  return postgres(url, {
    max: 5,
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

async function dump(sql: postgres.Sql, outStream: NodeJS.WritableStream) {
  console.error('📦 Dumping data from local...');
  
  // Disable triggers/constraints temporarily
  outStream.write('SET session_replication_role = replica;\n\n');
  
  for (const table of TABLES_IN_ORDER) {
    const rows = await sql`select * from ${sql(table)} order by 1`;
    if (rows.length === 0) {
      console.error(`  ${table}: 0 rows (skipped)`);
      continue;
    }
    
    console.error(`  ${table}: ${rows.length} rows`);
    
    // Build INSERT statements
    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    
    outStream.write(`-- ${table}: ${rows.length} rows\n`);
    outStream.write(`DELETE FROM "${table}";\n`);
    
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const values = chunk.map(row => 
        '(' + cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
          if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
          if (v instanceof Date) return "'" + v.toISOString() + "'";
          if (Array.isArray(v)) return 'ARRAY[' + v.map(x => typeof x === 'string' ? "'" + x.replace(/'/g, "''") + "'" : x).join(',') + ']';
          return v;
        }).join(', ') + ')'
      ).join(',\n');
      
      outStream.write(`INSERT INTO "${table}" (${colList}) VALUES\n${values};\n\n`);
    }
  }
  
  // Reset sequences
  outStream.write(`-- Reset sequences\n`);
  outStream.write(`SELECT setval('players_id_seq', (SELECT COALESCE(MAX(id), 0) FROM players));\n`);
  outStream.write(`SELECT setval('memberships_id_seq', (SELECT COALESCE(MAX(id), 0) FROM memberships));\n`);
  outStream.write(`SELECT setval('plan_ledger_id_seq', (SELECT COALESCE(MAX(id), 0) FROM plan_ledger));\n`);
  outStream.write(`SELECT setval('membership_requests_id_seq', (SELECT COALESCE(MAX(id), 0) FROM membership_requests));\n`);
  outStream.write(`SELECT setval('sessions_id_seq', (SELECT COALESCE(MAX(id), 0) FROM sessions));\n`);
  outStream.write(`SELECT setval('bookings_id_seq', (SELECT COALESCE(MAX(id), 0) FROM bookings));\n`);
  
  outStream.write('\nSET session_replication_role = DEFAULT;\n');
  console.error('✅ Dump complete');
}

async function restore(sql: postgres.Sql, input: string) {
  console.error('📥 Restoring to Neon...');
  await sql.begin(async (tx) => {
    // Split by semicolon (naive but works for our generated SQL)
    const statements = input
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));
    
    for (const stmt of statements) {
      if (!stmt) continue;
      try {
        await tx.unsafe(stmt + ';');
      } catch (e) {
        console.error(`❌ Failed: ${stmt.slice(0, 80)}...`);
        throw e;
      }
    }
  });
  console.error('✅ Restore complete');
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (cmd === 'dump') {
    const source = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'local';
    const outFile = args.find(a => a.startsWith('--out='))?.split('=')[1];
    
    const sql = connect(source === 'local' ? LOCAL_URL : NEON_URL!);
    const out = outFile ? fs.createWriteStream(resolve(ROOT, outFile)) : process.stdout;
    
    try {
      await dump(sql, out);
    } finally {
      await sql.end();
      if (outFile) out.end();
    }
  }
  else if (cmd === 'restore') {
    if (!NEON_URL) {
      console.error('❌ NEON_DATABASE_URL not set');
      process.exit(1);
    }
    const inFile = args.find(a => a.startsWith('--in='))?.split('=')[1];
    const target = args.find(a => a.startsWith('--target='))?.split('=')[1] || 'neon';
    
    const sql = connect(NEON_URL);
    const input = inFile 
      ? fs.readFileSync(resolve(ROOT, inFile), 'utf-8')
      : fs.readFileSync(0, 'utf-8'); // stdin
    
    try {
      await restore(sql, input);
    } finally {
      await sql.end();
    }
  }
  else {
    console.error(`
Usage:
  # Dump local data to file
  node scripts/migrate.mjs dump --source=local --out=dump.sql

  # Restore from file to Neon
  node scripts/migrate.mjs restore --target=neon --in=dump.sql

  # One-shot pipe (local → neon)
  node scripts/migrate.mjs dump --source=local | node scripts/migrate.mjs restore --target=neon

Env:
  LOCAL_DATABASE_URL   (default: postgresql://postgres:postgres@localhost:5432/badminton)
  NEON_DATABASE_URL    (required for restore)
`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });