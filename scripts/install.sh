#!/usr/bin/env bash
# install.sh : installs Curiosa on a Linux server (x86_64) from the latest STABLE release.
#            : installe Curiosa sur un serveur Linux (x86_64) à partir de la dernière release STABLE.
#
# Languages / Langues : English (en) and français (fr). Choice, in this order:
#   --lang fr|en, then the CURIOSA_LANG variable, then LC_ALL / LC_MESSAGES / LANG. If none of them is clear (no
#   language, "C", "POSIX" or a language not offered) and you are in a terminal, the script asks once; otherwise it
#   uses English. Exit codes, option names and every file written on the server are the same in every language.
#   --lang fr|en, puis la variable CURIOSA_LANG, puis LC_ALL / LC_MESSAGES / LANG. Si rien n'est clair (pas de langue,
#   « C », « POSIX » ou une langue non proposée) et que vous êtes dans un terminal, le script pose la question une
#   fois ; sinon il parle anglais. Codes de sortie, noms d'options et fichiers écrits sur le serveur : identiques
#   dans toutes les langues.
#   To add a language / Pour ajouter une langue : docs/INSTALL.md, section « Languages / Langues ».
#
# Usage, in two readable steps (never "curl | bash") / en deux temps lisibles (jamais « curl | bash ») :
#   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
#   less install.sh        # (optional / facultatif) read the file before running it / relire avant de l'exécuter
#   sudo bash install.sh
#
# The script asks at most three questions (site name, domain name, dedicated Linux user); each has an option so that
# an AI or a script can drive it without interaction / chacune a son option pour qu'une IA ou un script le pilote :
#   --site NAME       short lowercase name (names /var/www/NAME and the NAME.service service)
#   --domain DOMAIN   domain name of the site (--no-domain: trial without a domain, local HTTP only)
#   --user USER       dedicated Linux user (suggested: NAME-web)
#   --port PORT       local port of the site (default: the first free one from 3000)
#   --dir FOLDER      installation folder (default: /var/www/NAME)
#   --tag vX.Y.Z      install this exact release (default: the latest stable release)
#   --yes             answer "yes" to confirmations (install Node.js, Caddy, open 80/443 in ufw…)
#   --dry-run         check everything and announce what would be done, WITHOUT changing anything
#   --skip-dns-check  do not stop if the domain does not point (yet) to this server
#   --skip-proxy      do not touch the web server (HTTPS): the site only listens locally
#   --uninstall       stop the site and undo the added configuration (keeps the folder and the data)
#   --purge           with --uninstall: also delete the folder and the user (typed confirmation, backup made first)
#   --change-domain DOMAIN  change the domain of an installed site (with --site): a PLAN by default, nothing is changed
#   --apply           with --change-domain: do it (backups, our web server file, .env, restart); only files marked "Géré par install-curiosa"
#   --lang fr|en      language of the messages (see above)
#   --help
#
# The script can be resumed: run again after a failure, it detects what is done and goes on.
# Le script est reprenable : relancé après un échec, il détecte ce qui est fait et continue.
# Exit codes / Codes de sortie : 0 done ; 1 stopped on an error (nothing broken, see the message) ; 2 unknown option
# or language ; 10 installed (or domain changed), but the public address does not answer yet or a manual step remains (DNS, firewall, certificate: see the last page).
#
# Where the texts live / Où sont les textes : every sentence shown to the person is in a catalogue at the end of this
# file (catalog_en, catalog_fr), one line per message: « key text with {1} {2} placeholders ». The code only uses keys.
# This file stays ONE standalone file (it is downloaded alone, next to the archive): do not move the catalogues out.
# Tout texte affiché est dans un catalogue en fin de fichier ; le code n'utilise que des clés. Fichier UNIQUE et autonome.
#
# TEST variables (only used by the automatic tests, see tests/core/install-script.test.mjs):
#   CURIOSA_ROOT (fake prefix for /etc, /var… ; then accepts local http URLs), CURIOSA_ALLOW_NONROOT, CURIOSA_UNAME_M,
#   CURIOSA_OS_RELEASE, CURIOSA_GITHUB_API, CURIOSA_GITHUB_WEB, CURIOSA_PUBLIC_IP, CURIOSA_DOMAIN_IP, CURIOSA_VERIFY_URL,
#   CURIOSA_PORT_START, CURIOSA_MIN_FREE_MB.
set -euo pipefail

# ─── Réglages ───────────────────────────────────────────────────────────────────────────────────────────────────────
REPO="${CURIOSA_REPO:-helldog136/Curiosa}"
ROOT="${CURIOSA_ROOT:-}"
GITHUB_API="${CURIOSA_GITHUB_API:-https://api.github.com}"
GITHUB_WEB="${CURIOSA_GITHUB_WEB:-https://github.com}"
PORT_START="${CURIOSA_PORT_START:-3000}"
MIN_FREE_MB="${CURIOSA_MIN_FREE_MB:-2000}"
NODE_MAJOR_WANTED=22
MARKER_NAME=".install-curiosa"
# Langues proposées (un bloc catalog_XX par langue, en fin de fichier). La première est la langue par défaut.
LANGS="en fr"
# Langue de l'assistant /admin/setup tant qu'on n'en choisit pas une autre (voir SetupWizard.tsx) : sert à l'indice de la page finale.
WIZARD_LANG=fr

SITE="" DOMAIN="" SITE_USER="" PORT="" DIR="" TAG="" NO_DOMAIN=0
YES=0 DRY=0 SKIP_DNS=0 SKIP_PROXY=0 UNINSTALL=0 PURGE=0 APPLY=0 CHANGE_DOMAIN="" CERTBOT=0 EMAIL="" CERT_DONE=0
LANG_OPT="" LANG_CODE="" LANG_AMBIGUOUS=0
CAT_CUR="" CAT_EN="" MSG="" RAW=""

# ─── Textes : lecture du catalogue ──────────────────────────────────────────────────────────────────────────────────
# Un catalogue = lignes « clé texte » (clé sans espace ; texte avec {1} {2}… = arguments ; une clé seule = texte vide).
# Sans tableau associatif (bash 3 suffit) : le catalogue est une chaîne, la clé se cherche en début de ligne.
lookup() { # lookup CATALOGUE CLÉ -> RAW ; code 1 si la clé n'existe pas
  local c="$1" k="$2" rest
  case "$c" in
    *$'\n'"$k "*) rest="${c#*$'\n'"$k "}"; RAW="${rest%%$'\n'*}"; return 0 ;;
    *$'\n'"$k"$'\n'*) RAW=""; return 0 ;;
  esac
  return 1
}
has_msg() { lookup "$CAT_CUR" "$1" || lookup "$CAT_EN" "$1"; }
_render() { # _render CLÉ args... -> MSG (clé absente de la langue : repli sur l'anglais, puis sur « [clé] »)
  local key="$1" raw pre d out=""; shift
  local -a a=("$@")
  [ -n "$CAT_EN" ] || { [ -n "$LANG_CODE" ] || LANG_CODE=en; load_catalogs; }   # message avant le choix de la langue (erreur très précoce)
  if lookup "$CAT_CUR" "$key"; then raw="$RAW"; elif lookup "$CAT_EN" "$key"; then raw="$RAW"; else MSG="[$key]"; return 0; fi
  while :; do
    case "$raw" in *\{[0-9]\}*) ;; *) break ;; esac
    pre="${raw%%\{[0-9]\}*}"; d="${raw:${#pre}+1:1}"
    # shellcheck disable=SC2004  # $d est un chiffre 1 à 9
    out+="$pre${a[$((d - 1))]:-}"; raw="${raw:${#pre}+3}"
  done
  MSG="$out$raw"
  return 0
}
t() { _render "$@"; printf '%s' "$MSG"; }              # t CLÉ args... : le texte, sans retour à la ligne
_render_n() { # _render_n CLÉ N args... : singulier/pluriel (CLÉ.one / CLÉ.other ; {1} = N) ; « plural.zero » dit la forme de 0
  local key="$1" n="$2" form=other; shift 2
  if [ "$n" = 1 ]; then form=one; elif [ "$n" = 0 ]; then _render plural.zero; form="$MSG"; fi
  _render "$key.$form" "$n" "$@"
}
tn() { _render_n "$@"; printf '%s' "$MSG"; }          # tn CLÉ N args... : le texte au bon nombre
load_catalogs() {
  CAT_EN=$'\n'"$(catalog_en)"$'\n'
  if [ "$LANG_CODE" = en ] || [ -z "$LANG_CODE" ]; then CAT_CUR="$CAT_EN"; else CAT_CUR=$'\n'"$("catalog_$LANG_CODE")"$'\n'; fi
}

# ─── Choix de la langue ─────────────────────────────────────────────────────────────────────────────────────────────
norm_lang() { # « fr_BE.UTF-8 » -> fr ; « C », « POSIX », vide -> c
  local v; v=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z')
  v="${v%%.*}"; v="${v%%@*}"; v="${v%%_*}"; v="${v%%-*}"
  case "$v" in ""|posix) v=c ;; esac
  printf '%s' "$v"
}
lang_supported() { local l; for l in $LANGS; do [ "$l" = "$1" ] && return 0; done; return 1; }
detect_lang() { # --lang > CURIOSA_LANG > LC_ALL > LC_MESSAGES > LANG ; sinon anglais, « ambigu » si rien n'est clair
  local c v
  LANG_AMBIGUOUS=0
  if [ -n "$LANG_OPT" ]; then LANG_CODE=$(norm_lang "$LANG_OPT"); return 0; fi   # déjà validé par pre_scan_lang
  if [ -n "${CURIOSA_LANG:-}" ]; then c=$(norm_lang "$CURIOSA_LANG"); if lang_supported "$c"; then LANG_CODE="$c"; return 0; fi; fi
  for v in "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
    [ -n "$v" ] || continue
    c=$(norm_lang "$v")
    if lang_supported "$c"; then LANG_CODE="$c"; return 0; fi
    break   # la première variable renseignée l'emporte (règle POSIX), même si elle ne nous dit rien
  done
  LANG_CODE="${LANGS%% *}"; LANG_AMBIGUOUS=1
}
pre_scan_lang() { # lit --lang avant tout le reste, pour que même les erreurs d'options parlent la bonne langue
  local c
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --lang) if [ "$#" -ge 2 ]; then LANG_OPT="$2"; shift; fi ;;
      --lang=*) LANG_OPT="${1#--lang=}" ;;
    esac
    shift
  done
  if [ -n "$LANG_OPT" ]; then
    c=$(norm_lang "$LANG_OPT")
    lang_supported "$c" || { printf 'Langue inconnue / Unknown language: %s (%s)\n' "$LANG_OPT" "${LANGS// /, }" >&2; exit 2; }
  fi
}
lang_name() { local save="$CAT_CUR"; CAT_CUR=$'\n'"$("catalog_$1")"$'\n'; _render lang.name; CAT_CUR="$save"; printf '%s' "$MSG"; }
ask_lang() { # une seule question, bilingue, seulement si on ne peut pas deviner ; Entrée = langue par défaut
  local l i=1 ans pick=""
  printf '\nLanguage / Langue :\n'
  for l in $LANGS; do printf '  %s) %s\n' "$i" "$(lang_name "$l")"; i=$((i + 1)); done
  read -r -p "Choice / Choix [1] : " ans || ans=""
  ans=$(norm_lang "$ans"); i=1
  for l in $LANGS; do case "$ans" in "$i"|"$l"*) [ -n "$pick" ] || pick="$l" ;; esac; i=$((i + 1)); done
  [ -n "$pick" ] || pick="${LANGS%% *}"
  LANG_CODE="$pick"; load_catalogs
}

# ─── Affichage ──────────────────────────────────────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'; else B="" R="" G="" Y="" N=""; fi
# Toutes ces fonctions prennent une CLÉ de catalogue puis ses arguments.
say()  { _render "$@"; printf '%s\n' "$MSG"; }
info() { _render "$@"; printf '  %s\n' "$MSG"; }
sub()  { _render "$@"; printf '     %s\n' "$MSG"; }
info_n() { _render_n "$@"; printf '  %s\n' "$MSG"; }
bullet() { _render "$@"; printf '  - %s\n' "$MSG"; }
blank() { printf '\n'; }
ok()   { _render "$@"; printf '%s  %s%s  %s\n' "$G" "$(t lbl.ok)" "$N" "$MSG"; }
warn() { _render "$@"; printf '%s%s%s  %s\n' "$Y" "$(t lbl.warn)" "$N" "$MSG" >&2; }
title(){ _render "$@"; printf '\n%s%s%s\n' "$B" "$MSG" "$N"; }

STEP=step.prep; REPORTED=0; LOG=""
# report_error CLÉ args… : « ERREUR  ce qui ne va pas » puis « Que faire : … » (texte de CLÉ.fix s'il existe) : un seul remède par erreur.
report_error() {
  local key="$1"; shift
  _render "$key" "$@"; printf '\n%s%s%s  %s\n' "$R" "$(t lbl.error)" "$N" "$MSG" >&2
  if has_msg "$key.fix"; then _render "$key.fix" "$@"; printf '        %s %s\n' "$(t lbl.fix)" "$MSG" >&2; fi
  if [ -n "$LOG" ] && [ -s "$LOG" ]; then printf '        %s %s\n' "$(t lbl.details)" "$LOG" >&2; fi
  return 0
}
fail() { REPORTED=1; report_error "$@"; exit 1; }
on_exit() {
  local rc=$?
  set +e
  [ -n "${STAGING:-}" ] && [ -d "${STAGING:-}" ] && rm -rf -- "$STAGING"
  if [ "$rc" -ne 0 ] && [ "$REPORTED" -eq 0 ] && [ "$rc" -ne 10 ] && [ "$rc" -ne 2 ]; then
    report_error err.unexpected "$(t "$STEP")"
  fi
}

rp() { printf '%s%s' "$ROOT" "$1"; }          # chemin réel d'un chemin logique (préfixe fictif en test)
have() { command -v "$1" >/dev/null 2>&1; }
interactive() { [ -t 0 ]; }

# Lance une commande dont la sortie va dans le journal ; en cas d'échec : l'erreur CLÉ (avec ARG), après les dernières lignes du journal.
logged() { # logged CLÉ ARG commande...
  local key="$1" arg="$2"; shift 2
  [ -n "$LOG" ] && printf '\n$ %s\n' "$*" >>"$LOG"
  if ! "$@" >>"${LOG:-/dev/null}" 2>&1; then
    [ -n "$LOG" ] && tail -n 12 "$LOG" >&2
    fail "$key" "$arg"
  fi
}

is_yes() { # la réponse est-elle un « oui » ? (y, yes, o, oui dans toutes les langues + les mots du catalogue)
  local a w; a=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  # shellcheck disable=SC2046  # la liste de mots du catalogue est découpée volontairement
  for w in y yes o oui $(t yn.yes); do [ "$a" = "$w" ] && return 0; done
  return 1
}
# consent CLÉ args… : oui si --yes ou réponse « oui » ; sans terminal et sans --yes : s'arrête en disant comment répondre.
consent() {
  local q ans; q=$(t "$@")
  if [ "$YES" -eq 1 ]; then info consent.yes "$q"; return 0; fi
  if ! interactive; then fail consent.need "$q"; fi
  read -r -p "  $(t prompt.consent "$q") " ans || ans=""
  is_yes "$ans"
}
# ask VARIABLE CLÉ "défaut" [marge] : valeur déjà fournie par une option > question > défaut.
ask() {
  local var="$1" key="$2" def="${3:-}" pad="${4:-}" ans="" q
  [ -n "${!var}" ] && return 0
  q=$(t "$key")
  if interactive; then
    if [ -n "$def" ]; then read -r -p "  $pad$(t prompt.ask_def "$q" "$def") " ans || ans=""; else read -r -p "  $pad$(t prompt.ask "$q") " ans || ans=""; fi
    printf -v "$var" '%s' "${ans:-$def}"
  elif [ -n "$def" ]; then
    printf -v "$var" '%s' "$def"
  fi
}

# ─── Options ────────────────────────────────────────────────────────────────────────────────────────────────────────
usage() { # l'aide est le catalogue : help.01, help.02… (une clé seule = ligne vide)
  local n=1 k
  while :; do k=$(printf 'help.%02d' "$n"); has_msg "$k" || break; _render "$k"; printf '%s\n' "$MSG"; n=$((n + 1)); done
}
need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || { _render opt.needvalue "$1"; printf '%s\n' "$MSG" >&2; exit 2; }; }
parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --site) need_value "$@"; SITE="$2"; shift 2 ;;
      --domain) need_value "$@"; DOMAIN="$2"; shift 2 ;;
      --no-domain) NO_DOMAIN=1; shift ;;
      --user) need_value "$@"; SITE_USER="$2"; shift 2 ;;
      --port) need_value "$@"; PORT="$2"; shift 2 ;;
      --dir) need_value "$@"; DIR="$2"; shift 2 ;;
      --tag) need_value "$@"; TAG="$2"; shift 2 ;;
      --lang) need_value "$@"; shift 2 ;;     # déjà lu par pre_scan_lang
      --lang=*) need_value --lang "${1#--lang=}"; shift ;;
      --yes|-y) YES=1; shift ;;
      --dry-run) DRY=1; shift ;;
      --skip-dns-check) SKIP_DNS=1; shift ;;
      --skip-proxy) SKIP_PROXY=1; shift ;;
      --certbot) CERTBOT=1; shift ;;
      --email) need_value "$@"; EMAIL="$2"; shift 2 ;;
      --uninstall) UNINSTALL=1; shift ;;
      --purge) PURGE=1; shift ;;
      --change-domain) need_value "$@"; CHANGE_DOMAIN="$2"; shift 2 ;;
      --apply) APPLY=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) _render opt.unknown "$1"; printf '%s\n' "$MSG" >&2; exit 2 ;;
    esac
  done
}
check_urls() {
  if [ -z "$ROOT" ]; then
    case "$GITHUB_API$GITHUB_WEB" in *http://*) fail err.insecure_url ;; esac
  fi
}

