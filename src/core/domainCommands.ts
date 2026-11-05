import fs from "node:fs";
import path from "node:path";
import { installKind } from "../../scripts/install-kind.mjs";

/**
 * COMMANDES À COPIER SUR LE SERVEUR pour un changement de domaine. Le cœur ne modifie JAMAIS le fichier `.env`, la configuration du serveur web ni le DNS : il écrit ce qu'il faut
 * taper, adapté à CE serveur quand il le reconnaît (dossier du site, service, port), et reste neutre sinon. Les noms de domaine qui entrent ici ont déjà passé `parseSiteAddress`
 * (lettres, chiffres, points et tirets seulement) ; le chemin du site, lui, est protégé par des apostrophes.
 */

export type Supervisor =
  | { kind: "command"; command: string }
  | { kind: "systemd"; unit: string | null }
  | { kind: "pm2" }
  | { kind: "docker" }
  | { kind: "manual" };

export type ServerContext = {
  /** Dossier du site si on le connaît (`process.cwd()`), sinon null. */
  sitePath: string | null;
  /** Nom du site donné à `scripts/install.sh` (fichier `.install-curiosa`), ou null. */
  siteName: string | null;
  supervisor: Supervisor;
  port: number;
  /** Anciens domaines déjà listés dans `LEGACY_HOSTS`. */
  legacy: string[];
};

/** Lit le fichier-marque que `scripts/install.sh` écrit dans le dossier du site (`site=NOM`) ; null s'il n'y est pas ou s'il est illisible. */
export function readInstallMarker(dir: string): { site: string } | null {
  try {
    const text = fs.readFileSync(path.join(dir, ".install-curiosa"), "utf8");
    const site = /^site=([a-z0-9][a-z0-9_-]{0,31})$/m.exec(text)?.[1];
    return site ? { site } : null;
  } catch { return null; }
}

/** Ce qu'on peut déduire de l'environnement du processus : dossier, nom du site, gestionnaire de processus, port. Rien n'est inventé : sans indice, `manual` et des valeurs d'exemple. */
export function detectServerContext(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd(), legacy: string[] = []): ServerContext {
  const marker = readInstallMarker(cwd);
  const siteName = marker?.site ?? null;
  let supervisor: Supervisor = { kind: "manual" };
  const restart = (env.CURIOSA_RESTART_COMMAND ?? "").trim();
  if (restart) supervisor = { kind: "command", command: restart.slice(0, 300) };
  else if (installKind(env) === "docker") supervisor = { kind: "docker" };
  else if (env.PM2_HOME !== undefined || env.pm_id !== undefined) supervisor = { kind: "pm2" };
  else if (env.INVOCATION_ID !== undefined || env.JOURNAL_STREAM !== undefined) supervisor = { kind: "systemd", unit: siteName ?? (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(path.basename(cwd)) ? path.basename(cwd) : null) };
  else if (env.CURIOSA_SUPERVISED === "1") supervisor = { kind: "systemd", unit: siteName };
  const fromReady = /:(\d{2,5})(?:\/|$)/.exec(env.CURIOSA_READY_URL ?? "")?.[1];
  const port = Number(env.PORT || fromReady || 3000);
  return { sitePath: cwd || null, siteName, supervisor, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000, legacy };
}

/** Protège un texte pour le shell : apostrophes autour, les apostrophes du texte sont fermées puis échappées. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const PLACEHOLDER_DIR = "/chemin/de/votre/site";

export type MigrationCommands = {
  /** Valeur de `LEGACY_HOSTS` après le changement : l'ancien domaine ajouté aux anciens déjà listés (10 au plus). */
  legacyValue: string;
  env: string;
  restart: { text: string; kind: Supervisor["kind"] };
  nginx: { keep: string; redirect: string; certificate: string };
  caddy: { keep: string; redirect: string };
  apache: { keep: string; redirect: string; certificate: string };
  folderKnown: boolean;
};

export function migrationCommands(input: { oldHost: string; newHost: string; newUrl: string; server: ServerContext }): MigrationCommands {
  const { oldHost, newHost, newUrl, server } = input;
  const legacy = [...new Set([oldHost, ...server.legacy])].filter((h) => h !== newHost).slice(0, 10);
  const legacyValue = legacy.join(",");
  const dir = server.sitePath ?? PLACEHOLDER_DIR;
  const setLine = (key: string, value: string) =>
    `if grep -q '^${key}=' .env; then sudo sed -i -E 's|^${key}=.*|${key}="${value}"|' .env; else echo '${key}="${value}"' | sudo tee -a .env >/dev/null; fi`;
  const env = [`cd ${shellQuote(dir)}`, "sudo cp .env .env.avant-changement-domaine", setLine("SITE_URL", newUrl), setLine("LEGACY_HOSTS", legacyValue)].join("\n");

  const s = server.supervisor;
  const restart: MigrationCommands["restart"] =
    s.kind === "command" ? { kind: "command", text: s.command }
    : s.kind === "systemd" ? { kind: "systemd", text: `sudo systemctl restart ${s.unit ?? "nom-du-service"}` }
    : s.kind === "pm2" ? { kind: "pm2", text: "pm2 restart nom-du-site --update-env" }
    : s.kind === "docker" ? { kind: "docker", text: "docker compose up -d --force-recreate" }
    : { kind: "manual", text: "" };

  const names = [newHost, ...legacy].join(" ");
  const port = server.port;
  const nginx = {
    keep: `server {
    listen 80;
    listen [::]:80;
    server_name ${names};
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}`,
    redirect: legacy.map((h) => `server {\n    listen 80;\n    listen [::]:80;\n    server_name ${h};\n    return 301 ${newUrl}$request_uri;\n}`).join("\n\n"),
    certificate: `sudo certbot --nginx ${[newHost, ...legacy].map((h) => `-d ${h}`).join(" ")}`,
  };
  const caddy = {
    keep: `${[newHost, ...legacy].join(", ")} {\n    reverse_proxy 127.0.0.1:${port}\n}`,
    redirect: legacy.map((h) => `${h} {\n    redir ${newUrl}{uri} permanent\n}`).join("\n\n"),
  };
  const apache = {
    keep: `<VirtualHost *:80>\n    ServerName ${newHost}\n${legacy.map((h) => `    ServerAlias ${h}\n`).join("")}    ProxyPreserveHost On\n    RequestHeader set X-Forwarded-Proto "%{REQUEST_SCHEME}s"\n    ProxyPass / http://127.0.0.1:${port}/\n    ProxyPassReverse / http://127.0.0.1:${port}/\n</VirtualHost>`,
    redirect: legacy.map((h) => `<VirtualHost *:80>\n    ServerName ${h}\n    Redirect permanent / ${newUrl}/\n</VirtualHost>`).join("\n\n"),
    certificate: `sudo certbot --apache ${[newHost, ...legacy].map((h) => `-d ${h}`).join(" ")}`,
  };
  return { legacyValue, env, restart, nginx, caddy, apache, folderKnown: server.sitePath !== null };
}
