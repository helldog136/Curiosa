// Exigences « tableau de bord » : la clé facultative `dashboard` de module.json (tâches, actions rapides, cartes) et le code qui l'alimente (`dashboard.tasks`, `dashboard.cards`).
// Les bornes et les formes viennent du cœur (core/dashboard/spec.ts) : on appelle ses fonctions, on ne les recopie pas.
import { makeCtx } from "../probes.mjs";

const SLOW_MS = 1500;
const quiet = async (fn) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

const requirements = [
  {
    id: "dashboard.valid", level: "mandatory", group: "dashboard",
    title: "Ce que le module propose au tableau de bord est complet et valide",
    what: "Si module.json déclare « dashboard » (tasks, quickActions, cards), chaque tâche et chaque carte déclarée a sa fonction dans le code (dashboard.tasks.<id>, dashboard.cards.<id>) et chaque fonction est déclarée ; les libellés sont en français ET en anglais, les liens mènent à l'administration, les droits sont déclarés dans « rights » ; chaque fonction répond dans la forme attendue (un nombre pour une tâche, { value, detail? } ou { rows } pour une carte) en moins de 1,5 seconde, avec des données d'essai.",
    why: "Le cœur appelle ces fonctions à chaque affichage du tableau de bord, avec 1,5 seconde au plus : une réponse mal formée ou trop lente fait disparaître le module du tableau de bord (les autres s'affichent). Le cœur n'affiche jamais de HTML ni de lien hors de l'administration venant d'un module.",
    fix: "Déclarez dans module.json « dashboard »: { \"tasks\": [{ \"id\": \"pending\", \"label\": { \"fr\": \"{n} avis à valider\", \"en\": \"{n} reviews to approve\" }, \"href\": \"?tab=reviews\" }] } et écrivez « dashboard: { tasks: { pending: async (ctx) => nombre } } » dans le code ; lisez un compteur déjà calculé, jamais un service externe. Voir docs/CREATE-A-MODULE.md, « Tableau de bord ».",
    async run(m) {
      const decl = m.manifest?.dashboard;
      const code = m.definition?.dashboard;
      if (!decl && !code) return { na: "le module ne propose rien au tableau de bord" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const out = [];
      const tasks = (decl?.tasks ?? []).map((t) => t.id);
      const cards = (decl?.cards ?? []).map((c) => c.id);
      const doneTasks = Object.keys(code?.tasks ?? {});
      const doneCards = Object.keys(code?.cards ?? {});
      for (const id of tasks) if (!doneTasks.includes(id)) out.push(`la tâche « ${id} » est déclarée dans module.json mais n'a pas de fonction dashboard.tasks.${id} dans le code`);
      for (const id of doneTasks) if (!tasks.includes(id)) out.push(`dashboard.tasks.${id} existe dans le code mais la tâche n'est pas déclarée dans module.json (dashboard.tasks)`);
      for (const id of cards) if (!doneCards.includes(id)) out.push(`la carte « ${id} » est déclarée dans module.json mais n'a pas de fonction dashboard.cards.${id} dans le code`);
      for (const id of doneCards) if (!cards.includes(id)) out.push(`dashboard.cards.${id} existe dans le code mais la carte n'est pas déclarée dans module.json (dashboard.cards)`);
      const spec = await import("@/core/dashboard/spec");
      const instance = { id: "i-probe", key: "probe" };
      for (const mode of ["defaults", "filled"]) {
        for (const id of tasks) {
          const fn = code?.tasks?.[id];
          if (typeof fn !== "function") continue;
          const ctx = makeCtx(m, { mode, locale: "fr" });
          const started = Date.now();
          try {
            const raw = await quiet(() => Promise.race([fn(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error(`plus de ${SLOW_MS} ms`)), SLOW_MS + 500).unref())]));
            if (Date.now() - started > SLOW_MS) out.push(`la tâche « ${id} » répond en plus de ${SLOW_MS} ms (réglages ${mode === "defaults" ? "par défaut" : "remplis"}) : le cœur l'écarterait`);
            if (spec.parseTaskCount(raw) === null) out.push(`la tâche « ${id} » doit répondre un nombre entier de 0 ou plus (elle a répondu ${JSON.stringify(raw)?.slice(0, 40)})`);
          } catch (e) { out.push(`la tâche « ${id} » échoue (réglages ${mode === "defaults" ? "par défaut" : "remplis"}) : ${String(e?.message ?? e).slice(0, 100)}`); }
        }
        for (const card of decl?.cards ?? []) {
          const fn = code?.cards?.[card.id];
          if (typeof fn !== "function") continue;
          const ctx = makeCtx(m, { mode, locale: "fr" });
          const started = Date.now();
          try {
            const raw = await quiet(() => Promise.race([fn(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error(`plus de ${SLOW_MS} ms`)), SLOW_MS + 500).unref())]));
            if (Date.now() - started > SLOW_MS) out.push(`la carte « ${card.id} » répond en plus de ${SLOW_MS} ms : le cœur l'écarterait`);
            if (spec.parseCard(card.type, raw, instance) === null) out.push(`la carte « ${card.id} » (${card.type === "counter" ? "{ value, detail? }" : "{ rows: [{ title, detail?, href? }] }, 5 lignes au plus"}) a répondu une forme que le cœur refuse : ${JSON.stringify(raw)?.slice(0, 80)}`);
          } catch (e) { out.push(`la carte « ${card.id} » échoue : ${String(e?.message ?? e).slice(0, 100)}`); }
        }
      }
      return [...new Set(out)];
    },
  },
];

export default requirements;
