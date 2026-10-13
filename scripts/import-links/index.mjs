// Choix de l'adaptateur et lecture d'une page. Un adaptateur qui échoue, ou qui ne trouve aucun lien, laisse la main à l'adaptateur GÉNÉRIQUE : le rapport dit alors
// pourquoi, pour que l'on sache que le service a probablement changé son HTML.
import allmylinks from "./adapters/allmylinks.mjs";
import beacons from "./adapters/beacons.mjs";
import biolink from "./adapters/biolink.mjs";
import campsite from "./adapters/campsite.mjs";
import carrd from "./adapters/carrd.mjs";
import generic from "./adapters/generic.mjs";
import linkinbio from "./adapters/linkinbio.mjs";
import linktree from "./adapters/linktree.mjs";
import lnkbio from "./adapters/lnkbio.mjs";
import milkshake from "./adapters/milkshake.mjs";
import soloto from "./adapters/soloto.mjs";
import taplink from "./adapters/taplink.mjs";
import { hostOf } from "./urls.mjs";

export const ADAPTERS = [linktree, beacons, biolink, linkinbio, lnkbio, taplink, soloto, campsite, allmylinks, carrd, milkshake];
export { generic };
export const SERVICE_HOSTS = ADAPTERS.flatMap((a) => a.hosts);
const byHost = (host) => ADAPTERS.find((a) => a.hosts.some((h) => host === h || host.endsWith(`.${h}`)));

/** { adapter, by } : l'adaptateur demandé, sinon celui de l'adresse, sinon celui dont la page porte la signature ; null si aucun. */
export function pickAdapter(page, forcedId) {
  if (forcedId) { const a = ADAPTERS.find((x) => x.id === forcedId); if (!a && forcedId !== "generic") throw new Error(`adaptateur inconnu : ${forcedId} (disponibles : ${ADAPTERS.map((x) => x.id).join(", ")}, generic)`); return a ? { adapter: a, by: "option" } : null; }
  const h = byHost(page.host);
  if (h) return { adapter: h, by: "adresse" };
  for (const a of ADAPTERS) { try { if (a.detect(page)) return { adapter: a, by: "signature" }; } catch { /* signature illisible : on essaie la suivante */ } }
  return null;
}

/** Lit la page : { raw, aggregator, adapter, fallback, fallbackReason }. Ne lève jamais pour une structure inattendue. */
export function readPage(page, { adapter: forced } = {}) {
  const pick = pickAdapter(page, forced);
  let reason = pick ? "" : "service non reconnu";
  if (pick) {
    try {
      const raw = pick.adapter.extract(page);
      if (raw && raw.links?.length) return { raw, aggregator: pick.adapter.id, adapter: pick.adapter.id, fallback: false, fallbackReason: "", by: pick.by };
      reason = `la structure d'une page ${pick.adapter.name} n'a pas été reconnue (aucun lien lisible)`;
    } catch (e) { reason = `lecture ${pick.adapter.name} impossible (${String(e?.message ?? e).slice(0, 120)})`; }
  }
  const raw = generic.extract(page);
  const notes = [...(raw.notes ?? [])];
  if (!pick) notes.push("service non reconnu : lecture générique de la page (liens, titre, image de partage)");
  return { raw: { ...raw, notes }, aggregator: pick?.adapter.id ?? "unknown", adapter: "generic", fallback: !!pick, fallbackReason: pick ? reason : "", by: pick?.by ?? null };
}
export const aggregatorHostOf = hostOf;
