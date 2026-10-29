// Exigences sur les PIÈCES DE SKIN d'un module (clé « skin » du module.json, docs/SKINS.md §8). Elles ne concernent que l'apparence : un skin ne définit jamais de contenu
// (principe fondateur, docs/SKINS.md §0). Sans clé « skin », seul le conseil « skin.declare » parle (et seulement si le module met en forme une page publique).
import fs from "node:fs";
import path from "node:path";
import { stripComments, balancedArgs } from "./util.mjs";

const MAX_DEMO_BYTES = 20 * 1024;

/** Le texte où chercher du CSS et du HTML : le code du module (sans les commentaires), plus ses fichiers .css et .html éventuels. */
function corpus(m) {
  const parts = [{ file: "(code)", text: stripComments(m.code) }];
  for (const f of m.files ?? []) {
    if (f.symlink || !/\.(css|html)$/i.test(f.file) || /^(README|docs?)\b/i.test(f.file)) continue;
    try { parts.push({ file: f.file, text: fs.readFileSync(f.full, "utf8").slice(0, 400_000) }); } catch { /* illisible : ignoré */ }
  }
  return parts;
}
const allText = (m) => corpus(m).map((p) => p.text).join("\n");

/** Les valeurs de data-skin-part écrites dans le code. `dynamic` : une valeur calculée (`${…}`) que le kit ne peut pas lire. */
function emittedParts(m) {
  const out = new Set();
  let dynamic = false;
  for (const x of allText(m).matchAll(/data-skin-part\s*=\s*\\?["']([^"'\\]*)/g)) {
    if (x[1].includes("${") || x[1] === "") dynamic = true;
    else out.add(x[1]);
  }
  return { ids: out, dynamic };
}

/** Les jetons lus par le CSS (`var(--sk-…`) : nom, et s'il y a une valeur de repli (au premier niveau). */
function readTokens(m) {
  const text = allText(m);
  const out = [];
  for (const x of text.matchAll(/var\(\s*(--sk-[a-z0-9-]+)/g)) {
    const open = x.index + 3; // la parenthèse de « var »
    const { args } = balancedArgs(text, open);
    let depth = 0, comma = false;
    for (const c of args) { if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { comma = true; break; } }
    out.push({ name: x[1], fallback: comma, at: text.slice(Math.max(0, x.index - 40), x.index + 60).replace(/\s+/g, " ") });
  }
  return out;
}

/** Les déclarations « propriété: valeur » du CSS qui lisent un jeton de module. */
function declarationsUsing(m, prefix) {
  const out = [];
  for (const chunk of allText(m).split(/[;{}]/)) {
    const i = chunk.indexOf(":");
    if (i < 1 || !/var\(\s*--sk-m-/.test(chunk)) continue;
    const prop = chunk.slice(0, i).trim().split(/\s+/).pop().toLowerCase();
    if (!/^[a-z-]+$/.test(prop)) continue;
    for (const x of chunk.slice(i).matchAll(/var\(\s*(--sk-m-[a-z0-9-]+)/g)) if (!prefix || x[1].startsWith(prefix)) out.push({ prop, token: x[1] });
  }
  return out;
}

/** Propriétés où un jeton de module ne doit jamais se trouver : elles pourraient masquer, déplacer ou écraser le contenu (docs/SKINS.md §0.1, §6.3). */
const FORBIDDEN_PROPS = /^(display|visibility|opacity|content|clip|clip-path|mask|mask-image|pointer-events|user-select|position|top|right|bottom|left|inset(-.*)?|transform|translate|rotate|scale|z-index|order|overflow(-.*)?|text-indent|font-size|line-height|letter-spacing|width|height|max-width|max-height|filter|backdrop-filter|mix-blend-mode|-webkit-text-fill-color)$/;

const hasSkin = (m) => !!m.manifest && m.manifest.skin !== undefined;
const prefixOf = (m) => `--sk-m-${m.manifest.id}-`;

const requirements = [
  {
    id: "skin.valid", level: "mandatory", group: "skin",
    title: "La clé « skin » ne décrit que de l'apparence, avec des valeurs valables",
    what: "Si module.json a une clé « skin », chaque jeton porte le préfixe « --sk-m-<id du module>- », son type est dans la liste (couleur, longueur, ombre, nombre, police, durée, casse), sa valeur par défaut passe les mêmes contrôles que les valeurs d'un skin et ne cite que des jetons communs (« --sk-… », « --v-… ») ou des jetons du même module, chaque pièce est « <id du module>.<pièce> », et le tout tient dans 12 pièces et 24 jetons.",
    why: "Un skin ne définit que de l'apparence (docs/SKINS.md §0) : si un module pouvait y glisser du contenu ou une valeur dangereuse, changer de skin ferait perdre quelque chose ou ouvrirait une faille. Une valeur refusée est ignorée par le site (le module garde son apparence d'origine) mais le module ne ressemble alors pas à ce que vous avez voulu décrire.",
    fix: "Lisez le message : il nomme le jeton. Écrivez la valeur d'aujourd'hui (« 1rem », « #e8a23b », « 0 1px 2px rgb(0 0 0 / .2) ») ou une référence à un jeton commun (« var(--sk-radius-card) », « var(--v-surface) »). Voir docs/MODULES.md, « Rendre un module stylable ».",
    async run(m) {
      if (!hasSkin(m)) return { na: "le module ne déclare pas de pièces de skin" };
      if (!m.manifest.id) return { skip: "module.json sans id" };
      const out = [];
      const a = m.core.analyzeModuleSkin(m.manifest.id, JSON.parse(JSON.stringify(m.manifest.skin)));
      if (!a.decl) out.push("la clé « skin » est mal formée (voir aussi « manifest.valid » pour le champ fautif)");
      for (const i of a.issues) if (i.severity === "error") out.push(i.message.fr);
      for (const p of a.parts) if (p.kind && !m.core.skinParts.includes(p.kind)) out.push(`la pièce « ${p.id} » dit être de la famille « ${p.kind} », qui n'existe pas (familles : ${m.core.skinParts.slice(0, 8).join(", ")}…)`);
      return [...new Set(out)];
    },
  },
  {
    id: "skin.parts", level: "mandatory", group: "skin",
    title: "Les pièces déclarées sont dans le HTML, et celles du HTML sont déclarées",
    what: "Chaque pièce déclarée dans « skin.parts » est posée au moins une fois dans le HTML du module (data-skin-part=\"<id du module>.<pièce>\"), et chaque data-skin-part du module est une pièce déclarée de CE module (jamais le nom d'une pièce commune du cœur comme « card » ni la pièce d'un autre module). La valeur est écrite en entier, sans calcul.",
    why: "Un skin vise une pièce par ce nom. Une pièce déclarée mais jamais posée ne peut pas être restylée ; une pièce posée sans être déclarée est invisible pour les personnes qui écrivent des skins et pour le banc d'essai ; une pièce qui porte le nom d'une pièce du cœur ferait appliquer à tort le style de la carte du cœur à votre élément. Ajouter un attribut n'est pas un changement de contenu.",
    fix: "Ajoutez data-skin-part=\"mon-module.carte\" sur l'élément concerné (en plus de sa classe), ou retirez la pièce de module.json. Écrivez le nom en entier (pas de `${…}`).",
    run(m) {
      const { ids, dynamic } = emittedParts(m);
      if (!hasSkin(m)) return ids.size ? [`le module pose data-skin-part (${[...ids].slice(0, 4).join(", ")}) sans déclarer de clé « skin » dans module.json`] : { na: "le module ne déclare pas de pièces de skin" };
      const declared = new Set((m.manifest.skin.parts ?? []).map((p) => p.id));
      const out = [];
      for (const id of declared) if (!ids.has(id)) out.push(`la pièce « ${id} » est déclarée mais le code ne pose jamais data-skin-part="${id}"`);
      for (const id of ids) if (!declared.has(id)) out.push(`data-skin-part="${id}" n'est pas une pièce déclarée dans module.json (« skin.parts »)`);
      if (dynamic) out.push("un data-skin-part est écrit avec une valeur calculée (`${…}`) ou vide : écrivez chaque nom en entier pour que les pièces soient lisibles");
      return out;
    },
  },
  {
    id: "skin.fallback", level: "mandatory", group: "skin",
    title: "Chaque jeton lu par le CSS garde sa valeur d'aujourd'hui en repli",
    what: "Toute lecture d'un jeton de skin dans le CSS du module (« var(--sk-…) ») a une valeur de repli, et la chaîne finit par la valeur actuelle : var(--sk-m-module-pièce-propriété, var(--sk-jeton-commun, valeur-actuelle)). Les jetons « --sk-m-… » lus sont déclarés dans « skin.parts » et appartiennent à ce module.",
    why: "Sans repli, un cœur sans skins (ou un jeton oublié) rendrait le module différent de ce qu'il est aujourd'hui, voire cassé. Avec la chaîne complète, le rendu par défaut est IDENTIQUE à l'ancien et le module reste compatible avec les cœurs plus anciens. Lire le jeton d'un autre module créerait une dépendance cachée entre modules.",
    fix: "Écrivez par exemple border-radius:var(--sk-m-tw-card-radius,var(--sk-radius-card,1rem)) : jeton du module, puis jeton commun, puis la valeur que le module avait avant. Déclarez le jeton du module dans « skin.parts[].tokens ».",
    run(m) {
      const reads = readTokens(m);
      if (!reads.length && !hasSkin(m)) return { na: "le CSS du module ne lit aucun jeton de skin" };
      const out = [];
      const declared = hasSkin(m) ? new Set((m.manifest.skin.parts ?? []).flatMap((p) => (p.tokens ?? []).map((t) => t.name))) : new Set();
      const own = m.manifest?.id ? prefixOf(m) : null;
      for (const r of reads) {
        if (!r.fallback) out.push(`« var(${r.name}) » n'a pas de valeur de repli (…${r.at}…)`);
        if (r.name.startsWith("--sk-m-")) {
          if (own && !r.name.startsWith(own)) out.push(`« ${r.name} » est le jeton d'un autre module : un module ne lit que les siens et les jetons communs`);
          else if (!declared.has(r.name)) out.push(`« ${r.name} » est lu mais n'est pas déclaré dans « skin.parts[].tokens » de module.json`);
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "skin.noMasking", level: "mandatory", group: "skin",
    title: "Un jeton de module ne peut ni masquer, ni déplacer, ni écraser du contenu",
    what: "Aucun jeton « --sk-m-… » n'est lu dans une propriété qui pourrait masquer, déplacer ou rendre illisible un élément (display, visibility, opacity, content, clip-path, mask, position, décalages, transform, z-index, order, overflow, text-indent, font-size, line-height, width, height, max-width, max-height, filter…). Pour une taille de texte ou de boîte, utilisez un jeton COMMUN (« var(--sk-text-sm, .9rem) »).",
    why: "Un skin ne doit jamais pouvoir faire disparaître un texte ou un bouton (docs/SKINS.md §0.1) : les jetons communs sont bornés par le cœur (taille de texte minimale, cible tactile…), pas ceux d'un module. Un jeton « opacité » valant 0 effacerait le contenu.",
    fix: "Gardez les jetons de module pour des couleurs, des rayons, des bordures, des ombres, des espaces et des durées (propriétés color, background, border, border-radius, box-shadow, padding, margin, gap, transition…).",
    run(m) {
      const uses = declarationsUsing(m);
      if (!uses.length) return { na: "le CSS du module ne lit aucun jeton « --sk-m-… »" };
      return [...new Set(uses.filter((u) => FORBIDDEN_PROPS.test(u.prop)).map((u) => `${u.token} est lu dans « ${u.prop} », une propriété qui peut masquer ou déplacer du contenu`))];
    },
  },
  {
    id: "skin.demo", level: "mandatory", group: "skin",
    title: "L'aperçu du banc d'essai est un petit fragment HTML sans script",
    what: "Si « skin.demo » nomme un fichier, il existe à la racine du module, pèse 20 Ko au plus, ne contient ni script, ni gestionnaire d'évènement (onclick…), ni feuille de style, ni attribut style, ni adresse externe, ni cadre, et ne pose que les pièces déclarées par le module.",
    why: "Le banc d'essai affiche ce fragment pour qu'une personne qui écrit un skin voie la pièce sans installer le module. Il suit les mêmes règles qu'un bloc « html » : un fragment qui exécute du code ou charge un tiers serait une faille ; un fragment qui définit son propre style ne montrerait pas l'effet du skin.",
    fix: "Réduisez le fichier à du HTML simple (div, p, ul, li, a, img sans adresse externe…) avec les data-skin-part du module, des textes d'exemple neutres, et aucune mise en forme intégrée.",
    run(m) {
      const demo = hasSkin(m) ? m.manifest.skin.demo : undefined;
      if (demo === undefined) return { na: "le module ne fournit pas d'aperçu (le banc d'essai en fabriquera un)" };
      const file = path.resolve(m.dir, String(demo));
      if (!file.startsWith(m.dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return [`le fichier « ${demo} » (skin.demo) est introuvable à la racine du module`];
      const st = fs.statSync(file);
      const out = [];
      if (st.size > MAX_DEMO_BYTES) out.push(`« ${demo} » pèse ${(st.size / 1024).toFixed(1)} Ko : le maximum est 20 Ko`);
      const html = fs.readFileSync(file, "utf8");
      const rules = [
        [/<\s*script/i, "une balise script"], [/\son[a-z]+\s*=/i, "un gestionnaire d'évènement (onclick…)"], [/<\s*style/i, "une balise style"], [/\sstyle\s*=/i, "un attribut style"],
        [/<\s*(iframe|object|embed|link|meta|base|form|svg)\b/i, "une balise interdite (iframe, object, embed, link, meta, base, form, svg)"], [/javascript:|data:|vbscript:/i, "une adresse javascript:/data:"],
        [/(?:src|href|action|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i, "une adresse externe"], [/url\s*\(/i, "un url()"],
      ];
      for (const [re, label] of rules) if (re.test(html)) out.push(`« ${demo} » contient ${label}`);
      const declared = new Set((m.manifest.skin.parts ?? []).map((p) => p.id));
      for (const x of html.matchAll(/data-skin-part\s*=\s*["']([^"']*)["']/g)) if (!declared.has(x[1])) out.push(`« ${demo} » pose data-skin-part="${x[1]}", qui n'est pas une pièce de ce module`);
      return out;
    },
  },
  {
    id: "skin.tokensUsed", level: "advice", group: "skin",
    title: "Les jetons déclarés sont utilisés par le CSS du module",
    what: "Chaque jeton de « skin.parts[].tokens » est lu au moins une fois par le CSS du module (var(--sk-m-…)).",
    why: "Un jeton que rien ne lit promet aux personnes qui écrivent des skins un réglage qui ne fait rien.",
    fix: "Utilisez le jeton dans le CSS (avec sa chaîne de repli) ou retirez-le de module.json.",
    run(m) {
      if (!hasSkin(m)) return { na: "le module ne déclare pas de pièces de skin" };
      const read = new Set(readTokens(m).map((r) => r.name));
      return (m.manifest.skin.parts ?? []).flatMap((p) => (p.tokens ?? []).filter((t) => !read.has(t.name)).map((t) => `le jeton « ${t.name} » n'est lu nulle part dans le CSS du module`));
    },
  },
  {
    id: "skin.textPair", level: "advice", group: "skin",
    title: "Un jeton de couleur de texte dit sur quel fond il est posé",
    what: "Un jeton de couleur lu dans « color » (le texte) déclare « on » : le jeton de fond de la même pièce, pour que Curiosa contrôle la lisibilité du texte sur ce fond avec un skin.",
    why: "Sans cette paire, un skin pourrait poser un texte clair sur un fond clair dans la pièce du module sans que le contrôle de lisibilité automatique s'en aperçoive.",
    fix: "Ajoutez \"on\": \"--sk-m-<module>-<pièce>-bg\" au jeton de texte (le fond doit être un autre jeton de couleur du module).",
    run(m) {
      if (!hasSkin(m)) return { na: "le module ne déclare pas de pièces de skin" };
      const colorText = new Set(declarationsUsing(m, prefixOf(m)).filter((u) => u.prop === "color").map((u) => u.token));
      const tokens = (m.manifest.skin.parts ?? []).flatMap((p) => p.tokens ?? []);
      return tokens.filter((t) => t.type === "color" && colorText.has(t.name) && !t.on).map((t) => `le jeton « ${t.name} » colore du texte mais ne dit pas sur quel fond (« on »)`);
    },
  },
  {
    id: "skin.declare", level: "advice", group: "skin",
    title: "Un module qui met en forme une page publique déclare ses pièces de skin",
    what: "Le module qui a une page ou des sections avec sa propre mise en forme (CSS intégré) déclare une clé « skin » : ses pièces stylables et leurs jetons, avec leur valeur d'aujourd'hui en repli.",
    why: "Sans déclaration le module fonctionne à l'identique, mais un skin ne peut pas le restyler : ses rayons, ses espaces et ses ombres restent ceux du module quel que soit le skin choisi (docs/SKINS.md §8.5).",
    fix: "Suivez « Rendre un module stylable » dans docs/MODULES.md : remplacez les valeurs en dur par var(--sk-m-…, var(--sk-…, valeur-actuelle)), posez data-skin-part et déclarez-les dans « skin ». Ajoutez « minCore »: « 0.4.0 » et passez le module en version mineure (apparence inchangée).",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      if (hasSkin(m)) return [];
      const text = allText(m);
      const styled = /<style\b|(?:^|[\s`'"])\.[a-z][\w-]*\s*\{[^}]*\b(?:border-radius|padding|background|box-shadow)\s*:/m.test(text);
      const pub = m.manifest.page === true || !!m.manifest.content || (m.manifest.sections ?? []).length > 0;
      if (!styled || !pub) return { na: "le module n'a pas de mise en forme publique propre" };
      return ["le module met en forme une page ou des sections publiques mais ne déclare aucune pièce stylable (clé « skin »)"];
    },
  },
];
export default requirements;
