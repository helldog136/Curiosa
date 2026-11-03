// Exigences sur le fichier module.json et la compatibilité avec le cœur.
import fs from "node:fs";
import path from "node:path";
import { allSettings, compareVersions, missingLangs, stripComments } from "./util.mjs";

const MAX_BYTES = 10 * 1024 * 1024; // même plafond que l'installateur du cœur

/** `ctx.api.log.write(` sans `?.` et sans test visible de `ctx.api.log` (typeof, if, &&, ??) : plante sur un cœur d'avant la 0.6.0. */
function usesBareLogWrite(code) {
  if (!/\bapi\s*\.\s*log\s*\.\s*write\b/.test(code)) return false;
  return !/typeof\s+[\w.?]*\bapi\s*\??\.\s*log\b|\bif\s*\(\s*!?\s*[\w.?]*\bapi\s*\??\.\s*log\s*\)|\bapi\s*\??\.\s*log\s*(?:&&|\?\?|\|\|)|["']log["']\s+in\s+[\w.?]*\bapi\b/.test(code);
}

/** Une lecture de `ctx.timezone` qui ne prévoit pas son absence (ni `typeof`, ni `??`, `||`, `?`, ni comparaison) : sur un cœur d'avant la 0.6.4 elle vaut `undefined`. */
function usesBareTimezone(code) {
  if (/typeof\s+[\w.]*\bctx\s*\??\.\s*timezone\b|["']timezone["']\s+in\s+[\w.]*\bctx\b/.test(code)) return false;
  for (const hit of code.matchAll(/\bctx\s*\??\.\s*timezone\b(?!\s*:)/g)) {
    const after = code.slice(hit.index + hit[0].length, hit.index + hit[0].length + 12);
    if (!/^\s*(?:\?\?|\|\||\?[^.]|===|!==|==|!=)/.test(after)) return true;
  }
  return false;
}

/**
 * Version du cœur qui a apporté chaque fonction. Un module qui s'en sert doit déclarer `minCore` au moins égal, sinon un cœur plus ancien l'installe puis le
 * fait mal fonctionner (ou le refuse sans explication). Source : l'historique des versions du cœur (CHANGELOG.md).
 * Les fonctions d'avant la 0.1.10 ne sont pas listées : aucun site à jour n'a un cœur aussi ancien, une exigence là-dessus ne ferait que du bruit.
 * Volontairement ABSENTES : les clés de manifeste que le cœur plus ancien ignore sans rien perdre et que la documentation dit sans `minCore` à déclarer
 * (`previews` 0.6.1, `shortLink` 0.6.1, `social` 0.6.1, `suggestInMenu` 0.6.1, `returnAddresses` et `siteAddressUses` 0.6.2, `dashboard` 0.6.2, `content.templates` 0.6.3, `logEvents`
 * 0.6.0). En exiger un `minCore` exclurait des sites à jour pour rien. Déjà exigées ailleurs : `overlayElements` (0.5.0, par parseManifest). `catalogue/profiles.json`
 * est un fichier du dépôt de modules, pas d'un module. `advice: true` : conseil (exigence `compat.minCoreAdvice`) au lieu de `compat.minCore`.
 */
export const FEATURES = [
  // Cœur 0.6.4. `openEnded` : un cœur plus ancien refuse toute valeur ouverte et ne propose que deux dates. `ctx.timezone` : absent d'un cœur plus ancien, et l'oublier change
  // le jour au mauvais moment sans rien casser (d'où un simple conseil, et rien si le code teste la présence ou garde un repli).
  { since: "0.6.4", label: "« openEnded » sur une période (début seul ou fin seule)", test: (m, man) => allSettings(man).some((s) => s.openEnded !== undefined) || /\bopenEnded\s*:\s*true\b/.test(stripComments(m.code)) },
  { since: "0.6.4", advice: true, label: "ctx.timezone (fuseau du site) sans tester sa présence", test: (m) => usesBareTimezone(stripComments(m.code)) },
  // Cœur 0.6.0. `ctx.api.log` n'existe pas avant : l'appeler tel quel plante. `ctx.api.log?.write(…)` ou un test préalable ne sont pas signalés.
  { since: "0.6.0", label: "ctx.api.log.write (écrire au journal du cœur) sans tester que ctx.api.log existe", test: (m) => usesBareLogWrite(stripComments(m.code)) },
  { since: "0.6.0", label: "un réglage « period », « datetime » ou « duration » (période, date et heure, durée en un seul champ)", test: (m, man) => allSettings(man).some((s) => s.type === "period" || s.type === "datetime" || s.type === "duration") },
  { since: "0.6.0", label: "un réglage avec « min », « max », « step », « unit », « example », « rare » ou « display »", test: (m, man) => allSettings(man).some((s) => s.min !== undefined || s.max !== undefined || s.step !== undefined || s.unit !== undefined || s.example !== undefined || s.rare !== undefined || s.display !== undefined) },
  { since: "0.6.0", label: "un bloc du panneau avec un tableau enrichi (« searchable », « filters », cellule « badge » ou « switch », action « inMenu »)", test: (m) => /\bsearchable\s*:\s*true|\bfilters\s*:\s*\[\s*\{\s*column|\bbadge\s*:\s*["']|\binMenu\s*:\s*true|\bswitch\s*:\s*\{\s*on\b/.test(stripComments(m.code)) && /type\s*:\s*["']table["']/.test(stripComments(m.code)) },
  { since: "0.6.0", label: "un champ de formulaire « switch », « segmented », « period », « datetime » ou « duration », ou un champ « folded »", test: (m) => /\bkind\s*:\s*["'](?:switch|segmented|period|datetime|duration)["']|\bfolded\s*:\s*true/.test(stripComments(m.code)) },
  { since: "0.4.0", label: "« skin » dans module.json (pièces et jetons stylables par les skins)", test: (m, man) => man.skin !== undefined },
  { since: "0.2.14", label: "un réglage « multichoice » (plusieurs choix par cases à cocher)", test: (m, man) => allSettings(man).some((s) => s.type === "multichoice") },
  { since: "0.2.14", label: "« family » dans module.json (rangement choisi par le module)", test: (m, man) => man.family !== undefined },
  { since: "0.2.14", label: "« sitemapFromPage » dans module.json (chemins de la page ajoutés au plan du site)", test: (m, man) => man.sitemapFromPage !== undefined },
  { since: "0.2.14", label: "« robots: \"noindex\" » ou « sitemap » dans le résultat de page()", test: (m) => typeof m.definition?.page === "function" && /\b(robots\s*:\s*["']noindex["']|sitemap\s*:\s*[\[A-Za-z])/.test(stripComments(m.code)) },
  { since: "0.2.14", label: "une route à segment libre (« :slug » dans routes, ctx.params.slug)", test: (m) => Object.keys(m.definition?.routes ?? {}).some((k) => k === ":slug" || k.endsWith("/:slug")) || /\bparams\s*\??\.\s*slug\b/.test(stripComments(m.code)) },
  { since: "0.2.13", label: "la permission « files » (ctx.api.files : revendiquer et supprimer les fichiers envoyés)", test: (m, man) => (man.permissions ?? []).includes("files") || /\bapi\s*\??\.\s*files\b/.test(stripComments(m.code)) },
  { since: "0.2.12", label: "« pageSetting » (page facultative, allumée par un réglage booléen)", test: (m, man) => man.pageSetting !== undefined },
  { since: "0.2.12", label: "la permission « visitor.geolocation » (demander la position de la personne qui visite)", test: (m, man) => (man.permissions ?? []).includes("visitor.geolocation") },
  { since: "0.2.10", label: "ctx.api.rawg.candidates (jeux proposés pour un titre)", test: (m) => /\bapi\s*\??\.\s*rawg\s*\??\.\s*candidates\b/.test(stripComments(m.code)) },
  { since: "0.2.6", label: "ctx.api.visitor.fingerprint (empreinte de la personne qui visite)", test: (m) => /\bapi\s*\??\.\s*visitor\b/.test(stripComments(m.code)) },
  { since: "0.2.6", label: "la permission « privacy » (ctx.api.privacy.declarations)", test: (m, man) => (man.permissions ?? []).includes("privacy") || /\bapi\s*\??\.\s*privacy\b/.test(stripComments(m.code)) },
  { since: "0.2.6", label: "un script rattaché à la page (« scripts » dans le résultat de page())", test: (m) => /\bscripts\s*:\s*\[/.test(stripComments(m.code)) && typeof m.definition?.page === "function" },
  {
    since: "0.2.5", label: "un bloc du panneau placé dans un onglet (« tab » sur un bloc de adminPanel, ou « panel » sur un onglet)",
    test: (m, man) => {
      if ((man.tabs ?? []).some((t) => t && t.panel !== undefined)) return true;
      // Un cœur plus ancien ignore la clé : le bloc resterait dans Utiliser. On cherche « tab: "<onglet>" » (onglets du cœur ou déclarés) dans le code.
      const ids = ["settings", "sources", "general", ...(man.tabs ?? []).map((t) => t && t.id).filter(Boolean)];
      return new RegExp(`\\btab\\s*:\\s*["'\`](?:${ids.map((i) => String(i).replace(/[^\w-]/g, "")).join("|")})["'\`]`).test(stripComments(m.code));
    },
  },
  { since: "0.2.2", label: "des onglets (« tabs », ou « tab » sur un réglage)", test: (m, man) => (man.tabs ?? []).length > 0 || (man.settings ?? []).some((s) => s.tab !== undefined) },
  { since: "0.2.0", label: "un réglage « choice » (choix parmi) ou ctx.resolveChoice", test: (m, man) => allSettings(man).some((s) => s.type === "choice") || /\bresolveChoice\b/.test(stripComments(m.code)) },
  { since: "0.1.22", label: "un réglage « optional » (facultatif)", test: (m, man) => allSettings(man).some((s) => s.optional !== undefined) },
  { since: "0.1.16", label: "des « seeds » / ctx.seedInstance (créer une instance depuis une migration)", test: (m, man) => (man.seeds ?? []).length > 0 || /\bseedInstance\b/.test(stripComments(m.code)) },
  { since: "0.1.16", label: "un champ « datetime » dans un sujet consommé", test: (m, man) => (man.consumes ?? []).some((c) => (c.schema ?? []).some((f) => f.type === "datetime")) },
  { since: "0.1.16", label: "une période (from/to) demandée à ctx.api.topics.collect", test: (m) => /\bcollect\s*\([^)]*\{[^}]*\b(from|to)\b/.test(stripComments(m.code)) },
  { since: "0.1.16", label: "ctx.api.seo.jsonLd (données structurées)", test: (m) => /\bseo\s*\.\s*jsonLd\b/.test(stripComments(m.code)) },
  { since: "0.1.14", label: "un service « each » / ctx.api.services.callAll", test: (m, man) => (man.offers ?? []).some((o) => o.each) || /\bcallAll\b/.test(stripComments(m.code)) },
  { since: "0.1.10", label: "la permission « rawg » (jaquettes de jeux)", test: (m, man) => (man.permissions ?? []).includes("rawg") || /\bapi\s*\??\.\s*rawg\b(?!\.io\b)/.test(stripComments(m.code)) },
];

/** Les fonctions de FEATURES retenues par `keep` que le module utilise sans le `minCore` qu'il faut. */
function minCoreProblems(m, keep) {
  if (!m.parsed?.ok && !m.manifest) return { skip: "module.json illisible" };
  const man = m.parsed?.ok ? m.parsed.manifest : m.manifest;
  const need = FEATURES.filter((f) => keep(f) && (() => { try { return f.test(m, man); } catch { return false; } })());
  if (!need.length) return { na: "aucune fonction récente du cœur n'est utilisée" };
  const out = [];
  for (const f of need) {
    if (!man.minCore) out.push(`le module utilise ${f.label} (cœur ${f.since} ou plus) mais ne déclare pas « minCore »: « ${f.since} »`);
    else if (/^\d+\.\d+\.\d+$/.test(man.minCore) && compareVersions(man.minCore, f.since) < 0) out.push(`le module utilise ${f.label} (cœur ${f.since} ou plus) mais « minCore » vaut ${man.minCore}`);
  }
  return out;
}

const requirements = [
  {
    id: "manifest.file", level: "mandatory", group: "manifest",
    title: "Le dossier du module est complet",
    what: "Le dossier contient un module.json lisible à sa racine, le fichier principal annoncé par « main », aucun lien symbolique, et pèse moins de 10 Mo.",
    why: "Le cœur installe un module en lisant son dossier tel quel. Sans module.json à la racine, avec un fichier principal manquant, des liens symboliques ou plus de 10 Mo, l'installation est refusée.",
    fix: "Placez module.json à la racine du dossier (pas dans un sous-dossier), vérifiez que « main » nomme un fichier qui existe, remplacez les liens symboliques par de vrais fichiers et retirez les gros fichiers inutiles.",
    run(m) {
      const out = m.loadErrors.filter((e) => ["dir", "manifest-missing", "manifest-json", "main-missing"].includes(e.kind)).map((e) => e.message);
      for (const l of m.symlinks) out.push(`« ${l} » est un lien symbolique : ils sont refusés à l'installation`);
      if (m.bytes > MAX_BYTES) out.push(`le dossier pèse ${(m.bytes / 1048576).toFixed(1)} Mo : le maximum accepté est 10 Mo`);
      return out;
    },
  },
  {
    id: "manifest.valid", level: "mandatory", group: "manifest",
    title: "module.json est valide",
    what: "Le manifeste passe la même validation que celle du cœur à l'installation (parseManifest) : champs connus, types corrects, valeurs dans les limites.",
    why: "Un manifeste invalide est refusé à l'installation : le module n'apparaît pas dans le catalogue et ne peut pas être essayé.",
    fix: "Lisez le message : il donne le champ fautif (par exemple « settings.2.key »). Comparez avec docs/MODULES.md, section « Le manifeste module.json », et corrigez ce champ.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible (voir « manifest.file »)" };
      // La version de l'API a sa propre exigence (compat.apiVersion) : ici on valide tout le reste.
      const r = m.core.parseManifest(JSON.parse(JSON.stringify({ ...m.manifest, apiVersion: m.core.apiVersion })));
      return r.ok ? [] : [r.error];
    },
  },
  {
    id: "manifest.version", level: "mandatory", group: "manifest",
    title: "La version est au format x.y.z",
    what: "Le champ « version » est faite de trois nombres séparés par des points (1.0.0, 0.3.12), sans suffixe.",
    why: "Les mises à jour comparent les versions pour savoir ce qui est plus récent. Un autre format (v1, 1.0, 1.0.0-beta) ne se compare pas correctement.",
    fix: "Écrivez par exemple « version »: « 1.0.0 », et augmentez-la à chaque nouvelle publication.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      return typeof m.manifest.version === "string" && /^\d+\.\d+\.\d+$/.test(m.manifest.version) ? [] : [`la version est « ${m.manifest.version ?? "(absente)"} » : il faut trois nombres, comme 1.0.0`];
    },
  },
  {
    id: "manifest.id", level: "advice", group: "manifest",
    title: "L'identifiant correspond au nom du dossier",
    what: "Le champ « id » est identique au nom du dossier du module.",
    why: "Quand plusieurs modules vivent dans un même dépôt (un dossier chacun), retrouver un module par son dossier évite les confusions. Les dépôts de modules reconnus l'exigent.",
    fix: "Renommez le dossier comme l'« id », ou l'« id » comme le dossier (attention : l'« id » ne doit plus changer une fois le module publié).",
    run(m) {
      if (!m.manifest?.id) return { skip: "pas d'id lisible" };
      return m.manifest.id === m.name ? [] : [`l'id est « ${m.manifest.id} » mais le dossier s'appelle « ${m.name} »`];
    },
  },
  {
    id: "manifest.previews", level: "mandatory", group: "manifest",
    title: "Les visuels de la fiche sont des images valables",
    what: "Chaque visuel de « previews » (6 au plus) est un fichier « previews/….webp » ou « .png » du module : 150 Ko au plus, de vraies images (pas un autre format renommé), de 240 à 2400 pixels de côté, avec une légende et un texte alternatif en français et en anglais. Sans « previews », rien à vérifier.",
    why: "Le cœur lit ces images lui-même et les montre dans la fiche du module, avant et après l'installation. Une image trop lourde, d'un autre format ou absente est simplement écartée : la fiche paraît alors incomplète à la personne qui hésite à installer.",
    fix: "Exportez chaque capture en WebP (ou PNG) de moins de 150 Ko, rangez-la dans « previews/ », déclarez-la dans « previews » avec « file », « caption », « alt » et « type » (public, admin ou overlay). Ne montrez jamais de vraies données personnelles : utilisez des exemples inventés.",
    async run(m) {
      const man = m.parsed?.ok ? m.parsed.manifest : m.manifest;
      const decls = man?.previews;
      if (!Array.isArray(decls) || decls.length === 0) return { na: "le module ne déclare aucun visuel" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const { checkPreviewImage, PREVIEW_LIMITS } = await import("@/core/modules/previews");
      const why = { "too-large": `plus de ${PREVIEW_LIMITS.bytes / 1024} Ko`, type: "ce n'est pas un vrai WebP ou PNG (ou l'extension ne correspond pas au contenu)", corrupt: "fichier abîmé", dimensions: `dimensions hors de ${PREVIEW_LIMITS.minSide} à ${PREVIEW_LIMITS.maxSide} pixels` };
      const out = [];
      for (const d of decls) {
        const full = path.join(m.dir, d.file);
        try {
          const st = fs.lstatSync(full);
          if (!st.isFile()) { out.push(`« ${d.file} » n'est pas un fichier ordinaire`); continue; }
          if (st.size > PREVIEW_LIMITS.bytes) { out.push(`« ${d.file} » pèse ${Math.ceil(st.size / 1024)} Ko : le maximum est ${PREVIEW_LIMITS.bytes / 1024} Ko`); continue; }
          const c = checkPreviewImage(fs.readFileSync(full), d.file);
          if (!c.ok) out.push(`« ${d.file} » : ${why[c.problem]}`);
        } catch { out.push(`« ${d.file} » est déclaré dans « previews » mais le fichier n'existe pas`); }
      }
      return out;
    },
  },
  {
    id: "manifest.imageHosts", level: "mandatory", group: "manifest",
    title: "Les hôtes d'images déclarés sont de simples noms d'hôte",
    what: "« imageHosts » (5 au plus) liste des noms d'hôte exacts en minuscules (« media.example.org ») : pas de joker, d'adresse complète, de port, d'adresse numérique ni de nom interne, et aucun nom en double. Sans « imageHosts », rien à vérifier.",
    why: "Le cœur n'affiche une vignette de tableau (cellule « image ») que si son adresse est une page du site ou vient d'un hôte déclaré ici. Un hôte mal écrit n'est jamais reconnu : les vignettes disparaîtraient sans bruit, ou le cœur refuserait le manifeste.",
    fix: "Écrivez seulement le nom : « media.rawg.io », pas « https://media.rawg.io/ » ni « *.rawg.io ». Pour ne contacter aucun hôte, retirez « imageHosts » et enregistrez l'image sur le site (« /uploads/… »).",
    async run(m) {
      const hosts = m.manifest?.imageHosts;
      if (hosts === undefined) return { na: "le module ne déclare aucun hôte d'images" };
      if (!Array.isArray(hosts)) return ["« imageHosts » doit être une liste de noms d'hôte"];
      const { isDeclarableImageHost, MAX_IMAGE_HOSTS } = await import("@/core/adminkit/image");
      const out = [];
      if (hosts.length > MAX_IMAGE_HOSTS) out.push(`${hosts.length} hôtes déclarés : ${MAX_IMAGE_HOSTS} au plus`);
      for (const h of hosts) if (!isDeclarableImageHost(h)) out.push(`« ${String(h).slice(0, 80)} » n'est pas un nom d'hôte valable (exemple : media.example.org)`);
      if (new Set(hosts).size !== hosts.length) out.push("un même hôte est déclaré deux fois");
      return out;
    },
  },
  {
    id: "manifest.catalogue", level: "advice", group: "manifest",
    title: "La fiche du module est complète pour le catalogue",
    what: "Le module a un nom et une description en français et en anglais, le nom de la personne qui l'a écrit et une licence.",
    why: "Le catalogue affiche cette fiche avant l'installation. Une description manquante ou dans une seule langue laisse les personnes qui visitent du catalogue sans explication.",
    fix: "Ajoutez « description »: { « fr »: « … », « en »: « … » }, « author » et « license » (MIT, propriétaire…) dans module.json.",
    run(m) {
      const man = m.manifest;
      if (!man) return { skip: "module.json illisible" };
      const out = [];
      for (const l of missingLangs(man.name)) out.push(`le nom n'a pas de version ${l === "fr" ? "française" : "anglaise"}`);
      if (man.description === undefined) out.push("il n'y a pas de description");
      else for (const l of missingLangs(man.description)) out.push(`la description n'a pas de version ${l === "fr" ? "française" : "anglaise"}`);
      if (!man.author) out.push("la personne qui a écrit le module n'est pas indiquée (« author »)");
      if (!man.license) out.push("la licence n'est pas indiquée (« license »)");
      return out;
    },
  },
  {
    id: "compat.apiVersion", level: "mandatory", group: "compat",
    title: "Le module vise la bonne version de l'API des modules",
    what: "« apiVersion » vaut la version de l'API des modules que parle ce cœur.",
    why: "Un module d'une autre version d'API est refusé plutôt que cassé. C'est la promesse du cœur : tant que la version est la même, le module continue de fonctionner quand le cœur évolue.",
    fix: "Mettez « apiVersion » à la valeur indiquée dans le message. Si le cœur a changé d'API, lisez CHANGELOG.md : les changements à faire y sont décrits.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      return m.manifest.apiVersion === m.core.apiVersion ? [] : [`apiVersion vaut ${JSON.stringify(m.manifest.apiVersion)} mais ce cœur (version ${m.core.version}) parle la version ${m.core.apiVersion}`];
    },
  },
  {
    id: "compat.minCore", level: "mandatory", group: "compat",
    title: "minCore couvre les fonctions du cœur utilisées",
    what: "Si le module utilise une fonction apportée par une version récente du cœur (par exemple « optional » : 0.1.22), « minCore » est au moins cette version.",
    why: "Sans « minCore », un site dont le cœur est plus ancien installe quand même le module, et celui-ci se comporte mal (réglage qui n'existe pas, manifeste refusé…). Avec « minCore », le site répond clairement « mettez d'abord le site à jour ».",
    fix: "Ajoutez dans module.json « minCore »: « x.y.z » avec la version indiquée dans le message (trois nombres, rien d'autre).",
    run(m) { return minCoreProblems(m, (f) => !f.advice); },
  },
  {
    id: "compat.minCoreAdvice", level: "advice", group: "compat",
    title: "minCore couvre aussi les nouveautés qu'un cœur plus ancien lit de travers",
    what: "Si le module lit une nouveauté du cœur qu'un cœur plus ancien n'a pas et ne signale pas (par exemple « ctx.timezone » : cœur 0.6.4) sans prévoir son absence, « minCore » est au moins cette version.",
    why: "Rien ne plante : sur un cœur plus ancien la valeur manque, le module retombe sur autre chose et change de jour à la mauvaise heure, sans que personne ne le voie. Avec « minCore », le site répond « mettez d'abord le site à jour », ou le module garde un repli volontaire.",
    fix: "Soit ajoutez « minCore »: « x.y.z » avec la version indiquée dans le message, soit gardez un repli visible dans le code : `typeof ctx.timezone === \"string\" ? ctx.timezone : repli`, ou `ctx.timezone ?? repli`.",
    run(m) { return minCoreProblems(m, (f) => f.advice === true); },
  },
  {
    id: "compat.minCoreKnown", level: "advice", group: "compat",
    title: "minCore n'est pas plus récent que ce cœur",
    what: "« minCore » n'est pas supérieur à la version du cœur qui vérifie le module.",
    why: "Si « minCore » dépasse le cœur sur lequel vous testez, ce module ne peut pas s'y installer : vous ne pourriez pas l'essayer.",
    fix: "Baissez « minCore » à la plus petite version qui apporte ce dont le module a besoin, ou testez avec un cœur à jour.",
    run(m) {
      const mc = m.manifest?.minCore;
      if (!mc) return { na: "pas de minCore" };
      return /^\d+\.\d+\.\d+$/.test(mc) && compareVersions(mc, m.core.version) > 0 ? [`minCore vaut ${mc} mais ce cœur est en ${m.core.version}`] : [];
    },
  },
];
export default requirements;

