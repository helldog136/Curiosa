import type { MissingService } from "./bulkUpdate";

/**
 * Phrases lisibles pour « ce qui manque » (fonctions pures : le traducteur et les noms sont fournis par l'appelant).
 * Jamais d'identifiant technique ici sauf en dernier recours : un service sans libellé connu garde son nom.
 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;
export type Names = {
  /** Nom lisible d'un module (installé ou du catalogue), à défaut son identifiant. */
  module(id: string): string;
  /** Nom lisible d'un service : son libellé, sinon le module qui le fournit, sinon son nom technique. */
  service(service: string): string;
};

export function describeMissing(m: MissingService & { chain?: string[]; detail?: string }, t: Translate, names: Names): string {
  const name = names.service(m.service);
  switch (m.reason) {
    case "old": return t("deps.missing.old", { name, min: m.min, have: m.have ?? 1 });
    case "cycle": return t("deps.missing.cycle", { name, chain: (m.chain ?? []).map(names.module).join(" → ") });
    case "depth": return t("deps.missing.depth", { name });
    case "extra": return t("deps.missing.extra", { name, module: names.module(m.module ?? m.service) });
    case "failed": return t("deps.missing.failed", { name, module: names.module(m.module ?? m.service), reason: m.error ? t(m.error, { services: m.detail ?? "", modules: m.detail ?? "" }) : t("error.generic") });
    default: return t("deps.missing.none", { name });
  }
}

/** « Il manque : … » — une phrase par service. */
export const describeMissingList = (list: (MissingService & { chain?: string[]; detail?: string })[], t: Translate, names: Names): string[] => list.map((m) => describeMissing(m, t, names));

/* Transport dans l'adresse d'une redirection (le refus d'une action arrive sur la page par ?missing=…). Relu avec méfiance : c'est une entrée d'URL. */
const REASONS = new Set(["none", "old", "cycle", "depth", "failed", "extra"]);
const ID_RE = /^[a-z][a-z0-9.-]{0,60}$/;

export function encodeMissing(list: MissingService[] | undefined): string | undefined {
  if (!list?.length) return undefined;
  const slim = list.slice(0, 10).map((m) => ({ service: m.service, min: m.min, have: m.have, reason: m.reason, module: m.module, error: m.error, chain: (m as { chain?: string[] }).chain?.slice(0, 6) }));
  const text = JSON.stringify(slim);
  return text.length <= 1500 ? text : undefined;
}

export function decodeMissing(raw: string | undefined): (MissingService & { chain?: string[] })[] {
  if (!raw || raw.length > 1500) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: (MissingService & { chain?: string[] })[] = [];
    for (const p of parsed.slice(0, 10)) {
      if (!p || typeof p !== "object") continue;
      const o = p as Record<string, unknown>;
      if (typeof o.service !== "string" || !ID_RE.test(o.service) || typeof o.reason !== "string" || !REASONS.has(o.reason)) continue;
      out.push({
        service: o.service, reason: o.reason,
        min: Number.isInteger(o.min) && (o.min as number) >= 1 ? (o.min as number) : 1,
        have: Number.isInteger(o.have) ? (o.have as number) : null,
        ...(typeof o.module === "string" && ID_RE.test(o.module) ? { module: o.module } : {}),
        ...(typeof o.error === "string" && /^modules\.error\.[A-Za-z]+$/.test(o.error) ? { error: o.error } : {}),
        ...(Array.isArray(o.chain) ? { chain: o.chain.filter((c): c is string => typeof c === "string" && ID_RE.test(c)).slice(0, 6) } : {}),
      });
    }
    return out;
  } catch { return []; }
}
