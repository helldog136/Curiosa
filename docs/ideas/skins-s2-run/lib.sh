#!/bin/bash
# Bibliothèque des étapes lourdes du lot S2/S3 (reprise possible après un redémarrage du conteneur : les marques de /dev/shm disparaissent avec lui, les résultats sont dans results/).
export HOME=/dev/shm/home-s2 TMPDIR=/dev/shm/tmp-s2 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NEXT_TELEMETRY_DISABLED=1
S=/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/s2run
HARN=/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/harness-s2
RUN=/dev/shm/skins-s2
ST=/dev/shm/s2work/state; mkdir -p $ST /dev/shm/tmp-s2 /dev/shm/home-s2
PROFILES="night daylight custom layout-centered layout-minimal layout-tworows"
heavy() { flock /dev/shm/heavy.lock "$@"; }
log() { echo "$(date +%H:%M:%S) $*" | tee -a $S/log.txt; }
guard() { local u=$(du -sm /dev/shm | cut -f1); log "shm=${u}Mo $(free -m | awk 'NR==2{print "libre="$7"Mo"}')"; [ "$u" -lt 6000 ] || { log "ARRÊT : /dev/shm > 6 Go"; exit 3; }; }
install_deps() { [ -d $RUN/node_modules ] && [ -f $ST/deps ] && return; guard; cd $RUN; heavy bash -c 'npm ci --ignore-scripts && npx prisma generate' >> $S/log.txt 2>&1 && touch $ST/deps; }
checkout() { cd $RUN; git checkout -q -f "$1"; rm -rf scripts/visual; cp -r $HARN scripts/visual; rm -f $ST/built; }
build() { [ -f $ST/built ] && return; guard; cd $RUN; rm -rf .next; heavy bash -c 'npm run build' > $S/build.log 2>&1 && touch $ST/built || { log "BUILD ÉCHEC"; tail -5 $S/build.log; exit 1; }; }
prepare() { [ -f /dev/shm/visual/snapshot/snapshot.json ] && return; guard; cd $RUN; heavy node scripts/visual/site.mjs prepare >> $S/log.txt 2>&1; }
# merge_into <dest> <src> : fusionne une capture partielle dans une capture complète (PNG déplacés, manifestes concaténés)
merge_into() { node -e '
const fs=require("fs"),p=require("path");const [dest,src]=process.argv.slice(1);fs.mkdirSync(dest,{recursive:true});
for(const d of fs.readdirSync(src)){ if(d==="manifest.json") continue; fs.cpSync(p.join(src,d),p.join(dest,d),{recursive:true}); }
const ms=JSON.parse(fs.readFileSync(p.join(src,"manifest.json")));let m=ms;const f=p.join(dest,"manifest.json");
if(fs.existsSync(f)){m=JSON.parse(fs.readFileSync(f));m.shots=[...m.shots,...ms.shots];m.excluded=[...(m.excluded||[]),...(ms.excluded||[])];m.profiles=[...new Set([...m.profiles,...ms.profiles])];m.discovered={...(m.discovered||{}),...(ms.discovered||{})};}
fs.writeFileSync(f,JSON.stringify(m,null,2));' "$1" "$2"; }
capture_profile() { # <profil> <dossier> [options...]
  local p=$1 d=$2; shift 2; guard; cd $RUN; rm -rf $d
  heavy node scripts/visual/capture.mjs $d --profiles $p --jobs 2 "$@" >> $S/log.txt 2>&1; return $?; }
