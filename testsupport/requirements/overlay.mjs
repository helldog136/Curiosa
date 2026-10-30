// Exigences sur les ÉLÉMENTS DE PAGE D'OVERLAY d'un module (clé « overlayElements » du module.json, docs/OVERLAY-ELEMENTS.md). Sans élément, tout est « sans objet ».
import { makeCtx } from "../probes.mjs";
import { HOSTILE } from "../probes.mjs";
import { loadCore } from "../core.mjs";

/** Valeur d'option d'après sa déclaration (défaut, ou une valeur hostile / extrême). */
function optionValues(options, mode) {
  return Object.fromEntries((options ?? []).map((o) => {
    if (mode === "defaults") {
      if (o.type === "boolean") return [o.id, o.default ?? false];
      if (o.type === "number") return [o.id, o.default ?? o.min ?? 0];
      if (o.type === "choice") return [o.id, o.default ?? o.choices[0].value];
      return [o.id, o.default ?? ""];
    }
    if (o.type === "text") return [o.id, HOSTILE.slice(0, o.maxLength ?? 200)];
    if (o.type === "number") return [o.id, o.max ?? 1e9];
    if (o.type === "boolean") return [o.id, true];
    return [o.id, o.choices[o.choices.length - 1].value];
  }));
}

const sizeOf = (d) => (d.fit === "scale" ? d.size : { width: Math.round((d.referenceHeight ?? 1080) * (d.ratios ? (d.ratios.min + d.ratios.max) / 2 : 1.78)), height: d.referenceHeight ?? 720 });

const requirements = [
  {
    id: "overlay.elements", level: "mandatory", group: "overlay",
    title: "Les éléments d'overlay déclarés sont servis, avec des adresses valables",
    what: "Chaque élément de « overlayElements » (module.json) a sa fonction dans « overlayElements » du code, et inversement ; chaque fonction répond par une adresse du site (un chemin qui commence par « / », jamais une adresse externe) ou par null, même avec des options extrêmes ou hostiles.",
    why: "Le cœur demande à votre module, côté serveur, l'adresse de chaque élément. Une adresse externe ou mal formée est refusée (cadre vide dans OBS) ; une fonction qui plante avec une option inattendue fait disparaître l'élément du direct.",
    fix: "Déclarez chaque élément des deux côtés avec le même identifiant. Répondez { url: `/m/${ctx.instance.key}/…` } ; validez les options reçues (ignorez celles que vous ne connaissez pas) ; répondez null si l'élément n'est pas disponible.",
    async run(m) {
      const decls = m.parsed?.ok ? m.parsed.manifest.overlayElements : m.manifest?.overlayElements;
      const fns = m.definition?.overlayElements;
      if (!decls?.length && !fns) return { na: "le module ne propose aucun élément de page d'overlay" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const out = [];
      const ids = new Set((decls ?? []).map((d) => d.id));
      for (const d of decls ?? []) if (typeof fns?.[d.id] !== "function") out.push(`l'élément « ${d.id} » est déclaré dans module.json mais le code n'a pas de fonction overlayElements.${d.id}`);
      for (const k of Object.keys(fns ?? {})) if (!ids.has(k)) out.push(`le code sert l'élément « ${k} » qui n'est pas déclaré dans « overlayElements » de module.json`);
      await loadCore();
      const { parseAddress } = await import("@/core/overlays/address");
      for (const d of decls ?? []) {
        const fn = fns?.[d.id];
        if (typeof fn !== "function") continue;
        for (const mode of ["defaults", "hostile"]) {
          const ctx = makeCtx(m, { mode: "filled", locale: "fr" });
          const size = sizeOf(d);
          const request = { element: d.id, fit: d.fit, width: size.width, height: size.height, style: d.followsStyle === false ? null : { text: "light", surface: "transparent", corners: "round" }, options: optionValues(d.options, mode), lang: "fr" };
          try {
            const answer = await Promise.race([fn(ctx, request), new Promise((_, rej) => setTimeout(() => rej(new Error("trop long (plus de 8 s)")), 8000).unref())]);
            if (answer === null) continue;
            if (!answer || typeof answer.url !== "string") { out.push(`l'élément « ${d.id} » ne répond ni null ni { url }`); continue; }
            if (parseAddress && !parseAddress(answer)) out.push(`l'élément « ${d.id} » répond une adresse que le cœur refuse (« ${String(answer.url).slice(0, 60)} ») : un chemin du site, sans espace ni « .. », est attendu`);
          } catch (e) { out.push(`l'élément « ${d.id} » lève une erreur avec des options ${mode === "hostile" ? "extrêmes ou hostiles" : "par défaut"} : ${String(e?.message ?? e).slice(0, 100)}`); }
        }
      }
      return [...new Set(out)];
    },
  },
];

export default requirements;
