#!/bin/bash
# ref.sh : référence d'images du tag v0.3.1, prise EN SÉRIE (une fenêtre à la fois), profil par profil, puis posée d'un coup sur /dev/shm/visual-baseline-031 (READY à la fin).
. $(dirname $0)/lib.sh
BASE=/dev/shm/visual-baseline-031; NEW=/dev/shm/visual-baseline-031-new
[ -f $BASE/READY ] && [ -z "$REDO" ] && { log "référence déjà prête"; exit 0; }
[ -d $RUN/.git ] || { log "clone absent"; exit 1; }
install_deps
checkout v0.3.1; build; prepare
rm -rf $NEW
for p in $PROFILES; do
  for try in 1 2; do capture_profile $p /dev/shm/ref-$p && break; log "ref $p : essai $try avec erreurs"; done
  merge_into $NEW /dev/shm/ref-$p; rm -rf /dev/shm/ref-$p; log "ref $p fusionné"
done
n=$(find $NEW -name '*.png' | wc -l); log "référence : $n captures"
rm -rf $RUN/.next; rm -f $ST/built
if [ "$n" -ge 1160 ]; then date > $NEW/READY; rm -rf $BASE; mv $NEW $BASE; log "référence posée"; fi
