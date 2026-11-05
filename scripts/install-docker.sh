#!/usr/bin/env bash
# install-docker.sh : installation guidée de Curiosa avec Docker (image prête à l'emploi sur ghcr.io/helldog136/curiosa, PC x86_64 et ARM).
# Guided Docker install of Curiosa (ready-made image, nothing is built on your machine).
#
# What it does: checks Docker and Docker Compose, asks 2 or 3 plain questions (domain, e-mail for HTTPS, setup code), picks how HTTPS is served
# (bundled Caddy / your Traefik / a proxy already on this machine), writes `.env`, downloads the compose files if they are not there, then runs
# `docker compose pull && docker compose up -d` and waits until the site answers. It never installs Docker unless you pass --install-docker.
# Run it again at any time: it keeps what is already in `.env` and never deletes anything.
#
#   bash install-docker.sh [options]
#   --dir DIR             folder for docker-compose.yml and .env (default: ./curiosa)
#   --domain NAME         public domain (no domain: a local trial on http://localhost:3000)
#   --email ADDRESS       e-mail for the HTTPS certificate (optional)
#   --setup-token CODE    code asked by the setup page (default: one is generated); --no-setup-token for none
#   --proxy MODE          caddy | traefik | host | none (default: chosen from what runs on this machine)
#   --version X.Y.Z       pin a version (also X.Y for a series); default: latest
#   --data-dir PATH       keep the data in this folder instead of a Docker volume (NAS)
#   --puid N --pgid N     user and group the site runs as (default 1000; on a NAS, the owner of the shared folder)
#   --skip-dns            do not check the domain's DNS
#   --refresh             download the compose files again (the old ones are kept as .bak)
#   --install-docker      install Docker if it is missing (Linux, with your consent)
#   --yes                 accept the proposed choices without asking
#   --dry-run             show everything, change nothing
#   --lang fr|en          language of the messages (default: CURIOSA_LANG, then the system language, then English)
# Exit codes: 0 done; 1 error; 2 wrong option; 3 Docker missing or unusable; 10 installed but the site does not answer yet.
set -u

IMAGE="ghcr.io/helldog136/curiosa"
UPDATE_COMMAND="docker compose pull && docker compose up -d"
REPO="${CURIOSA_DOCKER_REPO:-helldog136/Curiosa}"
RAW_BASE="${CURIOSA_RAW_BASE:-https://raw.githubusercontent.com/$REPO}"
API_BASE="${CURIOSA_API_BASE:-https://api.github.com/repos/$REPO}"
HEALTH_SECONDS="${CURIOSA_HEALTH_SECONDS:-180}"
LANGS="en fr"

DIR="" DOMAIN="" EMAIL="" SETUP="" NO_SETUP=0 PROXY="" PIN="" DATA_DIR="" PUID_ARG="" PGID_ARG=""
SKIP_DNS=0 REFRESH=0 INSTALL_DOCKER=0 YES=0 DRY=0 LANG_OPT="" LANG_CODE="" CAT_CUR="" CAT_EN="" MSG="" RAW=""
PORT="" CF_FILES="docker-compose.yml" CF_PROFILES="" WARNINGS=0 REF="" COMPOSE_VERSION=""

