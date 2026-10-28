#!/bin/bash
. /dev/shm/s7-e2e/env.sh
pid=$(cat $E2E/dev.pid 2>/dev/null); [ -n "$pid" ] || exit 0
pkill -P $pid 2>/dev/null; kill $pid 2>/dev/null; sleep 2
for c in $(pgrep -f "next-server.*$PORT|next dev -p $PORT" 2>/dev/null); do kill $c 2>/dev/null; done
ss -ltnp 2>/dev/null | grep ":$PORT " && echo "ENCORE VIVANT" || echo "arrêté, port libre"; rm -f $E2E/dev.pid
