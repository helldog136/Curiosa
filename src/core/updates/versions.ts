/**
 * Versions du framework : des étiquettes `vX.Y.Z` (stables) ou `vX.Y.Z-rc.N` (release candidates). Par défaut une installation ne se met
 * jamais à jour vers autre chose qu'une version stable ; un administrateur avancé peut choisir le canal « rc », à ses risques et périls.
 */
export const TAG_RE = /^v?\d+\.\d+\.\d+$/;
/** Version stable ou release candidate (`v1.2.0-rc.1`) : les seules que le canal « rc » d'une instance peut installer. */
export const TAG_RC_RE = /^v?\d+\.\d+\.\d+(-rc\.\d+)?$/;
export type UpdateLevel = "major" | "minor" | "patch";
export type UpdateChannel = "stable" | "rc";

export function isPrerelease(v: string): boolean { return /-rc\.\d+$/.test(v); }

/** [majeure, mineure, correctif, rc] : une stable vaut Infinity en 4e position (1.2.0-rc.3 < 1.2.0). Version invalide → null. */
export function parseVersion(v: string, rc = false): [number, number, number, number] | null {
  if (!(rc ? TAG_RC_RE : TAG_RE).test(v)) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(v)!;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a, true), pb = parseVersion(b, true);
  if (!pa || !pb) throw new Error("invalid version");
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** Nature de la mise à jour : une montée de « majeure » peut casser des choses, on ne l'applique jamais d'office. */
export function classify(current: string, target: string): UpdateLevel | null {
  const c = parseVersion(current, true), t = parseVersion(target, true);
  if (!c || !t || compareVersions(current, target) >= 0) return null;
  return t[0] !== c[0] ? "major" : t[1] !== c[1] ? "minor" : "patch";
}

export type ReleaseInfo = { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };

/**
 * Plus haute version publiée qui fournit l'archive voulue. Canal « stable » : versions stables seulement. Canal « rc » : les release
 * candidates aussi (la plus haute des deux). Brouillons, snapshots (`dev-…`) et releases sans archive sont toujours ignorés.
 */
export function pickLatestRelease(releases: unknown, assetName: (tag: string) => string, channel: UpdateChannel = "stable"): string | null {
  let best: string | null = null;
  if (!Array.isArray(releases)) return null;
  for (const r of releases as ReleaseInfo[]) {
    const tag = r?.tag_name;
    if (typeof tag !== "string" || r.draft === true) continue;
    if (!(channel === "rc" ? TAG_RC_RE : TAG_RE).test(tag)) continue;
    // Une stable marquée « pré-version » sur GitHub, ou une rc non marquée, est suspecte : on s'en tient au nom de l'étiquette.
    if (channel === "stable" && r.prerelease === true) continue;
    const names = Array.isArray(r.assets) ? (r.assets as { name?: unknown }[]).map((a) => a?.name) : [];
    if (!names.includes(assetName(tag))) continue;
    if (!best || compareVersions(tag, best) > 0) best = tag;
  }
  return best;
}

/** Texte (notes de version) de la release portant cette étiquette ; vide si elle n'en a pas. */
export function releaseNotes(releases: unknown, tag: string): string {
  if (!Array.isArray(releases)) return "";
  const r = (releases as ReleaseInfo[]).find((x) => x?.tag_name === tag) as (ReleaseInfo & { body?: unknown }) | undefined;
  return typeof r?.body === "string" ? r.body.slice(0, 6000) : "";
}

/** Plus haute version stable dans la sortie de `git ls-remote --tags` (modules git : les lignes `^{}` des étiquettes annotées comptent une fois). */
export function pickLatestTag(lsRemote: string): string | null {
  let best: string | null = null;
  for (const line of lsRemote.split("\n")) {
    const m = /\trefs\/tags\/([^\s^]+)(\^\{\})?$/.exec(line.trim() ? line : "");
    const tag = m?.[1];
    if (!tag || !TAG_RE.test(tag)) continue;
    if (!best || compareVersions(tag, best) > 0) best = tag;
  }
  return best;
}
