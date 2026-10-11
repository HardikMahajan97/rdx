import postgres from 'postgres';

const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

// Keep `date` columns as 'YYYY-MM-DD' strings so IST dates never shift.
export const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL!, {
    max: 5,
    types: {
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForDb.sql = sql;

export type Tx = postgres.TransactionSql;

export type Role = 'player' | 'core' | 'admin';
export type Lang = 'en' | 'mr' | 'hi';

export type Player = {
  id: number;
  name: string;
  phone: string;
  role: Role;
  pin_hash: string | null;
  lang: Lang;
};

export type Batch = {
  id: string;
  label: string;
  start_time: string; // 'HH:MM:SS' IST
  duration_min: number;
  courts: number;
  players_per_court: number;
  price_rupees: number;
};

export type Session = {
  id: number;
  batch_id: string;
  date: string;
  starts_at: Date;
  capacity: number;
  closed: boolean;
  cancelled: boolean;
};

export type Membership = {
  id: number;
  player_id: number;
  batch_id: string;
  days: number[];
  sessions_total: number;
  sessions_used: number;
  starts_on: string;
  ends_on: string | null;
  note: string | null;
  status: 'active' | 'ended';
};

export type PlanKind = 'month' | 'weekdays' | 'weekends' | 'other';

export type BookingStatus = 'booked' | 'withdrawn' | 'present' | 'no_show';

export type Booking = {
  id: number;
  session_id: number;
  player_id: number;
  guests: number;
  status: BookingStatus;
  source: 'self' | 'auto';
  membership_id: number | null;
  paid: boolean;
};
