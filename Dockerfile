# The Curiosa image: the release archive, unpacked. Nothing is compiled or installed from source here (no npm ci, no next build, no COPY of the
# source tree): what ships is exactly what the release workflow built and smoke-tested (tests/core/docker-image.test.mjs enforces it).
#
# Build context (made by .github/workflows/release.yml): archive-amd64.tar.gz and archive-arm64.tar.gz, the curiosa-vX.Y.Z-linux-<arch>.tar.gz release archives.
#   docker buildx build --platform linux/amd64,linux/arm64 --build-arg VERSION=0.8.0 <context>
# The Prisma CLI (used for migrations at start) must use the engines that ship in the archive and must never try to download or write them: the site
# runs as a non-root user and may have no network. Their file names depend on the architecture, hence one tiny stage per architecture.
ARG TARGETARCH
FROM node:22-bookworm-slim AS target-amd64
ENV PRISMA_ENGINE_TARGET=debian-openssl-3.0.x
FROM node:22-bookworm-slim AS target-arm64
ENV PRISMA_ENGINE_TARGET=linux-arm64-openssl-3.0.x
FROM target-${TARGETARCH}
# git: installing modules from the admin. openssl: the database engine. ca-certificates: https.
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG TARGETARCH
ARG VERSION=unknown
ARG REVISION=unknown
ARG SOURCE=https://github.com/helldog136/Curiosa
LABEL org.opencontainers.image.title="Curiosa" \
      org.opencontainers.image.description="Curiosa, a personal-site framework (release archive, unpacked)" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="SEE LICENSE IN LICENSE"
WORKDIR /app
# ADD unpacks a local .tar.gz: the archive of the architecture being built (amd64 or arm64).
ADD archive-${TARGETARCH}.tar.gz /app/
# CURIOSA_INSTALL=docker: the admin never updates in place; the image is replaced (scripts/install-kind.mjs).
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data DATABASE_URL=file:/app/data/curiosa.db CURIOSA_INSTALL=docker HOME=/tmp NEXT_TELEMETRY_DISABLED=1
# The site writes Next's cache here whatever user it runs as (PUID/PGID or `user:`).
RUN mkdir -p /app/data /app/.next/cache && chmod 1777 /app/.next/cache && chown 1000:1000 /app/data
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-${PRISMA_ENGINE_TARGET}
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-${PRISMA_ENGINE_TARGET}.so.node
VOLUME /app/data
EXPOSE 3000
# Migrations and the first start can take a while: a generous start period. Same route and port as the update's health wait.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Starts as root only to give the data folder to PUID:PGID (default 1000:1000), then drops to that user; the site never runs as root.
# With `user: "uid:gid"` in compose the entrypoint starts unprivileged and only checks the data folder is writable.
ENTRYPOINT ["node", "/app/scripts/docker-entrypoint.mjs"]
