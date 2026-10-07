/**
 * Versions du framework : des étiquettes git stables `vX.Y.Z` (ou `X.Y.Z`). Les pré-versions (`-beta`…) sont ignorées :
 * une installation ne se met jamais à jour vers autre chose qu'une version stable.
 */
export const TAG_RE = /^v?\d+\.\d+\.\d+$/;
export type UpdateLevel = "major" | "minor" | "patch";

export function parseVersion(v: string): [number, number, number] | null {
  if (!TAG_RE.test(v)) return null;
  const [a, b, c] = v.replace(/^v/, "").split(".").map(Number);
  return [a!, b!, c!];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) throw new Error("invalid version");
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! < pb[i]! ? -1 : 1;
  return 0;
}

/** Nature de la mise à jour : une montée de « majeure » peut casser des choses, on ne l'applique jamais d'office. */
export function classify(current: string, target: string): UpdateLevel | null {
  const c = parseVersion(current), t = parseVersion(target);
  if (!c || !t || compareVersions(current, target) >= 0) return null;
  return t[0] !== c[0] ? "major" : t[1] !== c[1] ? "minor" : "patch";
}

export type ReleaseInfo = { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };

/** Plus haute version stable parmi les releases publiées (API GitHub) qui fournissent l'archive voulue : brouillons, pré-versions et releases sans archive sont ignorés. */
export function pickLatestRelease(releases: unknown, assetName: (tag: string) => string): string | null {
  let best: string | null = null;
  if (!Array.isArray(releases)) return null;
  for (const r of releases as ReleaseInfo[]) {
    const tag = r?.tag_name;
    if (typeof tag !== "string" || !TAG_RE.test(tag) || r.draft === true || r.prerelease === true) continue;
    const names = Array.isArray(r.assets) ? (r.assets as { name?: unknown }[]).map((a) => a?.name) : [];
    if (!names.includes(assetName(tag))) continue;
    if (!best || compareVersions(tag, best) > 0) best = tag;
  }
  return best;
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
