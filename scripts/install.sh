#!/usr/bin/env bash
# install.sh : installe Curiosa sur un serveur Linux (x86_64) à partir de la dernière release STABLE.
#
# Usage, en deux temps lisibles (jamais « curl | bash ») :
#   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
#   less install.sh        # (facultatif) relire le fichier avant de l'exécuter
#   sudo bash install.sh
#
# Le script pose au plus trois questions (nom du site, nom de domaine, utilisateur Linux dédié) ; chacune a son option
# pour qu'une IA ou un script le pilote sans interaction :
#   --site NOM        nom court en minuscules (nomme le dossier /var/www/NOM et le service NOM.service)
#   --domain DOMAINE  nom de domaine du site (--no-domain : essai sans domaine, en HTTP local seulement)
#   --user UTILISATEUR utilisateur Linux dédié (défaut proposé : NOM-web)
#   --port PORT       port local du site (défaut : le premier libre à partir de 3000)
#   --dir DOSSIER     dossier d'installation (défaut : /var/www/NOM)
#   --tag vX.Y.Z      installer cette release précise (par défaut : la dernière release stable)
#   --yes             répondre « oui » aux confirmations (installer Node.js, Caddy, ouvrir 80/443 dans ufw…)
#   --dry-run         tout vérifier et annoncer ce qui serait fait, SANS rien modifier
#   --skip-dns-check  ne pas s'arrêter si le DNS du domaine ne pointe pas (encore) vers ce serveur
#   --skip-proxy      ne pas toucher au serveur web (HTTPS) : le site n'écoute qu'en local
#   --uninstall       arrêter le site et défaire la configuration ajoutée (garde le dossier et les données)
#   --purge           avec --uninstall : supprimer aussi le dossier et l'utilisateur (confirmation tapée, sauvegarde faite avant)
#   --help
#
# Le script est reprenable : relancé après un échec, il détecte ce qui est fait et continue.
# Codes de sortie : 0 terminé ; 1 arrêté sur une erreur (rien de cassé, voir le message) ; 2 option inconnue ;
# 10 installé, mais l'adresse publique ne répond pas encore (DNS, pare-feu, certificat : voir le message final).
#
# Variables de TEST (ne servent qu'aux tests automatiques, voir tests/core/install-script.test.mjs) :
#   CURIOSA_ROOT (préfixe fictif pour /etc, /var… ; accepte alors des URL http locales), CURIOSA_ALLOW_NONROOT, CURIOSA_UNAME_M,
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

SITE="" DOMAIN="" SITE_USER="" PORT="" DIR="" TAG="" NO_DOMAIN=0
YES=0 DRY=0 SKIP_DNS=0 SKIP_PROXY=0 UNINSTALL=0 PURGE=0

# ─── Affichage ──────────────────────────────────────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'; else B="" R="" G="" Y="" N=""; fi
say()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '%s  OK%s  %s\n' "$G" "$N" "$*"; }
warn() { printf '%sATTENTION%s  %s\n' "$Y" "$N" "$*" >&2; }
title(){ printf '\n%s%s%s\n' "$B" "$*" "$N"; }

STEP="préparation"; REPORTED=0; LOG=""
# fail "ce qui ne va pas" "ce qu'il faut faire" : un seul remède par erreur, en français.
fail() {
  REPORTED=1
  printf '\n%sERREUR%s  %s\n' "$R" "$N" "$1" >&2
  [ -n "${2:-}" ] && printf '        Que faire : %s\n' "$2" >&2
  [ -n "$LOG" ] && [ -s "$LOG" ] && printf '        Détails techniques : %s\n' "$LOG" >&2
  exit 1
}
on_exit() {
  local rc=$?
  set +e
  [ -n "${STAGING:-}" ] && [ -d "${STAGING:-}" ] && rm -rf -- "$STAGING"
  if [ "$rc" -ne 0 ] && [ "$REPORTED" -eq 0 ] && [ "$rc" -ne 10 ] && [ "$rc" -ne 2 ]; then
    printf '\n%sERREUR%s  Le script s'"'"'est arrêté de façon inattendue (étape : %s).\n' "$R" "$N" "$STEP" >&2
    printf '        Que faire : relancez la même commande, elle reprend où elle s'"'"'est arrêtée. Si ça recommence, envoyez le message ci-dessus (sans mot de passe ni code) à la personne qui vous aide.\n' >&2
    [ -n "$LOG" ] && [ -s "$LOG" ] && printf '        Détails techniques : %s\n' "$LOG" >&2
  fi
}
trap on_exit EXIT

rp() { printf '%s%s' "$ROOT" "$1"; }          # chemin réel d'un chemin logique (préfixe fictif en test)
have() { command -v "$1" >/dev/null 2>&1; }
interactive() { [ -t 0 ]; }

# Lance une commande dont la sortie va dans le journal ; en cas d'échec : l'erreur, avec les dernières lignes.
logged() { # logged "ce qu'on fait" "remède" commande...
  local what="$1" cure="$2"; shift 2
  [ -n "$LOG" ] && printf '\n$ %s\n' "$*" >>"$LOG"
  if ! "$@" >>"${LOG:-/dev/null}" 2>&1; then
    [ -n "$LOG" ] && tail -n 12 "$LOG" >&2
    fail "$what n'a pas abouti." "$cure"
  fi
}

# consent "clé" "question" : oui si --yes ou réponse « o » ; sans terminal et sans --yes : s'arrête en disant comment répondre.
consent() {
  local q="$1" ans
  if [ "$YES" -eq 1 ]; then info "$q  ->  oui (--yes)"; return 0; fi
  if ! interactive; then fail "Il faut votre accord pour : $q" "relancez en ajoutant --yes pour accepter, ou lancez la commande dans un terminal pour que je vous pose la question."; fi
  read -r -p "  $q (o/N) " ans || ans=""
  case "$ans" in o|O|oui|Oui|OUI|y|Y|yes) return 0 ;; *) return 1 ;; esac
}
# ask VARIABLE "question" "défaut" : valeur déjà fournie par une option > question > défaut.
ask() {
  local var="$1" q="$2" def="${3:-}" ans=""
  [ -n "${!var}" ] && return 0
  if interactive; then
    if [ -n "$def" ]; then read -r -p "  $q [$def] : " ans || ans=""; else read -r -p "  $q : " ans || ans=""; fi
    printf -v "$var" '%s' "${ans:-$def}"
  elif [ -n "$def" ]; then
    printf -v "$var" '%s' "$def"
  fi
}

# ─── Options ────────────────────────────────────────────────────────────────────────────────────────────────────────
usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || { printf 'Option %s : une valeur est attendue.\n' "$1" >&2; exit 2; }; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --site) need_value "$@"; SITE="$2"; shift 2 ;;
    --domain) need_value "$@"; DOMAIN="$2"; shift 2 ;;
    --no-domain) NO_DOMAIN=1; shift ;;
    --user) need_value "$@"; SITE_USER="$2"; shift 2 ;;
    --port) need_value "$@"; PORT="$2"; shift 2 ;;
    --dir) need_value "$@"; DIR="$2"; shift 2 ;;
    --tag) need_value "$@"; TAG="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --skip-dns-check) SKIP_DNS=1; shift ;;
    --skip-proxy) SKIP_PROXY=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Option inconnue : %s (voir --help)\n' "$1" >&2; exit 2 ;;
  esac
done
if [ -z "$ROOT" ]; then
  case "$GITHUB_API$GITHUB_WEB" in *http://*) fail "Adresse de téléchargement non sécurisée." "n'utilisez que des adresses https:// (les adresses http:// ne servent qu'aux tests automatiques)." ;; esac
