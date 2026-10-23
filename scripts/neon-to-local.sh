#!/usr/bin/env bash
# Copies the live Neon database into your local one, so you can test with real data.
# Neon is only read, never changed. Your current local data is backed up first, then replaced.
#
#   bash scripts/neon-to-local.sh          (or: npm run db:pull)
#   YES=1 bash scripts/neon-to-local.sh    don't ask before replacing local data
#
# Neon connection string: NEON_DATABASE_URL, else DATABASE_URL in .env.production, else it asks.
# Needs the local setup done first (bash scripts/setup-local.sh).

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh
load_paths

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

command -v node >/dev/null 2>&1 && command -v pg_dump >/dev/null 2>&1 && command -v psql >/dev/null 2>&1 ||
  die "Node.js or PostgreSQL tools are missing. Run the local setup first: bash scripts/setup-local.sh"

# ---------- Where from, where to ----------

step "Databases"
LOCAL_URL=$(env_get .env.local DATABASE_URL)
[ -n "$LOCAL_URL" ] || die ".env.local has no DATABASE_URL. Run the local setup first: bash scripts/setup-local.sh"
case "$(url_host "$LOCAL_URL")" in
  localhost|127.0.0.1|::1|'') ;;
  *) die ".env.local points at $(url_host "$LOCAL_URL"), not this computer. This script only writes to a local database." ;;
esac

NEON_URL=${NEON_DATABASE_URL:-$(env_get .env.production DATABASE_URL)}
if [ -z "$NEON_URL" ]; then
  echo "  Paste the Neon connection string (Neon dashboard → Connect). It starts with postgresql://"
  if [ -t 0 ]; then read -r -s -p "  Neon URL: " NEON_URL; echo; fi
fi
[ -n "$NEON_URL" ] || die "No Neon connection string given."
[ "$NEON_URL" != "$LOCAL_URL" ] || die "The Neon and local URLs are the same."

pg_isready -q -h localhost 2>/dev/null || die "Local PostgreSQL isn't running. Start it with: bash scripts/setup-local.sh"
psql "$NEON_URL" -qtAc 'select 1' >/dev/null || die "Can't connect to Neon with $(masked "$NEON_URL")."
ok "From (read only): $(masked "$NEON_URL")"
ok "To:               $(masked "$LOCAL_URL")"

# pg_dump has to be at least as new as the server it reads from.
server_major=$(( $(psql "$NEON_URL" -qtAc 'show server_version_num') / 10000 ))
dump_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
if [ "$dump_major" -lt "$server_major" ]; then
  warn "Neon runs PostgreSQL $server_major, but the copy tool here (pg_dump) is version $dump_major. It must be $server_major or newer."
  case "$(platform)" in
    mac)
      confirm "Install the PostgreSQL $server_major tools with Homebrew? Your local database keeps running as it is" y ||
        die "Stopped. Install them with: brew install postgresql@$server_major"
      brew install "postgresql@$server_major" ;;
    apt)
      confirm "Install the PostgreSQL $server_major tools? It will ask for your password (sudo)" y ||
        die "Stopped. Install postgresql-client-$server_major and try again."
      sudo apt-get install -y postgresql-common >/dev/null
      sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y   # the official PostgreSQL package source
      sudo apt-get install -y "postgresql-client-$server_major"
      PATH="/usr/lib/postgresql/$server_major/bin:$PATH" ;;
    *)
      die "Install the PostgreSQL $server_major client tools and try again." ;;
  esac
  load_paths
  dump_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
  [ "$dump_major" -ge "$server_major" ] || die "pg_dump is still version $dump_major. Open a new terminal and try again."
  ok "Using pg_dump $dump_major"
fi

counts() {
  psql "$1" -qtAc "select (select count(*) from players) || ' players, ' || (select count(*) from memberships where status = 'active')
    || ' active plans, ' || (select count(*) from bookings) || ' bookings'" 2>/dev/null || echo "no app tables"
}
echo "  Neon has:  $(counts "$NEON_URL")"
echo "  Local has: $(counts "$LOCAL_URL")"

# ---------- Copy ----------

confirm "Replace ALL local data with the Neon copy? (local is backed up first)" n || die "Stopped. Nothing was changed."

DB=$(url_db "$LOCAL_URL")
MAINT=$(url_with_db "$LOCAL_URL" postgres)
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

step "Backing up local data"
if [ "$(psql "$MAINT" -qtAc "select 1 from pg_database where datname = '$DB'")" = 1 ]; then
  pg_dump "$LOCAL_URL" --no-owner --no-privileges > "backups/local-$STAMP.sql"
  ok "Saved backups/local-$STAMP.sql"
else
  ok "No local database yet; nothing to back up"
fi

step "Downloading from Neon"
# Owners, grants and Neon's own extensions don't exist locally, so leave them out.
pg_dump "$NEON_URL" --no-owner --no-privileges --no-publications --no-subscriptions \
  | sed -E '/^SET transaction_timeout/d; /EXTENSION.*neon/d; s/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS public;/' \
  > "backups/neon-$STAMP.sql"
ok "Saved backups/neon-$STAMP.sql"

step "Loading into the local database"
psql "$MAINT" -qc "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\"" >/dev/null
if ! psql "$LOCAL_URL" -q -v ON_ERROR_STOP=1 -f "backups/neon-$STAMP.sql" >/dev/null; then
  warn "Loading failed. Putting your previous local data back…"
  psql "$MAINT" -qc "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\"" >/dev/null
  [ -f "backups/local-$STAMP.sql" ] && psql "$LOCAL_URL" -q -f "backups/local-$STAMP.sql" >/dev/null
  die "Copy failed; your local data was restored from backups/local-$STAMP.sql."
fi
ok "Local now has: $(counts "$LOCAL_URL")"

step "Checking the copy"
if ! npm run -s db:check >/dev/null 2>&1; then
  warn "Neon's tables are older than this code; upgrading the local copy…"
  npm run -s db:setup
fi
npm run -s db:check | tail -2

echo
echo "  Done. Everyone's PIN works locally too. Sign in again on http://localhost:3000"
echo "  (local and Neon use different SESSION_SECRETs, so sign-ins don't carry over)."
echo "  The backups/ folder is not committed to git. Delete old files there when you no longer need them."
