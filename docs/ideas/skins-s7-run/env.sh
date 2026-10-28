export HOME=/dev/shm/home-s7 TMPDIR=/dev/shm/tmp-s7 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NEXT_TELEMETRY_DISABLED=1
export E2E=/dev/shm/s7-e2e SITE=/dev/shm/s7-e2e/site SRC=/dev/shm/s7 PORT=${PORT:-3552}
export GIT_CONFIG_GLOBAL=/dev/shm/s7-e2e/gitconfig
export DATA_DIR=$SITE/data DATABASE_URL=file:$SITE/data/curiosa.db SITE_URL=http://127.0.0.1:$PORT AUTH_SECRET=e2e-secret-not-for-production AUTH_TRUST_HOST=1
export CURIOSA_ALLOW_LOCAL_MODULES=1 CURIOSA_CATALOGUE_RUNTIME=0 CURIOSA_CATALOGUE_REPO=file:///nonexistent/curiosa-extras CURIOSA_SKINS_REPO=https://github.com/e2e/curiosa-skins
