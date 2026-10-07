import path from "node:path";

/** Tout ce qui est propre à une installation (base, envois, modules, secret). */
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const MODULES_DIR = path.join(DATA_DIR, "modules");

/** Version du contrat entre le cœur et les modules (voir docs/MODULES.md). */
export const MODULE_API_VERSION = 1;

export const siteUrl = (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

/** Premier chemin d'URL qui ne peut être ni une collection ni une redirection. */
export const RESERVED_PATHS = new Set([
  "admin",
  "api",
  "m",
  "go",
  "uploads",
  "_next",
  "sitemap.xml",
  "robots.txt",
  "icon",
  "favicon.ico",
]);