# ─── Texts: one catalogue per language at the end of the file (lines « key text », {1} {2}… = arguments) ───────────
lookup() {
  local c="$1" k="$2" rest
  case "$c" in
    *$'\n'"$k "*) rest="${c#*$'\n'"$k "}"; RAW="${rest%%$'\n'*}"; return 0 ;;
  esac
  return 1
}
_render() {
  local key="$1" raw pre d out=""; shift
  local -a a=("$@")
  [ -n "$CAT_EN" ] || load_catalogs
  if lookup "$CAT_CUR" "$key"; then raw="$RAW"; elif lookup "$CAT_EN" "$key"; then raw="$RAW"; else MSG="[$key]"; return 0; fi
  while :; do
    case "$raw" in *\{[0-9]\}*) ;; *) break ;; esac
    pre="${raw%%\{[0-9]\}*}"; d="${raw:${#pre}+1:1}"
    # shellcheck disable=SC2004
    out+="$pre${a[$((d - 1))]:-}"; raw="${raw:${#pre}+3}"
  done
  MSG="$out$raw"
}
t() { _render "$@"; printf '%s' "$MSG"; }
load_catalogs() {
  CAT_EN=$'\n'"$(catalog_en)"$'\n'
  if [ "$LANG_CODE" = en ] || [ -z "$LANG_CODE" ]; then CAT_CUR="$CAT_EN"; else CAT_CUR=$'\n'"$("catalog_$LANG_CODE")"$'\n'; fi
}
say() { printf '%s\n' "$(t "$@")"; }
warn() { WARNINGS=$((WARNINGS + 1)); printf '%s %s\n' "$(t lbl.warn)" "$(t "$@")" >&2; }
die() { local code="$1"; shift; printf '%s %s\n' "$(t lbl.error)" "$(t "$@")" >&2; exit "$code"; }
plan() { printf '  %s\n' "$(t "$@")"; }
have() { command -v "$1" >/dev/null 2>&1; }

norm_lang() { local v; v=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z'); v="${v%%.*}"; v="${v%%@*}"; v="${v%%_*}"; v="${v%%-*}"; printf '%s' "$v"; }
lang_supported() { local l; for l in $LANGS; do [ "$l" = "$1" ] && return 0; done; return 1; }
detect_lang() {
  local c v
  if [ -n "$LANG_OPT" ]; then LANG_CODE=$(norm_lang "$LANG_OPT"); return 0; fi
  for v in "${CURIOSA_LANG:-}" "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
    c=$(norm_lang "$v"); [ -n "$c" ] || continue
    if lang_supported "$c"; then LANG_CODE="$c"; return 0; fi
  done
  LANG_CODE=en
}

# ─── Options ─────────────────────────────────────────────────────────────────────────────────────────────────────
pre_scan_lang() {
  while [ "$#" -gt 0 ]; do
    case "$1" in --lang) [ "$#" -ge 2 ] && LANG_OPT="$2"; shift ;; --lang=*) LANG_OPT="${1#--lang=}" ;; esac
    shift
  done
  if [ -n "$LANG_OPT" ]; then
    lang_supported "$(norm_lang "$LANG_OPT")" || { printf 'Langue inconnue / Unknown language: %s (en, fr)\n' "$LANG_OPT" >&2; exit 2; }
  fi
}
need_val() { [ "$2" -ge 2 ] || die 2 err.option_value "$1"; }
parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir) need_val "$1" "$#"; DIR="$2"; shift ;;
      --domain) need_val "$1" "$#"; DOMAIN="$2"; shift ;;
      --email) need_val "$1" "$#"; EMAIL="$2"; shift ;;
      --setup-token) need_val "$1" "$#"; SETUP="$2"; shift ;;
      --no-setup-token) NO_SETUP=1 ;;
      --proxy) need_val "$1" "$#"; PROXY="$2"; shift ;;
      --version) need_val "$1" "$#"; PIN="$2"; shift ;;
      --data-dir) need_val "$1" "$#"; DATA_DIR="$2"; shift ;;
      --puid) need_val "$1" "$#"; PUID_ARG="$2"; shift ;;
      --pgid) need_val "$1" "$#"; PGID_ARG="$2"; shift ;;
      --skip-dns) SKIP_DNS=1 ;;
      --refresh) REFRESH=1 ;;
      --install-docker) INSTALL_DOCKER=1 ;;
      --yes|-y) YES=1 ;;
      --dry-run) DRY=1 ;;
      --lang) shift ;;
      --lang=*) ;;
      -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die 2 err.option_unknown "$1" ;;
    esac
    shift
  done
}
validate_args() {
  [ -z "$DOMAIN" ] || printf '%s' "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || die 2 err.domain "$DOMAIN"
  [ -z "$EMAIL" ] || printf '%s' "$EMAIL" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || die 2 err.email "$EMAIL"
  [ -z "$SETUP" ] || printf '%s' "$SETUP" | grep -Eq '^[A-Za-z0-9._-]{8,64}$' || die 2 err.setup
  case "$PROXY" in ""|caddy|traefik|host|none) ;; *) die 2 err.proxy "$PROXY" ;; esac
  [ -z "$PIN" ] || printf '%s' "$PIN" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+(-rc\.[0-9]+)?)?$|^latest$' || die 2 err.version "$PIN"
  [ -z "$PUID_ARG" ] || printf '%s' "$PUID_ARG" | grep -Eq '^[1-9][0-9]{0,4}$' || die 2 err.ids
  [ -z "$PGID_ARG" ] || printf '%s' "$PGID_ARG" | grep -Eq '^[1-9][0-9]{0,4}$' || die 2 err.ids
  [ -z "$DATA_DIR" ] || printf '%s' "$DATA_DIR" | grep -Eq '^/[A-Za-z0-9._/@ -]*$' || die 2 err.datadir "$DATA_DIR"
  return 0
}

