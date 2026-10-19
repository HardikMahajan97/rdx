-- Badminton community schema. Safe to re-run: the bottom half upgrades older databases in place.

create table if not exists batches (
  id                text primary key,            -- 'morning' | 'evening'
  label             text not null,
  start_time        time not null,               -- IST wall-clock time
  duration_min      int  not null default 60,
  courts            int  not null,
  players_per_court int  not null default 4,
  price_rupees      int  not null default 100    -- daily fee for floaters / friends
);

create table if not exists players (
  id         serial primary key,
  first_name text not null,
  last_name  text not null,                      -- 'x' = not given yet (filled in for older accounts)
  -- Display name, kept by Postgres: "First Last", or just "First" while the last name is the 'x' filler.
  name       text generated always as (first_name || coalesce(' ' || nullif(last_name, 'x'), '')) stored,
  phone      text not null unique,               -- 10 digits
  role       text not null default 'player' check (role in ('player', 'core', 'admin')),
  pin_hash   text,                               -- scrypt; core/admin set it on first sign-in
  lang       text not null default 'en' check (lang in ('en', 'mr', 'hi')),
  created_at timestamptz not null default now()
);

-- A paid plan, created by core/admin after collecting payment offline.
--   fixed:  one batch, fixed days of the week. The member can only vote for those.
--   wallet: a balance of sessions usable in any batch on any day.
create table if not exists memberships (
  id             serial primary key,
  player_id      int  not null references players(id),
  kind           text not null default 'fixed' check (kind in ('fixed', 'wallet')),
  batch_id       text references batches(id),    -- null for wallet plans
  days           int[] not null,                 -- days of week covered, 0 = Sun … 6 = Sat (all days for wallet)
  sessions_total int  not null check (sessions_total > 0),
  sessions_used  int  not null default 0,        -- +1 when a booked slot locks (30 min before start)
  starts_on      date not null,
  ends_on        date,                           -- optional hard expiry
  note           text,                           -- e.g. "₹2000 cash to RDX"
  amount_rupees  int,                            -- what was paid, if recorded
  status         text not null default 'active' check (status in ('active', 'ended')),
  created_by     int references players(id),
  created_at     timestamptz not null default now()
);
create unique index if not exists one_active_membership on memberships (player_id) where status = 'active';

-- Every change to a plan's balance, so a wallet can always be explained session by session.
create table if not exists plan_ledger (
  id            serial primary key,
  membership_id int  not null references memberships(id),
  delta         int  not null,                   -- change in sessions left: +n activate/top-up/refund, −1 use
  reason        text not null check (reason in ('activate', 'topup', 'use', 'refund', 'adjust')),
  booking_id    int,
  amount_rupees int,
  note          text,
  by_player     int references players(id),
  created_at    timestamptz not null default now()
);
create index if not exists plan_ledger_membership_idx on plan_ledger (membership_id, created_at desc);

-- pending → quoted (staff told the player what to pay) → approved (plan activated) | rejected
create table if not exists membership_requests (
  id                 serial primary key,
  player_id          int  not null references players(id),
  batch_id           text references batches(id), -- null for wallet requests
  plan               text not null,
  sessions_requested int,
  amount_rupees      int,                          -- quoted by staff
  note               text,
  status             text not null default 'pending',
  handled_by         int references players(id),
  handled_at         timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists sessions (
  id         serial primary key,
  batch_id   text not null references batches(id),
  date       date not null,                      -- IST date
  starts_at  timestamptz not null,
  capacity   int not null,
  locked     boolean not null default false,     -- 30 min before start: no more backing out, plan sessions charged
  closed     boolean not null default false,     -- attendance window over; unconfirmed bookings became no-shows
  cancelled  boolean not null default false,
  unique (batch_id, date)
);

-- booked (voted) → confirmed (coming, from 12 h before) → present (player confirmed they played) | no_show
-- booked/confirmed → withdrawn (backed out, until 30 min before start)
create table if not exists bookings (
  id            serial primary key,
  session_id    int not null references sessions(id),
  player_id     int not null references players(id),
  guests        int not null default 0,          -- friends; always pay the daily fee
  status        text not null default 'booked',
  source        text not null default 'self' check (source in ('self', 'auto')),
  membership_id int references memberships(id),  -- plan that pays for the player's own seat
  charged       boolean not null default false,  -- the plan session has been taken off the balance
  paid          boolean not null default false,  -- daily fee collected by staff
  checked_by    int references players(id),
  confirmed_at  timestamptz,
  attended_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (session_id, player_id)
);
create index if not exists bookings_player_idx on bookings (player_id);

create table if not exists rate_limits (
  key          text primary key,
  count        int not null,
  window_start timestamptz not null
);

-- ---------- Upgrades for databases created by earlier versions ----------

-- One name column → first_name + last_name. The old full name becomes first_name; last_name gets the 'x' filler.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'players' and column_name = 'name' and is_generated = 'NEVER') then
    alter table players rename column name to first_name;
  end if;
end $$;
alter table players add column if not exists last_name text not null default 'x';
alter table players alter column last_name drop default;
alter table players add column if not exists name text
  generated always as (first_name || coalesce(' ' || nullif(last_name, 'x'), '')) stored;

alter table memberships add column if not exists kind text not null default 'fixed';
alter table memberships add column if not exists amount_rupees int;
alter table memberships alter column batch_id drop not null;
alter table memberships drop constraint if exists memberships_kind_check;
alter table memberships add constraint memberships_kind_check check (kind in ('fixed', 'wallet'));

alter table membership_requests add column if not exists sessions_requested int;
alter table membership_requests add column if not exists amount_rupees int;
alter table membership_requests alter column batch_id drop not null;
alter table membership_requests drop constraint if exists membership_requests_plan_check;
alter table membership_requests drop constraint if exists membership_requests_status_check;
update membership_requests set plan = 'wallet' where plan = 'other';
alter table membership_requests add constraint membership_requests_plan_check
  check (plan in ('month', 'weekdays', 'weekends', 'wallet'));
alter table membership_requests add constraint membership_requests_status_check
  check (status in ('pending', 'quoted', 'approved', 'rejected'));
drop index if exists one_pending_request;
create unique index if not exists one_open_request on membership_requests (player_id) where status in ('pending', 'quoted');

alter table sessions add column if not exists locked boolean not null default false;
update sessions set locked = true where not locked and (closed or starts_at < now());

alter table bookings add column if not exists charged boolean not null default false;
alter table bookings add column if not exists confirmed_at timestamptz;
alter table bookings add column if not exists attended_at timestamptz;
alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('booked', 'confirmed', 'withdrawn', 'present', 'no_show'));
-- Old flow: a plan session was used when core ticked the player present.
update bookings set charged = true where membership_id is not null and status = 'present' and not charged;
-- Old flow: members were IN by default. Now everyone votes, so drop untouched future auto-votes.
delete from bookings b using sessions s
  where s.id = b.session_id and b.source = 'auto' and b.status = 'booked' and s.starts_at > now();
