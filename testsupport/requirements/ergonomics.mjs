// Exigences « ergonomie des pages d'administration » (docs/ERGONOMIE-ADMIN.md, règles [auto]). Elles lisent le MANIFESTE et les LOCALES, jamais le code ;
// les règles qui portent sur des pages produites par du code se testent avec assertAdminPageErgonomics (testsupport/ergonomics.mjs).
//
// CLIQUET : une base `tests/ergonomics-baseline.json` (dans le dépôt des modules) liste les écarts CONNUS de chaque module. Un écart de la base est un avertissement
// (admin.ergonomics.known) ; un NOUVEL écart est un échec (admin.ergonomics) ; un écart de la base qui a disparu est aussi un échec (« retirez cette ligne de la base »).
// Sans base, il n'y a pas de « connu » : les écarts sont tous des avertissements, et rien n'échoue.
import fs from "node:fs";
import path from "node:path";
import { RULES, analyzeModule, compareToBaseline, parseBaseline, ratchetMessages } from "../ergonomics.mjs";

/** La base à utiliser pour ce module : option `ergonomicsBaseline` (objet, chemin, ou `false`), sinon <dépôt>/tests/ergonomics-baseline.json (dépôt de modules : <dépôt>/modules/<id>), sinon <module>/ergonomics-baseline.json. */
export function findBaseline(m) {
  const opt = m.opts?.ergonomicsBaseline;
  if (opt === false) return null;
  if (opt && typeof opt === "object") return parseBaseline(opt);
  const files = typeof opt === "string" ? [opt] : [path.join(m.dir, "..", "..", "tests", "ergonomics-baseline.json"), path.join(m.dir, "ergonomics-baseline.json")];
  for (const f of files) {
    try { if (fs.existsSync(f)) return parseBaseline(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { /* base illisible : comme si elle n'existait pas */ }
  }
  return null;
}

function inspect(m) {
  // The word lists and tone rules are English and French: community languages (locales/<code>.json) are reviewed by their own maintainers.
  const locales = Object.fromEntries(Object.entries(m.locales ?? {}).filter(([lang]) => lang === "en" || lang === "fr"));
  const gaps = analyzeModule({ id: m.manifest.id ?? m.name, manifest: m.manifest, locales });
  const baseline = findBaseline(m);
  return { gaps, baseline, ...(baseline ? compareToBaseline(gaps, baseline.modules[m.name] ?? []) : { tolerated: [], fresh: [], stale: [] }) };
}

/** Un résumé par règle (le détail complet : `node scripts/ergonomics-baseline.mjs --report` dans le dépôt des modules). */
function summary(gaps) {
  const rules = [...new Set(gaps.map((g) => g.rule))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return rules.map((r) => {
    const list = gaps.filter((g) => g.rule === r);
    return `${r} — ${RULES[r]} : ${list.length} écart${list.length > 1 ? "s" : ""}. Par exemple ${list[0].where} : ${list[0].message}`;
  });
}

const requirements = [
  {
    id: "admin.ergonomics", level: "mandatory", group: "ergonomics",
    title: "Aucun nouvel écart d'ergonomie dans les réglages et les textes",
    what: "Le manifeste (module.json) et les textes (locales/fr.json, en.json) respectent les règles automatiques de docs/ERGONOMIE-ADMIN.md : R5 (7 réglages simples au plus par onglet), R9 (aucun mot du code), R10 (libellés de 60 caractères au plus, sans « : »), R11 (aides courtes avec un exemple pour tout champ libre), R13 (vouvoiement, sans « ! », sans « Veuillez », sans majuscules criardes, phrases de 20 mots au plus), R17 (pas de bouton « Activer / désactiver »), R19 (pas de liste pour un booléen, pas de case négative) et R29 (FR et EN à parité exacte : mêmes clés, mêmes {variables}). Les écarts déjà connus d'un module, listés dans tests/ergonomics-baseline.json, sont tolérés (voir admin.ergonomics.known) ; tout NOUVEL écart (nouveau réglage, nouveau texte) échoue, et un écart connu qui a disparu doit être retiré de la base.",
    why: "Une personne qui crée du contenu juge une page de réglages en dix secondes. Les règles sont mesurées pour que la page ne se dégrade pas : la base ne peut que rétrécir, jamais grossir.",
    fix: "Corrigez le texte ou le réglage signalé (le message dit la règle et l'endroit). Pour un écart « disparu », retirez sa ligne de la base : node scripts/ergonomics-baseline.mjs --write. Ne rajoutez jamais une ligne à la base pour faire taire un nouvel écart ; pour un mot qui est le bon mot (un tiers l'impose), ajoutez une entrée JUSTIFIÉE à JARGON_WHITELIST en tête de testsupport/ergonomics.mjs.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const r = inspect(m);
      if (!r.baseline) return r.gaps.length ? { skip: `pas de base d'ergonomie (tests/ergonomics-baseline.json) : ${r.gaps.length} écart(s) signalé(s) en conseil (admin.ergonomics.known)` } : [];
      return ratchetMessages(r);
    },
  },
  {
    id: "admin.ergonomics.known", level: "advice", group: "ergonomics",
    title: "Écarts d'ergonomie connus, à résorber",
    what: "Les écarts d'ergonomie qui existent déjà (ceux de tests/ergonomics-baseline.json ; sans base, tous les écarts). Ils n'empêchent rien, mais la base doit rétrécir.",
    why: "Ces écarts sont de la dette : un texte trop long, un mot du code, un onglet trop chargé. Les garder visibles en avertissement évite de les oublier.",
    fix: "Corrigez un écart, puis retirez sa ligne de la base (node scripts/ergonomics-baseline.mjs --write). Le tableau par module et par règle : node scripts/ergonomics-baseline.mjs --report.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const r = inspect(m);
      const list = r.baseline ? r.tolerated : r.gaps;
      return summary(list);
    },
  },
];

export default requirements;