# ─── .env: read and write one value, never touching the rest ──────────────────────────────────────────────────────
ENV_FILE=""
env_get() { [ -f "$ENV_FILE" ] || return 1; local v; v=$(sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1); v="${v#\"}"; v="${v%\"}"; [ -n "$v" ] && printf '%s' "$v"; }
env_set() { # env_set KEY VALUE : replaces the line KEY=… or appends it; idempotent
  local k="$1" v="$2" tmp
  if [ -f "$ENV_FILE" ] && grep -q "^$k=" "$ENV_FILE"; then
    tmp="$ENV_FILE.tmp.$$"
    awk -v k="$k" -v v="$v" 'BEGIN { done = 0 } { if (index($0, k "=") == 1) { if (!done) { print k "=\"" v "\""; done = 1 } } else print }' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s="%s"\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

# ─── Checks ──────────────────────────────────────────────────────────────────────────────────────────────────────
ver_ge() { # ver_ge A B : A >= B (numbers separated by dots)
  local a="${1#v}" b="$2" i x y; a="${a%%[-+]*}"
  for i in 1 2 3; do x=$(printf '%s' "$a" | cut -d. -f$i); y=$(printf '%s' "$b" | cut -d. -f$i); x="${x:-0}"; y="${y:-0}"
    [ "$x" -gt "$y" ] && return 0; [ "$x" -lt "$y" ] && return 1; done
  return 0
}
check_docker() {
  if ! have docker; then
    if [ "$INSTALL_DOCKER" = 1 ]; then
      [ "$(uname -s)" = Linux ] || die 3 err.docker_nolinux
      plan p.install_docker
      if [ "$DRY" = 1 ]; then return 0; fi
      confirm c.install_docker || die 3 err.docker_missing
      have curl || die 3 err.docker_missing
      local f; f=$(mktemp); curl -fsSL https://get.docker.com -o "$f" || die 3 err.docker_missing; sh "$f" || die 3 err.docker_missing
    else
      die 3 err.docker_missing
    fi
  fi
  if [ "$DRY" = 1 ] && ! have docker; then return 0; fi
  docker info >/dev/null 2>&1 || die 3 err.docker_daemon
  local cv; cv=$(docker compose version --short 2>/dev/null || true)
  [ -n "$cv" ] || die 3 err.compose_missing
  COMPOSE_VERSION="$cv"
  ver_ge "$cv" 2.0.0 || die 3 err.compose_old "$cv"
}
check_memory() {
  local kb; kb=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)
  if [ -n "$kb" ] && [ "$kb" -lt 900000 ]; then warn w.memory "$((kb / 1024))"; fi
  return 0
}
resolve_v4() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true; }
public_ip() {
  [ -n "${CURIOSA_PUBLIC_IP:-}" ] && { printf '%s' "$CURIOSA_PUBLIC_IP"; return 0; }
  local u ip
  for u in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    ip=$(curl -4 -fsS -m 6 "$u" 2>/dev/null | tr -d '[:space:]') || ip=""
    case "$ip" in ""|*[!0-9.]*) ;; *) printf '%s' "$ip"; return 0 ;; esac
  done
  return 1
}
check_dns() {
  [ -n "$DOMAIN" ] && [ "$SKIP_DNS" = 0 ] || return 0
  local got pub; got=$(resolve_v4 "$DOMAIN"); pub=$(public_ip || true)
  if [ -z "$got" ]; then warn w.dns_none "$DOMAIN" "${pub:-?}"; return 0; fi
  if [ -n "$pub" ]; then case " $got " in *" $pub "*) say i.dns_ok "$DOMAIN" "$pub" ;; *) warn w.dns_other "$DOMAIN" "$got" "$pub" ;; esac; fi
  return 0
}
port_busy() { # port_busy N : something already listens on this host port
  if have ss; then ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; return $?; fi
  if have netstat; then netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"; return $?; fi
  return 1
}
traefik_running() { have docker && docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qi traefik; }
network_exists() { docker network inspect "$1" >/dev/null 2>&1; }