# ─── Utilitaires de lecture seule ───────────────────────────────────────────────────────────────────────────────────
free_port() { # le port est-il à l'écoute (IPv4/IPv6, toutes interfaces) ? sans dépendre de `ss`
  local hex; hex=$(printf '%04X' "$1")
  local f
  for f in /proc/net/tcp /proc/net/tcp6; do
    [ -r "$f" ] || continue
    if awk -v h=":$hex" 'NR>1 && $4=="0A" && index($2,h)==length($2)-4 {f=1} END{exit f?0:1}' "$f"; then return 1; fi
  done
  if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then return 1; fi
  return 0
}
node_version_ok() { # $1 = « v22.3.0 »
  local v="${1#v}" maj min
  maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
  case "$maj$min" in *[!0-9]*|"") return 1 ;; esac
  [ "$maj" -gt 20 ] || { [ "$maj" -eq 20 ] && [ "$min" -ge 9 ]; }
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
http_code() { curl -s -o /dev/null -m 8 -w '%{http_code}' "$1" 2>/dev/null || true; }
unit_path() { rp "/etc/systemd/system/$1.service"; }
marker_get() { sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n1 || true; }

# ─── Désinstallation prudente ───────────────────────────────────────────────────────────────────────────────────────
# Les lignes « # Géré par install-curiosa » écrites dans les fichiers du serveur sont des MARQUES techniques : on les retrouve
# pour savoir ce qui est à nous, d'une version et d'une langue à l'autre. Elles ne se traduisent pas et ne changent jamais.
do_uninstall() {
  title un.title "$SITE"
  [ -n "$DIR" ] || DIR="/var/www/$SITE"
  local m; m="$(rp "$DIR")/$MARKER_NAME"
  [ -f "$m" ] && [ "$(marker_get "$m" site)" = "$SITE" ] || fail un.notfound "$SITE" "$DIR"
  SITE_USER=$(marker_get "$m" user)
  local u; u="$(unit_path "$SITE")"
  if [ -f "$u" ] && grep -q '^# Géré par install-curiosa' "$u"; then
    systemctl disable --now "$SITE.service" >/dev/null 2>&1 || true
    rm -f -- "$u"; systemctl daemon-reload || true; ok un.service_removed "$SITE"
  else info un.no_unit; fi
  local f reloaded=""
  for f in "$(rp /etc/nginx/sites-enabled/$SITE.conf)" "$(rp /etc/nginx/sites-available/$SITE.conf)" "$(rp /etc/nginx/conf.d/$SITE.conf)"; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      if [ -L "$f" ] || grep -q '^# Géré par install-curiosa' "$f" 2>/dev/null; then rm -f -- "$f"; reloaded=nginx; ok un.nginx_removed "$f"; fi
    fi
  done
  [ "$reloaded" = nginx ] && { nginx -t >/dev/null 2>&1 && systemctl reload nginx || warn un.nginx_warn; }
  f="$(rp /etc/apache2/sites-available/$SITE.conf)"
  if [ -f "$f" ] && grep -q '^# Géré par install-curiosa' "$f"; then a2dissite "$SITE" >/dev/null 2>&1 || true; rm -f -- "$f"; systemctl reload apache2 || true; ok un.apache_removed; fi
  f="$(rp /etc/caddy/sites/$SITE.caddy)"
  if [ -f "$f" ] && grep -q '^# Géré par install-curiosa' "$f"; then rm -f -- "$f"; systemctl reload caddy || true; ok un.caddy_removed; fi
  if [ "$PURGE" -ne 1 ]; then
    blank; say un.kept "$DIR" "$SITE_USER"
    say un.purge_hint "$SITE"
    return 0
  fi
  interactive || fail un.need_tty
  # Le nom du fichier de sauvegarde est le même dans toutes les langues (« sauvegarde » : nom de fichier, pas un message).
  local backup; backup="$(rp /root)/curiosa-$SITE-sauvegarde-$(date +%Y%m%d-%H%M%S).tar.gz"
  warn un.purge_warn "$DIR" "$SITE_USER"
  info un.backup_notice "$backup"
  local typed; read -r -p "  $(t prompt.purge "$SITE") " typed || typed=""
  [ "$typed" = "$SITE" ] || fail un.confirm_diff "$SITE"
  mkdir -p "$(dirname "$backup")"; (umask 077; tar -czf "$backup" -C "$(rp "$DIR")" --ignore-failed-read data .env 2>/dev/null) || fail un.backup_failed
  rm -rf -- "${ROOT}${DIR:?}"; userdel "$SITE_USER" >/dev/null 2>&1 || true
  ok un.purged "$backup"
}

# ─── Changer de domaine (--change-domain) ───────────────────────────────────────────────────────────────────────────
# Par défaut : un PLAN, rien n'est modifié. Avec --apply : sauvegarde du .env et des configurations, nouveau domaine dans .env (SITE_URL), ancien domaine ajouté à LEGACY_HOSTS (le site
# le redirige lui-même vers le nouveau), configuration du serveur web QUE CE SCRIPT A ÉCRITE (marque « Géré par install-curiosa ») mise à jour, redémarrage. Une configuration
# qui n'est pas la nôtre n'est jamais modifiée : on dit quoi y changer. Voir docs/MIGRER-DOMAINE.md.
valid_domain() { # le nom est-il un nom de domaine public ?
  printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$' || return 1
  case "$1" in *.localhost|*.local|*.internal|*.lan|*.home|*.home.arpa|*.corp|*.intranet|*.test|*.invalid|*.example) return 1 ;; esac
  return 0
}
env_value() { # env_value FICHIER CLÉ -> la valeur, sans guillemets
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n1 | sed -E 's/^"(.*)"$/\1/'
}
set_env_value() { # set_env_value FICHIER CLÉ VALEUR : remplace la ligne CLÉ=… ou l'ajoute à la fin ; propriétaire et droits du fichier inchangés
  local f="$1" k="$2" v="$3" tmp; tmp=$(mktemp)
  awk -v k="$k" -v v="$v" 'BEGIN { done = 0 } index($0, k "=") == 1 { print k "=\"" v "\""; done = 1; next } { print } END { if (!done) print k "=\"" v "\"" }' "$f" >"$tmp"
  cat "$tmp" >"$f"; rm -f -- "$tmp"
}
cd_backup() { # cd_backup FICHIER : copie datée à côté du fichier
  local bak; bak="$1.avant-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$1" "$bak"; CD_LAST_BACKUP="$bak"; info x.backup "$bak"
}

do_change_domain() {
  STEP=step.change
  local new old old_url cur d m envf names h
  new=$(printf '%s' "$CHANGE_DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#\.$##')
  [ -n "$SITE" ] || fail cd.site
  valid_domain "$new" || fail cd.domain_bad "$new"
  title cd.title "$SITE" "$new"
  [ "$(id -u)" -eq 0 ] || [ -n "$ROOT" ] || fail cd.root "$SITE" "$new"
  [ -n "$DIR" ] || DIR="/var/www/$SITE"
  d="$(rp "$DIR")"; m="$d/$MARKER_NAME"; envf="$d/.env"
  [ -f "$m" ] && [ "$(marker_get "$m" site)" = "$SITE" ] || fail cd.notfound "$SITE" "$DIR"
  PORT=$(marker_get "$m" port); [ -n "$PORT" ] || PORT=3000
  [ -f "$envf" ] || fail cd.noenv "$DIR"
  old_url=$(env_value "$envf" SITE_URL)
  case "$old_url" in
    https://*) old="${old_url#https://}"; old="${old%%/*}" ;;
    *) fail cd.nodomain "$SITE" "$old_url" ;;
  esac
  [ "$old" != "$new" ] || fail cd.same "$new"
  ok cd.current "$old"

  # anciens domaines déjà redirigés + celui-ci : dix au plus, sans doublon, jamais le nouveau
  cur=$(env_value "$envf" LEGACY_HOSTS)
  LEGACY_NEW="$old"
  for h in $(printf '%s' "$cur" | tr 'A-Z,;' 'a-z  '); do
    [ "$h" != "$new" ] || continue
    case ",$LEGACY_NEW," in *",$h,"*) continue ;; esac
    valid_domain "$h" || continue
    LEGACY_NEW="$LEGACY_NEW,$h"
  done
  LEGACY_NEW=$(printf '%s' "$LEGACY_NEW" | cut -d, -f1-10)
  names="$new $(printf '%s' "$LEGACY_NEW" | tr ',' ' ')"
  CERT_ARGS=""; for h in $names; do CERT_ARGS="$CERT_ARGS -d $h"; done

  # DNS du nouveau domaine
  DNS_OK=1; local ips="${CURIOSA_DOMAIN_IP:-}" pub=""
  [ -n "$ips" ] || ips=$(resolve_v4 "$new")
  [ "$ips" = none ] && ips=""
  pub=$(public_ip || true)
  if [ -z "$ips" ]; then DNS_OK=0; warn s.dns_none "$new"
  elif [ -z "$pub" ]; then warn s.dns_noip "$ips"
  else case " $ips " in *" $pub "*) ok s.dns_ok "$new" "$pub" ;; *) DNS_OK=0; warn s.dns_other "$new" "$ips" "$pub" ;; esac; fi

  # ce qui est à nous, ce qui ne l'est pas
  local nginx_conf="" apache_conf="" caddy_conf="" f foreign=0
  for f in "$(rp /etc/nginx/sites-available/$SITE.conf)" "$(rp /etc/nginx/conf.d/$SITE.conf)"; do
    [ -f "$f" ] || continue
    if grep -q '^# Géré par install-curiosa' "$f"; then nginx_conf="$f"; else warn x.conf_foreign "$f"; foreign=1; fi
  done
  f="$(rp /etc/apache2/sites-available/$SITE.conf)"
  if [ -f "$f" ]; then if grep -q '^# Géré par install-curiosa' "$f"; then apache_conf="$f"; else warn x.conf_foreign "$f"; foreign=1; fi; fi
  f="$(rp /etc/caddy/sites/$SITE.caddy)"
  if [ -f "$f" ]; then if grep -q '^# Géré par install-curiosa' "$f"; then caddy_conf="$f"; else warn x.conf_foreign "$f"; foreign=1; fi; fi
  local proxy_kind=""
  if [ -n "$nginx_conf" ]; then proxy_kind=nginx; elif [ -n "$apache_conf" ]; then proxy_kind=apache; elif [ -n "$caddy_conf" ]; then proxy_kind=caddy; fi
  if [ "$foreign" -eq 0 ] && [ -z "$proxy_kind" ]; then info cd.no_proxy; fi

  title cd.plan
  info cd.plan_env "$envf" "$old_url" "https://$new"
  info cd.plan_legacy "$LEGACY_NEW"
  [ -n "$nginx_conf" ] && info cd.plan_proxy "$nginx_conf" "$names"
  [ -n "$apache_conf" ] && info cd.plan_proxy "$apache_conf" "$names"
  [ -n "$caddy_conf" ] && info cd.plan_proxy "$caddy_conf" "$names"
  [ "$foreign" -eq 1 ] && info cd.plan_foreign
  case "$proxy_kind" in nginx|apache) info cd.plan_cert "sudo certbot --$proxy_kind$CERT_ARGS" ;; caddy) info cd.plan_cert_caddy ;; esac
  info cd.plan_restart "$SITE"

  if [ "$APPLY" -ne 1 ] || [ "$DRY" -eq 1 ]; then
    blank; say cd.dry "$B" "$N" "$SITE" "$new"
    return 0
  fi

  [ "$DNS_OK" -eq 1 ] || [ "$SKIP_DNS" -eq 1 ] || { sub s.dns_howto "$new" "${pub:-$(t s.dns_this_ip)}"; fail cd.dns_stop "$new"; }
  if [ "$YES" -eq 0 ]; then consent cd.go "$old" "$new" || { say c.stop; exit 0; }; fi
  LOG="$(rp /var/log)/curiosa-change-domain-$SITE.log"
  mkdir -p "$(dirname "$LOG")"; ( umask 077; : >>"$LOG" )

  # 1. le serveur web (si l'un de nos fichiers) : sauvegarde, nouveau nom, test, retour arrière au moindre refus
  CD_MANUAL=0
  STEP=step.proxy
  if [ -n "$nginx_conf" ]; then
    cd_backup "$nginx_conf"; local bak="$CD_LAST_BACKUP"
    sed -i -E "s/^([[:space:]]*server_name[[:space:]]+).*;/\\1$names;/" "$nginx_conf"
    if ! nginx -t >>"$LOG" 2>&1; then mv -- "$bak" "$nginx_conf"; tail -n 8 "$LOG" >&2; fail x.nginx_refused; fi
    if systemctl is-active --quiet nginx 2>/dev/null; then systemctl reload nginx; fi
    ok cd.proxy_done "$nginx_conf"
  elif [ -n "$apache_conf" ]; then
    cd_backup "$apache_conf"; local abak="$CD_LAST_BACKUP" aliases=""
    for h in $(printf '%s' "$LEGACY_NEW" | tr ',' ' '); do aliases="$aliases\\n    ServerAlias $h"; done
    sed -i -E "/^[[:space:]]*ServerAlias /d; s/^([[:space:]]*)ServerName .*/\\1ServerName $new$aliases/" "$apache_conf"
    if ! apachectl configtest >>"$LOG" 2>&1; then mv -- "$abak" "$apache_conf"; tail -n 8 "$LOG" >&2; fail x.apache_refused; fi
    systemctl reload apache2 || true
    ok cd.proxy_done "$apache_conf"
    [ -f "$(rp /etc/apache2/sites-available/$SITE-le-ssl.conf)" ] && { warn cd.apache_ssl "$SITE-le-ssl.conf"; CD_MANUAL=1; }
  elif [ -n "$caddy_conf" ]; then
    cd_backup "$caddy_conf"; local cbak="$CD_LAST_BACKUP"
    { proxy_marker; printf '%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$(printf '%s' "$names" | sed 's/ /, /g')" "$PORT"; } >"$caddy_conf"
    if have caddy && ! caddy validate --config "$(rp /etc/caddy/Caddyfile)" >>"$LOG" 2>&1; then mv -- "$cbak" "$caddy_conf"; tail -n 8 "$LOG" >&2; fail x.caddy_refused; fi
    systemctl reload caddy || systemctl restart caddy || true
    ok cd.proxy_done "$caddy_conf"
  fi
  [ "$foreign" -eq 0 ] || { warn cd.foreign_todo "$names" "$PORT"; CD_MANUAL=1; }

  # 2. le fichier de réglages du site
  STEP=step.env
  cd_backup "$envf"
  set_env_value "$envf" SITE_URL "https://$new"
  set_env_value "$envf" LEGACY_HOSTS "$LEGACY_NEW"
  ok cd.env_done "https://$new" "$LEGACY_NEW"

  # 3. redémarrage du site (il relit son fichier de réglages)
  STEP=step.unit
  local u; u="$(unit_path "$SITE")"
  if [ -f "$u" ] && grep -q '^# Géré par install-curiosa' "$u"; then
    systemctl restart "$SITE.service" >>"$LOG" 2>&1 || fail cd.restart_failed "$SITE"
    ok cd.restarted "$SITE"
  else
    warn cd.restart_manual "$SITE"; CD_MANUAL=1
  fi

  # 4. certificat (Caddy l'obtient seul ; nginx et Apache : certbot, avec votre accord)
  STEP=step.public
  case "$proxy_kind" in
    nginx|apache)
      local hint="sudo certbot --$proxy_kind$CERT_ARGS"
      if [ "$DNS_OK" -eq 0 ]; then info cd.cert_dns "$hint"; CD_MANUAL=1
      elif have certbot; then
        if consent cd.cert_ask "$hint"; then
          # shellcheck disable=SC2086  # CERT_ARGS est une suite d'options « -d nom » voulue
          if certbot "--$proxy_kind" $CERT_ARGS --non-interactive --redirect --expand >>"$LOG" 2>&1; then ok cd.cert_ok; else warn cd.cert_failed "$hint"; CD_MANUAL=1; fi
        else info cd.cert_hint "$hint"; CD_MANUAL=1; fi
      else info cd.cert_hint "$hint"; CD_MANUAL=1; fi ;;
    caddy) info cd.cert_caddy ;;
  esac

  # 5. le site répond-il à sa nouvelle adresse ?
  local url="${CURIOSA_VERIFY_URL:-https://$new/api/health}" public=1
  if [ "$proxy_kind" = "" ]; then public=0
  elif ! wait_http "$url" 30; then public=0; fi
  blank
  if [ "$public" -eq 1 ] && [ "$CD_MANUAL" -eq 0 ]; then say cd.done "$B" "$N" "$new"; else say cd.done_todo "$B" "$N" "$new"; fi
  bullet cd.next_check "$new"
  bullet cd.next_docs
  [ "$public" -eq 1 ] && [ "$CD_MANUAL" -eq 0 ] || exit 10
}

