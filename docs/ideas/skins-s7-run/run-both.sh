#!/bin/bash
cd /dev/shm/s7-e2e
for W in 1280 390; do
  (cd skins-repo && sed 's/1\.1\.0/1.0.0/g' catalogue/index-1.1.0.json > catalogue/index.json && git -c user.email=t@t -c user.name=t commit -qam "idx10-$W" 2>/dev/null)
  ./dev-down.sh >/dev/null; ./site-reset.sh >/dev/null; ./dev-up.sh >/dev/null
  W=$W timeout 1500 node journey.mjs > journey$W.log 2>&1
done
echo FINI > run-both.done
