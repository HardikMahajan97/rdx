# Shared helpers for the setup scripts. Not meant to be run on its own.
# shellcheck shell=bash

PG_FORMULA="postgresql@18"   # installed on macOS when Postgres is missing; matches Neon (pg_dump must be at least as new as the server)

bold=$'\033[1m'; green=$'\033[32m'; yellow=$'\033[33m'; red=$'\033[31m'; reset=$'\033[0m'
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
ok()   { printf '  %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '\n%s✗ %s%s\n\n' "$red" "$*" "$reset" >&2; exit 1; }

# ask "Question" "default"  → prints the answer (the default when nobody is typing, e.g. YES=1 or piped input)
ask() {
  local q=$1 def=${2:-} a=''
  if [ -t 0 ] && [ "${YES:-0}" != 1 ]; then read -r -p "  $q${def:+ [$def]}: " a || true; fi
  printf '%s' "${a:-$def}"
}
# confirm "Question" "y|n"  → true for yes. YES=1 answers yes to everything.
confirm() {
  [ "${YES:-0}" = 1 ] && return 0
  local a; a=$(ask "$1 (y/n)" "${2:-n}"); [[ $a =~ ^[Yy] ]]
}

# Reads KEY from an env file, ignoring commented-out lines and surrounding quotes.
env_get() {
  local file=$1 key=$2
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//'
}
# Sets KEY=value in an env file (adds the line if missing).
env_set() {
  local file=$1 key=$2 value=$3
  KEY="$key" VALUE="$value" node -e '
    const fs = require("fs"); const f = process.argv[1]; const { KEY, VALUE } = process.env;
    let s = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    const line = `${KEY}=${VALUE}`;
    s = new RegExp(`^${KEY}=.*$`, "m").test(s) ? s.replace(new RegExp(`^${KEY}=.*$`, "m"), () => line) : s.replace(/\n?$/, "\n") + line + "\n";
    fs.writeFileSync(f, s);' "$file"
}

# URL helpers (Node is installed before these are used).
url_with_db() { node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$1" "$2"; }
url_db()      { node -e 'console.log(decodeURIComponent(new URL(process.argv[1]).pathname.slice(1)))' "$1"; }
url_host()    { node -e 'console.log(new URL(process.argv[1]).hostname)' "$1"; }
masked()      { printf '%s' "$1" | sed -E 's#(://[^:/@]*:)[^@]*@#\1***@#'; }

platform() {
  case "$(uname -s)" in
    Darwin) echo mac ;;
    Linux)  if command -v apt-get >/dev/null 2>&1; then echo apt; else echo linux; fi ;;
    *)      echo other ;;
  esac
}

# Homebrew Postgres versions installed on this Mac, newest first (e.g. "postgresql@18 postgresql@17").
brew_pg_formulas() {
  command -v brew >/dev/null 2>&1 || return 0
  ls -d "$(brew --prefix)"/opt/postgresql@* 2>/dev/null | xargs -n1 basename 2>/dev/null | sort -t@ -k2 -nr
}

# Puts Homebrew (macOS) and its keg-only Postgres tools on PATH for this script, newest version first.
load_paths() {
  local b f
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if ! command -v brew >/dev/null 2>&1 && [ -x "$b" ]; then eval "$("$b" shellenv)"; fi
  done
  for f in $(brew_pg_formulas | sort -t@ -k2 -n); do
    [ -d "$(brew --prefix)/opt/$f/bin" ] && PATH="$(brew --prefix)/opt/$f/bin:$PATH"
  done
  if [ -d /Applications/Postgres.app/Contents/Versions/latest/bin ]; then
    PATH="$PATH:/Applications/Postgres.app/Contents/Versions/latest/bin"
  fi
  export PATH
}

# Waits up to ~20 s for the local Postgres server to accept connections.
wait_for_postgres() {
  local i
  for i in $(seq 1 20); do
    if pg_isready -q -h localhost 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
