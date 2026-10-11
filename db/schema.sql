-- Badminton community schema. Safe to re-run.

create table if not exists batches (
  id                text primary key,            -- 'morning' | 'evening'
  label             text not null,
  start_time        time not null,               -- IST wall-clock time
  duration_min      int  not null default 60,
  courts            int  not null,
  players_per_court int  not null default 4,
  price_rupees      int  not null default 100    -- daily fee for floaters / friends / off-day visits
);

create table if not exists players (
  id         serial primary key,
  name       text not null,
  phone      text not null unique,               -- 10 digits
  role       text not null default 'player' check (role in ('player', 'core', 'admin')),
  pin_hash   text,                               -- scrypt; core/admin set it on first sign-in
  lang       text not null default 'en' check (lang in ('en', 'mr', 'hi')),
  created_at timestamptz not null default now()
);

-- A paid plan, created by core/admin after collecting payment offline.
create table if not exists memberships (
  id             serial primary key,
  player_id      int  not null references players(id),
  batch_id       text not null references batches(id),
  days           int[] not null,                 -- days of week covered, 0 = Sun … 6 = Sat
  sessions_total int  not null check (sessions_total > 0),
  sessions_used  int  not null default 0,        -- +1 each time core ticks the player present
  starts_on      date not null,
  ends_on        date,                           -- optional hard expiry
  note           text,                           -- e.g. "₹2000 cash to RDX"
  status         text not null default 'active' check (status in ('active', 'ended')),
  created_by     int references players(id),
  created_at     timestamptz not null default now()
);
create unique index if not exists one_active_membership on memberships (player_id) where status = 'active';

create table if not exists membership_requests (
  id         serial primary key,
  player_id  int  not null references players(id),
  batch_id   text not null references batches(id),
  plan       text not null check (plan in ('month', 'weekdays', 'weekends', 'other')),
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  handled_by int references players(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists one_pending_request on membership_requests (player_id) where status = 'pending';

create table if not exists sessions (
  id         serial primary key,
  batch_id   text not null references batches(id),
  date       date not null,                      -- IST date
  starts_at  timestamptz not null,
  capacity   int not null,
  closed     boolean not null default false,     -- finished; unticked bookings became no-shows
  cancelled  boolean not null default false,
  unique (batch_id, date)
);

create table if not exists bookings (
  id            serial primary key,
  session_id    int not null references sessions(id),
  player_id     int not null references players(id),
  guests        int not null default 0,          -- friends; always pay the daily fee
  status        text not null default 'booked' check (status in ('booked', 'withdrawn', 'present', 'no_show')),
  source        text not null default 'self' check (source in ('self', 'auto')),
  membership_id int references memberships(id),  -- set at check-in when the plan covered the player's own seat
  paid          boolean not null default false,  -- daily fee collected at court
  checked_by    int references players(id),
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
