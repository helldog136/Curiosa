#!/bin/bash
# site-reset.sh : site jetable (copie de l'instantané du harnais), administrateur connu : owner@example.org / e2e-password-123
. /dev/shm/s7-e2e/env.sh
rm -rf $SITE; mkdir -p $SITE; cp -r /dev/shm/s7-visual/snapshot/data $SITE/data
cd $SRC && node_modules/.bin/prisma migrate deploy > $E2E/migrate.log 2>&1
node --no-warnings $E2E/reset-user.cjs
