#!/usr/bin/env bash
# One-command local setup. Safe to run again at any time; it only adds what is missing.
#
#   bash scripts/setup-local.sh          install what's needed, create the database, then offer to start the app
#   bash scripts/setup-local.sh --start  just make sure the database is running and start the app (daily use)
#   YES=1 bash scripts/setup-local.sh    accept every default without asking
#
# Installs (only if missing): Node.js, PostgreSQL, the app's npm packages.
# Supports macOS (via Homebrew) and Ubuntu/Debian, including Windows through WSL.

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib.sh
source scripts/lib.sh

START_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --start) START_ONLY=1 ;;
    --yes|-y) YES=1 ;;
    *) die "Unknown option: $arg" ;;
  esac
done

ENV_FILE=.env.local
OS=$(platform)
[ "$OS" = other ] && die "This script runs on macOS or Linux. On Windows, install WSL (Ubuntu) and run it there; see README → Windows."
load_paths

# ---------- Node.js ----------

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 9) ? 0 : 1)'
}

ensure_brew() {
  command -v brew >/dev/null 2>&1 && return
  warn "Homebrew (the standard Mac installer for developer tools) is not installed."
  confirm "Install Homebrew now? It will ask for your Mac password" y || die "Homebrew is needed. Install it from https://brew.sh and run this script again."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_paths
  command -v brew >/dev/null 2>&1 || die "Homebrew installed, but this terminal can't see it yet. Close the terminal, open a new one and run this script again."
}

ensure_node() {
  step "Node.js"
  if node_ok; then ok "Node.js $(node --version)"; return; fi
  command -v node >/dev/null 2>&1 && warn "Node.js $(node --version) is too old; version 20.9 or newer is needed."
  case "$OS" in
    mac)
      ensure_brew
      brew install node ;;
    apt)
      confirm "Install Node.js 22 now? It will ask for your password (sudo)" y || die "Install Node.js 22 from https://nodejs.org and run this script again."
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs ;;
    *)
      die "Install Node.js 22 from https://nodejs.org and run this script again." ;;
  esac
  hash -r
  node_ok || die "Node.js still isn't available. Open a new terminal and run this script again."
  ok "Node.js $(node --version)"
}

# ---------- PostgreSQL ----------

ensure_postgres() {
  step "PostgreSQL (the database)"
  case "$OS" in
    mac)
      if ! command -v psql >/dev/null 2>&1; then
        ensure_brew
        warn "PostgreSQL is not installed. Installing $PG_FORMULA with Homebrew…"
        brew install "$PG_FORMULA"
        load_paths
      fi
      if ! pg_isready -q -h localhost 2>/dev/null; then
        local installed
        # The version already set up as a background service holds your data; otherwise the newest one.
        installed=$(brew services list 2>/dev/null | awk '/^postgresql/ && $2 != "none" { print $1; exit }')
        [ -n "$installed" ] || installed=$(brew_pg_formulas | head -1)
        if [ -n "$installed" ]; then
          brew services start "$installed" >/dev/null   # also starts it again after a restart
        else
          warn "PostgreSQL is installed but not running. Start it (e.g. open Postgres.app) if this keeps waiting."
        fi
      fi ;;
    apt)
      if ! command -v pg_ctlcluster >/dev/null 2>&1; then
        warn "PostgreSQL is not installed."
        confirm "Install PostgreSQL now? It will ask for your password (sudo)" y || die "PostgreSQL is needed for the app."
        sudo apt-get update -qq
        sudo apt-get install -y postgresql postgresql-contrib
      fi
      # WSL and some servers don't start it automatically after a reboot.
      pg_isready -q -h localhost 2>/dev/null || sudo service postgresql start >/dev/null ;;
    *)
      command -v psql >/dev/null 2>&1 || die "Install PostgreSQL 17 for your system (https://www.postgresql.org/download/) and run this script again." ;;
  esac
  wait_for_postgres || die "PostgreSQL did not start. Try restarting your computer, then run this script again."
  ok "$(psql --version | head -1), running"
}

# On Ubuntu/WSL the database login has to be created for you; on a Mac Homebrew already did that.
make_linux_login() {
  local pass
  pass=$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))')
  sudo -u postgres psql -qtAc "select 1 from pg_roles where rolname = '$USER'" | grep -q 1 ||
    sudo -u postgres createuser --superuser "$USER"
  sudo -u postgres psql -qc "alter role \"$USER\" with login password '$pass'" >/dev/null
  printf 'postgres://%s:%s@localhost:5432/badminton' "$USER" "$pass"
}

# ---------- .env.local ----------