fi

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
do_uninstall() {
  title "Désinstallation de « $SITE »"
  [ -n "$DIR" ] || DIR="/var/www/$SITE"
  local m; m="$(rp "$DIR")/$MARKER_NAME"
  [ -f "$m" ] && [ "$(marker_get "$m" site)" = "$SITE" ] || fail "Je ne trouve pas d'installation « $SITE » faite par ce script dans $DIR." "vérifiez --site et --dir ; je ne touche qu'à ce que j'ai installé moi-même."
  SITE_USER=$(marker_get "$m" user)
  local u; u="$(unit_path "$SITE")"
  if [ -f "$u" ] && grep -q '^# Géré par install-curiosa' "$u"; then
    systemctl disable --now "$SITE.service" >/dev/null 2>&1 || true
    rm -f -- "$u"; systemctl daemon-reload || true; ok "Service $SITE arrêté et retiré."
  else info "Pas d'unité systemd à moi à retirer."; fi
  local f reloaded=""
  for f in "$(rp /etc/nginx/sites-enabled/$SITE.conf)" "$(rp /etc/nginx/sites-available/$SITE.conf)" "$(rp /etc/nginx/conf.d/$SITE.conf)"; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      if [ -L "$f" ] || grep -q '^# Géré par install-curiosa' "$f" 2>/dev/null; then rm -f -- "$f"; reloaded=nginx; ok "Configuration nginx retirée ($f)."; fi
    fi
  done
  [ "$reloaded" = nginx ] && { nginx -t >/dev/null 2>&1 && systemctl reload nginx || warn "nginx -t échoue après le retrait : vérifiez à la main avant de recharger."; }
  f="$(rp /etc/apache2/sites-available/$SITE.conf)"
  if [ -f "$f" ] && grep -q '^# Géré par install-curiosa' "$f"; then a2dissite "$SITE" >/dev/null 2>&1 || true; rm -f -- "$f"; systemctl reload apache2 || true; ok "Site Apache retiré."; fi
  f="$(rp /etc/caddy/sites/$SITE.caddy)"
  if [ -f "$f" ] && grep -q '^# Géré par install-curiosa' "$f"; then rm -f -- "$f"; systemctl reload caddy || true; ok "Site Caddy retiré."; fi
  if [ "$PURGE" -ne 1 ]; then
    say ""; say "Le site est arrêté. Le dossier $DIR et l'utilisateur $SITE_USER sont conservés (vos données y sont)."
    say "Pour tout supprimer ensuite : sudo bash install.sh --uninstall --purge --site $SITE"
    return 0
  fi
  interactive || fail "La suppression des données demande une confirmation tapée dans un terminal." "lancez la commande vous-même dans un terminal (une IA ne peut pas la confirmer à votre place)."
  local backup; backup="$(rp /root)/curiosa-$SITE-sauvegarde-$(date +%Y%m%d-%H%M%S).tar.gz"
  warn "Ceci supprime définitivement $DIR (base de données, images envoyées, .env) et l'utilisateur $SITE_USER."
  say "  Une sauvegarde sera d'abord écrite dans $backup (lisible par root seulement)."
  local typed; read -r -p "  Pour confirmer, tapez le nom du site ($SITE) : " typed || typed=""
  [ "$typed" = "$SITE" ] || fail "Confirmation différente du nom du site : rien n'a été supprimé." "relancez et tapez exactement « $SITE »."
  mkdir -p "$(dirname "$backup")"; (umask 077; tar -czf "$backup" -C "$(rp "$DIR")" --ignore-failed-read data .env 2>/dev/null) || fail "La sauvegarde a échoué : rien n'a été supprimé." "libérez de la place disque puis relancez."
  rm -rf -- "${ROOT}${DIR:?}"; userdel "$SITE_USER" >/dev/null 2>&1 || true
  ok "Dossier et utilisateur supprimés. Sauvegarde : $backup"
}

