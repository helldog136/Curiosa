#!/bin/bash
. /dev/shm/s7-e2e/env.sh
cd $SRC
[ -f $E2E/dev.pid ] && kill -0 $(cat $E2E/dev.pid) 2>/dev/null && { echo "déjà démarré $(cat $E2E/dev.pid)"; exit 0; }
setsid node node_modules/next/dist/bin/next dev -p $PORT -H 127.0.0.1 > $E2E/dev.log 2>&1 &
echo $! > $E2E/dev.pid
for i in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:$PORT/api/health && { echo "prêt pid $(cat $E2E/dev.pid)"; exit 0; }; sleep 1; done
echo ÉCHEC; tail -20 $E2E/dev.log; exit 1
