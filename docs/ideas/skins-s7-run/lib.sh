#!/bin/bash
# Étapes lourdes du lot S7 (référence v0.3.1 et candidate), toutes derrière le verrou commun. Reprise possible : les marques sont dans $ST.
export HOME=/dev/shm/home-s7 TMPDIR=/dev/shm/tmp-s7 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NEXT_TELEMETRY_DISABLED=1
export VISUAL_ROOT=/dev/shm/s7-visual VISUAL_PORT_BASE=3550
S=/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/skins-s7; mkdir -p $S/results
ST=/dev/shm/s7-work/state; mkdir -p $ST $TMPDIR $HOME $VISUAL_ROOT
PROFILES="night daylight custom layout-centered layout-minimal layout-tworows"
heavy() { flock /dev/shm/heavy.lock "$@"; }
log() { echo "$(date +%H:%M:%S) $*" | tee -a $S/log.txt; }
guard() { local u=$(du -sm /dev/shm | cut -f1); log "shm=${u}Mo $(free -m | awk 'NR==2{print "libre="$7"Mo"}')"; }
merge_into() { node -e '
const fs=require("fs"),p=require("path");const [dest,src]=process.argv.slice(1);fs.mkdirSync(dest,{recursive:true});
for(const d of fs.readdirSync(src)){ if(d==="manifest.json") continue; fs.cpSync(p.join(src,d),p.join(dest,d),{recursive:true}); }
const ms=JSON.parse(fs.readFileSync(p.join(src,"manifest.json")));let m=ms;const f=p.join(dest,"manifest.json");
if(fs.existsSync(f)){m=JSON.parse(fs.readFileSync(f));m.shots=[...m.shots,...ms.shots];m.excluded=[...(m.excluded||[]),...(ms.excluded||[])];m.profiles=[...new Set([...m.profiles,...ms.profiles])];m.discovered={...(m.discovered||{}),...(ms.discovered||{})};}
fs.writeFileSync(f,JSON.stringify(m,null,2));' "$1" "$2"; }