# ─── Phase A : constater l'environnement (lecture seule) ────────────────────────────────────────────────────────────
phase_detect() {
  STEP="constat de l'environnement"
  title "1/5  Je regarde votre serveur (rien n'est modifié)"
  if [ "$(id -u)" -ne 0 ] && ! { [ -n "$ROOT" ] && [ "${CURIOSA_ALLOW_NONROOT:-}" = 1 ]; }; then
    fail "Ce script doit être lancé avec les droits d'administration." "relancez avec : sudo bash install.sh"
  fi
  local arch; arch="${CURIOSA_UNAME_M:-$(uname -m)}"
  case "$arch" in
    x86_64|amd64) ok "Processeur : $arch (compatible)." ;;
    aarch64|arm64|armv*|arm*) fail "Ce serveur a un processeur ARM ($arch). Curiosa n'est publié que pour les processeurs x86_64 (« amd64 », « x64 ») pour l'instant." "créez un autre serveur en choisissant un modèle x86_64 / amd64 / « Intel ou AMD » (évitez les mentions « ARM », « Ampere », « Graviton », « arm64 »), puis relancez ce script dessus. Rien n'a été modifié ici." ;;
    *) fail "Processeur non reconnu ($arch) : Curiosa n'est publié que pour x86_64." "utilisez un serveur x86_64 (amd64). Rien n'a été modifié." ;;
  esac
  OS_ID="inconnu"; OS_LIKE=""; OS_NAME="Linux"
  local osr; osr="${CURIOSA_OS_RELEASE:-/etc/os-release}"
  # shellcheck disable=SC1090  # le fichier os-release est lu tel quel (variable de test CURIOSA_OS_RELEASE comprise)
  if [ -r "$osr" ]; then OS_ID=$(. "$osr"; printf '%s' "${ID:-inconnu}"); OS_LIKE=$(. "$osr"; printf '%s' "${ID_LIKE:-}"); OS_NAME=$(. "$osr"; printf '%s' "${PRETTY_NAME:-Linux}"); fi
  APT=0
  case " $OS_ID $OS_LIKE " in *" debian "*|*" ubuntu "*) APT=1 ;; esac
  if [ "$OS_ID" = alpine ]; then fail "Alpine Linux n'est pas pris en charge (la release est faite pour les systèmes de type Debian/Ubuntu)." "créez le serveur avec Ubuntu LTS ou Debian."; fi
  if [ "$APT" -eq 1 ]; then ok "Système : $OS_NAME."; else warn "Système : $OS_NAME. Je sais tout installer sans aide sur Ubuntu et Debian ; ici je m'arrêterai si un outil manque."; fi
  if [ ! -d "$(rp /run/systemd/system)" ]; then
    fail "systemd n'est pas actif sur ce serveur (c'est lui qui garde le site allumé)." "utilisez un serveur Ubuntu ou Debian classique (pas un conteneur sans systemd), ou suivez l'installation manuelle de docs/AGENT-INSTALL.md."
  fi
  ok "systemd présent."
  local mem; mem=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${mem:-0}" -gt 0 ] && [ "$mem" -lt 700 ]; then warn "Mémoire : ${mem} Mo seulement. C'est juste : prévoyez au moins 1 Go (1 à 2 Go recommandés), sinon le site peut s'arrêter."; else ok "Mémoire : ${mem} Mo."; fi

  # outils
  MISSING_PKGS=()
  have curl || MISSING_PKGS+=(curl); have git || MISSING_PKGS+=(git); have tar || MISSING_PKGS+=(tar)
  have sha256sum || MISSING_PKGS+=(coreutils); have openssl || MISSING_PKGS+=(openssl); have gzip || MISSING_PKGS+=(gzip)
  local t; for t in getent useradd; do have "$t" || fail "Il manque l'outil système « $t »." "installez le paquet « passwd » de votre distribution, ou utilisez Ubuntu/Debian."; done
  [ -n "$ROOT" ] || have runuser || fail "Il manque l'outil système « runuser »." "installez le paquet « util-linux » de votre distribution, ou utilisez Ubuntu/Debian."
  if [ "${#MISSING_PKGS[@]}" -eq 0 ]; then ok "Outils présents (curl, git, tar, sha256sum, openssl)."; else info "Outils à installer : ${MISSING_PKGS[*]}"; fi

  # Node.js
  NODE_BIN=""; NODE_NEED=0
  if have node; then
    NODE_BIN=$(readlink -f "$(command -v node)")
    local nv; nv=$(node -v 2>/dev/null || echo "")
    case "$NODE_BIN" in /root/*|/home/*) NODE_NEED=1; warn "Node.js trouvé dans un dossier personnel ($NODE_BIN) : le site ne pourrait pas l'utiliser (utilisateur dédié)." ;; esac
    if [ "$NODE_NEED" -eq 0 ]; then
      if node_version_ok "$nv"; then ok "Node.js $nv ($NODE_BIN)."; else NODE_NEED=1; warn "Node.js $nv est trop ancien (il faut 20.9 ou plus)."; fi
    fi
  else NODE_NEED=1; info "Node.js n'est pas installé."; fi
  if [ "$NODE_NEED" -eq 1 ] && [ "$APT" -ne 1 ]; then
    fail "Node.js 20.9 ou plus est nécessaire et je ne sais pas l'installer sur $OS_NAME." "installez Node.js 22 (https://nodejs.org/fr/download), puis relancez ce script. Rien n'a été modifié."
  fi

  # serveur web déjà là ?
  WEB=""; WEB_ACTIVE=0
  local w unit
  for w in nginx apache2 httpd caddy; do
    unit="$w"
    if systemctl is-active --quiet "$unit" 2>/dev/null; then WEB="$w"; WEB_ACTIVE=1; break; fi
  done
  if [ -z "$WEB" ]; then for w in nginx apache2 httpd caddy; do if have "$w"; then WEB="$w"; break; fi; done; fi
  if [ -n "$WEB" ]; then ok "Serveur web déjà installé : $WEB ($( [ "$WEB_ACTIVE" -eq 1 ] && echo actif || echo arrêté ))  ->  j'y AJOUTE votre site sans toucher aux autres."; else info "Aucun serveur web : j'installerai Caddy (certificat HTTPS automatique)."; fi
  UFW_ACTIVE=0; UFW_OPEN=1
  local ufw_out=""; have ufw && ufw_out=$(ufw status 2>/dev/null || true)
  if printf '%s\n' "$ufw_out" | grep -q '^Status: active'; then
    UFW_ACTIVE=1
    printf '%s\n' "$ufw_out" | grep -Eq '^(80|443)(/tcp)?[[:space:]]+ALLOW|^(Nginx|Apache|WWW) ' || UFW_OPEN=0
    ok "Pare-feu ufw actif ($( [ "$UFW_OPEN" -eq 1 ] && echo "80/443 déjà ouverts" || echo "80/443 fermés" ))."
  fi
}

# ─── Phase B : questions, validations, état existant ────────────────────────────────────────────────────────────────
phase_ask() {
  STEP="questions"
  title "2/5  Trois questions"
  ask SITE "1. Nom du site (court, en minuscules, sans espace ; ex. monsite)"
  [ -n "$SITE" ] || fail "Il manque le nom du site." "relancez avec --site monsite (court, en minuscules)."
  printf '%s' "$SITE" | grep -Eq '^[a-z][a-z0-9-]{1,30}$' || fail "Le nom du site « $SITE » n'est pas valable." "utilisez 2 à 31 caractères : des lettres minuscules sans accent, des chiffres ou des tirets, en commençant par une lettre (ex. monsite)."
  if [ "$NO_DOMAIN" -eq 0 ] && [ -z "$DOMAIN" ] && interactive; then
    say "  2. Nom de domaine : l'adresse que verra votre public (ex. monsite.example.org). Laissez vide pour un simple essai sans domaine."
    read -r -p "     Nom de domaine : " DOMAIN || DOMAIN=""
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#\.$##')
  if [ -z "$DOMAIN" ]; then
    [ "$NO_DOMAIN" -eq 1 ] || interactive || fail "Il manque le nom de domaine." "relancez avec --domain monsite.example.org (ou --no-domain pour un essai sans domaine, en HTTP local seulement)."
    NO_DOMAIN=1
  else
    printf '%s' "$DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$' || fail "« $DOMAIN » n'est pas un nom de domaine valable." "écrivez-le sans https:// et sans espace, par exemple monsite.example.org (une adresse IP ne convient pas)."
  fi
  say "  3. Utilisateur Linux dédié : le site tournera sous un compte à part, sans droits d'administration. Si un jour il avait une faille, elle resterait enfermée dans son dossier."
  ask SITE_USER "   Utilisateur dédié" "$SITE-web"
  [ -n "$SITE_USER" ] || SITE_USER="$SITE-web"
  printf '%s' "$SITE_USER" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || fail "Le nom d'utilisateur « $SITE_USER » n'est pas valable." "utilisez des minuscules sans accent, chiffres, tirets (32 caractères au plus), par exemple $SITE-web."
  [ "$SITE_USER" != root ] || fail "L'utilisateur « root » est interdit pour faire tourner le site." "choisissez un autre nom, par exemple $SITE-web."
  [ -n "$DIR" ] || DIR="/var/www/$SITE"
  case "$DIR" in /*) ;; *) fail "Le dossier d'installation doit être un chemin complet (commençant par /)." "par exemple --dir /var/www/$SITE" ;; esac
  case "$DIR" in /|/etc*|/usr*|/bin*|/sbin*|/lib*|/boot*|/dev*|/proc*|/sys*|/root|/home) fail "Le dossier « $DIR » est réservé au système." "gardez le défaut /var/www/$SITE." ;; esac

  STEP="état de l'installation"
  title "3/5  Je vérifie ce qui existe déjà (rien n'est modifié)"
  RESUME=0; local d m; d="$(rp "$DIR")"; m="$d/$MARKER_NAME"
  if [ -e "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
    if [ -f "$m" ]; then
      [ "$(marker_get "$m" site)" = "$SITE" ] || fail "Le dossier $DIR appartient à une autre installation (site « $(marker_get "$m" site) »)." "choisissez un autre dossier avec --dir, ou gardez le même nom de site."
      RESUME=1; PORT_FROM_MARKER=$(marker_get "$m" port)
      local mu; mu=$(marker_get "$m" user); [ -n "$mu" ] && [ "$mu" != "$SITE_USER" ] && { warn "Cette installation utilise l'utilisateur « $mu » : je le garde."; SITE_USER="$mu"; }
      [ -z "$PORT" ] && PORT="$PORT_FROM_MARKER"
      ok "Une installation commencée par ce script existe dans $DIR : je la reprends là où elle s'est arrêtée."
    else
      fail "Le dossier $DIR n'est pas vide et n'a pas été créé par ce script. Je ne l'écrase jamais (il contient peut-être un autre site)." "regardez ce qu'il contient (ls -la $DIR). Pour un nouveau site, choisissez un autre dossier avec --dir, ou déplacez l'ancien : sudo mv $DIR $DIR.ancien"
    fi
  else ok "Le dossier $DIR est libre."; fi
  USER_EXISTS=0
  if getent passwd "$SITE_USER" >/dev/null 2>&1; then
    USER_EXISTS=1; local home; home=$(getent passwd "$SITE_USER" | cut -d: -f6)
    [ "$home" = "$DIR" ] || fail "L'utilisateur « $SITE_USER » existe déjà, avec un autre dossier personnel ($home)." "choisissez un autre nom avec --user (par exemple $SITE-web2) ; je ne modifie pas un compte existant."
    info "L'utilisateur « $SITE_USER » existe déjà avec le bon dossier : je l'utilise."
  fi
  UNIT="$(unit_path "$SITE")"; UNIT_OURS=0
  if [ -f "$UNIT" ]; then
    grep -q '^# Géré par install-curiosa' "$UNIT" || fail "Un service « $SITE.service » existe déjà et n'a pas été créé par ce script." "choisissez un autre nom de site (--site), ou regardez-le : systemctl cat $SITE.service"
    UNIT_OURS=1
  fi
  # port
  if [ -n "$PORT" ]; then
    printf '%s' "$PORT" | grep -Eq '^[0-9]{2,5}$' && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "Le port « $PORT » n'est pas valable." "choisissez un nombre entre 1024 et 65535, ou laissez-moi en trouver un libre (n'indiquez pas --port)."
    if [ "$RESUME" -eq 0 ] || [ "$UNIT_OURS" -eq 0 ]; then free_port "$PORT" || fail "Le port $PORT est déjà utilisé par un autre programme (je n'y touche pas)." "n'indiquez pas --port : je prendrai le premier port libre, ou choisissez-en un autre."; fi
  else
    PORT="$PORT_START"
    while ! free_port "$PORT"; do info "Le port $PORT est déjà pris (par un autre programme, que je laisse tranquille) : j'essaie le suivant."; PORT=$((PORT + 1)); [ "$PORT" -lt $((PORT_START + 200)) ] || fail "Aucun port libre trouvé autour de $PORT_START." "libérez un port ou indiquez --port."; done
  fi
  ok "Port local du site : $PORT."
  # espace disque
  local anc="$d"; while [ ! -e "$anc" ]; do anc=$(dirname "$anc"); done
  local freemb; freemb=$(df -Pk "$anc" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024}'); freemb=${freemb:-0}
  [ "$RESUME" -eq 1 ] || { [ "$freemb" -ge "$MIN_FREE_MB" ] || fail "Pas assez de place disque : ${freemb} Mo libres, il en faut environ ${MIN_FREE_MB}." "choisissez un serveur avec plus de disque (20 Go conviennent) ou libérez de la place."; }
  ok "Espace disque : ${freemb} Mo libres."

  # DNS
  DNS_OK=1; PUBLIC_IP=""
  if [ "$NO_DOMAIN" -eq 0 ]; then
    local ips="${CURIOSA_DOMAIN_IP:-}"; [ -n "$ips" ] || ips=$(resolve_v4 "$DOMAIN")
    [ "$ips" = none ] && ips=""
    PUBLIC_IP=$(public_ip || true)
    if [ -z "$ips" ]; then
      DNS_OK=0; warn "Le domaine $DOMAIN ne pointe vers aucune adresse pour l'instant (enregistrement DNS « A » absent ou pas encore propagé)."
    elif [ -z "$PUBLIC_IP" ]; then
      warn "Je n'arrive pas à connaître l'adresse publique de ce serveur (pas d'accès à Internet ?). Le domaine pointe vers : $ips"
    else
      case " $ips " in
        *" $PUBLIC_IP "*) ok "Le domaine $DOMAIN pointe bien vers ce serveur ($PUBLIC_IP)." ;;
        *) DNS_OK=0; warn "Le domaine $DOMAIN pointe vers $ips mais ce serveur est à l'adresse $PUBLIC_IP." ;;
      esac
    fi
    if [ "$DNS_OK" -eq 0 ]; then
      if [ "$SKIP_DNS" -eq 1 ]; then info "(--skip-dns-check) je continue quand même."
      else
        say "     Chez votre registraire (là où vous avez acheté le domaine), créez un enregistrement de type A : nom « $DOMAIN » (ou « @ »), valeur ${PUBLIC_IP:-adresse-IP-de-ce-serveur}. Attendez quelques minutes (parfois plus) : on peut vérifier avec  getent hosts $DOMAIN"
        say "     Si vous utilisez Cloudflare, mettez le nuage en gris (DNS seul) le temps de l'installation."
        if [ "$YES" -eq 1 ] || ! interactive; then
          fail "Le DNS du domaine ne pointe pas (encore) vers ce serveur : le certificat HTTPS ne pourrait pas être obtenu." "corrigez l'enregistrement A, attendez qu'il soit propagé puis relancez la même commande ; ou ajoutez --skip-dns-check pour installer quand même (le site sera d'abord joignable en local seulement, le HTTPS viendra tout seul quand le DNS sera bon, avec Caddy)."
        fi
        consent "Installer quand même, sans attendre le DNS ? (sinon j'arrête ici, rien n'est modifié)" || fail "Arrêt à votre demande : rien n'a été modifié." "créez l'enregistrement DNS, attendez la propagation, puis relancez la même commande."
      fi
    fi
  fi
  [ "$NO_DOMAIN" -eq 1 ] && SKIP_PROXY=1
  if [ "$NO_DOMAIN" -eq 1 ]; then SITE_URL="http://localhost:$PORT"; else SITE_URL="https://$DOMAIN"; fi
}

# ─── Phase C : version à installer + plan + accords ─────────────────────────────────────────────────────────────────
phase_plan() {
  STEP="recherche de la release"
  if [ "$RESUME" -eq 1 ] && [ -f "$(rp "$DIR")/release.json" ]; then
    TAG=$(sed -n 's/.*"version": *"\([^"]*\)".*/v\1/p' "$(rp "$DIR")/release.json" | head -n1)
    ok "Release déjà dépliée dans $DIR ($TAG)."
  else
    if [ -z "$TAG" ]; then
      local json; json=$(curl -fsSL -m 25 "$GITHUB_API/repos/$REPO/releases/latest" 2>/dev/null) || fail "Je n'arrive pas à interroger GitHub pour trouver la dernière release." "vérifiez que ce serveur a accès à Internet (curl -I https://github.com), puis relancez. Si GitHub est en panne, réessayez plus tard."
      TAG=$(printf '%s' "$json" | grep -m1 '"tag_name"' | cut -d'"' -f4 || true)
      [ -n "$TAG" ] || fail "Aucune release stable n'est publiée pour l'instant." "attendez la publication d'une release (page « Releases » du projet) ; je n'installe jamais une version non publiée ni ne compile rien sur le serveur."
    fi
    printf '%s' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$' || fail "Numéro de version inattendu : « $TAG »." "indiquez une version du type v0.2.13."
    FILE="curiosa-$TAG-linux-x64.tar.gz"
    local code; code=$(curl -s -o /dev/null -m 25 -L -r 0-0 -w '%{http_code}' "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE.sha256" 2>/dev/null || true)
    case "$code" in 200|206) ;; *) fail "La release $TAG n'a pas de fichier pour Linux x64 ($FILE, réponse $code)." "regardez la page « Releases » : une release sans archive ne peut pas s'installer ; choisissez une autre version avec --tag, ou attendez." ;; esac
    ok "Release à installer : $TAG (la dernière version stable)."
  fi

  title "Ce que je vais faire"
  [ "${#MISSING_PKGS[@]}" -gt 0 ] && info "- installer les outils manquants : ${MISSING_PKGS[*]}"
  [ "$NODE_NEED" -eq 1 ] && info "- installer Node.js $NODE_MAJOR_WANTED (dépôt officiel NodeSource)"
  [ "$RESUME" -eq 0 ] && info "- télécharger $TAG et vérifier son empreinte SHA-256 (rien n'est déplié si elle ne correspond pas)"
  [ "$USER_EXISTS" -eq 0 ] && info "- créer l'utilisateur système « $SITE_USER » (sans droits d'administration, sans mot de passe)"
  info "- installer le site dans $DIR, écrire sa configuration (.env, avec un code d'installation aléatoire que je n'affiche pas), créer la base de données"
  info "- créer le service « $SITE.service » (démarre au boot, redémarre seul), à l'écoute en local sur le port $PORT"
  PROXY_PLAN=none
  if [ "$SKIP_PROXY" -eq 1 ]; then info "- (pas de serveur web : le site ne sera joignable qu'en local, http://127.0.0.1:$PORT)"
  elif [ -n "$WEB" ]; then PROXY_PLAN="$WEB"; info "- AJOUTER $DOMAIN à $WEB (sauvegarde de l'ancienne configuration, test avant rechargement ; vos autres sites ne sont pas touchés)"
  else PROXY_PLAN=caddy-install; info "- installer Caddy (dépôt officiel) : il obtient et renouvelle seul le certificat HTTPS de $DOMAIN"; fi
  [ "$UFW_ACTIVE" -eq 1 ] && [ "$UFW_OPEN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ] && info "- ouvrir les ports 80 et 443 dans le pare-feu ufw"
  info "- démarrer le site et vérifier qu'il répond (/admin/setup)"

  if [ "$DRY" -eq 1 ]; then
    say ""; say "$B(--dry-run) Rien n'a été modifié.$N Pour installer pour de bon, relancez la même commande sans --dry-run."
    exit 0
  fi
  # accords : tous demandés AVANT toute modification
  WANT_UFW=0
  [ "${#MISSING_PKGS[@]}" -gt 0 ] && { consent "Installer les outils manquants (${MISSING_PKGS[*]}) avec apt ?" || fail "Sans ces outils je ne peux pas continuer." "installez-les (sudo apt-get install ${MISSING_PKGS[*]}) puis relancez."; }
  [ "$NODE_NEED" -eq 1 ] && { consent "Installer Node.js $NODE_MAJOR_WANTED depuis le dépôt officiel NodeSource ?" || fail "Sans Node.js 20.9 ou plus, le site ne peut pas tourner." "installez Node.js 22 (https://nodejs.org/fr/download) puis relancez."; }
  [ "$PROXY_PLAN" = caddy-install ] && { consent "Installer Caddy depuis son dépôt officiel (apt) ?" || fail "Sans serveur web je ne peux pas mettre le site en HTTPS." "relancez avec --skip-proxy pour un site en local seulement, ou installez un serveur web puis relancez."; }
  if [ "$UFW_ACTIVE" -eq 1 ] && [ "$UFW_OPEN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ]; then consent "Ouvrir les ports 80 et 443 dans ufw (nécessaires au site et au certificat) ?" && WANT_UFW=1 || warn "Ports 80/443 laissés fermés : le site ne sera pas joignable depuis Internet tant que vous ne les ouvrez pas (sudo ufw allow 80/tcp && sudo ufw allow 443/tcp)."; fi
  if [ "$YES" -eq 0 ] && interactive; then consent "On y va ?" || { say "Arrêt : rien n'a été modifié."; exit 0; }; fi
}

# ─── Phase D : appliquer ────────────────────────────────────────────────────────────────────────────────────────────
apt_run() { DEBIAN_FRONTEND=noninteractive apt-get "$@"; }
install_packages() {
  STEP="outils et Node.js"
  if [ "${#MISSING_PKGS[@]}" -gt 0 ]; then
    logged "Le chargement de la liste des paquets" "vérifiez la connexion Internet du serveur puis relancez." apt_run update
    logged "L'installation de ${MISSING_PKGS[*]}" "lancez sudo apt-get install ${MISSING_PKGS[*]} pour voir l'erreur, corrigez-la puis relancez." apt_run install -y --no-install-recommends ca-certificates "${MISSING_PKGS[@]}"
    ok "Outils installés."
  fi
  if [ "$NODE_NEED" -eq 1 ]; then
    local ks=/usr/share/keyrings/nodesource.gpg
    have gpg || logged "L'installation de gnupg" "lancez sudo apt-get install gnupg puis relancez." apt_run install -y --no-install-recommends gnupg
    [ -n "$LOG" ] && printf '\n$ nodesource key + list\n' >>"$LOG"
    curl -fsSL -m 40 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o "$ks" 2>>"${LOG:-/dev/null}" || fail "Le téléchargement de la clé du dépôt NodeSource a échoué." "vérifiez l'accès à deb.nodesource.com depuis ce serveur, ou installez Node.js 22 vous-même puis relancez."
    printf 'deb [arch=amd64 signed-by=%s] https://deb.nodesource.com/node_%s.x nodistro main\n' "$ks" "$NODE_MAJOR_WANTED" >/etc/apt/sources.list.d/nodesource.list
    logged "Le chargement de la liste des paquets" "vérifiez la connexion Internet du serveur puis relancez." apt_run update
    logged "L'installation de Node.js" "lancez sudo apt-get install nodejs pour voir l'erreur, corrigez-la puis relancez." apt_run install -y nodejs
    NODE_BIN=$(readlink -f "$(command -v node)")
    node_version_ok "$(node -v)" || fail "Node.js installé ($(node -v)) est quand même trop ancien." "installez Node.js 22 à la main (https://nodejs.org/fr/download) puis relancez."
    ok "Node.js $(node -v) installé."
  fi
}

download_release() {
  STEP="téléchargement et vérification"
  [ "$RESUME" -eq 1 ] && return 0
  local parent; parent="$(dirname "$(rp "$DIR")")"
  mkdir -p "$parent"
  STAGING="$parent/.curiosa-staging-$SITE"
  rm -rf -- "$STAGING"; mkdir -p "$STAGING/unpack"
  info "Téléchargement de $TAG (environ 150 Mo, quelques minutes selon la connexion)…"
  curl -fL --retry 3 -m 1200 -o "$STAGING/$FILE" "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE" 2>>"${LOG:-/dev/null}" || fail "Le téléchargement de l'archive a échoué." "vérifiez l'accès à Internet et l'espace disque, puis relancez la même commande (rien n'est installé)."
  curl -fsSL -m 60 -o "$STAGING/$FILE.sha256" "$GITHUB_WEB/$REPO/releases/download/$TAG/$FILE.sha256" || fail "Le téléchargement du fichier d'empreinte (.sha256) a échoué." "relancez la même commande ; rien n'est installé."
  local want got; want=$(awk '{print tolower($1)}' "$STAGING/$FILE.sha256" | head -n1); got=$(sha256sum "$STAGING/$FILE" | awk '{print $1}')
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    fail "L'empreinte SHA-256 de l'archive ne correspond pas : le fichier est abîmé ou a été modifié. Rien n'a été déplié ni installé." "relancez la même commande (un téléchargement coupé est la cause la plus fréquente) ; si ça se répète, ne l'installez pas et prévenez le projet."
  fi
  ok "Empreinte SHA-256 vérifiée."
  local bad; bad=$(tar -tzf "$STAGING/$FILE" 2>/dev/null | grep -E '(^/|(^|/)\.\.(/|$))' | head -n1 || true)
  [ -z "$bad" ] || fail "L'archive contient un chemin dangereux ($bad) : elle n'est pas dépliée." "ne l'installez pas et prévenez le projet."
  tar -xzf "$STAGING/$FILE" -C "$STAGING/unpack" 2>>"${LOG:-/dev/null}" || fail "L'archive n'a pas pu être dépliée (disque plein ?)." "libérez de la place (df -h) puis relancez ; rien n'est installé."
  [ -f "$STAGING/unpack/release.json" ] && [ -d "$STAGING/unpack/node_modules" ] && [ -d "$STAGING/unpack/prisma" ] || fail "L'archive ne ressemble pas à une release de Curiosa." "ne l'installez pas et prévenez le projet."
  rm -f -- "$STAGING/$FILE" "$STAGING/$FILE.sha256"
  ok "Archive dépliée en lieu sûr."
}

create_user_and_dir() {
  STEP="utilisateur et dossier"
  if [ "$USER_EXISTS" -eq 0 ]; then
    mkdir -p "$(rp "$DIR")" 2>/dev/null || true
    logged "La création de l'utilisateur $SITE_USER" "regardez le détail ci-dessus ; choisissez un autre nom avec --user si le nom est déjà pris." \
      useradd --system --user-group --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin "$SITE_USER"
    ok "Utilisateur « $SITE_USER » créé (sans droits d'administration)."
  fi
  SITE_GROUP=$(id -gn "$SITE_USER" 2>/dev/null || echo "$SITE_USER")
  if [ "$RESUME" -eq 0 ]; then
    local d; d="$(rp "$DIR")"
    [ -z "$(ls -A "$d" 2>/dev/null)" ] || fail "Le dossier $DIR n'est plus vide : quelqu'un y a écrit entre-temps." "vérifiez son contenu puis relancez."
    rmdir "$d" 2>/dev/null || true
    mv -- "$STAGING/unpack" "$d"
    printf 'site=%s\nuser=%s\nport=%s\ncreated=%s\nrelease=%s\n' "$SITE" "$SITE_USER" "$PORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" >"$d/$MARKER_NAME"
    ok "Site déplié dans $DIR."
  fi
  chown -R "$SITE_USER:$SITE_GROUP" "$(rp "$DIR")"
  chmod 755 "$(rp "$DIR")"
}

write_env() {
  STEP="configuration (.env)"
  local d env tok; d="$(rp "$DIR")"; env="$d/.env"
  if [ -f "$env" ]; then ok ".env déjà présent : je le garde tel quel (je n'écrase jamais votre configuration)."; return 0; fi
  tok=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
  [ "${#tok}" -ge 24 ] || fail "Je n'ai pas pu fabriquer un code d'installation aléatoire." "installez openssl (sudo apt-get install openssl) puis relancez."
  ( umask 077
    { if [ -f "$d/.env.example" ]; then awk -v url="$SITE_URL" '/^SITE_URL=/ {print "SITE_URL=\"" url "\""; next} {print}' "$d/.env.example"
      else printf 'DATABASE_URL="file:../data/curiosa.db"\nSITE_URL="%s"\n' "$SITE_URL"; fi
      printf '\n# ─── Ajouté par scripts/install.sh (site : %s) ───\n' "$SITE"
      printf 'CURIOSA_SUPERVISED=1\nCURIOSA_READY_URL="http://127.0.0.1:%s/"\nSETUP_TOKEN="%s"\n' "$PORT" "$tok"
    } >"$env.tmp"
    mv -- "$env.tmp" "$env" )
  chown "$SITE_USER:$SITE_GROUP" "$env"; chmod 600 "$env"
  mkdir -p "$d/data"; chown "$SITE_USER:$SITE_GROUP" "$d/data"
  ok "Configuration écrite (.env, lisible par le site seulement). Le code d'installation n'est affiché nulle part."
}

run_as_site() {
  if [ -n "$ROOT" ]; then ( cd "$(rp "$DIR")" && env HOME="$(rp "$DIR")" "$@" ); return; fi
  ( cd "$DIR" && runuser -u "$SITE_USER" -- env HOME="$DIR" PATH="$PATH" "$@" )
}
migrate_db() {
  STEP="base de données"
  mkdir -p "$(rp "$DIR")/data"; chown "$SITE_USER:$SITE_GROUP" "$(rp "$DIR")/data"
  local out; out=$(run_as_site "$NODE_BIN" node_modules/prisma/build/index.js migrate deploy 2>&1) || { [ -n "$LOG" ] && printf '%s\n' "$out" >>"$LOG"; printf '%s\n' "$out" | tail -n 12 >&2; fail "La création de la base de données a échoué." "relancez la même commande ; si l'erreur est « EACCES », vérifiez que $DIR appartient bien à $SITE_USER (sudo chown -R $SITE_USER: $DIR)."; }
  [ -n "$LOG" ] && printf '%s\n' "$out" >>"$LOG"
  ok "Base de données prête."
}

write_unit() {
  STEP="service systemd"
  local new; new=$(mktemp)
  cat >"$new" <<EOF
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
EOF
  UNIT_CHANGED=0
  if [ -f "$UNIT" ] && cmp -s "$new" "$UNIT"; then rm -f -- "$new"; ok "Service déjà à jour."
  else
    if [ -f "$UNIT" ]; then cp -p -- "$UNIT" "$UNIT.avant-$(date +%Y%m%d-%H%M%S)"; fi
    mkdir -p "$(dirname "$UNIT")"; mv -- "$new" "$UNIT"; chmod 644 "$UNIT"; UNIT_CHANGED=1
    ok "Service $SITE.service écrit."
  fi
  systemctl daemon-reload
  if systemctl is-active --quiet "$SITE.service" 2>/dev/null; then
    [ "$UNIT_CHANGED" -eq 1 ] && systemctl restart "$SITE.service"
    ok "Service déjà actif."
  else
    systemctl enable --now "$SITE.service" >>"${LOG:-/dev/null}" 2>&1 || fail "Le service n'a pas pu démarrer." "regardez pourquoi : sudo journalctl -u $SITE -n 40 --no-pager ; puis relancez la même commande."
    ok "Service démarré (et relancé automatiquement au démarrage du serveur)."
  fi
}

wait_http() { # wait_http URL secondes -> 0 si 200
  local i=0 code
  while [ "$i" -lt "$2" ]; do code=$(http_code "$1"); [ "$code" = 200 ] && return 0; sleep 2; i=$((i + 2)); done
  return 1
}
verify_local() {
  STEP="vérification locale"
  wait_http "http://127.0.0.1:$PORT/admin/setup" 90 || fail "Le site ne répond pas en local (http://127.0.0.1:$PORT/admin/setup)." "regardez le journal : sudo journalctl -u $SITE -n 40 --no-pager. Si le message parle d'un port déjà utilisé, relancez avec --port 3010 (un autre nombre) ; sinon relancez la même commande."
  ok "Le site répond en local (HTTP 200 sur /admin/setup)."
}

# ── proxy ──
proxy_marker() { printf '# Géré par install-curiosa (scripts/install.sh), site : %s\n' "$SITE"; }
nginx_conf() { proxy_marker; cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
EOF
}
domain_known_elsewhere() { # le domaine est-il déjà géré dans $1 (fichiers autres que le nôtre) ?
  local found; found=$(grep -rlE "(server_name|ServerName|ServerAlias)[^;#]*[[:space:]]$DOMAIN([[:space:];]|\$)|^${DOMAIN}[[:space:],{]" "$@" 2>/dev/null | grep -v "/$SITE\.conf\$" | grep -v "/$SITE\.caddy\$" | grep -v '\.avant-' | head -n1 || true)
  [ -n "$found" ] && { printf '%s' "$found"; return 0; }; return 1
}
manual_proxy_note() { PROXY_MANUAL="$1"; warn "$1"; }

configure_nginx() {
  local avail enabled conf
  if [ -d "$(rp /etc/nginx/sites-available)" ]; then avail=/etc/nginx/sites-available; enabled=/etc/nginx/sites-enabled; conf="$avail/$SITE.conf"; else avail=/etc/nginx/conf.d; enabled=""; conf="$avail/$SITE.conf"; fi
  local other; if other=$(domain_known_elsewhere "$(rp /etc/nginx)"); then
    manual_proxy_note "nginx gère déjà $DOMAIN dans $other : je n'y touche pas. Pour y envoyer le trafic vers ce site, faites pointer son « proxy_pass » vers http://127.0.0.1:$PORT (modèle : docs/INSTALL.md)."; return 0
  fi
  local rc; rc=$(rp "$conf"); local new; new=$(mktemp); nginx_conf >"$new"
  local bak=""
  if [ -f "$rc" ]; then
    grep -q '^# Géré par install-curiosa' "$rc" || { rm -f -- "$new"; manual_proxy_note "$conf existe déjà et n'est pas à moi : je n'y touche pas."; return 0; }
    if cmp -s "$new" "$rc"; then rm -f -- "$new"; ok "Configuration nginx déjà à jour."; return 0; fi
    bak="$rc.avant-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$rc" "$bak"; info "Ancienne configuration sauvegardée : $bak"
  fi
  mkdir -p "$(dirname "$rc")"; mv -- "$new" "$rc"; chmod 644 "$rc"
  [ -n "$enabled" ] && ln -sfn "$conf" "$(rp "$enabled/$SITE.conf")"
  if ! nginx -t >>"${LOG:-/dev/null}" 2>&1; then
    # retour arrière : on remet l'ancien état, on ne recharge rien
    if [ -n "$bak" ]; then mv -- "$bak" "$rc"; else rm -f -- "$rc"; [ -n "$enabled" ] && rm -f -- "$(rp "$enabled/$SITE.conf")"; fi
    [ -n "$LOG" ] && tail -n 8 "$LOG" >&2
    fail "nginx refuse la nouvelle configuration (nginx -t a échoué) : je l'ai retirée, nginx n'a pas été touché." "regardez le détail ci-dessus ; une configuration existante est probablement en cause. Relancez avec --skip-proxy pour ne pas toucher à nginx."
  fi
  if [ "$WEB_ACTIVE" -eq 1 ]; then systemctl reload nginx; ok "$DOMAIN ajouté à nginx (rechargé)."; else warn "nginx est installé mais arrêté : démarrez-le (sudo systemctl start nginx) pour mettre le site en ligne."; fi
  CERT_HINT="sudo apt-get install certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
}

configure_apache() {
  if [ ! -d "$(rp /etc/apache2/sites-available)" ] || ! have a2ensite; then
    manual_proxy_note "Apache est présent mais pas à la disposition Debian (sites-available) : je n'y touche pas. Ajoutez un hôte virtuel pour $DOMAIN qui renvoie vers http://127.0.0.1:$PORT (ProxyPass / http://127.0.0.1:$PORT/), en activant mod_proxy, mod_proxy_http et mod_headers."; return 0
  fi
  local other; if other=$(domain_known_elsewhere "$(rp /etc/apache2)"); then manual_proxy_note "Apache gère déjà $DOMAIN dans $other : je n'y touche pas (faites-le pointer vers http://127.0.0.1:$PORT)."; return 0; fi
  local rc; rc=$(rp "/etc/apache2/sites-available/$SITE.conf")
  if [ -f "$rc" ] && ! grep -q '^# Géré par install-curiosa' "$rc"; then manual_proxy_note "$rc existe déjà et n'est pas à moi : je n'y touche pas."; return 0; fi
  [ -f "$rc" ] && cp -p -- "$rc" "$rc.avant-$(date +%Y%m%d-%H%M%S)"
  { proxy_marker; cat <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "%{REQUEST_SCHEME}s"
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
</VirtualHost>
EOF
  } >"$rc"
  logged "L'activation des modules Apache nécessaires" "lancez sudo a2enmod proxy proxy_http headers pour voir l'erreur." a2enmod proxy proxy_http headers
  logged "L'activation du site Apache" "lancez sudo a2ensite $SITE pour voir l'erreur." a2ensite "$SITE"
  if ! apachectl configtest >>"${LOG:-/dev/null}" 2>&1; then
    a2dissite "$SITE" >/dev/null 2>&1 || true; rm -f -- "$rc"
    fail "Apache refuse la nouvelle configuration : je l'ai retirée, Apache n'a pas été rechargé." "relancez avec --skip-proxy pour ne pas toucher à Apache."
  fi
  systemctl reload apache2 && ok "$DOMAIN ajouté à Apache (rechargé)."
  CERT_HINT="sudo apt-get install certbot python3-certbot-apache && sudo certbot --apache -d $DOMAIN"
}

install_caddy() {
  [ "$APT" -eq 1 ] || fail "Je ne sais installer Caddy que sur Ubuntu/Debian." "installez un serveur web (Caddy ou nginx) puis relancez ce script."
  logged "L'installation des prérequis de Caddy" "vérifiez la connexion Internet puis relancez." apt_run install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -fsSL -m 40 https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>>"${LOG:-/dev/null}" || fail "Le téléchargement de la clé du dépôt de Caddy a échoué." "vérifiez l'accès à dl.cloudsmith.io depuis ce serveur, puis relancez."
  curl -fsSL -m 40 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list || fail "Le téléchargement de la liste de paquets de Caddy a échoué." "vérifiez l'accès à dl.cloudsmith.io depuis ce serveur, puis relancez."
  logged "Le chargement de la liste des paquets" "vérifiez la connexion Internet puis relancez." apt_run update
  logged "L'installation de Caddy" "lancez sudo apt-get install caddy pour voir l'erreur, puis relancez." apt_run install -y caddy
  ok "Caddy installé."
  WEB=caddy; WEB_ACTIVE=1
}
configure_caddy() {
  local main sites site bak=""; main=$(rp /etc/caddy/Caddyfile); sites=$(rp /etc/caddy/sites); site="$sites/$SITE.caddy"
  local other; if other=$(domain_known_elsewhere "$(rp /etc/caddy)"); then manual_proxy_note "Caddy gère déjà $DOMAIN dans $other : je n'y touche pas (faites-le pointer vers 127.0.0.1:$PORT)."; return 0; fi
  if [ -f "$site" ] && ! grep -q '^# Géré par install-curiosa' "$site"; then manual_proxy_note "$site existe déjà et n'est pas à moi : je n'y touche pas."; return 0; fi
  mkdir -p "$sites"
  [ -f "$site" ] && cp -p -- "$site" "$site.avant-$(date +%Y%m%d-%H%M%S)"
  { proxy_marker; printf '%s {\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"; } >"$site"
  if [ ! -f "$main" ]; then mkdir -p "$(dirname "$main")"; printf 'import /etc/caddy/sites/*.caddy\n' >"$main"
  elif ! grep -Eq '^[[:space:]]*import[[:space:]]+/etc/caddy/sites/\*\.caddy' "$main"; then
    bak="$main.avant-curiosa-$(date +%Y%m%d-%H%M%S)"; cp -p -- "$main" "$bak"; info "Ancien Caddyfile sauvegardé : $bak"
    printf '\n# Ajouté par install-curiosa : un fichier par site dans /etc/caddy/sites\nimport /etc/caddy/sites/*.caddy\n' >>"$main"
  fi
  if have caddy && ! caddy validate --config "$(rp /etc/caddy/Caddyfile)" >>"${LOG:-/dev/null}" 2>&1; then
    rm -f -- "$site"; [ -n "$bak" ] && mv -- "$bak" "$main"
    [ -n "$LOG" ] && tail -n 8 "$LOG" >&2
    fail "Caddy refuse la nouvelle configuration : je l'ai retirée, Caddy n'a pas été rechargé." "regardez le détail ci-dessus, ou relancez avec --skip-proxy."
  fi
  if [ "$WEB_ACTIVE" -eq 1 ]; then systemctl reload caddy || systemctl restart caddy; else systemctl enable --now caddy >>"${LOG:-/dev/null}" 2>&1 || warn "Caddy n'a pas démarré : sudo journalctl -u caddy -n 30"; fi
  ok "$DOMAIN ajouté à Caddy : le certificat HTTPS est demandé automatiquement."
}

configure_proxy() {
  STEP="serveur web (HTTPS)"
  PROXY_MANUAL=""; CERT_HINT=""
  [ "$SKIP_PROXY" -eq 1 ] && return 0
  case "$PROXY_PLAN" in
    nginx) configure_nginx ;;
    apache2|httpd) configure_apache ;;
    caddy) configure_caddy ;;
    caddy-install) install_caddy; configure_caddy ;;
  esac
  if [ "$WANT_UFW" -eq 1 ]; then ufw allow 80/tcp >>"${LOG:-/dev/null}" 2>&1 && ufw allow 443/tcp >>"${LOG:-/dev/null}" 2>&1 && ok "Ports 80 et 443 ouverts dans ufw." || warn "Je n'ai pas pu ouvrir 80/443 dans ufw : sudo ufw allow 80/tcp && sudo ufw allow 443/tcp"; fi
}

