// Exigences sur le code : il se charge, il correspond à ce que le manifeste annonce, il n'utilise que ce qu'il a déclaré.
import path from "node:path";
import { permissionsFromDefinition, definitionProblems } from "../builtinChecks.mjs";
import { observe } from "../probes.mjs";
import { NET_RULES_LEVEL, balancedArgs, stripComments } from "./util.mjs";

const FN = (v) => typeof v === "function";
const strip = (m) => stripComments(m.code);

/** Capacités de `ctx.api` utilisées par le code → permission à déclarer. */
const API_USE = [
  { permission: "storage", re: /\bapi\s*\??\.\s*store\b|\{[^}]*\bstore\b[^}]*\}\s*=\s*[\w.]*\bapi\b/, label: "le stockage (ctx.api.store)" },
  { permission: "mail", re: /\bapi\s*\??\.\s*mail\b|\{[^}]*\bmail\b[^}]*\}\s*=\s*[\w.]*\bapi\b/, label: "l'envoi d'e-mails (ctx.api.mail)" },
  { permission: "rawg", re: /\bapi\s*\??\.\s*rawg\b|\{[^}]*\brawg\b[^}]*\}\s*=\s*[\w.]*\bapi\b/, label: "les jaquettes de jeux (ctx.api.rawg)" },
  { permission: "topics", re: /\bapi\s*\??\.\s*topics\b|\{[^}]*\btopics\b[^}]*\}\s*=\s*[\w.]*\bapi\b/, label: "les sujets d'échange (ctx.api.topics)" },
];