# ─── Phase A : constater l'environnement (lecture seule) ────────────────────────────────────────────────────────────
phase_detect() {
  STEP=step.detect
  title d.title
  if [ "$(id -u)" -ne 0 ] && ! { [ -n "$ROOT" ] && [ "${CURIOSA_ALLOW_NONROOT:-}" = 1 ]; }; then
    fail err.root
  fi
  local arch; arch="${CURIOSA_UNAME_M:-$(uname -m)}"
  case "$arch" in
    x86_64|amd64) ok d.arch_ok "$arch" ;;
    aarch64|arm64|armv*|arm*) fail d.arch_arm "$arch" ;;
    *) fail d.arch_unknown "$arch" ;;
  esac
  OS_ID="inconnu"; OS_LIKE=""; OS_NAME="Linux"
  local osr; osr="${CURIOSA_OS_RELEASE:-/etc/os-release}"
  # shellcheck disable=SC1090  # le fichier os-release est lu tel quel (variable de test CURIOSA_OS_RELEASE comprise)
  if [ -r "$osr" ]; then OS_ID=$(. "$osr"; printf '%s' "${ID:-inconnu}"); OS_LIKE=$(. "$osr"; printf '%s' "${ID_LIKE:-}"); OS_NAME=$(. "$osr"; printf '%s' "${PRETTY_NAME:-Linux}"); fi
  APT=0
  case " $OS_ID $OS_LIKE " in *" debian "*|*" ubuntu "*) APT=1 ;; esac
  if [ "$OS_ID" = alpine ]; then fail d.alpine; fi
  if [ "$APT" -eq 1 ]; then ok d.os_ok "$OS_NAME"; else warn d.os_warn "$OS_NAME"; fi
  if [ ! -d "$(rp /run/systemd/system)" ]; then
    fail d.no_systemd
  fi
  ok d.systemd_ok
  local mem; mem=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${mem:-0}" -gt 0 ] && [ "$mem" -lt 700 ]; then warn d.mem_low "$mem"; else ok d.mem_ok "$mem"; fi

  # outils
  MISSING_PKGS=()
  have curl || MISSING_PKGS+=(curl); have git || MISSING_PKGS+=(git); have tar || MISSING_PKGS+=(tar)
  have sha256sum || MISSING_PKGS+=(coreutils); have openssl || MISSING_PKGS+=(openssl); have gzip || MISSING_PKGS+=(gzip)
  local t; for t in getent useradd; do have "$t" || fail d.tool_passwd "$t"; done
  [ -n "$ROOT" ] || have runuser || fail d.tool_runuser runuser
  if [ "${#MISSING_PKGS[@]}" -eq 0 ]; then ok d.tools_ok; else info_n d.tools_todo "${#MISSING_PKGS[@]}" "${MISSING_PKGS[*]}"; fi

  # Node.js
  NODE_BIN=""; NODE_NEED=0
  if have node; then
    NODE_BIN=$(readlink -f "$(command -v node)")
    local nv; nv=$(node -v 2>/dev/null || echo "")
    case "$NODE_BIN" in /root/*|/home/*) NODE_NEED=1; warn d.node_home "$NODE_BIN" ;; esac
    if [ "$NODE_NEED" -eq 0 ]; then
      if node_version_ok "$nv"; then ok d.node_ok "$nv" "$NODE_BIN"; else NODE_NEED=1; warn d.node_old "$nv"; fi
    fi
  else NODE_NEED=1; info d.node_none; fi
  if [ "$NODE_NEED" -eq 1 ] && [ "$APT" -ne 1 ]; then
    fail d.node_manual "$OS_NAME"
  fi

  # serveur web déjà là ?
  WEB=""; WEB_ACTIVE=0
  local w unit
  for w in nginx apache2 httpd caddy; do
    unit="$w"
    if systemctl is-active --quiet "$unit" 2>/dev/null; then WEB="$w"; WEB_ACTIVE=1; break; fi
  done
  if [ -z "$WEB" ]; then for w in nginx apache2 httpd caddy; do if have "$w"; then WEB="$w"; break; fi; done; fi
  if [ -n "$WEB" ]; then ok d.web_found "$WEB" "$( [ "$WEB_ACTIVE" -eq 1 ] && t d.state_active || t d.state_stopped )"; else info d.web_none; fi
  UFW_ACTIVE=0; UFW_OPEN=1
  local ufw_out=""; have ufw && ufw_out=$(ufw status 2>/dev/null || true)
  if printf '%s\n' "$ufw_out" | grep -q '^Status: active'; then
    UFW_ACTIVE=1
    printf '%s\n' "$ufw_out" | grep -Eq '^(80|443)(/tcp)?[[:space:]]+ALLOW|^(Nginx|Apache|WWW) ' || UFW_OPEN=0
    ok d.ufw "$( [ "$UFW_OPEN" -eq 1 ] && t d.ufw_open || t d.ufw_closed )"
  fi
}

# ─── Phase B : questions, validations, état existant ────────────────────────────────────────────────────────────────
phase_ask() {
  STEP=step.ask
  title a.title
  ask SITE a.q_site
  [ -n "$SITE" ] || fail a.site_missing
  printf '%s' "$SITE" | grep -Eq '^[a-z][a-z0-9-]{1,30}$' || fail a.site_bad "$SITE"
  if [ "$NO_DOMAIN" -eq 0 ] && [ -z "$DOMAIN" ] && interactive; then
    info a.q_domain
    read -r -p "     $(t prompt.domain) " DOMAIN || DOMAIN=""
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#\.$##')
  if [ -z "$DOMAIN" ]; then
    [ "$NO_DOMAIN" -eq 1 ] || interactive || fail a.domain_missing
    NO_DOMAIN=1
  else
    printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$' || fail a.domain_bad "$DOMAIN"
  fi
  info a.q_user
  ask SITE_USER a.q_user_label "$SITE-web" "   "
  [ -n "$SITE_USER" ] || SITE_USER="$SITE-web"
  printf '%s' "$SITE_USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || fail a.user_bad "$SITE_USER" "$SITE"
  [ "$SITE_USER" != root ] || fail a.user_root "$SITE"
  [ -n "$DIR" ] || DIR="/var/www/$SITE"
  case "$DIR" in /*) ;; *) fail a.dir_abs "$SITE" ;; esac
  case "$DIR" in /|/etc*|/usr*|/bin*|/sbin*|/lib*|/boot*|/dev*|/proc*|/sys*|/root|/home) fail a.dir_reserved "$DIR" "$SITE" ;; esac

  STEP=step.state
  title s.title
  RESUME=0; local d m; d="$(rp "$DIR")"; m="$d/$MARKER_NAME"
  if [ -e "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
    if [ -f "$m" ]; then
      [ "$(marker_get "$m" site)" = "$SITE" ] || fail s.other_install "$DIR" "$(marker_get "$m" site)"
      RESUME=1; PORT_FROM_MARKER=$(marker_get "$m" port)
      local mu; mu=$(marker_get "$m" user); [ -n "$mu" ] && [ "$mu" != "$SITE_USER" ] && { warn s.user_kept "$mu"; SITE_USER="$mu"; }
      [ -z "$PORT" ] && PORT="$PORT_FROM_MARKER"
      ok s.resume "$DIR"
    else
      fail s.not_empty "$DIR"
    fi
  else ok s.dir_free "$DIR"; fi
  USER_EXISTS=0
  if getent passwd "$SITE_USER" >/dev/null 2>&1; then
    USER_EXISTS=1; local home; home=$(getent passwd "$SITE_USER" | cut -d: -f6)
    [ "$home" = "$DIR" ] || fail s.user_other_home "$SITE_USER" "$home" "$SITE"
    info s.user_reuse "$SITE_USER"
  fi
  UNIT="$(unit_path "$SITE")"; UNIT_OURS=0
  if [ -f "$UNIT" ]; then
    grep -q '^# Géré par install-curiosa' "$UNIT" || fail s.unit_foreign "$SITE"
    UNIT_OURS=1
  fi
  # port
  if [ -n "$PORT" ]; then
    printf '%s' "$PORT" | grep -Eq '^[0-9]{2,5}$' && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail s.port_bad "$PORT"
    if [ "$RESUME" -eq 0 ] || [ "$UNIT_OURS" -eq 0 ]; then free_port "$PORT" || fail s.port_busy "$PORT"; fi
  else
    PORT="$PORT_START"
    while ! free_port "$PORT"; do info s.port_next "$PORT"; PORT=$((PORT + 1)); [ "$PORT" -lt $((PORT_START + 200)) ] || fail s.port_none "$PORT_START"; done
  fi
  ok s.port_ok "$PORT"
  # espace disque
  local anc="$d"; while [ ! -e "$anc" ]; do anc=$(dirname "$anc"); done
  local freemb; freemb=$(df -Pk "$anc" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024}'); freemb=${freemb:-0}
  [ "$RESUME" -eq 1 ] || { [ "$freemb" -ge "$MIN_FREE_MB" ] || fail s.disk_low "$freemb" "$MIN_FREE_MB"; }
  ok s.disk_ok "$freemb"

  # DNS
  DNS_OK=1; PUBLIC_IP=""
  if [ "$NO_DOMAIN" -eq 0 ]; then
    local ips="${CURIOSA_DOMAIN_IP:-}"; [ -n "$ips" ] || ips=$(resolve_v4 "$DOMAIN")
    [ "$ips" = none ] && ips=""
    PUBLIC_IP=$(public_ip || true)
    if [ -z "$ips" ]; then
      DNS_OK=0; warn s.dns_none "$DOMAIN"
    elif [ -z "$PUBLIC_IP" ]; then
      warn s.dns_noip "$ips"
    else
      case " $ips " in
        *" $PUBLIC_IP "*) ok s.dns_ok "$DOMAIN" "$PUBLIC_IP" ;;
        *) DNS_OK=0; warn s.dns_other "$DOMAIN" "$ips" "$PUBLIC_IP" ;;
      esac
    fi
    if [ "$DNS_OK" -eq 0 ]; then
      if [ "$SKIP_DNS" -eq 1 ]; then info s.dns_skip
      else
        sub s.dns_howto "$DOMAIN" "${PUBLIC_IP:-$(t s.dns_this_ip)}"
        sub s.dns_cloudflare
        if [ "$YES" -eq 1 ] || ! interactive; then
          fail s.dns_stop
        fi
        consent s.dns_ask || fail s.dns_declined
      fi
    fi
  fi
  [ "$NO_DOMAIN" -eq 1 ] && SKIP_PROXY=1
  if [ "$NO_DOMAIN" -eq 1 ]; then SITE_URL="http://localhost:$PORT"; else SITE_URL="https://$DOMAIN"; fi
}

# ─── HTTPS certificate with certbot (nginx and Apache only; opt-in: --certbot, or a "yes" to the question at the end of the proxy step) ───────────────
valid_email() { printf '%s' "$1" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; }
certbot_kind() { case "$PROXY_PLAN" in nginx) echo nginx ;; apache2|httpd) echo apache ;; esac; }
# plan_certbot: with --certbot, checks the e-mail and announces what will (or will not) happen. Runs before --dry-run stops, so the dry-run is accurate.
plan_certbot() {
  [ "$CERTBOT" -eq 1 ] || return 0
  if [ "$NO_DOMAIN" -eq 1 ] || [ "$SKIP_PROXY" -eq 1 ]; then info p.certbot_none; return 0; fi
  if [ -z "$(certbot_kind)" ]; then info p.certbot_caddy; return 0; fi
  if [ "$DNS_OK" -eq 0 ]; then info p.certbot_dns "$DOMAIN"; return 0; fi
  if [ -z "$EMAIL" ] && [ "$DRY" -eq 0 ]; then ask EMAIL cert.email_q ""; fi
  [ -n "$EMAIL" ] || fail cert.email_missing
  valid_email "$EMAIL" || fail cert.email_bad "$EMAIL"
  info p.certbot "$DOMAIN" "$EMAIL"
}
# obtain_certificate: end of the proxy step. Never fatal: on any problem the site stays in HTTP and the usual hint stays.
obtain_certificate() {
  local kind; kind=$(certbot_kind)
  [ -n "$kind" ] && [ -n "${CERT_HINT:-}" ] || return 0
  [ "$NO_DOMAIN" -eq 0 ] || return 0
  if [ "$DNS_OK" -eq 0 ]; then [ "$CERTBOT" -eq 0 ] || warn cert.skip_dns "$DOMAIN"; return 0; fi
  if [ "$WEB_ACTIVE" -ne 1 ]; then [ "$CERTBOT" -eq 0 ] || warn cert.skip_stopped; return 0; fi
  if [ "$CERTBOT" -eq 0 ]; then
    # a plain "yes" typed in a terminal; --yes alone never accepts the Let's Encrypt terms
    { [ "$YES" -eq 0 ] && interactive; } || return 0
    local q ans; q=$(t cert.ask)
    read -r -p "  $(t prompt.consent "$q") " ans || ans=""
    is_yes "$ans" || return 0
    ask EMAIL cert.email_q ""
  fi
  if ! valid_email "$EMAIL"; then warn cert.email_bad "$EMAIL"; return 0; fi
  local hint="$CERT_HINT"
  if have certbot && certbot certificates -d "$DOMAIN" 2>/dev/null | grep -q 'Certificate Name'; then
    ok cert.exists "$DOMAIN"; return 0
  fi
  if ! have certbot; then
    local pkgs="certbot python3-certbot-$kind"
    info cert.pkgs "$pkgs"
    apt_run update >>"${LOG:-/dev/null}" 2>&1 || true
    # shellcheck disable=SC2086  # a list of package names
    if ! apt_run install -y --no-install-recommends $pkgs >>"${LOG:-/dev/null}" 2>&1 || ! have certbot; then warn cert.apt_failed "$pkgs" "$hint"; return 0; fi
  fi
  info cert.run "$DOMAIN"
  local out; out=$(mktemp)
  # shellcheck disable=SC2086  # CURIOSA_CERTBOT_ARGS: extra options (for example --staging), split on purpose
  if certbot "--$kind" -d "$DOMAIN" --non-interactive --agree-tos --no-eff-email -m "$EMAIL" --redirect ${CURIOSA_CERTBOT_ARGS:-} >"$out" 2>&1; then
    cat -- "$out" >>"${LOG:-/dev/null}"; rm -f -- "$out"
    CERT_DONE=1; CERT_HINT=""; ok cert.ok "$DOMAIN"; info cert.terms
    return 0
  fi
  cat -- "$out" >>"${LOG:-/dev/null}"
  local why
  if grep -qiE 'rate limit|too many' "$out"; then why=$(t cert.why_limit)
  elif grep -qiE 'timeout|connection refused|unauthorized|could not connect|no valid ip|nxdomain|dns problem' "$out"; then why=$(t cert.why_unreachable)
  else why=$(t cert.why_other); fi
  rm -f -- "$out"
  warn cert.failed "$why" "$hint"
}

# ─── Phase C : version à installer + plan + accords ─────────────────────────────────────────────────────────────────
phase_plan() {
  STEP=step.release
  if [ "$RESUME" -eq 1 ] && [ -f "$(rp "$DIR")/release.json" ]; then
    TAG=$(sed -n 's/.*"version": *"\([^"]*\)".*/v\1/p' "$(rp "$DIR")/release.json" | head -n1)
    ok p.release_present "$DIR" "$TAG"
  else
    if [ -z "$TAG" ]; then
      local json; json=$(curl -fsSL -m 25 "$GITHUB_API/repos/$REPO/releases/latest" 2>/dev/null) || fail p.github_down
      TAG=$(printf '%s' "$json" | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)
      [ -n "$TAG" ] || fail p.no_release
    fi
    printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' || fail p.tag_bad "$TAG"
    FILE="curiosa-$TAG-linux-x64.tar.gz"
    local code; code=$(curl -s -o /dev/null -m 25 -L -r 0-0 -w '%{http_code}' "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE.sha256" 2>/dev/null || true)
    case "$code" in 200|206) ;; *) fail p.no_file "$TAG" "$FILE" "$code" ;; esac
    ok p.release_ok "$TAG"
  fi

  title p.title
  [ "${#MISSING_PKGS[@]}" -gt 0 ] && info_n p.pkgs "${#MISSING_PKGS[@]}" "${MISSING_PKGS[*]}"
  [ "$NODE_NEED" -eq 1 ] && info p.node "$NODE_MAJOR_WANTED"
  [ "$RESUME" -eq 0 ] && info p.download "$TAG"
  [ "$USER_EXISTS" -eq 0 ] && info p.user "$SITE_USER"
  info p.install "$DIR"
  info p.service "$SITE" "$PORT"
  PROXY_PLAN=none
  if [ "$SKIP_PROXY" -eq 1 ]; then info p.proxy_none "$PORT"
  elif [ -n "$WEB" ]; then PROXY_PLAN="$WEB"; info p.proxy_add "$DOMAIN" "$WEB"; [ "$WEB" != nginx ] || info p.proxy_nginx
  else PROXY_PLAN=caddy-install; info p.proxy_caddy "$DOMAIN"; fi
  [ "$UFW_ACTIVE" -eq 1 ] && [ "$UFW_OPEN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ] && info p.ufw
  plan_certbot
  info p.start

  if [ "$DRY" -eq 1 ]; then
    blank; say p.dry "$B" "$N"
    exit 0
  fi
  # accords : tous demandés AVANT toute modification
  WANT_UFW=0
  [ "${#MISSING_PKGS[@]}" -gt 0 ] && { consent c.pkgs "${MISSING_PKGS[*]}" || fail c.pkgs_no "${MISSING_PKGS[*]}"; }
  [ "$NODE_NEED" -eq 1 ] && { consent c.node "$NODE_MAJOR_WANTED" || fail c.node_no; }
  [ "$PROXY_PLAN" = caddy-install ] && { consent c.caddy || fail c.caddy_no; }
  if [ "$UFW_ACTIVE" -eq 1 ] && [ "$UFW_OPEN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ]; then consent c.ufw && WANT_UFW=1 || warn c.ufw_no; fi
  if [ "$YES" -eq 0 ] && interactive; then consent c.go || { say c.stop; exit 0; }; fi
}

# ─── Phase D : appliquer ────────────────────────────────────────────────────────────────────────────────────────────
apt_run() { DEBIAN_FRONTEND=noninteractive apt-get "$@"; }
install_packages() {
  STEP=step.pkgs
  if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
    logged l.apt_update "" apt_run update
    logged l.pkgs "${MISSING_PKGS[*]}" apt_run install -y --no-install-recommends ca-certificates "${MISSING_PKGS[@]}"
    ok l.pkgs_ok
  fi
  if [ "$NODE_NEED" -eq 1 ]; then
    local ks=/usr/share/keyrings/nodesource.gpg
    have gpg || logged l.gnupg "" apt_run install -y --no-install-recommends gnupg
    [ -n "$LOG" ] && printf '\n$ nodesource key + list\n' >>"$LOG"
    curl -fsSL -m 40 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o "$ks" 2>>"${LOG:-/dev/null}" || fail l.node_key
    printf 'deb [arch=amd64 signed-by=%s] https://deb.nodesource.com/node_%s.x nodistro main\n' "$ks" "$NODE_MAJOR_WANTED" >/etc/apt/sources.list.d/nodesource.list
    logged l.apt_update "" apt_run update
    logged l.node "" apt_run install -y nodejs
    NODE_BIN=$(readlink -f "$(command -v node)")
    node_version_ok "$(node -v)" || fail l.node_old "$(node -v)"
    ok l.node_ok "$(node -v)"
  fi
}

download_release() {
  STEP=step.download
  [ "$RESUME" -eq 1 ] && return 0
  local parent; parent="$(dirname "$(rp "$DIR")")"
  mkdir -p "$parent"
  STAGING="$parent/.curiosa-staging-$SITE"
  rm -rf -- "$STAGING"; mkdir -p "$STAGING/unpack"
  info dl.start "$TAG"
  curl -fL --retry 3 -m 1200 -o "$STAGING/$FILE" "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE" 2>>"${LOG:-/dev/null}" || fail dl.archive
  curl -fsSL -m 60 -o "$STAGING/$FILE.sha256" "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE.sha256" || fail dl.sha_file
  local want got; want=$(awk '{print tolower($1)}' "$STAGING/$FILE.sha256" | head -n1); got=$(sha256sum "$STAGING/$FILE" | awk '{print $1}')
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    fail dl.sha_bad
  fi
  ok dl.sha_ok
  local bad; bad=$(tar -tzf "$STAGING/$FILE" 2>/dev/null | grep -E '(^/|(^|/)\.\.(/|$))' | head -n1 || true)
  [ -z "$bad" ] || fail dl.unsafe "$bad"
  tar -xzf "$STAGING/$FILE" -C "$STAGING/unpack" 2>>"${LOG:-/dev/null}" || fail dl.untar
  [ -f "$STAGING/unpack/release.json" ] && [ -d "$STAGING/unpack/node_modules" ] && [ -d "$STAGING/unpack/prisma" ] || fail dl.not_curiosa
  rm -f -- "$STAGING/$FILE" "$STAGING/$FILE.sha256"
  ok dl.unpacked
}

create_user_and_dir() {
  STEP=step.user
  if [ "$USER_EXISTS" -eq 0 ]; then
    mkdir -p "$(rp "$DIR")" 2>/dev/null || true
    logged l.useradd "$SITE_USER" \
      useradd --system --user-group --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin "$SITE_USER"
    ok u.created "$SITE_USER"
  fi
  SITE_GROUP=$(id -gn "$SITE_USER" 2>/dev/null || echo "$SITE_USER")
  if [ "$RESUME" -eq 0 ]; then
    local d; d="$(rp "$DIR")"
    [ -z "$(ls -A "$d" 2>/dev/null)" ] || fail u.dir_filled "$DIR"
    rmdir "$d" 2>/dev/null || true
    mv -- "$STAGING/unpack" "$d"
    printf 'site=%s\nuser=%s\nport=%s\ncreated=%s\nrelease=%s\n' "$SITE" "$SITE_USER" "$PORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >"$d/$MARKER_NAME"
    ok u.unpacked "$DIR"
  fi
  chown -R "$SITE_USER:$SITE_GROUP" "$(rp "$DIR")"
  chmod 755 "$(rp "$DIR")"
}

write_env() {
  STEP=step.env
  local d env tok; d="$(rp "$DIR")"; env="$d/.env"
  if [ -f "$env" ]; then ok e.kept; return 0; fi
  tok=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  [ "${#tok}" -ge 24 ] || fail e.no_token
  # Le contenu du .env est le même dans toutes les langues (fichier lu par le site, relu par les personnes qui aident).
  ( umask 077
    { if [ -f "$d/.env.example" ]; then awk -v url="$SITE_URL" '/^SITE_URL=/ {print "SITE_URL=\"" url "\""; next} {print}' "$d/.env.example"
      else printf 'DATABASE_URL="file:../data/curiosa.db"\nSITE_URL="%s"\n' "$SITE_URL"; fi
      printf '\n# ─── Ajouté par scripts/install.sh (site : %s) ───\n' "$SITE"
      printf 'CURIOSA_SUPERVISED=1\nCURIOSA_READY_URL="http://127.0.0.1:%s/"\nSETUP_TOKEN="%s"\n' "$PORT" "$tok"
    } >"$env.tmp"
    mv -- "$env.tmp" "$env" )
  chown "$SITE_USER:$SITE_GROUP" "$env"; chmod 600 "$env"
  mkdir -p "$d/data"; chown "$SITE_USER:$SITE_GROUP" "$d/data"
  ok e.written
}

run_as_site() {
  if [ -n "$ROOT" ]; then ( cd "$(rp "$DIR")" && env HOME="$(rp "$DIR")" "$@" ); return; fi
  ( cd "$DIR" && runuser -u "$SITE_USER" -- env HOME="$DIR" PATH="$PATH" "$@" )
}
migrate_db() {
  STEP=step.db
  mkdir -p "$(rp "$DIR")/data"; chown "$SITE_USER:$SITE_GROUP" "$(rp "$DIR")/data"
  local out; out=$(run_as_site "$NODE_BIN" node_modules/prisma/build/index.js migrate deploy 2>&1) || { [ -n "$LOG" ] && printf '%s\n' "$out" >>"$LOG"; printf '%s\n' "$out" | tail -n 12 >&2; fail m.failed "$DIR" "$SITE_USER"; }
  [ -n "$LOG" ] && printf '%s\n' "$out" >>"$LOG"
  ok m.ready
}

write_unit() {
  STEP=step.unit
  local new; new=$(mktemp)
  cat >"$new" <<UNIT
# Géré par install-curiosa (scripts/install.sh), site : $SITE
[Unit]
Description=Curiosa ($SITE)
After=network.target

[Service]
Type=simple
User=$SITE_USER
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
Environment=NODE_ENV=production
Environment=CURIOSA_SUPERVISED=1
ExecStart=$NODE_BIN node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=3
KillMode=control-group
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
UNIT
  UNIT_CHANGED=0
  if [ -f "$UNIT" ] && cmp -s "$new" "$UNIT"; then rm -f -- "$new"; ok v.uptodate
  else
    if [ -f "$UNIT" ]; then cp -p -- "$UNIT" "$UNIT.avant-$(date +%Y%m%d-%H%M%S)"; fi
    mkdir -p "$(dirname "$UNIT")"; mv -- "$new" "$UNIT"; chmod 644 "$UNIT"; UNIT_CHANGED=1
    ok v.written "$SITE"
  fi
  systemctl daemon-reload
  if systemctl is-active --quiet "$SITE.service" 2>/dev/null; then
    [ "$UNIT_CHANGED" -eq 1 ] && systemctl restart "$SITE.service"
    ok v.active
  else
    systemctl enable --now "$SITE.service" >>"${LOG:-/dev/null}" 2>&1 || fail v.start_failed "$SITE"
    ok v.started
  fi
}

wait_http() { # wait_http URL secondes -> 0 si 200
  local i=0 code
  while [ "$i" -lt "$2" ]; do code=$(http_code "$1"); [ "$code" = 200 ] && return 0; sleep 2; i=$((i + 2)); done
  return 1
}
verify_local() {
  STEP=step.local
  wait_http "http://127.0.0.1:$PORT/admin/setup" 90 || fail w.local_down "$PORT" "$SITE"
  ok w.local_ok
}

# ── proxy ──
proxy_marker() { printf '# Géré par install-curiosa (scripts/install.sh), site : %s\n' "$SITE"; }
# nginx version as "major.minor.patch" (empty when it cannot be read). Used to decide what the generated site may contain.
nginx_version() { nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*|\1|p' | head -n1; }
# version_ge A B -> 0 when A >= B (both "x.y.z")
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }
# The generated site: compression, and a persistent connection to the site when nginx supports "keepalive_timeout" in an upstream (1.15.3+).
# Neither "http2" (the file only listens on port 80: certbot adds the TLS listener) nor any cache is written here (docs/PERFORMANCE.md).
# nginx_conf [legacy]: "legacy" prints the previous template (no extras), to recognize a site written by an older installer and leave it alone.
nginx_conf() {
  local mode="${1:-}" up="" target="127.0.0.1:$PORT" ver name; name="curiosa_${SITE//[^A-Za-z0-9_]/_}"
  if [ "$mode" != legacy ]; then
    ver=$(nginx_version)
    if [ -n "$ver" ] && version_ge "$ver" 1.15.3; then
      up="upstream $name {
    server 127.0.0.1:$PORT;
    keepalive 16;
    keepalive_timeout 4s;
}
"
      target="$name"
    fi
  fi
  proxy_marker
  printf '%s' "$up"
  cat <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 50m;
NGINX
  if [ "$mode" != legacy ]; then cat <<'NGINX'
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/css text/plain text/xml text/javascript application/javascript application/json application/xml application/rss+xml image/svg+xml;
NGINX
  fi
  cat <<NGINX
    location / {
        proxy_pass http://$target;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
NGINX
}
domain_known_elsewhere() { # le domaine est-il déjà géré dans $1 (fichiers autres que le nôtre) ?
  local found; found=$(grep -rlE "(server_name|ServerName|ServerAlias)[^;#]*[[:space:]]$DOMAIN([[:space:];]|\$)|^${DOMAIN}[[:space:],{]" "$@" 2>/dev/null | grep -v "/$SITE\.conf\$" | grep -v "/$SITE\.caddy\$" | grep -v '\.avant-' | head -n1 || true)
  [ -n "$found" ] && { printf '%s' "$found"; return 0; }; return 1
}
manual_proxy_note() { _render "$@"; PROXY_MANUAL="$MSG"; warn "$@"; }   # manual_proxy_note CLÉ args… : à régler à la main (repris dans la page finale)

configure_nginx() {
  local avail enabled conf
  if [ -d "$(rp /etc/nginx/sites-available)" ]; then avail=/etc/nginx/sites-available; enabled=/etc/nginx/sites-enabled; conf="$avail/$SITE.conf"; else avail=/etc/nginx/conf.d; enabled=""; conf="$avail/$SITE.conf"; fi
  local other; if other=$(domain_known_elsewhere "$(rp /etc/nginx)"); then
    manual_proxy_note x.nginx_known "$DOMAIN" "$other" "$PORT"; return 0
  fi
  local rc; rc=$(rp "$conf"); local new; new=$(mktemp); nginx_conf >"$new"
  local bak=""
  if [ -f "$rc" ]; then
    grep -q '^# Géré par install-curiosa' "$rc" || { rm -f -- "$new"; manual_proxy_note x.conf_foreign "$conf"; return 0; }
    if cmp -s "$new" "$rc"; then rm -f -- "$new"; ok x.nginx_uptodate; return 0; fi
    # certbot already edited this site (HTTPS listener, certificate paths): rewriting it would remove the certificate
    if grep -q 'managed by Certbot' "$rc"; then rm -f -- "$new"; ok x.nginx_kept "$conf"; return 0; fi
    # a site written by an earlier installer (previous template, nothing edited): left as it is; the lines to add by hand are in docs/PERFORMANCE.md
    local legacy; legacy=$(mktemp); nginx_conf legacy >"$legacy"
    if cmp -s "$legacy" "$rc"; then rm -f -- "$new" "$legacy"; ok x.nginx_kept "$conf"; return 0; fi
    rm -f -- "$legacy"
    bak="$rc.avant-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$rc" "$bak"; info x.backup "$bak"
  fi
  mkdir -p "$(dirname "$rc")"; mv -- "$new" "$rc"; chmod 644 "$rc"
  [ -n "$enabled" ] && ln -sfn "$conf" "$(rp "$enabled/$SITE.conf")"
  if ! nginx -t >>"${LOG:-/dev/null}" 2>&1; then
    # retour arrière : on remet l'ancien état, on ne recharge rien
    if [ -n "$bak" ]; then mv -- "$bak" "$rc"; else rm -f -- "$rc"; [ -n "$enabled" ] && rm -f -- "$(rp "$enabled/$SITE.conf")"; fi
    [ -n "$LOG" ] && tail -n 8 "$LOG" >&2
    fail x.nginx_refused
  fi
  if [ "$WEB_ACTIVE" -eq 1 ]; then systemctl reload nginx; ok x.nginx_added "$DOMAIN"; else warn x.nginx_stopped; fi
  CERT_HINT="sudo apt-get install certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
}

configure_apache() {
  if [ ! -d "$(rp /etc/apache2/sites-available)" ] || ! have a2ensite; then
    manual_proxy_note x.apache_layout "$DOMAIN" "$PORT"; return 0
  fi
  local other; if other=$(domain_known_elsewhere "$(rp /etc/apache2)"); then manual_proxy_note x.apache_known "$DOMAIN" "$other" "$PORT"; return 0; fi
  local rc; rc=$(rp "/etc/apache2/sites-available/$SITE.conf")
  if [ -f "$rc" ] && ! grep -q '^# Géré par install-curiosa' "$rc"; then manual_proxy_note x.conf_foreign "$rc"; return 0; fi
  if [ -f "$rc" ] && grep -q 'RewriteRule .*https://%{SERVER_NAME}' "$rc"; then ok x.nginx_kept "$rc"; return 0; fi   # certbot added its HTTPS redirect: keep it
  [ -f "$rc" ] && cp -p -- "$rc" "$rc.avant-$(date +%Y%m%d-%H%M%S)"
  { proxy_marker; cat <<APACHE
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "%{REQUEST_SCHEME}s"
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
</VirtualHost>
APACHE
  } >"$rc"
  logged x.a2enmod "" a2enmod proxy proxy_http headers
  logged x.a2ensite "$SITE" a2ensite "$SITE"
  if ! apachectl configtest >>"${LOG:-/dev/null}" 2>&1; then
    a2dissite "$SITE" >/dev/null 2>&1 || true; rm -f -- "$rc"
    fail x.apache_refused
  fi
  systemctl reload apache2 && ok x.apache_added "$DOMAIN"
  CERT_HINT="sudo apt-get install certbot python3-certbot-apache && sudo certbot --apache -d $DOMAIN"
}

install_caddy() {
  [ "$APT" -eq 1 ] || fail x.caddy_apt
  logged x.caddy_pre "" apt_run install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -fsSL -m 40 https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>>"${LOG:-/dev/null}" || fail x.caddy_key
  curl -fsSL -m 40 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list || fail x.caddy_list
  logged l.apt_update "" apt_run update
  logged x.caddy_install "" apt_run install -y caddy
  ok x.caddy_ok
  WEB=caddy; WEB_ACTIVE=1
}
configure_caddy() {
  local main sites site bak=""; main=$(rp /etc/caddy/Caddyfile); sites=$(rp /etc/caddy/sites); site="$sites/$SITE.caddy"
  local other; if other=$(domain_known_elsewhere "$(rp /etc/caddy)"); then manual_proxy_note x.caddy_known "$DOMAIN" "$other" "$PORT"; return 0; fi
  if [ -f "$site" ] && ! grep -q '^# Géré par install-curiosa' "$site"; then manual_proxy_note x.conf_foreign "$site"; return 0; fi
  mkdir -p "$sites"
  [ -f "$site" ] && cp -p -- "$site" "$site.avant-$(date +%Y%m%d-%H%M%S)"
  { proxy_marker; printf '%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"; } >"$site"
  if [ ! -f "$main" ]; then mkdir -p "$(dirname "$main")"; printf 'import /etc/caddy/sites/*.caddy\n' >"$main"
  elif ! grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/\*\.caddy' "$main"; then
    bak="$main.avant-curiosa-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$main" "$bak"; info x.caddyfile_backup "$bak"
    printf '\n# Ajouté par install-curiosa : un fichier par site dans /etc/caddy/sites\nimport /etc/caddy/sites/*.caddy\n' >>"$main"
  fi
  if have caddy && ! caddy validate --config "$(rp /etc/caddy/Caddyfile)" >>"${LOG:-/dev/null}" 2>&1; then
    rm -f -- "$site"; [ -n "$bak" ] && mv -- "$bak" "$main"
    [ -n "$LOG" ] && tail -n 8 "$LOG" >&2
    fail x.caddy_refused
  fi
  if [ "$WEB_ACTIVE" -eq 1 ]; then systemctl reload caddy || systemctl restart caddy; else systemctl enable --now caddy >>"${LOG:-/dev/null}" 2>&1 || warn x.caddy_nostart; fi
  ok x.caddy_added "$DOMAIN"
}

configure_proxy() {
  STEP=step.proxy
  PROXY_MANUAL=""; CERT_HINT=""
  [ "$SKIP_PROXY" -eq 1 ] && return 0
  case "$PROXY_PLAN" in
    nginx) configure_nginx ;;
    apache2|httpd) configure_apache ;;
    caddy) configure_caddy ;;
    caddy-install) install_caddy; configure_caddy ;;
  esac
  if [ "$WANT_UFW" -eq 1 ]; then ufw allow 80/tcp >>"${LOG:-/dev/null}" 2>&1 && ufw allow 443/tcp >>"${LOG:-/dev/null}" 2>&1 && ok x.ufw_ok || warn x.ufw_failed; fi
  obtain_certificate
}

