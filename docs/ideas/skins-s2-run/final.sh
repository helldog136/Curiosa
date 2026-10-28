#!/bin/bash
# final.sh <commit> : contrôle du DOM dans le navigateur, skin d'essai (preuve + captures), déterminisme de la galerie.
. $(dirname $0)/lib.sh
BASE=/dev/shm/visual-baseline-031
commit=$1; OUT=$S/results/final; mkdir -p $OUT
install_deps; checkout $commit; build; prepare
SKIN=/dev/shm/s2work/skin-side-column; [ -d $SKIN ] || cp -r $S/../skin-side-column $SKIN
cd $RUN
log "dom-check"; heavy node scripts/visual/dom-check.mjs > $OUT/dom-check.txt 2>&1; log "dom-check : $(tail -1 $OUT/dom-check.txt)"
export VISUAL_SKIN_DIR=$SKIN VISUAL_SKIN_ID=side-column
log "skin-proof"; heavy node scripts/visual/skin-proof.mjs > $OUT/skin-proof.txt 2>&1; log "skin-proof : $(tail -2 $OUT/skin-proof.txt | tr '\n' ' ')"
log "skin shots"; rm -rf /dev/shm/skin-shots; heavy node scripts/visual/capture.mjs /dev/shm/skin-shots --profiles skin-test --widths 390,768,1280,1920 > $OUT/skin-capture.txt 2>&1
rm -rf /dev/shm/basic-shots; heavy node scripts/visual/capture.mjs /dev/shm/basic-shots --profiles night --widths 390,768,1280,1920 --only home,blog,events > /dev/null 2>&1
mkdir -p $OUT/skin-shots $OUT/basic-shots; cp -r /dev/shm/skin-shots/skin-test/fr/* $OUT/skin-shots/ 2>/dev/null; cp -r /dev/shm/basic-shots/night/fr/* $OUT/basic-shots/ 2>/dev/null
log "déterminisme galerie"
for i in 1 2 3; do capture_profile night /dev/shm/det$i --only galeries; done
{ for i in 2 3; do echo "det1 vs det$i"; node scripts/visual/compare.mjs /dev/shm/det1 /dev/shm/det$i --out /dev/shm/det$i/c | grep -E "Comparées|ÉCART|RÉSULTAT"; done; for i in 1 2 3; do echo "réf vs det$i"; node scripts/visual/compare.mjs $BASE /dev/shm/det$i --only "night/fr/390/galeries,night/fr/768/galeries,night/fr/1280/galeries,night/fr/1920/galeries" --out /dev/shm/det$i/c2 | grep -E "Comparées|ÉCART|RÉSULTAT"; done; } > $OUT/determinisme.txt 2>&1
rm -rf /dev/shm/det? /dev/shm/skin-shots /dev/shm/basic-shots
log "final terminé"
