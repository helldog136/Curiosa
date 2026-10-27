#!/bin/bash
. $(dirname $0)/lib.sh
[ -f /dev/shm/visual-baseline-031/READY ] && { log "référence déjà prête"; exit 0; }
cd /dev/shm; [ -d $RUN/.git ] || { log "clone absent"; exit 1; }
install_deps
checkout v0.3.1; build; prepare
rm -rf /dev/shm/visual-baseline-031
for p in $PROFILES; do
  for try in 1 2; do capture_profile $p /dev/shm/ref-$p && break; log "ref $p : essai $try avec erreurs"; done
  merge_into /dev/shm/visual-baseline-031 /dev/shm/ref-$p; rm -rf /dev/shm/ref-$p; log "ref $p fusionné"
done
n=$(find /dev/shm/visual-baseline-031 -name '*.png' | wc -l); log "référence : $n captures"
rm -rf $RUN/.next; rm -f $ST/built
[ "$n" -ge 1160 ] && date > /dev/shm/visual-baseline-031/READY