valid_phone() { [[ $1 =~ ^[6-9][0-9]{9}$ ]]; }

# ask_phone "Label" "default" [optional]
ask_phone() {
  local label=$1 def=$2 optional=${3:-} p
  while true; do
    p=$(ask "$label (10-digit mobile number)" "$def")
    p=${p//[^0-9]/}; [ ${#p} -gt 10 ] && p=${p: -10}
    if valid_phone "$p" || { [ -z "$p" ] && [ -n "$optional" ]; }; then printf '%s' "$p"; return; fi
    printf '  %sThat is not a valid 10-digit Indian mobile number.%s\n' "$yellow" "$reset" >&2
  done
}

ensure_env() {
  step "Settings file ($ENV_FILE)"
  if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE already exists; keeping your settings"
  else
    cp .env.example "$ENV_FILE"
    env_set "$ENV_FILE" SESSION_SECRET "$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    if [ "$OS" = apt ]; then env_set "$ENV_FILE" DATABASE_URL "$(make_linux_login)"; fi
    echo "  The first admin signs in with their number and picks their own PIN."
    env_set "$ENV_FILE" ADMIN_PHONE "$(ask_phone 'Admin phone' "$(env_get .env.example ADMIN_PHONE)")"
    env_set "$ENV_FILE" ADMIN_NAME "$(ask 'Admin name' "$(env_get .env.example ADMIN_NAME)")"
    env_set "$ENV_FILE" CORE_PHONE "$(ask_phone 'Core member phone (leave empty to skip)' "$(env_get .env.example CORE_PHONE)" optional)"
    env_set "$ENV_FILE" CORE_NAME "$(ask 'Core member name' "$(env_get .env.example CORE_NAME)")"
    ok "Created $ENV_FILE with a new random SESSION_SECRET"
  fi

  DATABASE_URL=$(env_get "$ENV_FILE" DATABASE_URL)
  [ -n "$DATABASE_URL" ] || die "DATABASE_URL is missing in $ENV_FILE."
  case "$(url_host "$DATABASE_URL")" in
    *neon.tech*) die "$ENV_FILE points at Neon ($(masked "$DATABASE_URL")). Local setup only works on a local database: put the local URL first and comment the Neon one out with #." ;;
  esac
}

# ---------- Database ----------

ensure_database() {
  step "App database"
  local db maint
  db=$(url_db "$DATABASE_URL")
  maint=$(url_with_db "$DATABASE_URL" postgres)
  if ! psql "$maint" -qtAc 'select 1' >/dev/null 2>&1; then
    if [ "$OS" = apt ] && confirm "Can't log in to PostgreSQL with the URL in $ENV_FILE. Reset the local database login and update $ENV_FILE?" y; then
      DATABASE_URL=$(url_with_db "$(make_linux_login)" "$db")
      env_set "$ENV_FILE" DATABASE_URL "$DATABASE_URL"
      maint=$(url_with_db "$DATABASE_URL" postgres)
    fi
    psql "$maint" -qtAc 'select 1' >/dev/null || die "Can't connect with DATABASE_URL=$(masked "$DATABASE_URL"). Check it in $ENV_FILE."
  fi
  if [ "$(psql "$maint" -qtAc "select 1 from pg_database where datname = '$db'")" = 1 ]; then
    ok "Database \"$db\" exists"
  else
    psql "$maint" -qc "create database \"$db\""
    ok "Created database \"$db\""
  fi
}

# ---------- Run ----------

start_app() {
  step "Starting the app"
  echo "  Open ${bold}http://localhost:3000${reset} in your browser."
  echo "  Sign in with the admin number from $ENV_FILE ($(env_get "$ENV_FILE" ADMIN_PHONE)) and choose a PIN."
  echo "  Keep this window open while you use the app. Press Ctrl+C to stop it."
  echo
  exec npm run dev
}

if [ "$START_ONLY" = 1 ]; then
  node_ok || die "Node.js is missing. Run: bash scripts/setup-local.sh"
  ensure_postgres
  [ -d node_modules ] || die "Packages are missing. Run: bash scripts/setup-local.sh"
  start_app
fi

ensure_node
ensure_postgres
ensure_env
ensure_database

step "App packages (npm install)"
npm install --no-audit --no-fund --loglevel=error
ok "Packages installed"

step "Tables, batches and staff accounts"
npm run -s db:setup
npm run -s db:check | tail -3

printf '\n%s✓ Local setup complete.%s Next time, start the app with: %snpm run local%s\n' "$green" "$reset" "$bold" "$reset"
if [ -t 0 ] && confirm "Start the app now?" y; then start_app; fi
