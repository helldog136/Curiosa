#!/bin/bash
# cand.sh <étiquette> <commit> : construit ce commit et compare, profil par profil, à la référence (0 pixel).
. $(dirname $0)/lib.sh
label=$1; commit=$2
[ -f /dev/shm/visual-baseline-031/READY ] || { log "pas de référence"; exit 1; }
install_deps; checkout $commit; build
for p in $PROFILES; do
  [ -f $S/results/$label-$p.txt ] && continue
  capture_profile $p /dev/shm/cand-$p
  node $RUN/scripts/visual/compare.mjs /dev/shm/visual-baseline-031 /dev/shm/cand-$p --only "$p/" --out /dev/shm/cand-$p/compare > /dev/shm/cmp-$p.txt 2>&1
  { echo "commit $commit"; grep -E "Comparées|ÉCART|RÉSULTAT" /dev/shm/cmp-$p.txt | head -40; } > $S/results/$label-$p.txt
  log "$label $p : $(grep -E 'Comparées' /dev/shm/cmp-$p.txt)"
  grep -q "RÉSULTAT : ÉCHEC" /dev/shm/cmp-$p.txt && cp -r /dev/shm/cand-$p/compare /dev/shm/keep-$label-$p
  rm -rf /dev/shm/cand-$p
done
rm -rf $RUN/.next; rm -f $ST/built; log "$label terminé"