const requirements = [
  {
    id: "def.loads", level: "mandatory", group: "code",
    title: "Le code se charge sans erreur",
    what: "Le fichier principal s'importe, exporte par défaut un objet, et chaque morceau (sections, routes, actions…) est une fonction.",
    why: "Un module dont le code ne se charge pas ne fait rien sur le site : le cœur l'écarte et journalise l'erreur.",
    fix: "Corrigez l'erreur indiquée (souvent une faute de syntaxe ou un import manquant). Le fichier doit finir par « export default { … } ».",
    run(m) {
      const out = m.loadErrors.filter((e) => ["import", "no-default", "default-type", "locale-json"].includes(e.kind)).map((e) => e.message);
      const d = m.definition ?? {};
      for (const group of ["sections", "slots", "routes", "exports", "adminActions", "mcp", "tasks", "services", "migrations"]) {
        const g = d[group];
        if (g === undefined) continue;
        if (!g || typeof g !== "object" || Array.isArray(g)) { out.push(`« ${group} » doit être un objet`); continue; }
        for (const [k, v] of Object.entries(g)) {
          if (group === "tasks") { if (!v || !FN(v.run)) out.push(`la tâche « ${k} » doit avoir une fonction « run »`); }
          else if (group === "services") { for (const [meth, f] of Object.entries(v ?? {})) if (!FN(f)) out.push(`la méthode « ${meth} » du service « ${k} » doit être une fonction`); }
          else if (group === "adminActions" && v && FN(v.run)) continue; // forme { right, run } (cœur 0.2.0)
          else if (!FN(v)) out.push(`${group}.${k} doit être une fonction`);
        }
      }
      for (const k of ["page", "overlay", "news", "adminBadge", "adminPanel"]) if (d[k] !== undefined && !FN(d[k])) out.push(`« ${k} » doit être une fonction`);
      if (d.entryPanels !== undefined) {
        if (!d.entryPanels || typeof d.entryPanels !== "object" || Array.isArray(d.entryPanels)) out.push("« entryPanels » doit être un objet");
        else for (const [k, v] of Object.entries(d.entryPanels)) {
          if (!v || typeof v !== "object" || !FN(v.render)) { out.push(`la section d'éditeur « ${k} » doit avoir une fonction « render »`); continue; }
          if (v.actions !== undefined && (!v.actions || typeof v.actions !== "object")) out.push(`entryPanels.${k}.actions doit être un objet`);
          else for (const [a, f] of Object.entries(v.actions ?? {})) if (!FN(f)) out.push(`entryPanels.${k}.actions.${a} doit être une fonction`);
        }
      }
      return out;
    },
  },
  {
    id: "def.matches", level: "mandatory", group: "code",
    title: "Ce que module.json annonce est ce que le code fait",
    what: "Chaque section, section d'éditeur d'entrée, action MCP, service offert, sujet partagé, page et overlay déclarés existent dans le code — et inversement. Les emplacements (slots) ont un nom connu, les formulaires pointent vers une route ou une action qui existe (une action d'administration peut être une fonction OU un objet « { right, run } » ; dans une section d'éditeur : une action de cette section), et les services ou sujets appelés sont déclarés.",
    why: "Le cœur ne connaît le module que par son manifeste. Une section annoncée mais absente s'affiche vide ; un code jamais annoncé n'est jamais appelé ; un service non déclaré est refusé à l'appel.",
    fix: "Ajoutez ce qui manque d'un côté ou de l'autre : le message dit si c'est le manifeste (module.json) ou le code (index.mjs) qui est en retard.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide (voir « manifest.valid »)" };
      const man = m.parsed.manifest;
      const d = m.definition ?? {};
      const out = [];
      const isContent = !!man.content;
      const implicit = new Set(isContent ? ["latest", "random"] : []);
      for (const p of definitionProblems(man, d)) {
        const section = /^la section « ([^»]+) » est déclarée/.exec(p);
        if (section && implicit.has(section[1])) continue; // fournie par le cœur pour les modules à contenu
        out.push(p);
      }
      // sections ajoutées à l'éditeur d'entrée d'un autre module : ce que module.json annonce = ce que le code fournit, et chaque bouton vise une action de la section
      const panelDecl = new Set((man.entryPanels ?? []).map((p) => p.id));
      for (const id of panelDecl) if (!FN(d.entryPanels?.[id]?.render)) out.push(`la section d'éditeur « ${id} » est annoncée dans module.json (entryPanels) mais le code n'a pas de « entryPanels["${id}"].render »`);
      for (const id of Object.keys(d.entryPanels ?? {})) if (!panelDecl.has(id)) out.push(`le code définit la section d'éditeur « ${id} » (entryPanels) mais module.json ne l'annonce pas (entryPanels)`);
      const offers = new Map((man.offers ?? []).map((o) => [o.service, o]));
      for (const service of offers.keys()) if (!d.services?.[service]) out.push(`le service « ${service} » est offert dans module.json mais n'existe pas dans le code (services)`);
      for (const service of Object.keys(d.services ?? {})) if (!offers.has(service)) out.push(`le service « ${service} » existe dans le code mais n'est pas déclaré dans module.json (offers)`);
      for (const [service, o] of offers) for (const meth of o.readOnly ?? []) if (d.services?.[service] && !FN(d.services[service][meth])) out.push(`la méthode « ${meth} » du service « ${service} » est annoncée en lecture seule mais n'existe pas`);
      const provides = new Set((man.provides ?? []).map((p) => p.topic));
      for (const t of provides) if (!FN(d.exports?.[t])) out.push(`le sujet « ${t} » est annoncé (provides) mais le code n'a pas de « exports["${t}"] »`);
      for (const t of Object.keys(d.exports ?? {})) if (!provides.has(t)) out.push(`le code partage le sujet « ${t} » (exports) mais module.json ne l'annonce pas (provides)`);
      if (man.page === true && !FN(d.page) && !isContent) out.push(`module.json annonce une page publique (« page »: true) mais le code n'a pas de fonction « page »`);
      if (FN(d.page) && man.page !== true && !isContent) out.push(`le code définit une page publique mais module.json n'a pas « page »: true : elle ne serait jamais affichée`);
      const overlayish = man.type === "overlay" || (man.permissions ?? []).includes("overlay");
      if (overlayish && !FN(d.overlay)) out.push(`le module est un overlay (type ou permission « overlay ») mais le code n'a pas de fonction « overlay »`);
      if (FN(d.overlay) && !overlayish) out.push(`le code définit un overlay mais module.json n'a ni « type »: « overlay » ni la permission « overlay »`);
      for (const slot of Object.keys(d.slots ?? {})) if (!m.core.SLOTS.includes(slot)) out.push(`l'emplacement « ${slot} » n'existe pas (connus : ${m.core.SLOTS.join(", ")})`);
      // appels de services et de sujets : seulement ce qui est déclaré
      const code = strip(m);
      const required = new Set((man.requires ?? []).map((r) => r.service));
      for (const x of code.matchAll(/services\s*\.\s*(?:call|callAll|available)\s*\(\s*["']([^"']+)["']/g)) if (!required.has(x[1])) out.push(`le code appelle le service « ${x[1]} » qui n'est pas déclaré dans module.json (requires)`);
      const consumed = new Set((man.consumes ?? []).map((c) => c.topic));
      for (const x of code.matchAll(/topics\s*\.\s*collect\s*\(\s*["']([^"']+)["']/g)) if (!consumed.has(x[1])) out.push(`le code lit le sujet « ${x[1]} » qui n'est pas déclaré dans module.json (consumes)`);
      // formulaires et boutons → routes et actions
      const obs = await observe(m);
      const seen = new Set();
      for (const run of Object.values(obs.runs)) for (const f of run.forms) {
        const key = `${f.admin ? "a" : "p"}:${f.action}`;
        if (seen.has(key) || !f.action) continue;
        seen.add(key);
        if (f.admin) { if (!(FN(d.adminActions?.[f.action]) || FN(d.adminActions?.[f.action]?.run))) /* forme { right, run } comprise (cœur 0.2.0) */ out.push(`le panneau d'administration a un formulaire ou un bouton vers l'action « ${f.action} » qui n'existe pas (adminActions)`); }
        else {
          const route = f.action.split(/[?#]/)[0].split("/").filter(Boolean).pop(); // « <clé d'instance>/<route> »
          if (route && !FN(d.routes?.[route])) out.push(`un formulaire public envoie vers la route « ${route} » qui n'existe pas (routes)`);
        }
      }
      for (const run of Object.values(obs.runs)) for (const f of run.entryForms ?? []) {
        const key = `e:${f.panel}:${f.action}`;
        if (seen.has(key) || !f.action) continue;
        seen.add(key);
        if (!FN(d.entryPanels?.[f.panel]?.actions?.[f.action])) out.push(`la section d'éditeur « ${f.panel} » a un formulaire ou un bouton vers l'action « ${f.action} » qui n'existe pas (entryPanels.${f.panel}.actions)`);
      }
      return out;
    },
  },
  {
    id: "perm.declared", level: "mandatory", group: "permissions",
    title: "Chaque capacité utilisée est déclarée dans « permissions »",
    what: "Le code n'utilise le stockage, l'e-mail, les sujets d'échange, les jaquettes de jeux, les routes, pages, emplacements, sections, overlay, filtres, actions MCP ou l'administration que si la permission correspondante est dans module.json. Le test l'a vérifié en lisant le code et en le faisant tourner avec un contexte qui refuse ce qui n'est pas déclaré.",
    why: "Les permissions sont montrées à l'administrateur avant l'installation : c'est ce qui lui permet de dire oui en connaissance de cause. Un module qui en utilise plus qu'il n'en annonce trompe cette confiance.",
    fix: "Ajoutez la permission citée au tableau « permissions » de module.json — ou retirez du code ce qui l'utilise si ce n'est pas voulu.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide (voir « manifest.valid »)" };
      const man = m.parsed.manifest;
      const have = new Set(man.permissions ?? []);
      const out = [];
      const need = new Map();
      for (const { permission, why } of permissionsFromDefinition(m.definition ?? {})) need.set(permission, why);
      const code = strip(m);
      for (const u of API_USE) if (u.re.test(code)) need.set(u.permission, `le code utilise ${u.label}`);
      if ((man.consumes ?? []).length) need.set("topics", "le module consomme des sujets (consumes)");
      for (const [permission, why] of need) if (!have.has(permission)) out.push(`la permission « ${permission} » manque : ${why}`);
      const obs = await observe(m);
      const denied = new Set(Object.values(obs.runs).flatMap((r) => r.denied));
      for (const p of denied) if (!need.has(p) && !have.has(p)) out.push(`à l'exécution, le module a touché à une capacité qui demande la permission « ${p} », non déclarée`);
      return out;
    },
  },
  {
    id: "perm.minimal", level: "advice", group: "permissions",
    title: "Aucune permission inutile n'est demandée",
    what: "Chaque permission déclarée correspond à quelque chose que le code fait vraiment.",
    why: "Moins un module demande, plus il est facile à accepter pour l'administrateur (principe du moindre privilège). Une permission en trop fait hésiter pour rien.",
    fix: "Retirez de « permissions » celles que le message cite comme inutilisées.",
    run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const man = m.parsed.manifest;
      const d = m.definition ?? {};
      const code = strip(m);
      const used = new Set(permissionsFromDefinition(d).map((x) => x.permission));
      for (const u of API_USE) if (u.re.test(code)) used.add(u.permission);
      if ((man.consumes ?? []).length || (man.provides ?? []).length) used.add("topics");
      if (man.page && !d.page && man.content) used.add("pages");
      if (man.content) { used.add("pages"); used.add("sections"); }
      return (man.permissions ?? []).filter((p) => !used.has(p)).map((p) => `la permission « ${p} » est déclarée mais le code ne semble pas l'utiliser`);
    },
  },
  {
    id: "code.imports", level: "mandatory", group: "code",
    title: "Le module ne dépend de rien d'autre que de ctx",
    what: "Le code n'importe rien du cœur (« @/… », « src/… »), aucun paquet à installer (npm), aucun fichier hors de son dossier. Seuls sont permis les modules intégrés de Node (« node:… ») et les fichiers du dossier du module.",
    why: "Un module est un simple dossier chargé tel quel : pas de « npm install », pas de compilation. Tout ce dont il a besoin lui est donné par ctx. Une dépendance cachée casserait l'installation sur un autre site.",
    fix: "Remplacez l'import par ce que ctx.api offre (stockage, e-mail, QR…), ou recopiez le petit morceau de code dans votre dossier. Gardez les fichiers du module dans son dossier.",
    run(m) {
      const out = [];
      // import statiques (au début d'une ligne) et dynamiques ; un import(« ${…} ») dans un texte est du code envoyé au navigateur, pas un import du module
      const importRe = /^\s*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"'\n]+)["']|^\s*import\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)|\brequire\(\s*["']([^"'\n]+)["']\s*\)/gm;
      for (const s of m.sources) {
        for (const x of stripComments(s.text).matchAll(importRe)) {
          const spec = x[1] ?? x[2] ?? x[3] ?? x[4];
          if (spec.startsWith("node:") || spec.includes("${") || spec.startsWith("/m/")) continue;
          if (spec.startsWith("@/") || /(^|\/)src\//.test(spec)) out.push(`${s.file} importe du code du cœur (« ${spec} »)`);
          else if (spec.startsWith(".")) {
            const target = path.resolve(m.dir, path.dirname(s.file), spec);
            if (!target.startsWith(m.dir + path.sep)) out.push(`${s.file} importe un fichier hors du dossier du module (« ${spec} »)`);
          } else if (/^https?:|^data:/.test(spec)) out.push(`${s.file} importe du code téléchargé (« ${spec} »)`);
          else out.push(`${s.file} importe le paquet « ${spec.slice(0, 60)} » : aucune dépendance npm n'est installée avec un module`);
        }
      }
      return out;
    },
  },
  {
    id: "code.noDanger", level: "mandatory", group: "code",
    title: "Pas de code dangereux",
    what: "Le code n'utilise ni eval, ni new Function, ni lancement de commandes (child_process), ni accès direct à la base (Prisma), ni écriture de fichiers sur le disque, ni arrêt du serveur (process.exit).",
    why: "Un module tourne dans le serveur avec les droits du site. Ces outils permettent de tout casser ou de tout lire ; ctx.api offre les moyens sûrs de stocker et d'envoyer.",
    fix: "Stockez avec ctx.api.store, envoyez avec ctx.api.mail, et supprimez l'usage de la fonction citée. Si vous construisez du code à la volée, remplacez-le par une table de correspondance.",
    run(m) {
      const out = [];
      const rules = [
        [/\beval\s*\(/, "eval()"], [/\bnew\s+Function\s*\(/, "new Function()"], [/child_process|\bexecSync\b|\bspawnSync\b/, "le lancement de commandes (child_process)"],
        [/prisma|@prisma\/client/i, "un accès direct à la base de données (Prisma)"], [/\bprocess\s*\.\s*exit\b|\bprocess\s*\.\s*kill\b/, "l'arrêt du serveur (process.exit / kill)"],
        [/(?:node:fs|["']fs(?:\/promises)?["'])[\s\S]*\b(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rmSync|rmdir|mkdirSync|createWriteStream|copyFile|renameSync)\s*\(/, "l'écriture de fichiers sur le disque"],
      ];
      for (const s of m.sources) { const code = stripComments(s.text); for (const [re, label] of rules) if (re.test(code)) out.push(`${s.file} utilise ${label}`); }
      return out;
    },
  },
  {
    id: "load.noNetwork", level: "mandatory", group: "code",
    title: "Aucun accès au réseau au chargement",
    what: "Charger le fichier principal ne déclenche aucune requête réseau (fetch, http, connexion, résolution de nom).",
    why: "Le cœur charge tous les modules au démarrage du site, y compris quand Internet ne répond pas. Un module qui appelle un service dès son chargement ralentit ou bloque le démarrage de tout le site.",
    fix: "Déplacez l'appel réseau dans une fonction (section, route, tâche planifiée) : il ne part alors qu'à la demande, jamais à l'import.",
    run(m) {
      if (!m.loadErrors.length && !m.manifest?.main) return { na: "module sans code" };
      return m.network.map((n) => `au chargement, le code a tenté : ${n}`);
    },
  },
  {
    id: "net.bounded", level: NET_RULES_LEVEL, group: "network",
    title: "Chaque appel réseau a un délai",
    what: "Aucun « fetch( » sans délai : soit l'appel passe par ctx.api.net.request (délai, pauses et disjoncteur fournis par le cœur), soit il porte un « signal » (par exemple AbortSignal.timeout(8000)). Conseil dans le cœur 0.2.0 ; deviendra obligatoire.",
    why: "Un appel sans délai vers un service qui ne répond plus attend pour toujours : la page, la tâche ou l'action qui l'attend reste figée, et les appels suivants s'empilent jusqu'à faire tomber le site entier.",
    fix: "Remplacez « await fetch(url) » par « await ctx.api.net.request({ url }) » (il ne lève jamais : testez « r.ok »), ou au minimum ajoutez « { signal: AbortSignal.timeout(8000) } » à l'appel.",
    run(m) {
      const out = [];
      for (const s of m.sources) {
        const code = stripComments(s.text);
        for (const x of code.matchAll(/(?<![\w$])(?:globalThis\s*\.\s*|window\s*\.\s*|self\s*\.\s*)?fetch\s*\(/g)) {
          const before = code.slice(Math.max(0, x.index - 20), x.index);
          if (/(?:function\s*\*?\s*|\.\s*)$/.test(before) && !/(?:globalThis|window|self)\s*\.\s*$/.test(before)) continue; // définition, ou méthode d'un autre objet (ctx.api.fetch…)
          const { args, close } = balancedArgs(code, x.index + x[0].length - 1);
          if (/^\s*\{/.test(code.slice(close + 1, close + 40)) || /^\s*=>/.test(code.slice(close + 1, close + 10))) continue; // fetch(url) { … } : une méthode qu'on définit
          if (/\bsignal\b|AbortSignal\s*\.\s*(?:timeout|any)/.test(args)) continue;
          // options passées par une variable (fetch(url, init)) : un « signal » préparé juste avant suffit
          if (/,\s*[\w$.]+\s*$|,\s*\{\s*\.\.\./.test(args) && /\bsignal\b|AbortSignal\s*\.\s*timeout/.test(code.slice(Math.max(0, x.index - 1500), x.index))) continue;
          const line = code.slice(0, x.index).split("\n").length;
          out.push(`${s.file}:${line} : fetch(${args.replace(/\s+/g, " ").trim().slice(0, 60)}) n'a pas de délai (ni ctx.api.net, ni signal)`);
        }
      }
      return out;
    },
  },
  {
    id: "net.noIdleTimer", level: "advice", group: "network",
    title: "Aucune boucle réseau qui tourne sans personne",
    what: "Le code ne lance pas de minuteur répétitif (setInterval) : un travail régulier est une tâche planifiée déclarée (« tasks »), et un appel réseau ne part que quand quelqu'un en a besoin (une page, une action, une tâche).",
    why: "Un setInterval tourne même quand personne ne regarde, n'est jamais arrêté à la désactivation du module, se multiplie à chaque rechargement du code, et appelle des services externes pour rien : quotas consommés, pannes aggravées.",
    fix: "Déclarez une tâche planifiée (tasks: { refresh: { everyMinutes: 15, run } }) : le cœur la lance une fois par instance active, sans chevauchement. Ou bien calculez à la demande et gardez le résultat en cache daté.",
    run(m) {
      const out = [];
      for (const s of m.sources) {
        const code = stripComments(s.text);
        for (const x of code.matchAll(/(?<![\w$.])setInterval\s*\(/g)) out.push(`${s.file}:${code.slice(0, x.index).split("\n").length} : setInterval(…) tourne sans consommateur`);
      }
      return out;
    },
  },
  {
    id: "forms.fieldErrors", level: "advice", group: "forms",
    title: "Une erreur de champ s'affiche sous son champ",
    what: "Une action d'administration qui refuse une valeur saisie dit QUEL champ pose problème (`errors: { champ: \"message\" }`) au lieu d'un seul `error` général.",
    why: "Un message général s'affiche loin du champ, parfois hors de l'écran sur un téléphone : la personne ne voit pas ce qu'il faut corriger. Avec `errors`, le message apparaît juste sous le champ, qui prend le focus.",
    fix: "Renvoyez `{ errors: { adresse: \"Écrivez une adresse complète, par exemple https://www.monsite.be/contact.\" } }` (nom du champ → message, avec un exemple). Gardez `error` pour ce qui ne concerne aucun champ.",
    run(m) {
      const actions = m.definition?.adminActions;
      const out = [];
      if (!actions || typeof actions !== "object") return out;
      for (const s of m.sources) {
        const code = stripComments(s.text);
        if (!/\breturn\s*\{[^}]*\berror\s*:/.test(code)) continue;
        if (/\berrors\s*:/.test(code)) continue;
        out.push(`${s.file} : renvoie \`error\` mais jamais \`errors\` : une valeur refusée devrait s'afficher sous son champ`);
      }
      return out;
    },
  },
];
export default requirements;