confirm() { # confirm KEY : asks yes/no unless --yes ; default no
  [ "$YES" = 1 ] && return 0
  local ans; printf '%s ' "$(t "$1")"; read -r ans || return 1
  case "$ans" in y|Y|o|O|yes|oui|Yes|Oui) return 0 ;; esac
  return 1
}
ask() { # ask VAR KEY DEFAULT : asks (unless --yes, no terminal, or already set); an empty answer takes the default
  local var="$1" key="$2" def="${3:-}" ans cur
  cur="${!var}"; [ -z "$cur" ] || return 0
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$def"; return 0; fi
  if [ -n "$def" ]; then printf '%s [%s] ' "$(t "$key")" "$def"; else printf '%s ' "$(t "$key")"; fi
  read -r ans || ans=""
  printf -v "$var" '%s' "${ans:-$def}"
}
random_code() { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 24; }

# ─── Main ────────────────────────────────────────────────────────────────────────────────────────────────────────
main() {
  pre_scan_lang "$@"; detect_lang; load_catalogs
  parse_args "$@"; validate_args
  DIR="${DIR:-./curiosa}"
  say t.title
  check_docker
  check_memory

  # An existing .env gives the defaults, so a second run asks nothing new and changes nothing.
  ENV_FILE="$DIR/.env"
  local prev_domain prev_email prev_setup
  prev_domain=$(env_get CURIOSA_DOMAIN || true); prev_email=$(env_get CURIOSA_ACME_EMAIL || true); prev_setup=$(env_get SETUP_TOKEN || true)

  # Questions: at most three
  [ -n "$DOMAIN" ] || DOMAIN="$prev_domain"
  ask DOMAIN q.domain ""
  validate_args
  if [ -n "$DOMAIN" ]; then
    [ -n "$EMAIL" ] || EMAIL="$prev_email"
    ask EMAIL q.email ""
    validate_args
  fi
  if [ "$NO_SETUP" = 0 ] && [ -z "$SETUP" ]; then SETUP="$prev_setup"; fi
  if [ "$NO_SETUP" = 0 ] && [ -z "$SETUP" ]; then
    local def; def=$(random_code)
    ask SETUP q.setup "$def"
    validate_args
  fi

  # How HTTPS is served
  local mode="$PROXY"
  if [ -z "$DOMAIN" ]; then mode=none
  elif [ -z "$mode" ]; then
    if have docker && traefik_running && network_exists "${TRAEFIK_NETWORK:-traefik}"; then mode=traefik
    elif port_busy 80 || port_busy 443; then mode=host
    else mode=caddy; fi
  fi
  case "$mode" in
    traefik)
      ver_ge "${COMPOSE_VERSION:-2.24.0}" 2.24.0 || die 3 err.traefik_compose "${COMPOSE_VERSION:-?}"
      CF_FILES="docker-compose.yml:docker-compose.traefik.yml" ;;
    caddy) CF_PROFILES="https" ;;
  esac
  say "i.proxy_$mode"

  # Port on this machine (Traefik publishes nothing)
  PORT=$(env_get CURIOSA_PORT || true)
  if [ -z "$PORT" ]; then PORT=3000; while port_busy "$PORT"; do PORT=$((PORT + 1)); done; fi
  if [ "$PORT" != 3000 ]; then warn w.port "$PORT"; fi
  check_dns

  local site_url
  if [ -z "$DOMAIN" ]; then site_url="http://localhost:$PORT"; else site_url="https://$DOMAIN"; fi

  # What will be done
  say t.plan
  plan p.dir "$DIR"
  plan p.env "$ENV_FILE"
  plan p.pull "$IMAGE:${PIN:-latest}"
  plan p.up
  if [ "$mode" = host ]; then plan p.host_proxy "$PORT"; fi
  if [ "$DRY" = 1 ]; then
    say t.dry
    local kv; for kv in "SITE_URL=$site_url" "CURIOSA_DOMAIN=$DOMAIN" "CURIOSA_ACME_EMAIL=$EMAIL" "CURIOSA_VERSION=${PIN:-}" "SETUP_TOKEN=${SETUP:+(set, not shown)}" "PUID=${PUID_ARG:-}" "PGID=${PGID_ARG:-}" "CURIOSA_DATA_DIR=$DATA_DIR" "CURIOSA_PORT=$PORT" "COMPOSE_FILE=$CF_FILES" "COMPOSE_PROFILES=$CF_PROFILES"; do
      if [ -n "${kv#*=}" ]; then printf '  .env  %s\n' "$kv"; fi
    done
    printf '  (%s) %s\n' "$DIR" "$UPDATE_COMMAND"
    exit 0
  fi
  confirm c.go || die 1 err.cancel

  # Do it
  mkdir -p "$DIR" || die 1 err.mkdir "$DIR"
  fetch_compose "$mode"
  touch "$ENV_FILE" && chmod 600 "$ENV_FILE"
  env_set SITE_URL "$site_url"
  if [ -n "$DOMAIN" ]; then env_set CURIOSA_DOMAIN "$DOMAIN"; fi
  if [ -n "$EMAIL" ]; then env_set CURIOSA_ACME_EMAIL "$EMAIL"; fi
  if [ -n "$SETUP" ]; then env_set SETUP_TOKEN "$SETUP"; fi
  if [ -n "$PIN" ]; then env_set CURIOSA_VERSION "$PIN"; fi
  if [ -n "$PUID_ARG" ]; then env_set PUID "$PUID_ARG"; fi
  if [ -n "$PGID_ARG" ]; then env_set PGID "$PGID_ARG"; fi
  if [ -n "$DATA_DIR" ]; then env_set CURIOSA_DATA_DIR "$DATA_DIR"; fi
  env_set CURIOSA_PORT "$PORT"
  # Compose reads these two from .env: the plain update command then keeps the proxy choice.
  env_set COMPOSE_FILE "$CF_FILES"
  env_set COMPOSE_PROFILES "$CF_PROFILES"
  if [ "$mode" = traefik ] || [ "$mode" = caddy ]; then env_set CURIOSA_TRUSTED_PROXIES 1; fi
  if [ "$mode" = none ] || [ "$mode" = host ]; then env_set CURIOSA_BIND "127.0.0.1"; fi
  say i.env_written "$ENV_FILE"

  ( cd "$DIR" && docker compose pull ) || die 1 err.pull
  ( cd "$DIR" && docker compose up -d ) || die 1 err.up
  wait_healthy "$mode" "$site_url"
}