verify_public() {
  STEP="vérification publique"; PUBLIC_OK=1
  [ "$NO_DOMAIN" -eq 1 ] || [ "$SKIP_PROXY" -eq 1 ] && return 0
  [ -z "$PROXY_MANUAL" ] || { PUBLIC_OK=0; return 0; }
  local url="${CURIOSA_VERIFY_URL:-https://$DOMAIN/admin/setup}"
  info "Je vérifie l'adresse publique (le certificat HTTPS peut demander jusqu'à une minute)…"
  if wait_http "$url" 90; then ok "Le site répond sur $url (HTTP 200)."; return 0; fi
  if [ -z "${CURIOSA_VERIFY_URL:-}" ] && wait_http "http://$DOMAIN/admin/setup" 6; then PUBLIC_OK=0; PUBLIC_WHY="Le site répond en HTTP mais pas encore en HTTPS (certificat pas encore obtenu)."; return 0; fi
  PUBLIC_OK=0; PUBLIC_WHY="Le site ne répond pas encore sur https://$DOMAIN."
}

final_page() {
  title "5/5  Terminé"
  local url="${SITE_URL}/admin/setup" local_only=0; { [ "$NO_DOMAIN" -eq 1 ] || [ "$SKIP_PROXY" -eq 1 ]; } && local_only=1
  [ "$local_only" -eq 1 ] && url="http://127.0.0.1:$PORT/admin/setup  (site joignable seulement depuis ce serveur ; pour l'ouvrir depuis chez vous : ssh -L $PORT:127.0.0.1:$PORT utilisateur@adresse-du-serveur, puis http://localhost:$PORT/admin/setup)"
  say ""
  say "$B================================================================$N"
  if [ "$PUBLIC_OK" -eq 1 ]; then say "$B  Curiosa $TAG est installé et répond.$N"; else say "$B  Curiosa $TAG est installé ; son adresse publique ne répond pas encore.$N"; fi
  say "$B================================================================$N"
  say ""
  say "  1. Ouvrez cette adresse dans votre navigateur :"
  say ""
  say "        $url"
  say ""
  say "  2. Le site vous demande un « code d'installation ». Il est enregistré sur ce serveur."
  say "     Pour le lire, tapez cette commande VOUS-MÊME dans votre terminal (le code s'affiche, recopiez-le dans la page) :"
  say ""
  say "        sudo sed -n 's/^SETUP_TOKEN=//p' $DIR/.env | tr -d '\"'"
  say ""
  say "     (Je ne l'écris pas ici volontairement : il ne doit apparaître ni dans un journal, ni dans une conversation avec une IA.)"
  say ""
  say "  3. Suivez ensuite l'assistant de première installation."
  if [ "$PUBLIC_OK" -eq 0 ] && [ "$NO_DOMAIN" -eq 0 ] && [ "$SKIP_PROXY" -eq 0 ]; then
    say ""; say "${Y}À régler pour que l'adresse publique fonctionne :$N"
    [ -n "$PROXY_MANUAL" ] && say "  - $PROXY_MANUAL"
    [ -n "${PUBLIC_WHY:-}" ] && say "  - $PUBLIC_WHY"
    [ "$DNS_OK" -eq 0 ] && say "  - Le DNS de $DOMAIN doit pointer vers ${PUBLIC_IP:-ce serveur} (enregistrement A). Caddy obtiendra alors le certificat tout seul (quelques minutes)."
    [ -n "$CERT_HINT" ] && say "  - Certificat HTTPS : $CERT_HINT"
    say "  - Les ports 80 et 443 doivent être ouverts chez votre hébergeur (pare-feu / « security group » de son tableau de bord)."
    say "  - Puis testez :  curl -I https://$DOMAIN/admin/setup"
  fi
  if [ "$PUBLIC_OK" -eq 1 ] && [ -n "${CERT_HINT:-}" ]; then say ""; say "  Certificat HTTPS (nginx/Apache ne l'obtiennent pas seuls) :  $CERT_HINT"; fi
  say ""
  say "Utile : état du service  sudo systemctl status $SITE   ·   journal  sudo journalctl -u $SITE -n 40 --no-pager"
  say "Les mises à jour se font ensuite depuis l'administration du site (page « Mises à jour »)."
  say "Une fois le site configuré, retirez la ligne SETUP_TOKEN de $DIR/.env puis : sudo systemctl restart $SITE"
  [ -n "$LOG" ] && say "Journal de cette installation : $LOG"
  [ "$PUBLIC_OK" -eq 1 ] || exit 10
}

# ─── Programme ──────────────────────────────────────────────────────────────────────────────────────────────────────
main() {
  say "${B}Installation de Curiosa${N}"
  if [ "$UNINSTALL" -eq 1 ]; then
    [ "$(id -u)" -eq 0 ] || [ -n "$ROOT" ] || fail "Ce script doit être lancé avec les droits d'administration." "relancez avec : sudo bash install.sh --uninstall --site NOM"
    [ -n "$SITE" ] || fail "Il manque le nom du site à désinstaller." "ajoutez --site NOM."
    do_uninstall; return 0
  fi
  [ "$PURGE" -eq 0 ] || fail "--purge s'utilise avec --uninstall." "relancez avec --uninstall --purge --site NOM."
  phase_detect
  phase_ask
  phase_plan
  LOG="$(rp /var/log)/curiosa-install-$SITE.log"
  mkdir -p "$(dirname "$LOG")"; ( umask 077; : >>"$LOG" )
  title "4/5  Installation"
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
main
