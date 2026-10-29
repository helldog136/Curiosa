// Exigences sur les langues, les réglages, les mots employés et la documentation.
import fs from "node:fs";
import path from "node:path";
import { localeProblems, settingsProblems } from "../builtinChecks.mjs";
import { observe, CANARY } from "../probes.mjs";
import { CORE_DIR } from "../core.mjs";
import { allSettings, CHOICE_RULES_LEVEL, missingLangs, stripComments, texts, whereOf } from "./util.mjs";

/** Onglets de la page d'admin (cœur 0.2.2, voir src/core/modules/tabs.ts) : ceux du cœur, et ce que le kit CONSEILLE en plus. */
const BUILTIN_TAB_IDS = ["use", "settings", "sources", "general"];
const MAX_ADDED_TABS = 3;
const TAB_NAME_MAX = 20;
const SAYS_OPTIONAL = /facultatif|optionnel|\boptional\b/i;
/**
 * Un texte d'aide qui demande de TAPER LE NOM d'une chose qui existe déjà (« saisissez le nom de la chaîne », « type the channel name », « tapez ici la chaîne
 * (identifiant) d'une autre instance »). Heuristique de la règle settings.textNamesExisting.
 */
export const NAMES_EXISTING = /\b(?:saisissez|tapez|indiquez|écrivez|entrez)\s+(?:ici\s+)?(?:le|la|l['’])\s*(?:nom|identifiant|pseudo|chaîne|catégorie|page|agenda)\b|\b(?:type|enter|write)\s+(?:here\s+)?the\s+(?:exact\s+)?(?:name\s+of\b|[\w-]+\s+(?:\()?(?:name|login)\b|(?:channel|category|page|calendar)\b)/i;
/** Clés de profils EXTERNES (un pseudo sur une autre plateforme n'existe pas sur le site) : jamais signalées par settings.textNamesExisting. */
const EXTERNAL_KEYS = ["profile", "channelId"];
/** Mots techniques interdits dans ce que lit une personne sans bagage technique (mode simple de l'administration). Réunit les listes des tests des modules. */
export const JARGON = /\b(sujets?|m[ée]triques?|collecteurs?|collector|topics?|metrics?|api|json|sch[ée]mas?|endpoint|payload|jetons?|tokens?|oauth|scope|quota|http|mcp|ctx|prisma|overlay\.item|feed\.item)\b/i;
/** Un texte sans ses adresses d'exemple (« https://monnom.bandcamp.com » n'est pas du jargon). */
const noUrls = (t) => String(t).replace(/\bhttps?:\/\/\S+/gi, " ");

/** Textes que voit une personne en mode simple : nom, description, sections, réglages non avancés (libellés, aides, options). */
function visibleTexts(man) {
  const out = [["le nom", texts(man.name)], ["la description", texts(man.description)]];
  for (const s of man.sections ?? []) out.push([`la section « ${s.id} »`, texts(s.label)]);
  for (const s of allSettings(man)) if (!s.advanced) out.push([s.where, [...texts(s.label), ...texts(s.help), ...(s.options ?? []).flatMap((o) => texts(o.label))]]);
  for (const g of man.optionalGroups ?? []) out.push([`le groupe « ${g.id} »`, [...texts(g.label), ...texts(g.addLabel), ...texts(g.removeLabel)]]);
  return out;
}

const requirements = [
  {
    id: "i18n.manifest", level: "mandatory", group: "i18n",
    title: "Les textes de module.json existent en français et en anglais",
    what: "Le nom, la description, les libellés de sections, les libellés et aides de réglages (et leurs options) sont fournis en français ET en anglais.",
    why: "Le site est multilingue : un texte absent dans la langue de la personne qui visite ou de la personne qui gère le site s'affiche vide ou dans la mauvaise langue.",
    fix: "Remplacez chaque texte seul par { « fr »: « … », « en »: « … » } dans module.json.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const man = m.manifest;
      const out = [];
      const check = (where, value, required = true) => { if (value === undefined && !required) return; for (const l of missingLangs(value)) out.push(`${where} : texte ${l === "fr" ? "français" : "anglais"} manquant`); };
      check("le nom", man.name);
      check("la description", man.description, false);
      for (const s of man.sections ?? []) check(`la section « ${s.id} » (libellé)`, s.label);
      for (const s of allSettings(man)) {
        check(`${s.where} (libellé)`, s.label);
        check(`${s.where} (aide)`, s.help, false);
        for (const o of s.options ?? []) check(`${s.where}, option « ${o.value} »`, o.label);
      }
      for (const g of man.optionalGroups ?? []) { check(`le groupe « ${g.id} » (libellé)`, g.label); check(`le groupe « ${g.id} » (bouton)`, g.addLabel); }
      for (const c of man.consumes ?? []) check(`le sujet consommé « ${c.topic} » (libellé)`, c.label);
      for (const p of man.privacy ? [man.privacy] : []) check("la déclaration de vie privée", p);
      return out;
    },
  },
  {
    id: "i18n.parity", level: "mandatory", group: "i18n",
    title: "Les fichiers de langue fr et en sont alignés",
    what: "Si le module a un dossier locales/, il contient fr.json ET en.json avec exactement les mêmes clés, les mêmes variables {x} dans chaque phrase, et aucune traduction vide. Un code qui appelle ctx.t() doit avoir ce dossier.",
    why: "Une clé qui n'existe que dans une langue affiche la clé brute (« err_config ») à la personne qui visite. Une variable oubliée donne des phrases à trous (« Bonjour  »).",
    fix: "Ajoutez la clé manquante dans l'autre fichier, avec les mêmes {variables}. Gardez les deux fichiers triés pareil pour les comparer à l'œil.",
    run(m) {
      const out = [...m.loadErrors.filter((e) => e.kind === "locale-json").map((e) => e.message), ...localeProblems(m.locales)];
      if (!Object.keys(m.locales).length && /\bctx\s*\.\s*t\s*\(|[^.\w]t\(\s*["'`]/.test(stripComments(m.code))) out.push("le code appelle ctx.t() mais le module n'a pas de dossier locales/ (fr.json et en.json)");
      if (!Object.keys(m.locales).length && !out.length) return { na: "le module n'a pas de textes à traduire (pas de locales/)" };
      return out;
    },
  },
  {
    id: "i18n.keys", level: "mandatory", group: "i18n",
    title: "Toutes les clés de traduction utilisées existent",
    what: "Chaque ctx.t(\"clé\") du code correspond à une clé présente dans fr.json et en.json.",
    why: "Une clé inconnue s'affiche telle quelle à l'écran (« err_hidden ») au lieu d'une phrase.",
    fix: "Ajoutez la clé dans fr.json et en.json (ou corrigez la faute de frappe dans le code).",
    run(m) {
      const code = stripComments(m.code);
      const used = new Set();
      const prefixes = new Set();
      for (const x of code.matchAll(/(?:\bctx\s*\.\s*t|[^.\w$]t)\(\s*["']([A-Za-z0-9_.-]+)["']/g)) used.add(x[1]);
      for (const x of code.matchAll(/(?:\bctx\s*\.\s*t|[^.\w$]t)\(\s*`([A-Za-z0-9_.-]*)\$\{/g)) prefixes.add(x[1]);
      if (!used.size && !prefixes.size) return { na: "le code n'appelle pas ctx.t()" };
      if (!Object.keys(m.locales).length) return { skip: "pas de dossier locales/ (voir « i18n.parity »)" };
      const out = [];
      for (const k of used) {
        if (k.includes(".")) continue; // clé du cœur (« common.save »…) : fournie par le site
        for (const l of ["fr", "en"]) if (m.locales[l] && !(k in m.locales[l])) out.push(`la clé « ${k} » est utilisée dans le code mais absente de locales/${l}.json`);
      }
      for (const p of prefixes) if (p && !Object.keys(m.locales.fr ?? {}).some((k) => k.startsWith(p))) out.push(`aucune clé ne commence par « ${p} » (clés construites par le code)`);
      return out;
    },
  },
  {
    id: "i18n.unused", level: "advice", group: "i18n",
    title: "Pas de traduction inutilisée",
    what: "Chaque clé des fichiers de langue est utilisée quelque part dans le code.",
    why: "Les clés oubliées alourdissent les fichiers et laissent croire qu'un texte existe alors qu'il n'est plus affiché.",
    fix: "Supprimez les clés citées des deux fichiers de langue (après vérification qu'aucun code ne les construit dynamiquement).",
    run(m) {
      if (!m.locales.fr && !m.locales.en) return { na: "pas de locales/" };
      const code = m.code;
      const dynamic = [...stripComments(code).matchAll(/`([A-Za-z0-9_.-]+)\$\{/g)].map((x) => x[1]);
      return Object.keys(m.locales.fr ?? m.locales.en).filter((k) => !code.includes(`"${k}"`) && !code.includes(`'${k}'`) && !dynamic.some((p) => p && k.startsWith(p)) && !new RegExp(`\\b${k}\\b`).test(code)).map((k) => `la clé « ${k} » n'est utilisée nulle part`);
    },
  },
  {
    id: "settings.sane", level: "mandatory", group: "settings",
    title: "Les réglages sont bien formés",
    what: "Chaque réglage a une clé unique, un libellé en français et en anglais ; une liste a des options et un défaut qui en fait partie ; un secret n'a jamais de valeur par défaut ; le défaut a le bon type (nombre pour un nombre, couleur #RRGGBB pour une couleur…).",
    why: "Ce sont les champs que la personne qui gère le site remplit. Un défaut hors liste ou d'un mauvais type donne un formulaire cassé ou un module qui démarre sur une valeur absurde ; un secret avec un défaut serait publié avec le code.",
    fix: "Corrigez le réglage cité dans module.json.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const man = m.manifest;
      const out = settingsProblems(man);
      for (const s of allSettings(man)) {
        const d = s.default;
        if (d === undefined) continue;
        if (s.type === "number" && typeof d !== "number") out.push(`${s.where} : le défaut d'un nombre doit être un nombre`);
        if (s.type === "boolean" && typeof d !== "boolean") out.push(`${s.where} : le défaut d'une case à cocher doit être vrai ou faux`);
        if (s.type === "color" && typeof d === "string" && !/^#[0-9a-fA-F]{6}$/.test(d) && !d.startsWith("theme:")) out.push(`${s.where} : le défaut d'une couleur doit être #RRGGBB (ou « theme:accent »)`);
      }
      return out;
    },
  },
  {
    id: "tabs.reasonable", level: "advice", group: "settings",
    title: "Les onglets ajoutés restent peu nombreux et bien nommés",
    what: `Si le module déclare « tabs » (cœur 0.2.2) : au plus ${MAX_ADDED_TABS} onglets ajoutés en plus des quatre onglets du cœur (Utiliser, Réglages, Sources, Général), et chaque nom d'onglet (ajouté ou renommé) est court (${TAB_NAME_MAX} caractères au plus) et existe en français ET en anglais.`,
    why: "Sur un téléphone, la rangée d'onglets défile : au-delà de six ou sept onglets, ou avec des noms longs, on ne voit plus où l'on est et on cherche le bon onglet. Un nom dans une seule langue laisse la moitié des personnes qui gèrent le site devant un mot qu'elles ne lisent pas.",
    fix: "Regroupez les réglages proches dans un même onglet (« tab » d'un réglage), raccourcissez les noms (« Vidéo », « Ma liste », « Créneaux ») et donnez « label »: { « fr »: « … », « en »: « … » }.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const tabs = Array.isArray(m.manifest.tabs) ? m.manifest.tabs : [];
      if (!tabs.length) return []; // les onglets du cœur : raisonnables par construction
      const out = [];
      const added = tabs.filter((t) => t && !BUILTIN_TAB_IDS.includes(t.id));
      if (added.length > MAX_ADDED_TABS) out.push(`${added.length} onglets ajoutés (${added.map((t) => t.id).join(", ")}) : ${MAX_ADDED_TABS} au plus, regroupez des réglages`);
      for (const t of tabs) {
        if (!t || t.label === undefined) continue;
        if (typeof t.label === "string") { out.push(`onglet « ${t.id} » : le nom n'existe que dans une langue (donnez { "fr": …, "en": … })`); continue; }
        for (const l of missingLangs(t.label)) out.push(`onglet « ${t.id} » : le nom n'a pas de version ${l === "fr" ? "française" : "anglaise"}`);
        for (const [l, v] of Object.entries(t.label)) if (typeof v === "string" && v.trim().length > TAB_NAME_MAX) out.push(`onglet « ${t.id} » : le nom ${l} « ${v} » est long (${v.trim().length} caractères, ${TAB_NAME_MAX} au plus conseillés)`);
      }
      return out;
    },
  },
  {
    id: "settings.optional", level: "mandatory", group: "settings",
    title: "Un réglage « facultatif » le déclare",
    what: "Quand le libellé ou l'aide d'un réglage dit « facultatif », « optionnel » ou « optional », le réglage porte \"optional\": true.",
    why: "Sans cela, le site compte le réglage vide comme « à remplir » et affiche l'extension « À configurer » alors que tout va bien : la personne qui gère le site croit qu'elle doit encore faire quelque chose.",
    fix: "Ajoutez \"optional\": true au réglage cité (et \"minCore\": \"0.1.22\" au module), ou retirez le mot « facultatif » du texte si le réglage est en réalité obligatoire.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      return allSettings(m.manifest).filter((s) => !s.optional && SAYS_OPTIONAL.test(JSON.stringify([s.label, s.help]))).map((s) => `${s.where} dit « facultatif » mais ne déclare pas "optional": true`);
    },
  },
  {
    id: "settings.advanced", level: "mandatory", group: "settings",
    title: "Les réglages « advanced » ont une valeur par défaut",
    what: "Un réglage marqué \"advanced\": true (nombre, liste ou couleur) a une valeur par défaut raisonnable.",
    why: "Les réglages avancés sont cachés en mode simple : la personne ne les voit jamais, c'est donc le défaut qui s'applique. Sans défaut, le module démarre sur du vide.",
    fix: "Ajoutez \"default\" au réglage cité, ou retirez \"advanced\": true s'il doit être rempli par la personne.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      return allSettings(m.manifest).filter((s) => s.advanced && s.default === undefined && ["number", "select", "color", "boolean"].includes(s.type) && !s.optional).map((s) => `${s.where} est avancé mais n'a pas de valeur par défaut`);
    },
  },
  {
    id: "settings.refersToChoice", level: CHOICE_RULES_LEVEL, group: "settings",
    title: "Un réglage qui désigne un élément existant est un « choix parmi »",
    what: "Un réglage qui déclare « refersTo » (une catégorie, une chaîne, une page, un agenda…) autre que « external » est de type « choice » : la personne choisit dans une liste, elle ne tape pas un nom. Conseil dans le cœur 0.2.0 ; deviendra obligatoire.",
    why: "Un nom tapé à la main casse dès que l'élément est renommé, ne voit pas qu'il a été supprimé, et laisse passer les fautes de frappe. Un « choix parmi » garde un identifiant stable, se cache quand il n'y a qu'une option et signale un élément disparu.",
    fix: "Passez le réglage en « type »: « choice » avec une « source » (« providers » pour une instance qui offre un service, « service » pour un élément d'un autre module), « fromText »: true pour reprendre les valeurs déjà tapées, et « minCore »: « 0.2.0 ». Pour un profil sur une autre plateforme, écrivez « refersTo »: « external ».",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const named = allSettings(m.manifest).filter((s) => s.refersTo !== undefined);
      return named.filter((s) => s.refersTo !== "external" && s.type !== "choice").map((s) => `${s.where} désigne un élément existant (refersTo « ${s.refersTo} ») mais est de type « ${s.type} » : utilisez « choice »`);
    },
  },
  {
    id: "settings.textNamesExisting", level: CHOICE_RULES_LEVEL, group: "settings",
    title: "On ne fait pas taper le nom d'un élément qui existe déjà",
    what: "Un réglage texte dont l'aide demande de « saisir le nom de… » (« type the name of… », « type the channel name ») un élément du site déclare « refersTo » ; s'il désigne un élément du site, c'est un « choice ». Les profils externes (« profile », « channelId », et « channel » dans un module de type « social ») ne sont pas concernés ; « refersTo »: « external » fait taire la règle.",
    why: "La personne doit retrouver et recopier un nom exact, qui casse au premier renommage. Une liste où l'on choisit est plus simple, et le module reçoit un identifiant qui ne change jamais.",
    fix: "Remplacez le réglage par un « choice » (même clé, « fromText »: true pour convertir les valeurs déjà saisies, « minCore »: « 0.2.0 »). Si c'est un profil sur une autre plateforme (un pseudo, une adresse), ajoutez « refersTo »: « external ».",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const social = m.manifest.type === "social";
      return allSettings(m.manifest)
        .filter((s) => (s.type === "text" || s.type === "textarea") && s.refersTo === undefined)
        .filter((s) => !EXTERNAL_KEYS.includes(s.key) && !(social && s.key === "channel"))
        .filter((s) => [...texts(s.label), ...texts(s.help)].some((x) => NAMES_EXISTING.test(x)))
        .map((s) => `${s.where} fait taper le nom d'un élément existant : un « choice » (ou « refersTo »: « external » pour un profil externe)`);
    },
  },
  {
    id: "secrets.hidden", level: "mandatory", group: "settings",
    title: "Les secrets ne s'affichent ni ne se journalisent jamais",
    what: "Une valeur de réglage « secret » (clé d'API, mot de passe, code) ne ressort dans aucune page, section, overlay, panneau d'administration, réponse de route, résultat MCP, message d'erreur ni journal. Le test donne une valeur-piège au secret et cherche où elle réapparaît.",
    why: "Une page publique, un journal ou une réponse MCP qui contient un secret le livre à n'importe qui. Un secret ne sert qu'à parler au service qui l'a émis.",
    fix: "Ne mettez jamais la valeur du secret dans un bloc, un message, une réponse ou console.log. Affichez plutôt « enregistré » / « manquant ». Un message d'erreur court suffit.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const secrets = allSettings(m.parsed.manifest).filter((s) => s.type === "secret");
      if (!secrets.length) return { na: "le module n'a pas de réglage secret" };
      const out = [];
      for (const s of secrets) if (s.translatable) out.push(`${s.where} : un secret ne doit pas être traduisible`);
      const obs = await observe(m);
      for (const [name, run] of Object.entries(obs.runs)) {
        if (name === "defaults") continue;
        for (const o of run.outputs) {
          const hay = o.ok ? JSON.stringify(o.value ?? null) : o.error;
          if (hay && hay.includes(CANARY)) out.push(`la valeur d'un secret réapparaît dans ${whereOf(o)}`);
        }
        for (const line of run.console) if (line.includes(CANARY)) out.push(`la valeur d'un secret est écrite dans le journal : « ${line.slice(0, 80)} »`);
      }
      return [...new Set(out)];
    },
  },
  {
    id: "wording.simple", level: "mandatory", group: "wording",
    title: "Pas de jargon dans ce que lit la personne",
    what: "Le nom, la description, les libellés de sections et les libellés, aides et options des réglages non avancés n'emploient aucun terme technique (sujet, métrique, API, JSON, jeton, OAuth, MCP…).",
    why: "Ces textes sont ce que voit une personne sans bagage technique. Un réglage doit dire « Adresse de votre salon Discord », pas « webhookUrl ». Les réglages techniques vont en mode avancé (\"advanced\": true).",
    fix: "Réécrivez la phrase avec des mots de tous les jours, ou marquez le réglage \"advanced\": true s'il est purement technique.",
    run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const out = [];
      for (const [where, list] of visibleTexts(m.manifest)) for (const t of list) { const x = JARGON.exec(noUrls(t)); if (x) out.push(`${where} emploie le mot technique « ${x[0]} » : « ${t.slice(0, 90)} »`); }
      return out;
    },
  },
  {
    id: "wording.locales", level: "advice", group: "wording",
    title: "Pas de jargon dans les phrases affichées par le module",
    what: "Les textes des fichiers de langue (messages, erreurs, titres) n'emploient pas de terme technique.",
    why: "Ce sont les phrases que lisent les personnes qui visitent et celle qui gère le site. Une erreur « JSON invalide » ne dit pas quoi faire ; « Ajoutez votre clé dans Réglages » si.",
    fix: "Reformulez en disant ce qui se passe et ce qu'on peut faire, avec des mots simples.",
    run(m) {
      if (!Object.keys(m.locales).length) return { na: "pas de locales/" };
      const out = [];
      for (const [lang, dict] of Object.entries(m.locales)) for (const [k, v] of Object.entries(dict)) { const x = JARGON.exec(noUrls(v)); if (x) out.push(`locales/${lang}.json, « ${k} » emploie le mot technique « ${x[0]} »`); }
      return out;
    },
  },
  {
    id: "readme.exists", level: "mandatory", group: "wording",
    title: "Un README.md explique le module",
    what: "Un fichier README.md à la racine du dossier, d'au moins quelques phrases.",
    why: "Le catalogue affiche le README avant l'installation : c'est la vitrine du module (à quoi il sert, ses réglages, ses limites). Sans lui, personne n'ose l'installer.",
    fix: "Créez README.md : une phrase sur ce que fait le module, la liste de ses réglages en mots simples, ses limites, et si vous le souhaitez un lien pour un don volontaire.",
    run(m) {
      if (m.readme === null) return ["il n'y a pas de README.md à la racine du dossier"];
      return m.readme.trim().length >= 80 ? [] : [`le README.md est trop court (${m.readme.trim().length} caractères) : expliquez à quoi sert le module`];
    },
  },
  {
    id: "readme.plain", level: "advice", group: "wording",
    title: "Le README est écrit en langage de tous les jours",
    what: "Le README n'emploie pas de termes techniques (API, JSON, endpoint…) hors des blocs de code.",
    why: "Le README s'adresse d'abord à quelqu'un qui veut savoir si le module lui sert, pas à une personne qui développe.",
    fix: "Réécrivez les passages cités. Les détails techniques peuvent rester dans une section « Pour les développeurs » à la fin.",
    run(m) {
      if (m.readme === null) return { skip: "pas de README.md" };
      const body = m.readme.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").split(/\n#{1,6}\s*(?:pour les développeurs|côté technique|for developers)[\s\S]*$/i)[0];
      const found = [...new Set([...noUrls(body).matchAll(new RegExp(JARGON.source, "gi"))].map((x) => x[0].toLowerCase()))];
      return found.map((w) => `le README emploie le mot technique « ${w} »`);
    },
  },
  {
    id: "neutrality.clean", level: "advice", group: "wording",
    title: "Aucune donnée personnelle ni propre à un site dans le module",
    what: "Aucun fichier du module ne contient un des termes interdits de votre liste de neutralité (noms, domaines, adresses réels), ni une adresse e-mail personnelle courante.",
    why: "Un module se partage : y laisser le nom de son propre site ou une adresse réelle livre ces informations à tous ceux qui l'installent. Utilisez des exemples neutres (example.org, « Demo »).",
    fix: "Remplacez l'élément cité par une valeur d'exemple. Pour une liste de termes à vérifier, créez un fichier .neutrality-terms (un terme par ligne) ou la variable NEUTRALITY_TERMS.",
    run(m) {
      const out = [];
      const listFile = [path.join(process.cwd(), ".neutrality-terms"), path.join(CORE_DIR, ".neutrality-terms")].find((f) => fs.existsSync(f));
      const text = process.env.NEUTRALITY_TERMS?.trim() ? process.env.NEUTRALITY_TERMS : listFile ? fs.readFileSync(listFile, "utf8") : "";
      const rules = [];
      for (const raw of text.split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith("#")) continue; const [term] = line.split("=>").map((s) => s.trim()); if (term) { try { rules.push({ term, re: new RegExp(term, "i") }); } catch { /* terme illisible : ignoré */ } } }
      const files = [...m.sources.map((s) => [s.file, s.text]), ["module.json", m.manifestText], ...(m.readme ? [["README.md", m.readme]] : []), ...Object.entries(m.locales).map(([l, d]) => [`locales/${l}.json`, JSON.stringify(d)])];
      for (const [file, content] of files) {
        for (const r of rules) if (r.re.test(content)) out.push(`${file} contient un terme de votre liste de neutralité (« ${r.term} »)`);
        const mail = /[\w.+-]+@(gmail|hotmail|outlook|yahoo|live|icloud|proton(?:mail)?|orange|free|skynet)\.[a-z.]+/i.exec(content);
        if (mail) out.push(`${file} contient une adresse e-mail personnelle (« ${mail[0]} »)`);
      }
      if (!rules.length && !out.length) return { skip: "aucune liste de termes (.neutrality-terms ou NEUTRALITY_TERMS) : seules les adresses e-mail personnelles ont été cherchées" };
      return out;
    },
  },
];
export default requirements;