fetch_compose() {
  local mode="$1" ref f need="docker-compose.yml"
  if [ "$mode" = traefik ]; then need="$need docker-compose.traefik.yml"; fi
  for f in $need; do
    if [ -f "$DIR/$f" ] && [ "$REFRESH" = 0 ]; then say i.compose_kept "$f"; continue; fi
    have curl || die 1 err.nocurl
    ref="$REF"; if [ -z "$ref" ]; then ref=$(release_ref); REF="$ref"; fi
    if [ -f "$DIR/$f" ]; then cp "$DIR/$f" "$DIR/$f.bak"; fi
    curl -fsSL "$RAW_BASE/$ref/$f" -o "$DIR/$f.tmp" || { rm -f "${DIR:?}/${f:?}.tmp"; die 1 err.download "$RAW_BASE/$ref/$f"; }
    mv "$DIR/$f.tmp" "$DIR/$f"
    say i.compose_got "$f" "$ref"
  done
}
release_ref() { # the compose file of the LATEST release (it only names an image tag: it works with any version you pin); the main branch if that cannot be read
  local tag
  tag=$(curl -fsSL -m 10 "$API_BASE/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  printf '%s' "${tag:-master}"
}

wait_healthy() {
  local mode="$1" url="$2" i cid st=""
  cid=$(cd "$DIR" && docker compose ps -q site 2>/dev/null | head -n1)
  for ((i = 0; i < HEALTH_SECONDS / 3; i++)); do
    st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)
    case "$st" in "running healthy") break ;; exited*|dead*) break ;; esac
    sleep "${CURIOSA_POLL_SECONDS:-3}"
  done
  if [ "$st" != "running healthy" ]; then
    say e.not_ready
    ( cd "$DIR" && docker compose logs --tail 30 site 2>&1 ) | sed 's/^/    /'
    exit 10
  fi
  say f.title
  say f.up "$url"
  say f.setup "$url/admin/setup"
  if [ -n "$SETUP" ]; then say f.code "$DIR"; fi
  case "$mode" in
    host) say f.host "$PORT" ;;
    caddy|traefik) say f.https "$DOMAIN" ;;
  esac
  say f.update "$DIR" "$UPDATE_COMMAND"
  say f.rerun
  if [ "$WARNINGS" != 0 ]; then say f.warnings "$WARNINGS"; fi
  exit 0
}

