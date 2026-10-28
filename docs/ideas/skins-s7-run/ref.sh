#!/bin/bash
# ref.sh : référence d'images du tag v0.3.1 (site public d'avant les skins), prise EN SÉRIE dans un arbre de travail à part ; fichier READY à la fin.
. $(dirname $0)/lib.sh
REF=/dev/shm/s7-ref; BASE=/dev/shm/s7-baseline-031; NEW=/dev/shm/s7-baseline-031-new
[ -f $BASE/READY ] && { log "référence déjà prête"; exit 0; }
cd /dev/shm/s7
if [ ! -d $REF ]; then git worktree add --detach $REF v0.3.1 >> $S/log.txt 2>&1; cp -r /dev/shm/s7/node_modules $REF/node_modules; fi
cd $REF
rm -rf scripts/visual; git -C /dev/shm/s7 archive HEAD scripts/visual | tar -x -C $REF
[ -f $ST/ref-built ] || { guard; heavy bash -c 'npx prisma generate >/dev/null 2>&1; rm -rf .next; npm run build' > $S/ref-build.log 2>&1 && touch $ST/ref-built || { log "BUILD RÉF ÉCHEC"; tail -5 $S/ref-build.log; exit 1; }; }
[ -f $VISUAL_ROOT/snapshot/snapshot.json ] || { guard; heavy node scripts/visual/site.mjs prepare >> $S/log.txt 2>&1; }
rm -rf $NEW
for p in $PROFILES; do
  for try in 1 2; do heavy node scripts/visual/capture.mjs /dev/shm/s7-ref-$p --profiles $p >> $S/log.txt 2>&1 && break; log "ref $p : essai $try avec erreurs"; done
  merge_into $NEW /dev/shm/s7-ref-$p; rm -rf /dev/shm/s7-ref-$p; log "ref $p fusionné"
done
n=$(find $NEW -name '*.png' | wc -l); log "référence : $n captures"
if [ "$n" -ge 1160 ]; then date > $NEW/READY; rm -rf $BASE; mv $NEW $BASE; log "référence posée"; fi
rm -rf $REF/.next; log "ref terminé"
