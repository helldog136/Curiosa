// How this Curiosa was installed, and the constants that every update path (bare metal and Docker) shares.
// Plain Node, no dependency: it is imported by the site (src/core/updates), by the update scripts and by the container start-up.
// This is the ONLY place that reads CURIOSA_INSTALL (tests/architecture.test.mjs enforces it): everything else calls installKind().

/** "docker": the code comes from an image that is replaced, never changed in place. "bare-metal": a release archive unpacked on a host. */
export const INSTALL_KINDS = ["bare-metal", "docker"];

/** @param {Record<string, string | undefined>} [env] */
export function installKind(env = process.env) {
  return env.CURIOSA_INSTALL === "docker" ? "docker" : "bare-metal";
}

/** Repository that publishes the releases and the image. */
export const DEFAULT_REPO = "helldog136/Curiosa";
/** The image on the GitHub Container Registry (the only registry). */
export const IMAGE_NAME = "ghcr.io/helldog136/curiosa";
export const IMAGE_PLATFORMS = ["linux/amd64", "linux/arm64"];
/** Compose variable that picks the image tag (docker-compose.yml: `image: ${IMAGE_NAME}:${CURIOSA_VERSION:-latest}`). */
export const VERSION_ENV = "CURIOSA_VERSION";
/** The one command that updates a Docker install that is already above the support floor. Docs, install script and Updates page all print this string. */
export const DOCKER_UPDATE_COMMAND = "docker compose pull && docker compose up -d";

/** Database copies kept in `data/backups/` (pre-update-<tag>-<time>.db), by both paths. */
export const KEEP_BACKUPS = 5;
export const BACKUP_PREFIX = "pre-update-";
/** Container start-up copies: `pre-update-` when the data version changes (an update, migrations may be pending), `start-` when the same version simply restarts. */
export const START_BACKUP_PREFIX = "start-";
export const KEEP_PRE_UPDATE_BACKUPS = 3;
export const KEEP_START_BACKUPS = 2;
/** Health route and the header that carries the hashed version (see hashVersion in update-lib.mjs and next.config.mjs). */
export const HEALTH_PATH = "/api/health";
export const VERSION_HEADER = "x-curiosa-version";
/** Written in the data folder after a start that completed all migrations: the last core version that did. */
export const DATA_VERSION_FILE = ".curiosa-data-version";
/** Result of the last container start (backup taken, migrations applied, or why it refused), shown on the Updates page. */
export const STARTUP_STATE_FILE = "startup.json";

/** `v1.2.3` and `1.2.3` both give the image tag `1.2.3`. */
export const imageTag = (step) => String(step).replace(/^v/, "");

/** Tags published for a release: always the exact one; the series (`X.Y`) and `latest` only for a stable release, never for a pre-release. */
export function imageTagsFor(version) {
  const v = imageTag(version);
  const m = /^(\d+)\.(\d+)\.\d+$/.exec(v);
  return m ? [v, `${m[1]}.${m[2]}`, "latest"] : [v];
}

/**
 * Tags for an image rebuilt from an EXISTING release (retry of a failed push, or images for a release published before they existed): the same policy,
 * except that `X.Y` and `latest` never move BACKWARDS. `stable` lists every stable version published (with or without the leading v).
 */
export function imageTagsForExisting(version, stable = []) {
  const tags = imageTagsFor(version);
  if (tags.length === 1) return tags;
  const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const others = stable.map(imageTag).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  const v = imageTag(version);
  const [exact, series, latest] = tags;
  const out = [exact];
  if (!others.some((o) => o.startsWith(`${series}.`) && cmp(o, v) > 0)) out.push(series);
  if (!others.some((o) => cmp(o, v) > 0)) out.push(latest);
  return out;
}

/** Commands to run, in order, for the tags of a plan: one line when the site is above the floor, one pinned line per step otherwise (compose pulls a tag it does not have yet). */
export function dockerCommands(tags) {
  if (!Array.isArray(tags) || tags.length <= 1) return [DOCKER_UPDATE_COMMAND];
  return tags.map((tag) => `${VERSION_ENV}=${imageTag(tag)} docker compose up -d`);
}