catalog_en() { cat <<'CATALOG_EN'
lang.name English
lbl.warn WARNING
lbl.error ERROR
t.title Curiosa with Docker: guided installation.
t.plan What will be done:
t.dry Dry run: nothing was changed. These values would be written to .env:
q.domain Domain name of your site (empty = a trial on this machine only):
q.email E-mail for the HTTPS certificate (optional):
q.setup Setup code asked by the setup page (Enter = use the one proposed):
c.go Go ahead? (y/N)
c.install_docker Install Docker now with the official script? (y/N)
i.proxy_caddy HTTPS: the bundled Caddy gets and renews the certificate by itself (ports 80 and 443).
i.proxy_traefik HTTPS: your Traefik on this machine serves the site (nothing is published on the host).
i.proxy_host HTTPS: something already uses ports 80 or 443 here. The site is published on this machine only, and your own web server must forward to it.
i.proxy_none No domain given: a trial on this machine only, without HTTPS.
i.dns_ok DNS: {1} points to this machine ({2}).
i.env_written Settings saved in {1}.
i.compose_kept Kept {1} as it is.
i.compose_got Downloaded {1} (version {2}).
p.dir Folder: {1}
p.env Settings file: {1} (existing values are kept)
p.pull Image: {1}
p.up Start with: docker compose up -d
p.host_proxy Forward your web server to 127.0.0.1:{1}.
p.install_docker Docker is missing: it would be installed with the official script (get.docker.com).
w.memory Only {1} MB of memory: Curiosa runs better with at least 1 GB.
w.dns_none The domain {1} does not resolve yet. Create an A record that points to {2}, then wait a few minutes. HTTPS will not work before that.
w.dns_other The domain {1} points to {2}, not to this machine ({3}). Check your DNS records. HTTPS will not work before that.
w.port Port 3000 is busy: using {1} instead.
e.not_ready The site does not answer yet. The last lines of its journal:
f.title Curiosa is running.
f.up The site: {1}
f.setup Finish the setup here: {1}
f.code The setup code is in {1}/.env (line SETUP_TOKEN). Read it yourself: it is not shown here.
f.host Point your web server to http://127.0.0.1:{1}, with HTTPS, then open the address above.
f.https HTTPS for {1} is requested automatically; it can take a minute. If the page does not open, check that the DNS points here and that ports 80 and 443 are open.
f.update To update later, in {1}: {2}
f.rerun You can run this script again at any time: it keeps your settings and deletes nothing.
f.warnings {1} warning(s) above: please read them.
err.option_value The option {1} needs a value.
err.option_unknown Unknown option: {1}. See --help.
err.domain "{1}" is not a valid domain name (for example example.org).
err.email "{1}" is not a valid e-mail address.
err.setup The setup code must have 8 to 64 letters, digits, dots, dashes or underscores.
err.proxy Unknown proxy mode "{1}". Choose caddy, traefik, host or none.
err.version Unknown version "{1}". Use X.Y.Z, X.Y or latest.
err.ids PUID and PGID must be whole numbers from 1 to 65534 (not 0).
err.datadir "{1}" is not a usable absolute folder path.
err.docker_missing Docker is not installed. Install it from https://docs.docker.com/engine/install/ (on a NAS, use its Docker package), or run this script again with --install-docker.
err.docker_nolinux --install-docker only works on Linux. Install Docker Desktop or your NAS Docker package instead.
err.docker_daemon Docker is installed but does not answer. Start it, or check that you may use it (is your account in the docker group?).
err.compose_missing Docker Compose (v2) is missing. Update Docker, or install the compose plugin.
err.compose_old Docker Compose {1} is too old: version 2 or newer is needed.
err.traefik_compose Docker Compose {1} is too old for the Traefik file: version 2.24 or newer is needed.
err.cancel Cancelled. Nothing was changed.
err.mkdir Cannot create the folder {1}.
err.nocurl curl is needed to download the compose file. Install it, or copy docker-compose.yml into the folder yourself.
err.download Cannot download {1}.
err.pull Cannot pull the image. Check your Internet connection and that ghcr.io is reachable.
err.up Docker could not start the site. See: docker compose logs
CATALOG_EN
}
catalog_fr() { cat <<'CATALOG_FR'
lang.name Français
lbl.warn ATTENTION
lbl.error ERREUR
t.title Curiosa avec Docker : installation guidée.
t.plan Ce qui va être fait :
t.dry Essai à blanc : rien n'a été modifié. Ces valeurs seraient écrites dans .env :
q.domain Nom de domaine de votre site (vide = un essai sur cette machine seulement) :
q.email Adresse e-mail pour le certificat HTTPS (facultatif) :
q.setup Code d'installation demandé par la page de réglage (Entrée = celui proposé) :
c.go On continue ? (o/N)
c.install_docker Installer Docker maintenant avec le script officiel ? (o/N)
i.proxy_caddy HTTPS : le Caddy fourni obtient et renouvelle le certificat tout seul (ports 80 et 443).
i.proxy_traefik HTTPS : votre Traefik présent sur cette machine sert le site (rien n'est publié sur la machine).
i.proxy_host HTTPS : les ports 80 ou 443 sont déjà pris ici. Le site est publié sur cette machine seulement, et votre propre serveur web doit lui transmettre les visites.
i.proxy_none Aucun domaine donné : un essai sur cette machine seulement, sans HTTPS.
i.dns_ok DNS : {1} pointe vers cette machine ({2}).
i.env_written Réglages enregistrés dans {1}.
i.compose_kept {1} conservé tel quel.
i.compose_got {1} téléchargé (version {2}).
p.dir Dossier : {1}
p.env Fichier de réglages : {1} (les valeurs existantes sont conservées)
p.pull Image : {1}
p.up Démarrage avec : docker compose up -d
p.host_proxy Faites transmettre votre serveur web vers 127.0.0.1:{1}.
p.install_docker Docker est absent : il serait installé avec le script officiel (get.docker.com).
w.memory Seulement {1} Mo de mémoire : Curiosa fonctionne mieux avec au moins 1 Go.
w.dns_none Le domaine {1} ne répond pas encore. Créez un enregistrement de type A qui pointe vers {2}, puis attendez quelques minutes. HTTPS ne marchera pas avant.
w.dns_other Le domaine {1} pointe vers {2}, pas vers cette machine ({3}). Vérifiez vos enregistrements DNS. HTTPS ne marchera pas avant.
w.port Le port 3000 est pris : le port {1} est utilisé à la place.
e.not_ready Le site ne répond pas encore. Les dernières lignes de son journal :
f.title Curiosa fonctionne.
f.up Le site : {1}
f.setup Terminez la mise en place ici : {1}
f.code Le code d'installation est dans {1}/.env (ligne SETUP_TOKEN). Lisez-le vous-même : il n'est pas affiché ici.
f.host Faites pointer votre serveur web vers http://127.0.0.1:{1}, avec HTTPS, puis ouvrez l'adresse ci-dessus.
f.https HTTPS pour {1} est demandé automatiquement ; cela peut prendre une minute. Si la page ne s'ouvre pas, vérifiez que le DNS pointe ici et que les ports 80 et 443 sont ouverts.
f.update Pour mettre à jour plus tard, dans {1} : {2}
f.rerun Vous pouvez relancer ce script à tout moment : il garde vos réglages et ne supprime rien.
f.warnings {1} avertissement(s) ci-dessus : lisez-les.
err.option_value L'option {1} demande une valeur.
err.option_unknown Option inconnue : {1}. Voir --help.
err.domain « {1} » n'est pas un nom de domaine valide (par exemple example.org).
err.email « {1} » n'est pas une adresse e-mail valide.
err.setup Le code d'installation doit avoir de 8 à 64 lettres, chiffres, points, tirets ou tirets bas.
err.proxy Mode de proxy inconnu « {1} ». Choisissez caddy, traefik, host ou none.
err.version Version inconnue « {1} ». Utilisez X.Y.Z, X.Y ou latest.
err.ids PUID et PGID doivent être des nombres entiers de 1 à 65534 (pas 0).
err.datadir « {1} » n'est pas un chemin de dossier absolu utilisable.
err.docker_missing Docker n'est pas installé. Installez-le depuis https://docs.docker.com/engine/install/ (sur un NAS, utilisez son paquet Docker), ou relancez ce script avec --install-docker.
err.docker_nolinux --install-docker ne fonctionne que sous Linux. Installez plutôt Docker Desktop ou le paquet Docker de votre NAS.
err.docker_daemon Docker est installé mais ne répond pas. Démarrez-le, ou vérifiez que vous avez le droit de l'utiliser (votre compte est-il dans le groupe docker ?).
err.compose_missing Docker Compose (v2) est absent. Mettez Docker à jour, ou installez le module compose.
err.compose_old Docker Compose {1} est trop ancien : la version 2 ou plus récente est nécessaire.
err.traefik_compose Docker Compose {1} est trop ancien pour le fichier Traefik : la version 2.24 ou plus récente est nécessaire.
err.cancel Annulé. Rien n'a été modifié.
err.mkdir Impossible de créer le dossier {1}.
err.nocurl curl est nécessaire pour télécharger le fichier compose. Installez-le, ou copiez vous-même docker-compose.yml dans le dossier.
err.download Impossible de télécharger {1}.
err.pull Impossible de récupérer l'image. Vérifiez votre connexion Internet et que ghcr.io est joignable.
err.up Docker n'a pas pu démarrer le site. Voir : docker compose logs
CATALOG_FR
}

main "$@"