verify_public() {
  STEP=step.public; PUBLIC_OK=1; PUBLIC_WHY=""
  [ "$NO_DOMAIN" -eq 1 ] || [ "$SKIP_PROXY" -eq 1 ] && return 0
  [ -z "$PROXY_MANUAL" ] || { PUBLIC_OK=0; return 0; }
  local url="${CURIOSA_VERIFY_URL:-https://$DOMAIN/admin/setup}"
  info y.checking
  if wait_http "$url" 90; then ok y.ok "$url"; return 0; fi
  if [ -z "${CURIOSA_VERIFY_URL:-}" ] && wait_http "http://$DOMAIN/admin/setup" 6; then PUBLIC_OK=0; PUBLIC_WHY=$(t y.why_http); return 0; fi
  PUBLIC_OK=0; PUBLIC_WHY=$(t y.why_down "$DOMAIN")
}

final_page() {
  title f.title
  local url="${SITE_URL}/admin/setup" local_only=0; { [ "$NO_DOMAIN" -eq 1 ] || [ "$SKIP_PROXY" -eq 1 ]; } && local_only=1
  [ "$local_only" -eq 1 ] && url="http://127.0.0.1:$PORT/admin/setup  $(t f.url_local "$PORT")"
  blank
  say f.rule "$B" "$N"
  if [ "$PUBLIC_OK" -eq 1 ]; then say f.done "$B" "$N" "$TAG"; else say f.done_nopublic "$B" "$N" "$TAG"; fi
  say f.rule "$B" "$N"
  blank
  info f.step1
  blank
  printf '        %s\n' "$url"
  blank
  info f.step2
  sub f.step2b
  blank
  printf '        sudo sed -n %s %s/.env | tr -d %s\n' "'s/^SETUP_TOKEN=//p'" "$DIR" "'\"'"
  blank
  sub f.step2_note
  blank
  info f.step3
  [ "$LANG_CODE" = "$WIZARD_LANG" ] || sub f.wizard_lang
  if [ "$PUBLIC_OK" -eq 0 ] && [ "$NO_DOMAIN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ]; then
    blank; say f.todo "$Y" "$N"
    [ -n "$PROXY_MANUAL" ] && printf '  - %s\n' "$PROXY_MANUAL"
    [ -n "${PUBLIC_WHY:-}" ] && printf '  - %s\n' "$PUBLIC_WHY"
    [ "$DNS_OK" -eq 0 ] && bullet f.todo_dns "$DOMAIN" "${PUBLIC_IP:-$(t f.this_server)}"
    [ -n "$CERT_HINT" ] && bullet f.todo_cert "$CERT_HINT"
    bullet f.todo_ports
    bullet f.todo_test "$DOMAIN"
  fi
  if [ "$PUBLIC_OK" -eq 1 ] && [ -n "${CERT_HINT:-}" ]; then blank; info f.cert "$CERT_HINT"; fi
  if [ "$CERT_DONE" -eq 1 ]; then blank; info f.cert_done "$DOMAIN"; info cert.terms; fi
  blank
  say f.useful "$SITE"
  say f.updates
  say f.token_remove "$DIR" "$SITE"
  [ -n "$LOG" ] && say f.log "$LOG"
  [ "$PUBLIC_OK" -eq 1 ] || exit 10
}

# ─── Programme ──────────────────────────────────────────────────────────────────────────────────────────────────────
main() {
  trap on_exit EXIT
  pre_scan_lang "$@"
  detect_lang
  load_catalogs
  parse_args "$@"
  # Question de langue : seulement si rien n'a permis de deviner, dans un terminal, et pas en mode « automatique » (--yes).
  if [ "$LANG_AMBIGUOUS" -eq 1 ] && [ "$YES" -eq 0 ] && interactive && [ -t 1 ]; then ask_lang; fi
  check_urls
  say m.title "$B" "$N"
  if [ -n "$CHANGE_DOMAIN" ] && [ "$UNINSTALL" -eq 1 ]; then _render m.change_alone; printf '%s\n' "$MSG" >&2; exit 2; fi
  if [ "$UNINSTALL" -eq 1 ]; then
    [ "$(id -u)" -eq 0 ] || [ -n "$ROOT" ] || fail m.uninstall_root
    [ -n "$SITE" ] || fail m.uninstall_site
    do_uninstall; return 0
  fi
  [ "$PURGE" -eq 0 ] || fail m.purge_alone
  if [ -n "$CHANGE_DOMAIN" ]; then
    do_change_domain; return 0
  fi
  [ "$APPLY" -eq 0 ] || { _render m.apply_alone; printf '%s\n' "$MSG" >&2; exit 2; }
  phase_detect
  phase_ask
  phase_plan
  LOG="$(rp /var/log)/curiosa-install-$SITE.log"
  mkdir -p "$(dirname "$LOG")"; ( umask 077; : >>"$LOG" )
  title m.install
  install_packages
  [ -n "$NODE_BIN" ] || NODE_BIN=$(readlink -f "$(command -v node)")
  download_release
  create_user_and_dir
  write_env
  migrate_db
  write_unit
  verify_local
  configure_proxy
  verify_public
  final_page
}

# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
# CATALOGUES DE MESSAGES : un bloc par langue, MÊMES clés et MÊMES {arguments} partout (tests/core/install-i18n.test.mjs le vérifie).
# Format : une ligne = « clé texte ». La clé n'a pas d'espace ; le texte garde ses espaces ; {1} {2}… sont les arguments, dans
# l'ordre voulu par la langue ; une clé seule est un texte vide ; « clé.fix » est le remède affiché après l'erreur « clé ».
# Pas de ligne de commentaire dans un bloc. Pour AJOUTER UNE LANGUE (ex. de) : copier catalog_en, traduire, ajouter « de » à LANGS
# (en haut du fichier) et la section « Languages / Langues » de docs/INSTALL.md ; le test de parité fait le reste.
# Ne pas traduire : options (--site…), commandes, noms de fichiers, la ligne « # Géré par install-curiosa » écrite sur le serveur.
# ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
catalog_fr() { cat <<'CATALOG_FR'
lang.name Français
plural.zero one
lbl.ok OK
lbl.warn ATTENTION
lbl.error ERREUR
lbl.fix Que faire :
lbl.details Détails techniques :
yn.yes o oui
prompt.consent {1} (o/N)
prompt.ask {1} :
prompt.ask_def {1} [{2}] :
prompt.domain Nom de domaine :
prompt.purge Pour confirmer, tapez le nom du site ({1}) :
consent.yes {1}  ->  oui (--yes)
consent.need Il faut votre accord pour : {1}
consent.need.fix relancez en ajoutant --yes pour accepter, ou lancez la commande dans un terminal pour que je vous pose la question.
opt.needvalue Option {1} : une valeur est attendue.
opt.unknown Option inconnue : {1} (voir --help)
err.insecure_url Adresse de téléchargement non sécurisée.
err.insecure_url.fix n'utilisez que des adresses https:// (les adresses http:// ne servent qu'aux tests automatiques).
err.unexpected Le script s'est arrêté de façon inattendue (étape : {1}).
err.unexpected.fix relancez la même commande, elle reprend où elle s'est arrêtée. Si ça recommence, envoyez le message ci-dessus (sans mot de passe ni code) à la personne qui vous aide.
err.root Ce script doit être lancé avec les droits d'administration.
err.root.fix relancez avec : sudo bash install.sh
step.prep préparation
step.detect constat de l'environnement
step.ask questions
step.state état de l'installation
step.release recherche de la release
step.pkgs outils et Node.js
step.download téléchargement et vérification
step.user utilisateur et dossier
step.env configuration (.env)
step.db base de données
step.unit service systemd
step.local vérification locale
step.proxy serveur web (HTTPS)
step.public vérification publique
m.title {1}Installation de Curiosa{2}
m.install 4/5  Installation
m.uninstall_root Ce script doit être lancé avec les droits d'administration.
m.uninstall_root.fix relancez avec : sudo bash install.sh --uninstall --site NOM
m.uninstall_site Il manque le nom du site à désinstaller.
m.uninstall_site.fix ajoutez --site NOM.
m.purge_alone --purge s'utilise avec --uninstall.
m.purge_alone.fix relancez avec --uninstall --purge --site NOM.
un.title Désinstallation de « {1} »
un.notfound Je ne trouve pas d'installation « {1} » faite par ce script dans {2}.
un.notfound.fix vérifiez --site et --dir ; je ne touche qu'à ce que j'ai installé moi-même.
un.service_removed Service {1} arrêté et retiré.
un.no_unit Pas d'unité systemd à moi à retirer.
un.nginx_removed Configuration nginx retirée ({1}).
un.nginx_warn nginx -t échoue après le retrait : vérifiez à la main avant de recharger.
un.apache_removed Site Apache retiré.
un.caddy_removed Site Caddy retiré.
un.kept Le site est arrêté. Le dossier {1} et l'utilisateur {2} sont conservés (vos données y sont).
un.purge_hint Pour tout supprimer ensuite : sudo bash install.sh --uninstall --purge --site {1}
un.need_tty La suppression des données demande une confirmation tapée dans un terminal.
un.need_tty.fix lancez la commande vous-même dans un terminal (une IA ne peut pas la confirmer à votre place).
un.purge_warn Ceci supprime définitivement {1} (base de données, images envoyées, .env) et l'utilisateur {2}.
un.backup_notice Une sauvegarde sera d'abord écrite dans {1} (lisible par root seulement).
un.confirm_diff Confirmation différente du nom du site : rien n'a été supprimé.
un.confirm_diff.fix relancez et tapez exactement « {1} ».
un.backup_failed La sauvegarde a échoué : rien n'a été supprimé.
un.backup_failed.fix libérez de la place disque puis relancez.
un.purged Dossier et utilisateur supprimés. Sauvegarde : {1}
d.title 1/5  Je regarde votre serveur (rien n'est modifié)
d.arch_ok Processeur : {1} (compatible).
d.arch_arm Ce serveur a un processeur ARM ({1}). Curiosa n'est publié que pour les processeurs x86_64 (« amd64 », « x64 ») pour l'instant.
d.arch_arm.fix créez un autre serveur en choisissant un modèle x86_64 / amd64 / « Intel ou AMD » (évitez les mentions « ARM », « Ampere », « Graviton », « arm64 »), puis relancez ce script dessus. Rien n'a été modifié ici.
d.arch_unknown Processeur non reconnu ({1}) : Curiosa n'est publié que pour x86_64.
d.arch_unknown.fix utilisez un serveur x86_64 (amd64). Rien n'a été modifié.
d.alpine Alpine Linux n'est pas pris en charge (la release est faite pour les systèmes de type Debian/Ubuntu).
d.alpine.fix créez le serveur avec Ubuntu LTS ou Debian.
d.os_ok Système : {1}.
d.os_warn Système : {1}. Je sais tout installer sans aide sur Ubuntu et Debian ; ici je m'arrêterai si un outil manque.
d.no_systemd systemd n'est pas actif sur ce serveur (c'est lui qui garde le site allumé).
d.no_systemd.fix utilisez un serveur Ubuntu ou Debian classique (pas un conteneur sans systemd), ou suivez l'installation manuelle de docs/AGENT-INSTALL.md.
d.systemd_ok systemd présent.
d.mem_low Mémoire : {1} Mo seulement. C'est juste : prévoyez au moins 1 Go (1 à 2 Go recommandés), sinon le site peut s'arrêter.
d.mem_ok Mémoire : {1} Mo.
d.tool_passwd Il manque l'outil système « {1} ».
d.tool_passwd.fix installez le paquet « passwd » de votre distribution, ou utilisez Ubuntu/Debian.
d.tool_runuser Il manque l'outil système « {1} ».
d.tool_runuser.fix installez le paquet « util-linux » de votre distribution, ou utilisez Ubuntu/Debian.
d.tools_ok Outils présents (curl, git, tar, sha256sum, openssl).
d.tools_todo.one Outil à installer : {2}
d.tools_todo.other Outils à installer : {2}
d.node_home Node.js trouvé dans un dossier personnel ({1}) : le site ne pourrait pas l'utiliser (utilisateur dédié).
d.node_ok Node.js {1} ({2}).
d.node_old Node.js {1} est trop ancien (il faut 20.9 ou plus).
d.node_none Node.js n'est pas installé.
d.node_manual Node.js 20.9 ou plus est nécessaire et je ne sais pas l'installer sur {1}.
d.node_manual.fix installez Node.js 22 (https://nodejs.org/fr/download), puis relancez ce script. Rien n'a été modifié.
d.web_found Serveur web déjà installé : {1} ({2})  ->  j'y AJOUTE votre site sans toucher aux autres.
d.state_active actif
d.state_stopped arrêté
d.web_none Aucun serveur web : j'installerai Caddy (certificat HTTPS automatique).
d.ufw Pare-feu ufw actif ({1}).
d.ufw_open 80/443 déjà ouverts
d.ufw_closed 80/443 fermés
a.title 2/5  Trois questions
a.q_site 1. Nom du site (court, en minuscules, sans espace ; ex. monsite)
a.site_missing Il manque le nom du site.
a.site_missing.fix relancez avec --site monsite (court, en minuscules).
a.site_bad Le nom du site « {1} » n'est pas valable.
a.site_bad.fix utilisez 2 à 31 caractères : des lettres minuscules sans accent, des chiffres ou des tirets, en commençant par une lettre (ex. monsite).
a.q_domain 2. Nom de domaine : l'adresse que verra votre public (ex. monsite.example.org). Laissez vide pour un simple essai sans domaine.
a.domain_missing Il manque le nom de domaine.
a.domain_missing.fix relancez avec --domain monsite.example.org (ou --no-domain pour un essai sans domaine, en HTTP local seulement).
a.domain_bad « {1} » n'est pas un nom de domaine valable.
a.domain_bad.fix écrivez-le sans https:// et sans espace, par exemple monsite.example.org (une adresse IP ne convient pas).
a.q_user 3. Utilisateur Linux dédié : le site tournera sous un compte à part, sans droits d'administration. Si un jour il avait une faille, elle resterait enfermée dans son dossier.
a.q_user_label Utilisateur dédié
a.user_bad Le nom d'utilisateur « {1} » n'est pas valable.
a.user_bad.fix utilisez des minuscules sans accent, chiffres, tirets (32 caractères au plus), par exemple {2}-web.
a.user_root L'utilisateur « root » est interdit pour faire tourner le site.
a.user_root.fix choisissez un autre nom, par exemple {1}-web.
a.dir_abs Le dossier d'installation doit être un chemin complet (commençant par /).
a.dir_abs.fix par exemple --dir /var/www/{1}
a.dir_reserved Le dossier « {1} » est réservé au système.
a.dir_reserved.fix gardez le défaut /var/www/{2}.
s.title 3/5  Je vérifie ce qui existe déjà (rien n'est modifié)
s.other_install Le dossier {1} appartient à une autre installation (site « {2} »).
s.other_install.fix choisissez un autre dossier avec --dir, ou gardez le même nom de site.
s.user_kept Cette installation utilise l'utilisateur « {1} » : je le garde.
s.resume Une installation commencée par ce script existe dans {1} : je la reprends là où elle s'est arrêtée.
s.not_empty Le dossier {1} n'est pas vide et n'a pas été créé par ce script. Je ne l'écrase jamais (il contient peut-être un autre site).
s.not_empty.fix regardez ce qu'il contient (ls -la {1}). Pour un nouveau site, choisissez un autre dossier avec --dir, ou déplacez l'ancien : sudo mv {1} {1}.ancien
s.dir_free Le dossier {1} est libre.
s.user_other_home L'utilisateur « {1} » existe déjà, avec un autre dossier personnel ({2}).
s.user_other_home.fix choisissez un autre nom avec --user (par exemple {3}-web2) ; je ne modifie pas un compte existant.
s.user_reuse L'utilisateur « {1} » existe déjà avec le bon dossier : je l'utilise.
s.unit_foreign Un service « {1}.service » existe déjà et n'a pas été créé par ce script.
s.unit_foreign.fix choisissez un autre nom de site (--site), ou regardez-le : systemctl cat {1}.service
s.port_bad Le port « {1} » n'est pas valable.
s.port_bad.fix choisissez un nombre entre 1024 et 65535, ou laissez-moi en trouver un libre (n'indiquez pas --port).
s.port_busy Le port {1} est déjà utilisé par un autre programme (je n'y touche pas).
s.port_busy.fix n'indiquez pas --port : je prendrai le premier port libre, ou choisissez-en un autre.
s.port_next Le port {1} est déjà pris (par un autre programme, que je laisse tranquille) : j'essaie le suivant.
s.port_none Aucun port libre trouvé autour de {1}.
s.port_none.fix libérez un port ou indiquez --port.
s.port_ok Port local du site : {1}.
s.disk_low Pas assez de place disque : {1} Mo libres, il en faut environ {2}.
s.disk_low.fix choisissez un serveur avec plus de disque (20 Go conviennent) ou libérez de la place.
s.disk_ok Espace disque : {1} Mo libres.
s.dns_none Le domaine {1} ne pointe vers aucune adresse pour l'instant (enregistrement DNS « A » absent ou pas encore propagé).
s.dns_noip Je n'arrive pas à connaître l'adresse publique de ce serveur (pas d'accès à Internet ?). Le domaine pointe vers : {1}
s.dns_ok Le domaine {1} pointe bien vers ce serveur ({2}).
s.dns_other Le domaine {1} pointe vers {2} mais ce serveur est à l'adresse {3}.
s.dns_skip (--skip-dns-check) je continue quand même.
s.dns_howto Chez votre registraire (là où vous avez acheté le domaine), créez un enregistrement de type A : nom « {1} » (ou « @ »), valeur {2}. Attendez quelques minutes (parfois plus) : on peut vérifier avec  getent hosts {1}
s.dns_this_ip adresse-IP-de-ce-serveur
s.dns_cloudflare Si vous utilisez Cloudflare, mettez le nuage en gris (DNS seul) le temps de l'installation.
s.dns_stop Le DNS du domaine ne pointe pas (encore) vers ce serveur : le certificat HTTPS ne pourrait pas être obtenu.
s.dns_stop.fix corrigez l'enregistrement A, attendez qu'il soit propagé puis relancez la même commande ; ou ajoutez --skip-dns-check pour installer quand même (le site sera d'abord joignable en local seulement, le HTTPS viendra tout seul quand le DNS sera bon, avec Caddy).
s.dns_ask Installer quand même, sans attendre le DNS ? (sinon j'arrête ici, rien n'est modifié)
s.dns_declined Arrêt à votre demande : rien n'a été modifié.
s.dns_declined.fix créez l'enregistrement DNS, attendez la propagation, puis relancez la même commande.
p.release_present Release déjà dépliée dans {1} ({2}).
p.github_down Je n'arrive pas à interroger GitHub pour trouver la dernière release.
p.github_down.fix vérifiez que ce serveur a accès à Internet (curl -I https://github.com), puis relancez. Si GitHub est en panne, réessayez plus tard.
p.no_release Aucune release stable n'est publiée pour l'instant.
p.no_release.fix attendez la publication d'une release (page « Releases » du projet) ; je n'installe jamais une version non publiée ni ne compile rien sur le serveur.
p.tag_bad Numéro de version inattendu : « {1} ».
p.tag_bad.fix indiquez une version du type v0.2.13.
p.no_file La release {1} n'a pas de fichier pour Linux x64 ({2}, réponse {3}).
p.no_file.fix regardez la page « Releases » : une release sans archive ne peut pas s'installer ; choisissez une autre version avec --tag, ou attendez.
p.release_ok Release à installer : {1} (la dernière version stable).
p.title Ce que je vais faire
p.pkgs.one - installer l'outil manquant : {2}
p.pkgs.other - installer les outils manquants : {2}
p.node - installer Node.js {1} (dépôt officiel NodeSource)
p.download - télécharger {1} et vérifier son empreinte SHA-256 (rien n'est déplié si elle ne correspond pas)
p.user - créer l'utilisateur système « {1} » (sans droits d'administration, sans mot de passe)
p.install - installer le site dans {1}, écrire sa configuration (.env, avec un code d'installation aléatoire que je n'affiche pas), créer la base de données
p.service - créer le service « {1}.service » (démarre au boot, redémarre seul), à l'écoute en local sur le port {2}
p.proxy_none - (pas de serveur web : le site ne sera joignable qu'en local, http://127.0.0.1:{1})
p.proxy_add - AJOUTER {1} à {2} (sauvegarde de l'ancienne configuration, test avant rechargement ; vos autres sites ne sont pas touchés)
p.proxy_nginx - nouveau site seulement : compression des pages et connexion gardée ouverte vers le site (un site nginx déjà installé n'est pas modifié)
p.proxy_caddy - installer Caddy (dépôt officiel) : il obtient et renouvelle seul le certificat HTTPS de {1}
p.ufw - ouvrir les ports 80 et 443 dans le pare-feu ufw
p.start - démarrer le site et vérifier qu'il répond (/admin/setup)
p.dry {1}(--dry-run) Rien n'a été modifié.{2} Pour installer pour de bon, relancez la même commande sans --dry-run.
c.pkgs Installer les outils manquants ({1}) avec apt ?
c.pkgs_no Sans ces outils je ne peux pas continuer.
c.pkgs_no.fix installez-les (sudo apt-get install {1}) puis relancez.
c.node Installer Node.js {1} depuis le dépôt officiel NodeSource ?
c.node_no Sans Node.js 20.9 ou plus, le site ne peut pas tourner.
c.node_no.fix installez Node.js 22 (https://nodejs.org/fr/download) puis relancez.
c.caddy Installer Caddy depuis son dépôt officiel (apt) ?
c.caddy_no Sans serveur web je ne peux pas mettre le site en HTTPS.
c.caddy_no.fix relancez avec --skip-proxy pour un site en local seulement, ou installez un serveur web puis relancez.
c.ufw Ouvrir les ports 80 et 443 dans ufw (nécessaires au site et au certificat) ?
c.ufw_no Ports 80/443 laissés fermés : le site ne sera pas joignable depuis Internet tant que vous ne les ouvrez pas (sudo ufw allow 80/tcp && sudo ufw allow 443/tcp).
c.go On y va ?
c.stop Arrêt : rien n'a été modifié.
l.apt_update Le chargement de la liste des paquets n'a pas abouti.
l.apt_update.fix vérifiez la connexion Internet du serveur puis relancez.
l.pkgs L'installation de {1} n'a pas abouti.
l.pkgs.fix lancez sudo apt-get install {1} pour voir l'erreur, corrigez-la puis relancez.
l.pkgs_ok Outils installés.
l.gnupg L'installation de gnupg n'a pas abouti.
l.gnupg.fix lancez sudo apt-get install gnupg puis relancez.
l.node_key Le téléchargement de la clé du dépôt NodeSource a échoué.
l.node_key.fix vérifiez l'accès à deb.nodesource.com depuis ce serveur, ou installez Node.js 22 vous-même puis relancez.
l.node L'installation de Node.js n'a pas abouti.
l.node.fix lancez sudo apt-get install nodejs pour voir l'erreur, corrigez-la puis relancez.
l.node_old Node.js installé ({1}) est quand même trop ancien.
l.node_old.fix installez Node.js 22 à la main (https://nodejs.org/fr/download) puis relancez.
l.node_ok Node.js {1} installé.
l.useradd La création de l'utilisateur {1} n'a pas abouti.
l.useradd.fix regardez le détail ci-dessus ; choisissez un autre nom avec --user si le nom est déjà pris.
dl.start Téléchargement de {1} (environ 150 Mo, quelques minutes selon la connexion)…
dl.archive Le téléchargement de l'archive a échoué.
dl.archive.fix vérifiez l'accès à Internet et l'espace disque, puis relancez la même commande (rien n'est installé).
dl.sha_file Le téléchargement du fichier d'empreinte (.sha256) a échoué.
dl.sha_file.fix relancez la même commande ; rien n'est installé.
dl.sha_bad L'empreinte SHA-256 de l'archive ne correspond pas : le fichier est abîmé ou a été modifié. Rien n'a été déplié ni installé.
dl.sha_bad.fix relancez la même commande (un téléchargement coupé est la cause la plus fréquente) ; si ça se répète, ne l'installez pas et prévenez le projet.
dl.sha_ok Empreinte SHA-256 vérifiée.
dl.unsafe L'archive contient un chemin dangereux ({1}) : elle n'est pas dépliée.
dl.unsafe.fix ne l'installez pas et prévenez le projet.
dl.untar L'archive n'a pas pu être dépliée (disque plein ?).
dl.untar.fix libérez de la place (df -h) puis relancez ; rien n'est installé.
dl.not_curiosa L'archive ne ressemble pas à une release de Curiosa.
dl.not_curiosa.fix ne l'installez pas et prévenez le projet.
dl.unpacked Archive dépliée en lieu sûr.
u.created Utilisateur « {1} » créé (sans droits d'administration).
u.dir_filled Le dossier {1} n'est plus vide : quelqu'un y a écrit entre-temps.
u.dir_filled.fix vérifiez son contenu puis relancez.
u.unpacked Site déplié dans {1}.
e.kept .env déjà présent : je le garde tel quel (je n'écrase jamais votre configuration).
e.no_token Je n'ai pas pu fabriquer un code d'installation aléatoire.
e.no_token.fix installez openssl (sudo apt-get install openssl) puis relancez.
e.written Configuration écrite (.env, lisible par le site seulement). Le code d'installation n'est affiché nulle part.
m.failed La création de la base de données a échoué.
m.failed.fix relancez la même commande ; si l'erreur est « EACCES », vérifiez que {1} appartient bien à {2} (sudo chown -R {2}: {1}).
m.ready Base de données prête.
v.uptodate Service déjà à jour.
v.written Service {1}.service écrit.
v.active Service déjà actif.
v.start_failed Le service n'a pas pu démarrer.
v.start_failed.fix regardez pourquoi : sudo journalctl -u {1} -n 40 --no-pager ; puis relancez la même commande.
v.started Service démarré (et relancé automatiquement au démarrage du serveur).
w.local_down Le site ne répond pas en local (http://127.0.0.1:{1}/admin/setup).
w.local_down.fix regardez le journal : sudo journalctl -u {2} -n 40 --no-pager. Si le message parle d'un port déjà utilisé, relancez avec --port 3010 (un autre nombre) ; sinon relancez la même commande.
w.local_ok Le site répond en local (HTTP 200 sur /admin/setup).
x.nginx_known nginx gère déjà {1} dans {2} : je n'y touche pas. Pour y envoyer le trafic vers ce site, faites pointer son « proxy_pass » vers http://127.0.0.1:{3} (modèle : docs/INSTALL.md).
x.conf_foreign {1} existe déjà et n'est pas à moi : je n'y touche pas.
x.nginx_uptodate Configuration nginx déjà à jour.
x.nginx_kept Site déjà présent dans {1} (écrit par une version précédente) : laissé tel quel. Pour ajouter la compression, voir docs/PERFORMANCE.md.
x.backup Ancienne configuration sauvegardée : {1}
x.nginx_refused nginx refuse la nouvelle configuration (nginx -t a échoué) : je l'ai retirée, nginx n'a pas été touché.
x.nginx_refused.fix regardez le détail ci-dessus ; une configuration existante est probablement en cause. Relancez avec --skip-proxy pour ne pas toucher à nginx.
x.nginx_added {1} ajouté à nginx (rechargé).
x.nginx_stopped nginx est installé mais arrêté : démarrez-le (sudo systemctl start nginx) pour mettre le site en ligne.
p.certbot - obtenir le certificat HTTPS de {1} avec certbot (Let's Encrypt), avis d'expiration à {2}. En utilisant --certbot, vous acceptez les conditions de Let's Encrypt.
p.certbot_dns - certificat HTTPS non demandé : {1} ne pointe pas encore vers ce serveur (la commande à lancer plus tard sera indiquée à la fin)
p.certbot_caddy - --certbot ne sert à rien ici : Caddy obtient seul le certificat HTTPS
p.certbot_none - --certbot ignoré : sans domaine ou sans serveur web touché, il n'y a pas de certificat à demander
cert.email_q Votre e-mail (pour les avis d'expiration du certificat)
cert.email_missing --certbot demande une adresse e-mail pour les avis d'expiration du certificat.
cert.email_missing.fix ajoutez --email, par exemple --email vous@exemple.org
cert.email_bad L'adresse e-mail « {1} » n'est pas valide.
cert.email_bad.fix écrivez-la sous la forme vous@exemple.org
cert.ask Obtenir le certificat HTTPS maintenant ? Un e-mail sera demandé pour les avis d'expiration, et vous acceptez les conditions de Let's Encrypt
cert.skip_dns Certificat HTTPS non demandé : {1} ne pointe pas encore vers ce serveur. Le site reste en HTTP.
cert.skip_stopped Certificat HTTPS non demandé : le serveur web est arrêté. Le site reste en HTTP.
cert.exists Un certificat existe déjà pour {1} : je n'en redemande pas.
cert.pkgs Installation de certbot (paquets : {1})
cert.apt_failed Certbot n'a pas pu être installé (paquets : {1}). Le site reste en HTTP. Pour continuer à la main : {2}
cert.run Demande du certificat à Let's Encrypt pour {1}
cert.ok Certificat HTTPS obtenu pour {1} : le site est en HTTPS et HTTP y redirige.
cert.terms En demandant ce certificat, vous avez accepté les conditions de Let's Encrypt.
cert.failed Certificat HTTPS non obtenu ({1}). Le site reste en HTTP, rien d'autre n'a changé. Pour réessayer : {2}
cert.why_limit Let's Encrypt limite le nombre de demandes ; réessayez plus tard
cert.why_unreachable Let's Encrypt n'a pas pu joindre le site sur le port 80 : vérifiez le DNS et le pare-feu
cert.why_other raison dans le journal d'installation
f.cert_done Certificat HTTPS obtenu avec certbot pour {1} ; certbot le renouvelle seul.
x.apache_layout Apache est présent mais pas à la disposition Debian (sites-available) : je n'y touche pas. Ajoutez un hôte virtuel pour {1} qui renvoie vers http://127.0.0.1:{2} (ProxyPass / http://127.0.0.1:{2}/), en activant mod_proxy, mod_proxy_http et mod_headers.
x.apache_known Apache gère déjà {1} dans {2} : je n'y touche pas (faites-le pointer vers http://127.0.0.1:{3}).
x.a2enmod L'activation des modules Apache nécessaires n'a pas abouti.
x.a2enmod.fix lancez sudo a2enmod proxy proxy_http headers pour voir l'erreur.
x.a2ensite L'activation du site Apache n'a pas abouti.
x.a2ensite.fix lancez sudo a2ensite {1} pour voir l'erreur.
x.apache_refused Apache refuse la nouvelle configuration : je l'ai retirée, Apache n'a pas été rechargé.
x.apache_refused.fix relancez avec --skip-proxy pour ne pas toucher à Apache.
x.apache_added {1} ajouté à Apache (rechargé).
x.caddy_apt Je ne sais installer Caddy que sur Ubuntu/Debian.
x.caddy_apt.fix installez un serveur web (Caddy ou nginx) puis relancez ce script.
x.caddy_pre L'installation des prérequis de Caddy n'a pas abouti.
x.caddy_pre.fix vérifiez la connexion Internet puis relancez.
x.caddy_key Le téléchargement de la clé du dépôt de Caddy a échoué.
x.caddy_key.fix vérifiez l'accès à dl.cloudsmith.io depuis ce serveur, puis relancez.
x.caddy_list Le téléchargement de la liste de paquets de Caddy a échoué.
x.caddy_list.fix vérifiez l'accès à dl.cloudsmith.io depuis ce serveur, puis relancez.
x.caddy_install L'installation de Caddy n'a pas abouti.
x.caddy_install.fix lancez sudo apt-get install caddy pour voir l'erreur, puis relancez.
x.caddy_ok Caddy installé.
x.caddy_known Caddy gère déjà {1} dans {2} : je n'y touche pas (faites-le pointer vers 127.0.0.1:{3}).
x.caddyfile_backup Ancien Caddyfile sauvegardé : {1}
x.caddy_refused Caddy refuse la nouvelle configuration : je l'ai retirée, Caddy n'a pas été rechargé.
x.caddy_refused.fix regardez le détail ci-dessus, ou relancez avec --skip-proxy.
x.caddy_nostart Caddy n'a pas démarré : sudo journalctl -u caddy -n 30
x.caddy_added {1} ajouté à Caddy : le certificat HTTPS est demandé automatiquement.
x.ufw_ok Ports 80 et 443 ouverts dans ufw.
x.ufw_failed Je n'ai pas pu ouvrir 80/443 dans ufw : sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
y.checking Je vérifie l'adresse publique (le certificat HTTPS peut demander jusqu'à une minute)…
y.ok Le site répond sur {1} (HTTP 200).
y.why_http Le site répond en HTTP mais pas encore en HTTPS (certificat pas encore obtenu).
y.why_down Le site ne répond pas encore sur https://{1}.
f.title 5/5  Terminé
f.rule {1}================================================================{2}
f.done {1}  Curiosa {3} est installé et répond.{2}
f.done_nopublic {1}  Curiosa {3} est installé ; son adresse publique ne répond pas encore.{2}
f.step1 1. Ouvrez cette adresse dans votre navigateur :
f.url_local (site joignable seulement depuis ce serveur ; pour l'ouvrir depuis chez vous : ssh -L {1}:127.0.0.1:{1} utilisateur@adresse-du-serveur, puis http://localhost:{1}/admin/setup)
f.step2 2. Le site vous demande un « code d'installation ». Il est enregistré sur ce serveur.
f.step2b Pour le lire, tapez cette commande VOUS-MÊME dans votre terminal (le code s'affiche, recopiez-le dans la page) :
f.step2_note (Je ne l'écris pas ici volontairement : il ne doit apparaître ni dans un journal, ni dans une conversation avec une IA.)
f.step3 3. Suivez ensuite l'assistant de première installation.
f.wizard_lang L'assistant s'ouvre en français par défaut : choisissez votre langue à la question « Dans quelle langue sera votre site ? ».
f.todo {1}À régler pour que l'adresse publique fonctionne :{2}
f.todo_dns Le DNS de {1} doit pointer vers {2} (enregistrement A). Caddy obtiendra alors le certificat tout seul (quelques minutes).
f.this_server ce serveur
f.todo_cert Certificat HTTPS : {1}
f.todo_ports Les ports 80 et 443 doivent être ouverts chez votre hébergeur (pare-feu / « security group » de son tableau de bord).
f.todo_test Puis testez :  curl -I https://{1}/admin/setup
f.cert Certificat HTTPS (nginx/Apache ne l'obtiennent pas seuls) :  {1}
f.useful Utile : état du service  sudo systemctl status {1}   ·   journal  sudo journalctl -u {1} -n 40 --no-pager
f.updates Les mises à jour se font ensuite depuis l'administration du site (page « Mises à jour »).
f.token_remove Une fois le site configuré, retirez la ligne SETUP_TOKEN de {1}/.env puis : sudo systemctl restart {2}
f.log Journal de cette installation : {1}
help.01 install.sh : installe Curiosa sur un serveur Linux (x86_64) à partir de la dernière release STABLE.
help.02
help.03 Usage, en deux temps lisibles (jamais « curl | bash ») :
help.04   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
help.05   less install.sh        # (facultatif) relire le fichier avant de l'exécuter
help.06   sudo bash install.sh
help.07
help.08 Le script pose au plus trois questions (nom du site, nom de domaine, utilisateur Linux dédié) ; chacune a son option
help.09 pour qu'une IA ou un script le pilote sans interaction :
help.10   --site NOM        nom court en minuscules (nomme le dossier /var/www/NOM et le service NOM.service)
help.11   --domain DOMAINE  nom de domaine du site (--no-domain : essai sans domaine, en HTTP local seulement)
help.12   --user UTILISATEUR utilisateur Linux dédié (défaut proposé : NOM-web)
help.13   --port PORT       port local du site (défaut : le premier libre à partir de 3000)
help.14   --dir DOSSIER     dossier d'installation (défaut : /var/www/NOM)
help.15   --tag vX.Y.Z      installer cette release précise (par défaut : la dernière release stable)
help.16   --yes             répondre « oui » aux confirmations (installer Node.js, Caddy, ouvrir 80/443 dans ufw…)
help.17   --dry-run         tout vérifier et annoncer ce qui serait fait, SANS rien modifier
help.18   --skip-dns-check  ne pas s'arrêter si le DNS du domaine ne pointe pas (encore) vers ce serveur
help.19   --skip-proxy      ne pas toucher au serveur web (HTTPS) : le site n'écoute qu'en local
help.20   --certbot        nginx ou Apache : obtenir le certificat HTTPS avec certbot (vous acceptez les conditions de Let's Encrypt)
help.21   --email ADRESSE   avec --certbot : e-mail pour les avis d'expiration du certificat
help.22   --uninstall       arrêter le site et défaire la configuration ajoutée (garde le dossier et les données)
help.23   --purge           avec --uninstall : supprimer aussi le dossier et l'utilisateur (confirmation tapée, sauvegarde faite avant)
help.24   --change-domain DOMAINE  changer le domaine d'un site déjà installé (avec --site) : par défaut un plan, rien n'est modifié
help.25   --apply          avec --change-domain : faire le changement (sauvegardes, serveur web écrit par ce script, .env, redémarrage)
help.26   --lang fr|en      langue des messages (sinon : variable CURIOSA_LANG, puis LC_ALL / LC_MESSAGES / LANG ; à défaut, anglais)
help.27   --help
help.28
help.29 Le script est reprenable : relancé après un échec, il détecte ce qui est fait et continue.
help.30 Codes de sortie : 0 terminé ; 1 arrêté sur une erreur (rien de cassé, voir le message) ; 2 option ou langue inconnue ;
help.31 10 installé, mais l'adresse publique ne répond pas encore (DNS, pare-feu, certificat : voir le message final).
help.32 Codes de sortie, options et fichiers écrits sont les mêmes dans toutes les langues.
step.change changement de domaine
m.change_alone --change-domain ne s'utilise pas avec --uninstall.
m.apply_alone --apply s'utilise avec --change-domain.
m.apply_alone.fix relancez avec --change-domain NOUVEAU-DOMAINE --site NOM --apply.
cd.site Il manque le nom du site dont il faut changer le domaine.
cd.site.fix ajoutez --site NOM.
cd.domain_bad « {1} » n'est pas un nom de domaine public valable (pas d'adresse numérique, ni « localhost », ni nom de réseau privé).
cd.domain_bad.fix écrivez par exemple  --change-domain monsite.be
cd.root Ce script doit être lancé avec les droits d'administration.
cd.root.fix relancez avec : sudo bash install.sh --site {1} --change-domain {2}
cd.notfound Je ne trouve pas d'installation « {1} » faite par ce script dans {2}.
cd.notfound.fix vérifiez --site et --dir ; je ne touche qu'à ce que j'ai installé moi-même.
cd.noenv Le fichier de réglages (.env) est introuvable dans {1}.
cd.noenv.fix restaurez-le depuis une sauvegarde, puis relancez.
cd.nodomain Le site « {1} » n'a pas de domaine public (adresse actuelle : {2}) : il n'y a rien à changer.
cd.nodomain.fix pour lui donner un domaine, relancez l'installation avec --domain.
cd.same Le site utilise déjà le domaine {1}.
cd.same.fix choisissez un autre domaine.
cd.title Changer le domaine de « {1} » en {2}
cd.current Domaine actuel : {1}
cd.plan Ce qui serait fait
cd.plan_env Dans {1} : SITE_URL passe de {2} à {3}.
cd.plan_legacy Anciens domaines redirigés vers le nouveau (LEGACY_HOSTS) : {1}
cd.plan_proxy Dans {1} : les noms du site deviennent  {2}
cd.plan_foreign Une configuration qui n'est pas à moi existe : je n'y touche pas, je dirai quoi y changer.
cd.plan_cert Certificat HTTPS, avec votre accord : {1}
cd.plan_cert_caddy Certificat HTTPS : Caddy le demande seul.
cd.plan_restart Redémarrage du service {1}.
cd.no_proxy Aucune configuration de serveur web écrite par ce script : seul le fichier de réglages est changé.
cd.dry {1}Rien n'a été modifié.{2} Pour appliquer le changement du site {3} vers {4}, relancez la même commande en ajoutant --apply.
cd.dns_stop Le DNS de {1} ne pointe pas (encore) vers ce serveur : le certificat HTTPS ne pourrait pas être obtenu.
cd.dns_stop.fix corrigez l'enregistrement A et attendez la propagation ; ou ajoutez --skip-dns-check pour changer quand même. Rien n'a été modifié.
cd.go Changer le domaine de {1} à {2} (sauvegardes faites avant, redémarrage du site)
cd.proxy_done Serveur web mis à jour : {1}
cd.apache_ssl Le fichier {1} (HTTPS) n'est pas à moi : remplacez-y l'ancien nom par le nouveau, ou relancez certbot.
cd.foreign_todo Dans la configuration qui n'est pas à moi, faites répondre le serveur web aux noms  {1}  en envoyant le trafic vers http://127.0.0.1:{2}
cd.env_done Fichier de réglages mis à jour : SITE_URL={1}  LEGACY_HOSTS={2}
cd.restarted Service {1} redémarré.
cd.restart_failed Le service {1} n'a pas redémarré.
cd.restart_failed.fix regardez  sudo journalctl -u {1} -n 40 --no-pager  ; l'ancien .env est sauvegardé à côté (.env.avant-…).
cd.restart_manual Le service {1} n'est pas à moi : redémarrez le site vous-même pour qu'il relise son fichier de réglages.
cd.cert_dns Le DNS ne pointe pas encore vers ce serveur. Une fois à jour, lancez : {1}
cd.cert_ask Obtenir le certificat HTTPS maintenant avec : {1}
cd.cert_ok Certificat HTTPS obtenu pour tous les noms.
cd.cert_failed Certbot n'a pas pu obtenir le certificat. Lancez vous-même : {1}
cd.cert_hint Certificat HTTPS à obtenir (nginx et Apache ne le font pas seuls) : {1}
cd.cert_caddy Le certificat HTTPS du nouveau nom est demandé par Caddy tout seul.
cd.done {1}Domaine changé{2} : le site répond maintenant sur https://{3}
cd.done_todo {1}Domaine changé, mais il reste des choses à faire{2} pour https://{3} (voir plus haut).
cd.next_check Ouvrez l'administration en mode avancé : Réglages du site, Adresse du site, « Après le changement » (https://{1}/admin/settings/address/after).
cd.next_docs Clés d'accès, adresses de retour chez les services tiers, OBS : voir docs/MIGRER-DOMAINE.md.
CATALOG_FR
}

catalog_en() { cat <<'CATALOG_EN'
lang.name English
plural.zero other
lbl.ok OK
lbl.warn WARNING
lbl.error ERROR
lbl.fix What to do:
lbl.details Technical details:
yn.yes y yes
prompt.consent {1} (y/N)
prompt.ask {1}:
prompt.ask_def {1} [{2}]:
prompt.domain Domain name:
prompt.purge To confirm, type the site name ({1}):
consent.yes {1}  ->  yes (--yes)
consent.need Your approval is needed for: {1}
consent.need.fix run again with --yes to accept, or run the command in a terminal so that I can ask you.
opt.needvalue Option {1}: a value is required.
opt.unknown Unknown option: {1} (see --help)
err.insecure_url The download address is not secure.
err.insecure_url.fix only use https:// addresses (http:// addresses are only meant for automatic tests).
err.unexpected The script stopped unexpectedly (step: {1}).
err.unexpected.fix run the same command again, it continues where it stopped. If it happens again, send the message above (without any password or code) to the person who helps you.
err.root This script must be run with administrator rights.
err.root.fix run again with: sudo bash install.sh
step.prep preparation
step.detect checking the environment
step.ask questions
step.state checking the existing installation
step.release looking for the release
step.pkgs tools and Node.js
step.download download and verification
step.user user and folder
step.env configuration (.env)
step.db database
step.unit systemd service
step.local local check
step.proxy web server (HTTPS)
step.public public check
m.title {1}Curiosa installation{2}
m.install 4/5  Installation
m.uninstall_root This script must be run with administrator rights.
m.uninstall_root.fix run again with: sudo bash install.sh --uninstall --site NAME
m.uninstall_site The name of the site to uninstall is missing.
m.uninstall_site.fix add --site NAME.
m.purge_alone --purge is used together with --uninstall.
m.purge_alone.fix run again with --uninstall --purge --site NAME.
un.title Uninstalling "{1}"
un.notfound I cannot find an installation "{1}" made by this script in {2}.
un.notfound.fix check --site and --dir; I only touch what I installed myself.
un.service_removed Service {1} stopped and removed.
un.no_unit No systemd unit of mine to remove.
un.nginx_removed nginx configuration removed ({1}).
un.nginx_warn nginx -t fails after the removal: check by hand before reloading.
un.apache_removed Apache site removed.
un.caddy_removed Caddy site removed.
un.kept The site is stopped. The folder {1} and the user {2} are kept (your data is there).
un.purge_hint To delete everything afterwards: sudo bash install.sh --uninstall --purge --site {1}
un.need_tty Deleting the data needs a confirmation typed in a terminal.
un.need_tty.fix run the command yourself in a terminal (an AI cannot confirm it for you).
un.purge_warn This permanently deletes {1} (database, uploaded images, .env) and the user {2}.
un.backup_notice A backup is written first to {1} (readable by root only).
un.confirm_diff The confirmation differs from the site name: nothing was deleted.
un.confirm_diff.fix run again and type exactly "{1}".
un.backup_failed The backup failed: nothing was deleted.
un.backup_failed.fix free some disk space, then run again.
un.purged Folder and user deleted. Backup: {1}
d.title 1/5  Looking at your server (nothing is changed)
d.arch_ok Processor: {1} (compatible).
d.arch_arm This server has an ARM processor ({1}). For now, Curiosa is only published for x86_64 processors ("amd64", "x64").
d.arch_arm.fix create another server and choose an x86_64 / amd64 / "Intel or AMD" model (avoid "ARM", "Ampere", "Graviton", "arm64"), then run this script on it. Nothing was changed here.
d.arch_unknown Processor not recognized ({1}): Curiosa is only published for x86_64.
d.arch_unknown.fix use an x86_64 (amd64) server. Nothing was changed.
d.alpine Alpine Linux is not supported (the release is made for Debian/Ubuntu type systems).
d.alpine.fix create the server with Ubuntu LTS or Debian.
d.os_ok System: {1}.
d.os_warn System: {1}. I can install everything without help on Ubuntu and Debian; here I will stop if a tool is missing.
d.no_systemd systemd is not active on this server (it keeps the site running).
d.no_systemd.fix use a regular Ubuntu or Debian server (not a container without systemd), or follow the manual installation in docs/AGENT-INSTALL.md.
d.systemd_ok systemd is present.
d.mem_low Memory: only {1} MB. This is tight: plan for at least 1 GB (1 to 2 GB recommended), otherwise the site may stop.
d.mem_ok Memory: {1} MB.
d.tool_passwd The system tool "{1}" is missing.
d.tool_passwd.fix install your distribution's "passwd" package, or use Ubuntu/Debian.
d.tool_runuser The system tool "{1}" is missing.
d.tool_runuser.fix install your distribution's "util-linux" package, or use Ubuntu/Debian.
d.tools_ok Tools present (curl, git, tar, sha256sum, openssl).
d.tools_todo.one Tool to install: {2}
d.tools_todo.other Tools to install: {2}
d.node_home Node.js found in a personal folder ({1}): the site could not use it (dedicated user).
d.node_ok Node.js {1} ({2}).
d.node_old Node.js {1} is too old (20.9 or later is required).
d.node_none Node.js is not installed.
d.node_manual Node.js 20.9 or later is required and I cannot install it on {1}.
d.node_manual.fix install Node.js 22 (https://nodejs.org/en/download), then run this script again. Nothing was changed.
d.web_found Web server already installed: {1} ({2})  ->  I ADD your site to it without touching the others.
d.state_active running
d.state_stopped stopped
d.web_none No web server: I will install Caddy (automatic HTTPS certificate).
d.ufw ufw firewall is active ({1}).
d.ufw_open 80/443 already open
d.ufw_closed 80/443 closed
a.title 2/5  Three questions
a.q_site 1. Site name (short, lowercase, no spaces; e.g. mysite)
a.site_missing The site name is missing.
a.site_missing.fix run again with --site mysite (short, lowercase).
a.site_bad The site name "{1}" is not valid.
a.site_bad.fix use 2 to 31 characters: lowercase letters without accents, digits or hyphens, starting with a letter (e.g. mysite).
a.q_domain 2. Domain name: the address your audience will see (e.g. mysite.example.org). Leave empty for a simple trial without a domain.
a.domain_missing The domain name is missing.
a.domain_missing.fix run again with --domain mysite.example.org (or --no-domain for a trial without a domain, local HTTP only).
a.domain_bad "{1}" is not a valid domain name.
a.domain_bad.fix write it without https:// and without spaces, for example mysite.example.org (an IP address does not work).
a.q_user 3. Dedicated Linux user: the site will run under a separate account with no administrator rights. If it ever had a flaw, the damage would stay inside its folder.
a.q_user_label Dedicated user
a.user_bad The user name "{1}" is not valid.
a.user_bad.fix use lowercase letters without accents, digits and hyphens (32 characters at most), for example {2}-web.
a.user_root The user "root" is not allowed to run the site.
a.user_root.fix choose another name, for example {1}-web.
a.dir_abs The installation folder must be a full path (starting with /).
a.dir_abs.fix for example --dir /var/www/{1}
a.dir_reserved The folder "{1}" is reserved for the system.
a.dir_reserved.fix keep the default /var/www/{2}.
s.title 3/5  Checking what already exists (nothing is changed)
s.other_install The folder {1} belongs to another installation (site "{2}").
s.other_install.fix choose another folder with --dir, or keep the same site name.
s.user_kept This installation uses the user "{1}": I keep it.
s.resume An installation started by this script exists in {1}: I resume it where it stopped.
s.not_empty The folder {1} is not empty and was not created by this script. I never overwrite it (it may hold another site).
s.not_empty.fix look at what it contains (ls -la {1}). For a new site, choose another folder with --dir, or move the old one: sudo mv {1} {1}.old
s.dir_free The folder {1} is free.
s.user_other_home The user "{1}" already exists, with another home folder ({2}).
s.user_other_home.fix choose another name with --user (for example {3}-web2); I do not modify an existing account.
s.user_reuse The user "{1}" already exists with the right folder: I use it.
s.unit_foreign A service "{1}.service" already exists and was not created by this script.
s.unit_foreign.fix choose another site name (--site), or look at it: systemctl cat {1}.service
s.port_bad The port "{1}" is not valid.
s.port_bad.fix choose a number between 1024 and 65535, or let me find a free one (do not give --port).
s.port_busy Port {1} is already used by another program (I do not touch it).
s.port_busy.fix do not give --port: I will take the first free port, or choose another one.
s.port_next Port {1} is already taken (by another program, which I leave alone): I try the next one.
s.port_none No free port found around {1}.
s.port_none.fix free a port or give --port.
s.port_ok Local port of the site: {1}.
s.disk_low Not enough disk space: {1} MB free, about {2} are needed.
s.disk_low.fix choose a server with more disk (20 GB is fine) or free some space.
s.disk_ok Disk space: {1} MB free.
s.dns_none The domain {1} does not point to any address yet (DNS "A" record missing or not propagated yet).
s.dns_noip I cannot find the public address of this server (no Internet access?). The domain points to: {1}
s.dns_ok The domain {1} points to this server ({2}).
s.dns_other The domain {1} points to {2} but this server is at address {3}.
s.dns_skip (--skip-dns-check) I continue anyway.
s.dns_howto At your registrar (where you bought the domain), create an A record: name "{1}" (or "@"), value {2}. Wait a few minutes (sometimes longer): you can check with  getent hosts {1}
s.dns_this_ip this-server-IP-address
s.dns_cloudflare If you use Cloudflare, set the cloud to grey (DNS only) during the installation.
s.dns_stop The domain's DNS does not point (yet) to this server: the HTTPS certificate could not be obtained.
s.dns_stop.fix fix the A record, wait until it has propagated, then run the same command again; or add --skip-dns-check to install anyway (the site will first be reachable locally only, and HTTPS will come by itself once the DNS is right, with Caddy).
s.dns_ask Install anyway, without waiting for the DNS? (otherwise I stop here, nothing is changed)
s.dns_declined Stopped at your request: nothing was changed.
s.dns_declined.fix create the DNS record, wait for it to propagate, then run the same command again.
p.release_present Release already unpacked in {1} ({2}).
p.github_down I cannot query GitHub to find the latest release.
p.github_down.fix check that this server has Internet access (curl -I https://github.com), then run again. If GitHub is down, try again later.
p.no_release No stable release is published yet.
p.no_release.fix wait for a release to be published (the project's "Releases" page); I never install an unpublished version nor build anything on the server.
p.tag_bad Unexpected version number: "{1}".
p.tag_bad.fix give a version like v0.2.13.
p.no_file Release {1} has no file for Linux x64 ({2}, answer {3}).
p.no_file.fix look at the "Releases" page: a release without an archive cannot be installed; choose another version with --tag, or wait.
p.release_ok Release to install: {1} (the latest stable version).
p.title What I am going to do
p.pkgs.one - install the missing tool: {2}
p.pkgs.other - install the missing tools: {2}
p.node - install Node.js {1} (official NodeSource repository)
p.download - download {1} and check its SHA-256 fingerprint (nothing is unpacked if it does not match)
p.user - create the system user "{1}" (no administrator rights, no password)
p.install - install the site in {1}, write its configuration (.env, with a random setup code that I do not display), create the database
p.service - create the service "{1}.service" (starts at boot, restarts by itself), listening locally on port {2}
p.proxy_none - (no web server: the site will only be reachable locally, http://127.0.0.1:{1})
p.proxy_add - ADD {1} to {2} (backup of the old configuration, test before reloading; your other sites are not touched)
p.proxy_nginx - new site only: page compression and a kept-open connection to the site (a site already set up in nginx is not modified)
p.proxy_caddy - install Caddy (official repository): it gets and renews the HTTPS certificate of {1} by itself
p.ufw - open ports 80 and 443 in the ufw firewall
p.start - start the site and check that it answers (/admin/setup)
p.dry {1}(--dry-run) Nothing was changed.{2} To really install, run the same command again without --dry-run.
c.pkgs Install the missing tools ({1}) with apt?
c.pkgs_no Without these tools I cannot continue.
c.pkgs_no.fix install them (sudo apt-get install {1}) then run again.
c.node Install Node.js {1} from the official NodeSource repository?
c.node_no.fix install Node.js 22 (https://nodejs.org/en/download) then run again.
c.node_no Without Node.js 20.9 or later, the site cannot run.
c.caddy Install Caddy from its official repository (apt)?
c.caddy_no Without a web server I cannot put the site on HTTPS.
c.caddy_no.fix run again with --skip-proxy for a local-only site, or install a web server then run again.
c.ufw Open ports 80 and 443 in ufw (needed by the site and the certificate)?
c.ufw_no Ports 80/443 left closed: the site will not be reachable from the Internet until you open them (sudo ufw allow 80/tcp && sudo ufw allow 443/tcp).
c.go Shall we go?
c.stop Stopped: nothing was changed.
l.apt_update Loading the package list did not succeed.
l.apt_update.fix check the server's Internet connection then run again.
l.pkgs Installing {1} did not succeed.
l.pkgs.fix run sudo apt-get install {1} to see the error, fix it then run again.
l.pkgs_ok Tools installed.
l.gnupg Installing gnupg did not succeed.
l.gnupg.fix run sudo apt-get install gnupg then run again.
l.node_key Downloading the NodeSource repository key failed.
l.node_key.fix check access to deb.nodesource.com from this server, or install Node.js 22 yourself then run again.
l.node Installing Node.js did not succeed.
l.node.fix run sudo apt-get install nodejs to see the error, fix it then run again.
l.node_old The installed Node.js ({1}) is still too old.
l.node_old.fix install Node.js 22 by hand (https://nodejs.org/en/download) then run again.
l.node_ok Node.js {1} installed.
l.useradd Creating the user {1} did not succeed.
l.useradd.fix look at the details above; choose another name with --user if the name is already taken.
dl.start Downloading {1} (about 150 MB, a few minutes depending on the connection)…
dl.archive Downloading the archive failed.
dl.archive.fix check Internet access and disk space, then run the same command again (nothing is installed).
dl.sha_file Downloading the fingerprint file (.sha256) failed.
dl.sha_file.fix run the same command again; nothing is installed.
dl.sha_bad The SHA-256 fingerprint of the archive does not match: the file is damaged or was modified. Nothing was unpacked or installed.
dl.sha_bad.fix run the same command again (an interrupted download is the most frequent cause); if it happens again, do not install it and tell the project.
dl.sha_ok SHA-256 fingerprint checked.
dl.unsafe The archive contains an unsafe path ({1}): it is not unpacked.
dl.unsafe.fix do not install it and tell the project.
dl.untar The archive could not be unpacked (disk full?).
dl.untar.fix free some space (df -h) then run again; nothing is installed.
dl.not_curiosa The archive does not look like a Curiosa release.
dl.not_curiosa.fix do not install it and tell the project.
dl.unpacked Archive unpacked in a safe place.
u.created User "{1}" created (no administrator rights).
u.dir_filled The folder {1} is no longer empty: someone wrote in it in the meantime.
u.dir_filled.fix check its content then run again.
u.unpacked Site unpacked in {1}.
e.kept .env already present: I keep it as it is (I never overwrite your configuration).
e.no_token I could not make a random setup code.
e.no_token.fix install openssl (sudo apt-get install openssl) then run again.
e.written Configuration written (.env, readable by the site only). The setup code is not displayed anywhere.
m.failed Creating the database failed.
m.failed.fix run the same command again; if the error is "EACCES", check that {1} belongs to {2} (sudo chown -R {2}: {1}).
m.ready Database ready.
v.uptodate Service already up to date.
v.written Service {1}.service written.
v.active Service already running.
v.start_failed The service could not start.
v.start_failed.fix look at why: sudo journalctl -u {1} -n 40 --no-pager; then run the same command again.
v.started Service started (and restarted automatically when the server starts).
w.local_down The site does not answer locally (http://127.0.0.1:{1}/admin/setup).
w.local_down.fix look at the log: sudo journalctl -u {2} -n 40 --no-pager. If the message mentions a port already in use, run again with --port 3010 (another number); otherwise run the same command again.
w.local_ok The site answers locally (HTTP 200 on /admin/setup).
x.nginx_known nginx already manages {1} in {2}: I do not touch it. To send the traffic to this site, make its "proxy_pass" point to http://127.0.0.1:{3} (template: docs/INSTALL.md).
x.conf_foreign {1} already exists and is not mine: I do not touch it.
x.nginx_uptodate nginx configuration already up to date.
x.nginx_kept Site already present in {1} (written by an earlier version): left as it is. To add compression, see docs/PERFORMANCE.md.
x.backup Old configuration saved: {1}
x.nginx_refused nginx refuses the new configuration (nginx -t failed): I removed it, nginx was not touched.
x.nginx_refused.fix look at the details above; an existing configuration is probably the cause. Run again with --skip-proxy to leave nginx alone.
x.nginx_added {1} added to nginx (reloaded).
x.nginx_stopped nginx is installed but stopped: start it (sudo systemctl start nginx) to put the site online.
p.certbot - get the HTTPS certificate of {1} with certbot (Let's Encrypt), expiry notices to {2}. By using --certbot, you accept the Let's Encrypt terms.
p.certbot_dns - HTTPS certificate not requested: {1} does not point to this server yet (the command to run later is shown at the end)
p.certbot_caddy - --certbot is not needed here: Caddy gets the HTTPS certificate by itself
p.certbot_none - --certbot ignored: without a domain or without touching a web server there is no certificate to request
cert.email_q Your e-mail (for certificate expiry notices)
cert.email_missing --certbot needs an e-mail address for certificate expiry notices.
cert.email_missing.fix add --email, for example --email you@example.org
cert.email_bad The e-mail address "{1}" is not valid.
cert.email_bad.fix write it like you@example.org
cert.ask Get the HTTPS certificate now? An e-mail will be asked for expiry notices, and you accept the Let's Encrypt terms
cert.skip_dns HTTPS certificate not requested: {1} does not point to this server yet. The site stays in HTTP.
cert.skip_stopped HTTPS certificate not requested: the web server is stopped. The site stays in HTTP.
cert.exists A certificate already exists for {1}: I do not ask for another one.
cert.pkgs Installing certbot (packages: {1})
cert.apt_failed Certbot could not be installed (packages: {1}). The site stays in HTTP. To go on by hand: {2}
cert.run Requesting the certificate from Let's Encrypt for {1}
cert.ok HTTPS certificate obtained for {1}: the site is in HTTPS and HTTP redirects to it.
cert.terms By requesting this certificate, you accepted the Let's Encrypt terms.
cert.failed HTTPS certificate not obtained ({1}). The site stays in HTTP, nothing else changed. To try again: {2}
cert.why_limit Let's Encrypt limits the number of requests; try again later
cert.why_unreachable Let's Encrypt could not reach the site on port 80: check the DNS and the firewall
cert.why_other reason in the installation log
f.cert_done HTTPS certificate obtained with certbot for {1}; certbot renews it by itself.
x.apache_layout Apache is present but not laid out the Debian way (sites-available): I do not touch it. Add a virtual host for {1} that forwards to http://127.0.0.1:{2} (ProxyPass / http://127.0.0.1:{2}/), enabling mod_proxy, mod_proxy_http and mod_headers.
x.apache_known Apache already manages {1} in {2}: I do not touch it (make it point to http://127.0.0.1:{3}).
x.a2enmod Enabling the required Apache modules did not succeed.
x.a2enmod.fix run sudo a2enmod proxy proxy_http headers to see the error.
x.a2ensite Enabling the Apache site did not succeed.
x.a2ensite.fix run sudo a2ensite {1} to see the error.
x.apache_refused Apache refuses the new configuration: I removed it, Apache was not reloaded.
x.apache_refused.fix run again with --skip-proxy to leave Apache alone.
x.apache_added {1} added to Apache (reloaded).
x.caddy_apt I can only install Caddy on Ubuntu/Debian.
x.caddy_apt.fix install a web server (Caddy or nginx) then run this script again.
x.caddy_pre Installing the Caddy prerequisites did not succeed.
x.caddy_pre.fix check the Internet connection then run again.
x.caddy_key Downloading the Caddy repository key failed.
x.caddy_key.fix check access to dl.cloudsmith.io from this server, then run again.
x.caddy_list Downloading the Caddy package list failed.
x.caddy_list.fix check access to dl.cloudsmith.io from this server, then run again.
x.caddy_install Installing Caddy did not succeed.
x.caddy_install.fix run sudo apt-get install caddy to see the error, then run again.
x.caddy_ok Caddy installed.
x.caddy_known Caddy already manages {1} in {2}: I do not touch it (make it point to 127.0.0.1:{3}).
x.caddyfile_backup Old Caddyfile saved: {1}
x.caddy_refused Caddy refuses the new configuration: I removed it, Caddy was not reloaded.
x.caddy_refused.fix look at the details above, or run again with --skip-proxy.
x.caddy_nostart Caddy did not start: sudo journalctl -u caddy -n 30
x.caddy_added {1} added to Caddy: the HTTPS certificate is requested automatically.
x.ufw_ok Ports 80 and 443 opened in ufw.
x.ufw_failed I could not open 80/443 in ufw: sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
y.checking Checking the public address (the HTTPS certificate can take up to a minute)…
y.ok The site answers on {1} (HTTP 200).
y.why_http The site answers over HTTP but not yet over HTTPS (certificate not obtained yet).
y.why_down The site does not answer yet on https://{1}.
f.title 5/5  Done
f.rule {1}================================================================{2}
f.done {1}  Curiosa {3} is installed and answers.{2}
f.done_nopublic {1}  Curiosa {3} is installed; its public address does not answer yet.{2}
f.step1 1. Open this address in your browser:
f.url_local (site reachable from this server only; to open it from home: ssh -L {1}:127.0.0.1:{1} user@server-address, then http://localhost:{1}/admin/setup)
f.step2 2. The site asks for a "setup code". It is stored on this server.
f.step2b To read it, type this command YOURSELF in your terminal (the code is shown, copy it into the page):
f.step2_note (I do not write it here on purpose: it must not appear in a log, nor in a conversation with an AI.)
f.step3 3. Then follow the first-time setup assistant.
f.wizard_lang The assistant opens in French by default: pick your language at the question "What language will your site be in?" and the page changes right away.
f.todo {1}To do so that the public address works:{2}
f.todo_dns The DNS of {1} must point to {2} (A record). Caddy will then get the certificate by itself (a few minutes).
f.this_server this server
f.todo_cert HTTPS certificate: {1}
f.todo_ports Ports 80 and 443 must be open at your host (firewall / "security group" in its dashboard).
f.todo_test Then test:  curl -I https://{1}/admin/setup
f.cert HTTPS certificate (nginx/Apache do not get it by themselves):  {1}
f.useful Useful: service status  sudo systemctl status {1}   ·   log  sudo journalctl -u {1} -n 40 --no-pager
f.updates Updates are then done from the site administration (the "Updates" page).
f.token_remove Once the site is set up, remove the SETUP_TOKEN line from {1}/.env then: sudo systemctl restart {2}
f.log Log of this installation: {1}
help.01 install.sh: installs Curiosa on a Linux server (x86_64) from the latest STABLE release.
help.02
help.03 Usage, in two readable steps (never "curl | bash"):
help.04   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
help.05   less install.sh        # (optional) read the file before running it
help.06   sudo bash install.sh
help.07
help.08 The script asks at most three questions (site name, domain name, dedicated Linux user); each has its option
help.09 so that an AI or a script can drive it without interaction:
help.10   --site NAME       short lowercase name (names the folder /var/www/NAME and the service NAME.service)
help.11   --domain DOMAIN   domain name of the site (--no-domain: trial without a domain, local HTTP only)
help.12   --user USER       dedicated Linux user (suggested: NAME-web)
help.13   --port PORT       local port of the site (default: the first free one from 3000)
help.14   --dir FOLDER      installation folder (default: /var/www/NAME)
help.15   --tag vX.Y.Z      install this exact release (default: the latest stable release)
help.16   --yes             answer "yes" to confirmations (install Node.js, Caddy, open 80/443 in ufw…)
help.17   --dry-run         check everything and announce what would be done, WITHOUT changing anything
help.18   --skip-dns-check  do not stop if the domain does not point (yet) to this server
help.19   --skip-proxy      do not touch the web server (HTTPS): the site only listens locally
help.20   --certbot        nginx or Apache: get the HTTPS certificate with certbot (you accept the Let's Encrypt terms)
help.21   --email ADDRESS   with --certbot: e-mail for certificate expiry notices
help.22   --uninstall       stop the site and undo the added configuration (keeps the folder and the data)
help.23   --purge           with --uninstall: also delete the folder and the user (typed confirmation, backup made first)
help.24   --change-domain DOMAIN  change the domain of an already installed site (with --site): a plan by default, nothing is changed
help.25   --apply          with --change-domain: do the change (backups, web server file written by this script, .env, restart)
help.26   --lang fr|en      language of the messages (otherwise: CURIOSA_LANG variable, then LC_ALL / LC_MESSAGES / LANG; else English)
help.27   --help
help.28
help.29 The script can be resumed: run again after a failure, it detects what is done and goes on.
help.30 Exit codes: 0 done; 1 stopped on an error (nothing broken, see the message); 2 unknown option or language;
help.31 10 installed, but the public address does not answer yet (DNS, firewall, certificate: see the last message).
help.32 Exit codes, options and written files are the same in every language.
step.change changing the domain
m.change_alone --change-domain is not used together with --uninstall.
m.apply_alone --apply is used together with --change-domain.
m.apply_alone.fix run again with --change-domain NEW-DOMAIN --site NAME --apply.
cd.site The name of the site whose domain must change is missing.
cd.site.fix add --site NAME.
cd.domain_bad "{1}" is not a valid public domain name (no numeric address, no "localhost", no private network name).
cd.domain_bad.fix write for example  --change-domain mysite.com
cd.root This script must be run with administrator rights.
cd.root.fix run again with: sudo bash install.sh --site {1} --change-domain {2}
cd.notfound I cannot find an installation "{1}" made by this script in {2}.
cd.notfound.fix check --site and --dir; I only touch what I installed myself.
cd.noenv The settings file (.env) is missing in {1}.
cd.noenv.fix restore it from a backup, then run again.
cd.nodomain The site "{1}" has no public domain (current address: {2}): there is nothing to change.
cd.nodomain.fix to give it a domain, run the installation again with --domain.
cd.same The site already uses the domain {1}.
cd.same.fix choose another domain.
cd.title Change the domain of "{1}" to {2}
cd.current Current domain: {1}
cd.plan What would be done
cd.plan_env In {1}: SITE_URL goes from {2} to {3}.
cd.plan_legacy Former domains redirected to the new one (LEGACY_HOSTS): {1}
cd.plan_proxy In {1}: the site names become  {2}
cd.plan_foreign A configuration that is not mine exists: I do not touch it, I will say what to change in it.
cd.plan_cert HTTPS certificate, with your consent: {1}
cd.plan_cert_caddy HTTPS certificate: Caddy asks for it by itself.
cd.plan_restart Restart of the service {1}.
cd.no_proxy No web server configuration written by this script: only the settings file is changed.
cd.dry {1}Nothing was changed.{2} To apply the change of the site {3} to {4}, run the same command again with --apply added.
cd.dns_stop The DNS of {1} does not point (yet) to this server: the HTTPS certificate could not be obtained.
cd.dns_stop.fix fix the A record and wait for propagation; or add --skip-dns-check to change anyway. Nothing was changed.
cd.go Change the domain of {1} to {2} (backups made first, the site restarts)
cd.proxy_done Web server updated: {1}
cd.apache_ssl The file {1} (HTTPS) is not mine: replace the old name with the new one in it, or run certbot again.
cd.foreign_todo In the configuration that is not mine, make the web server answer to the names  {1}  and send the traffic to http://127.0.0.1:{2}
cd.env_done Settings file updated: SITE_URL={1}  LEGACY_HOSTS={2}
cd.restarted Service {1} restarted.
cd.restart_failed The service {1} did not restart.
cd.restart_failed.fix look at  sudo journalctl -u {1} -n 40 --no-pager  ; the former .env is saved next to it (.env.avant-…).
cd.restart_manual The service {1} is not mine: restart the site yourself so that it reads its settings file again.
cd.cert_dns The DNS does not point to this server yet. Once it is up to date, run: {1}
cd.cert_ask Get the HTTPS certificate now with: {1}
cd.cert_ok HTTPS certificate obtained for all names.
cd.cert_failed Certbot could not obtain the certificate. Run it yourself: {1}
cd.cert_hint HTTPS certificate to obtain (nginx and Apache do not do it by themselves): {1}
cd.cert_caddy Caddy asks for the new name's HTTPS certificate by itself.
cd.done {1}Domain changed{2}: the site now answers at https://{3}
cd.done_todo {1}Domain changed, but things are left to do{2} for https://{3} (see above).
cd.next_check Open the administration in advanced mode: Site settings, Site address, "After the change" (https://{1}/admin/settings/address/after).
cd.next_docs Passkeys, return addresses at third-party services, OBS: see docs/MIGRER-DOMAINE.md.
CATALOG_EN
}

# Le script se lance lui-même, sauf s'il est « sourcé » par un test (qui veut seulement ses fonctions).
if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then main "$@"; fi
