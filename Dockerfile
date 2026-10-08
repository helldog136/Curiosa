FROM node:22-slim AS base
# git : nécessaire à l'installation de modules depuis l'admin. openssl : moteur Prisma.
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM base AS run
# CURIOSA_INSTALL=docker : l'admin n'essaie pas de se mettre à jour en place (on remplace l'image).
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data DATABASE_URL=file:/app/data/curiosa.db CURIOSA_INSTALL=docker
COPY --from=build /app ./
VOLUME /app/data
EXPOSE 3000
# Les migrations sont appliquées à chaque démarrage (idempotent).
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start"]
