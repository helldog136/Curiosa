// Exigences vérifiées EN FAISANT TOURNER le module (sondes) : sorties sûres, routes, outils MCP, tâches, données, vie privée, un module = une chose.
import { findSrpViolations } from "../builtinChecks.mjs";
import { fakeCtx } from "../fakeCtx.mjs";
import { makeCtx, observe } from "../probes.mjs";
import { stripComments, walkValue, whereOf } from "./util.mjs";

const KNOWN_BLOCKS = ["markdown", "html", "banner", "links", "entries", "hero", "panel", "embed", "form", "table", "copy", "downloads", "gridEditor", "head", "heading", "swatches", "adminForm", "suggestInstall"];
export { KNOWN_BLOCKS };

// ── Lecture des sorties ─────────────────────────────────────────────────────────────────────────────────────────────
const inTag = (s, i) => s.lastIndexOf("<", i) > s.lastIndexOf(">", i);
/** Problèmes d'un texte brut (HTML, CSS ou script) censé avoir été échappé. */
function rawIssues(str, channel) {
  const s = String(str ?? "");
  const out = [];
  if (s.includes("<img src=x onerror=PROBEIMG>")) out.push("du texte venu de l'extérieur est inséré tel quel : une balise a pu être injectée");
  if (s.includes("<script>PROBESCRIPT")) out.push("du texte venu de l'extérieur est inséré tel quel : un script a pu être injecté");
  for (const quote of ['"', "'"]) {
    const needle = `${quote} onmouseover=PROBEATTR`;
    let i = s.indexOf(needle);
    while (i !== -1) {
      const escapedInJs = channel === "script" && s[i - 1] === "\\";
      if (!escapedInJs && (channel === "script" || inTag(s, i))) { out.push("un guillemet venu de l'extérieur n'est pas échappé : il permet de sortir d'un attribut HTML et d'en ajouter un autre"); break; }
      i = s.indexOf(needle, i + 1);
    }
  }
  return [...new Set(out)];
}

function htmlIssues(o) {
  const out = [];
  const v = o.value;
  if (o.kind === "overlay" && v && typeof v === "object") {
    for (const ch of ["html", "css", "script"]) for (const p of rawIssues(v[ch], ch)) out.push(`${p} (overlay, partie « ${ch} »)`);
    return out;
  }
  if (o.kind === "route" && v && typeof v === "object" && /html|svg|xml/i.test(v.headers?.["content-type"] ?? "")) return rawIssues(v.body, "html");
  walkValue(v, (x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      if (x.type === "html" && typeof x.html === "string") out.push(...rawIssues(x.html, "html"));
      if (x.type === "head" && Array.isArray(x.tags)) for (const t of x.tags) if (t?.tag === "script" && typeof t.inline === "string") out.push(...rawIssues(t.inline, "script"));
    }
  });
  return out;
}

const URL_KEYS = new Set(["href", "src", "image", "video", "videoPoster", "poster", "url", "cover", "icon", "action"]);
function linkIssues(o) {
  const out = [];
  const bad = (s) => typeof s === "string" && /^\s*(javascript|vbscript|data):/i.test(s) && s.includes("PROBEJS");
  const attr = /\b(href|src|action|formaction|poster|xlink:href|data)\s*=\s*(["']?)\s*(javascript|vbscript):PROBEJS/i;
  const v = o.value;
  const scan = (value) => walkValue(value, (x, p) => {
    if (typeof x === "string") {
      const key = p.split(".").pop()?.replace(/\[\d+\]$/, "");
      if (URL_KEYS.has(key) && bad(x)) out.push(`une adresse venue de l'extérieur est reprise sans vérification (« ${key} » : javascript:…)`);
      if (attr.test(x)) out.push("une adresse venue de l'extérieur est reprise sans vérification dans du HTML (href/src : javascript:…)");
    }
  });
  if (o.kind === "overlay" && v) scan({ html: v.html, css: v.css });
  else if (o.kind === "export") return [];
  else if (o.kind === "route" && v) scan(/html/i.test(v.headers?.["content-type"] ?? "") ? v.body : "");
  else scan(v);
  return [...new Set(out)];
}

const ok2xx = (s) => s >= 200 && s < 300;

const requirements = [
  {
    id: "html.escaped", level: "mandatory", group: "security",
    title: "Les textes venus de l'extérieur sont échappés dans les pages",
    what: "Le module est essayé avec des données piégées (textes contenant des balises, des scripts, des guillemets) placées dans les réglages, le stockage, les formulaires, l'adresse de la page, le nom du site, les entrées et les sujets reçus. Aucune page, section, emplacement, overlay ni réponse de route ne doit les restituer tels quels.",
    why: "Le bloc « html » est brut : ce que vous y mettez est exécuté par le navigateur du visiteur. Un message de livre d'or contenant <script> pourrait voler la session de l'administrateur qui le modère (faille XSS).",
    fix: "Passez CHAQUE valeur qui n'est pas écrite par vous dans une fonction d'échappement (& < > \" ' devenant &amp; &lt; &gt; &quot; &#39;) avant de l'insérer dans du HTML. Voir la fonction esc() de l'exemple guestbook. Préférez les blocs markdown, heading, table, qui échappent seuls.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const out = [];
      for (const run of obs.hostile) for (const o of run.outputs) if (o.ok) for (const p of htmlIssues(o)) out.push(`${whereOf(o)} : ${p}`);
      return [...new Set(out)];
    },
  },
  {
    id: "links.safe", level: "mandatory", group: "security",
    title: "Les liens venus de l'extérieur sont vérifiés",
    what: "Une adresse « javascript:… » saisie dans un réglage, une entrée ou un sujet reçu n'est jamais reprise comme lien, image ou vidéo.",
    why: "Un lien « javascript: » s'exécute au clic dans le navigateur du visiteur. Seuls https:, http:, mailto: et les chemins du site (/…) sont sûrs.",
    fix: "Avant d'utiliser une adresse, vérifiez qu'elle commence par https://, http://, mailto: ou par un seul « / » (pas « // »), sinon ignorez-la. Voir safeSrc() dans l'exemple guestbook.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const out = [];
      for (const o of obs.runs.hostileUrl.outputs) if (o.ok) for (const p of linkIssues(o)) out.push(`${whereOf(o)} : ${p}`);
      return [...new Set(out)];
    },
  },
  {
    id: "blocks.valid", level: "mandatory", group: "security",
    title: "Ce que le module renvoie a la bonne forme",
    what: "Les sections, emplacements, pages, panneaux d'administration, overlays et partages renvoient des blocs connus (markdown, html, links, form…) avec leurs champs obligatoires, sous la forme attendue (liste de blocs, { blocks }, { html }…).",
    why: "Le cœur affiche ce qu'on lui rend sans le deviner. Un bloc inconnu ou une forme inattendue s'affiche vide ou fait échouer toute la page.",
    fix: "Comparez avec les exemples de docs/CREATE-A-MODULE.md (sections 5 à 7 et 11) : chaque bloc a un « type » connu et ses champs.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const out = [];
      const blocksIn = (list, o) => {
        if (list === null || list === undefined) return;
        if (!Array.isArray(list)) { out.push(`${whereOf(o)} doit renvoyer une liste de blocs (ou rien)`); return; }
        list.forEach((b, i) => {
          if (!b || typeof b !== "object" || typeof b.type !== "string") out.push(`${whereOf(o)} : l'élément ${i + 1} n'est pas un bloc (il manque « type »)`);
          else if (!KNOWN_BLOCKS.includes(b.type)) out.push(`${whereOf(o)} : le type de bloc « ${b.type} » n'existe pas`);
          else if (b.type === "html" && typeof b.html !== "string") out.push(`${whereOf(o)} : un bloc html n'a pas de texte « html »`);
          else if ((b.type === "markdown" || b.type === "heading") && typeof b.text !== "string") out.push(`${whereOf(o)} : un bloc ${b.type} n'a pas de texte « text »`);
          else if (b.type === "links" && (!Array.isArray(b.items) || b.items.some((x) => typeof x?.label !== "string" || typeof x?.href !== "string"))) out.push(`${whereOf(o)} : un bloc links doit avoir des « items » avec « label » et « href »`);
          else if (b.type === "form" && (typeof b.action !== "string" || !Array.isArray(b.fields) || typeof b.submitLabel !== "string" || typeof b.successText !== "string")) out.push(`${whereOf(o)} : un bloc form doit avoir action, fields, submitLabel et successText`);
          else if (b.type === "table" && (!Array.isArray(b.columns) || !Array.isArray(b.rows))) out.push(`${whereOf(o)} : un bloc table doit avoir « columns » et « rows »`);
        });
      };
      for (const run of obs.plain) for (const o of run.outputs) {
        if (!o.ok) continue;
        const v = o.value;
        if (["section", "slot", "adminPanel", "entryPanel"].includes(o.kind)) blocksIn(v, o);
        else if (o.kind === "page") { if (v !== null && v !== undefined) { if (typeof v !== "object" || Array.isArray(v)) out.push(`${whereOf(o)} doit renvoyer { blocks: [...] } ou rien`); else blocksIn(v.blocks, { ...o }); } }
        else if (o.kind === "overlay") { if (!v || typeof v.html !== "string") out.push(`${whereOf(o)} doit renvoyer { html: "…" }`); }
        else if (o.kind === "export") { if (!Array.isArray(v) || v.some((x) => !x || typeof x !== "object")) out.push(`${whereOf(o)} doit renvoyer une liste d'objets`); }
        else if (o.kind === "adminBadge") { if (typeof v !== "number" || !Number.isFinite(v)) out.push(`${whereOf(o)} doit renvoyer un nombre`); }
        else if (o.kind === "news") { if (typeof v !== "boolean") out.push(`${whereOf(o)} doit renvoyer vrai ou faux`); }
        else if (o.kind === "route") { if (v?.notResponse) out.push(`${whereOf(o)} doit renvoyer un objet Response`); }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "run.noCrash", level: "advice", group: "security",
    title: "Le module ne plante pas, même avec des données inattendues",
    what: "Sections, pages, emplacements, overlay, panneau d'administration et routes terminent sans erreur avec les réglages par défaut, des réglages remplis et des données piégées.",
    why: "Le cœur isole les erreurs d'un module (le site continue), mais le visiteur voit alors une section vide ou une page d'erreur. Un module robuste dégrade son affichage sans planter.",
    fix: "Protégez le code qui lit une donnée optionnelle (valeur absente, liste vide, texte trop long) et répondez par un code 4xx plutôt que de laisser une erreur remonter.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const out = [];
      for (const [name, run] of Object.entries(obs.runs)) {
        if (name === "protection") continue;
        for (const o of run.outputs) if (!o.ok && o.kind !== "mcp" && o.kind !== "adminAction" && o.kind !== "entryPanelAction") out.push(`${whereOf(o)}${o.label ? ` (${o.label})` : ""} a échoué (${name === "hostile" || name === "hostileUrl" ? "données piégées" : name === "defaults" ? "réglages par défaut" : "réglages remplis"}) : ${o.error.slice(0, 140)}`);
        if (run.fatal) out.push(`la sonde s'est arrêtée : ${run.fatal}`);
      }
      return [...new Set(out)].slice(0, 12);
    },
  },
  {
    id: "routes.methods", level: "mandatory", group: "routes",
    title: "Les routes n'écrivent que sur demande explicite (POST)",
    what: "Appeler une route en GET (lecture simple, y compris via un lien ou une image) ou avec une autre méthode (PUT, DELETE) ne modifie rien : ni stockage, ni e-mail envoyé.",
    why: "Un GET peut être déclenché par n'importe quelle page, image ou robot, sans formulaire ni intention de la personne. Seul un POST, soumis à la protection contre les envois venus d'autres sites, est une action volontaire.",
    fix: "Au début de la route, répondez 405 si request.method n'est pas POST : if (request.method !== \"POST\") return new Response(\"Method not allowed\", { status: 405 }).",
    async run(m) {
      if (!Object.keys(m.definition?.routes ?? {}).length) return { na: "le module n'a pas de routes" };
      const obs = await observe(m);
      const out = [];
      for (const run of [obs.runs.filled, obs.runs.hostile]) for (const o of run.outputs) {
        if (o.kind !== "route" || !o.ok || !["GET", "GET?params", "PUT", "DELETE"].includes(o.label)) continue;
        if (o.wrote > 0 || o.mailed > 0) out.push(`la route « ${o.route} » écrit ou envoie un e-mail en réponse à un ${o.method}`);
      }
      return [...new Set(out)];
    },
  },
  {
    id: "routes.size", level: "mandatory", group: "routes",
    title: "Les routes bornent la taille de ce qu'elles reçoivent",
    what: "Envoyer des champs de plusieurs mégaoctets à une route ne remplit pas le stockage : la route refuse (4xx) ou tronque.",
    why: "Sans borne, un seul envoi peut remplir la base de données du site (déni de service) ou la ralentir pour tout le monde.",
    fix: "Limitez chaque champ à sa taille utile avant de le stocker : String(valeur).slice(0, 500). Voir clean() dans l'exemple guestbook.",
    async run(m) {
      if (!Object.keys(m.definition?.routes ?? {}).length) return { na: "le module n'a pas de routes" };
      const obs = await observe(m);
      const out = [];
      for (const o of obs.runs.filled.outputs) if (o.kind === "route" && o.ok && o.label === "POST-huge" && o.stored > 100_000) out.push(`la route « ${o.route} » a rangé ${Math.round(o.stored / 1024)} Ko pour un envoi démesuré (statut ${o.value?.status})`);
      return out;
    },
  },
  {
    id: "routes.redirect", level: "mandatory", group: "routes",
    title: "Aucune redirection vers un site extérieur",
    what: "Une route ou une action d'administration ne redirige jamais vers une adresse reçue (paramètres next, redirect, return, url…) : seules les adresses du site sont permises.",
    why: "Une « redirection ouverte » permet de bâtir un lien qui part de votre site et atterrit chez un escroc : la confiance dans votre adresse sert l'hameçonnage.",
    fix: "Ignorez les adresses reçues. Si vous devez rediriger, n'acceptez qu'un chemin du site (qui commence par un seul « / »).",
    async run(m) {
      if (!Object.keys(m.definition?.routes ?? {}).length && !Object.keys(m.definition?.adminActions ?? {}).length) return { na: "ni routes ni actions d'administration" };
      const obs = await observe(m);
      const out = [];
      // sûr = une adresse du site : relative (« ?id=3 », « /page »), jamais « //hôte », « \\hôte » ni un schéma (https://autre-site, javascript:…) ; notre propre hôte de test passe aussi
      const safe = (loc) => /^https:\/\/example\.test(\/|$)/.test(loc) || !/^\s*([a-z][a-z0-9+.-]*:|\/\/|\\|\/\\)/i.test(loc);
      for (const run of Object.values(obs.runs)) for (const o of run.outputs) {
        if (!o.ok) continue;
        if (o.kind === "route") { const loc = o.value?.headers?.location; if (loc && !safe(loc)) out.push(`la route « ${o.route} » redirige vers « ${loc.slice(0, 80)} »`); }
        if (o.kind === "adminAction") { const r = o.value?.redirect; if (typeof r === "string" && r && !safe(r)) out.push(`l'action d'administration « ${o.name} » redirige vers « ${r.slice(0, 80)} »`); }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "routes.errors", level: "mandatory", group: "routes",
    title: "Les réponses d'erreur ne révèlent rien d'interne",
    what: "Les réponses des routes sont de vrais objets Response et ne contiennent ni chemin de fichier, ni trace d'erreur, ni détail de base de données ou de réglage secret.",
    why: "Un chemin ou une trace aide un attaquant à comprendre le serveur. Un visiteur n'a rien à faire d'un message technique.",
    fix: "Répondez par un code et un mot (400, 403, 404) sans détail : new Response(null, { status: 400 }) ou Response.json({ ok: false }, { status: 400 }). Journalisez l'erreur côté serveur, brièvement.",
    async run(m) {
      if (!Object.keys(m.definition?.routes ?? {}).length) return { na: "le module n'a pas de routes" };
      const obs = await observe(m);
      const out = [];
      const leak = /node_modules|\/home\/|\/tmp\/|\/Users\/|\.mjs:\d+|\n\s+at [\w.<>$]+ \(|stack trace|SQLITE|prisma|ECONNREFUSED/i;
      for (const run of Object.values(obs.runs)) for (const o of run.outputs) {
        if (o.kind !== "route") continue;
        if (o.ok && o.value?.notResponse) out.push(`la route « ${o.route} » ne renvoie pas un objet Response`);
        if (o.ok && leak.test(o.value?.body ?? "")) out.push(`la route « ${o.route} » (${o.label}) révèle un détail interne dans sa réponse`);
      }
      return [...new Set(out)];
    },
  },
  {
    id: "routes.protected", level: "mandatory", group: "routes",
    title: "Une route publique qui écrit est protégée contre les abus",
    what: "Quarante envois valides, à la suite, depuis le même visiteur, ne sont pas tous acceptés : la route a un limiteur de débit, un plafond de stockage, un code d'accès ou une modération qui la protège.",
    why: "Une route ouverte à tous qui écrit sans limite permet à un robot de remplir le stockage du site en quelques minutes.",
    fix: "Ajoutez un limiteur de débit par visiteur (voir limited() dans l'exemple guestbook : N envois par heure), un plafond du nombre d'éléments stockés (réponse 503 au-delà), et un champ piège pour les robots.",
    async run(m) {
      if (!Object.keys(m.definition?.routes ?? {}).length) return { na: "le module n'a pas de routes" };
      const obs = await observe(m);
      const bursts = new Map();
      for (const o of obs.runs.protection.outputs) if (o.kind === "route" && o.label === "POST-burst" && o.ok) {
        const b = bursts.get(o.route) ?? { sent: 0, accepted: 0 };
        b.sent++;
        if (ok2xx(o.value.status) && o.wrote > 0) b.accepted++;
        bursts.set(o.route, b);
      }
      const out = [];
      for (const [route, b] of bursts) if (b.accepted >= 40) out.push(`la route « ${route} » a accepté et rangé ${b.accepted} envois sur ${b.sent} sans jamais limiter`);
      return out;
    },
  },
  {
    id: "mcp.name", level: "mandatory", group: "mcp",
    title: "Les noms d'outils MCP restent assez courts",
    what: "L'outil visible par l'assistant s'appelle « clé-de-l'instance__nom-de-l'action ». Avec une clé de 31 caractères au plus, le nom d'action fait 31 caractères au plus pour que le total ne dépasse jamais 64.",
    why: "Les assistants IA refusent les outils dont le nom dépasse 64 caractères : l'action disparaîtrait sans message pour une instance à clé longue.",
    fix: "Raccourcissez le nom de l'action dans module.json (« mcp ») et dans le code, par exemple « guestbook_list » plutôt que « list_all_guestbook_messages_for_moderation ».",
    run(m) {
      const mcp = m.manifest?.mcp;
      if (!Array.isArray(mcp) || !mcp.length) return { na: "le module n'a pas d'actions MCP" };
      const max = 64 - 2 - 31;
      return mcp.filter((a) => String(a?.name ?? "").length > max).map((a) => `l'action « ${a.name} » fait ${a.name.length} caractères (31 au plus : l'outil complet ferait ${a.name.length + 33} caractères avec une clé d'instance de 31)`);
    },
  },
  {
    id: "mcp.safety", level: "mandatory", group: "mcp",
    title: "Les outils MCP déclarent honnêtement ce qu'ils font",
    what: "Une action qui lit seulement est marquée « readOnly » ; une action qui écrit n'est jamais activée par défaut (« default »: true) ; une action irréversible est « destructive » (et jamais par défaut) ; une action dont le nom parle de suppression ou de publication est « destructive ».",
    why: "L'administrateur décide quels outils chaque assistant peut utiliser, et par défaut un assistant reçoit les outils « sûrs ». Un outil qui écrit, annoncé par erreur comme sûr, laisse un assistant modifier le site sans accord.",
    fix: "Dans module.json (« mcp »), ajoutez \"readOnly\": true aux lectures, retirez \"default\": true des écritures, et ajoutez \"destructive\": true à tout ce qui supprime, retire ou publie.",
    run(m) {
      const mcp = m.manifest?.mcp;
      if (!Array.isArray(mcp) || !mcp.length) return { na: "le module n'a pas d'actions MCP" };
      const out = [];
      for (const a of mcp) {
        if (!a.readOnly && a.default === true) out.push(`l'action « ${a.name} » écrit mais est activée par défaut ("default": true)`);
        if (a.destructive && a.default === true) out.push(`l'action « ${a.name} » est destructive et activée par défaut`);
        if (a.readOnly && a.destructive) out.push(`l'action « ${a.name} » ne peut pas être à la fois lecture seule et destructive`);
        if (/(^|_)(delete|remove|destroy|purge|publish|erase|wipe)(_|$)/.test(a.name) && !a.destructive) out.push(`l'action « ${a.name} » semble supprimer ou publier mais n'est pas marquée "destructive": true`);
        if (/(^|_)(list|get|read|search|find|show)(_|$)/.test(a.name) && !a.readOnly && !/(^|_)(set|add|create|update|delete|remove|approve)(_|$)/.test(a.name)) out.push(`l'action « ${a.name} » semble ne faire que lire : si c'est le cas, ajoutez "readOnly": true`);
      }
      return out;
    },
  },
  {
    id: "mcp.readOnly", level: "mandatory", group: "mcp",
    title: "Une action « lecture seule » ne modifie rien",
    what: "Appeler une action marquée « readOnly » ne modifie pas le stockage et n'envoie pas d'e-mail.",
    why: "Les accès en lecture seule donnent des actions « readOnly » aux assistants les moins fiables : si elles écrivent, la protection ne sert à rien.",
    fix: "Retirez \"readOnly\": true de l'action si elle écrit vraiment (et mettez-la hors défaut), ou supprimez l'écriture de l'action.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const ro = new Set((m.parsed.manifest.mcp ?? []).filter((a) => a.readOnly).map((a) => a.name));
      if (!ro.size) return { na: "aucune action MCP en lecture seule" };
      const obs = await observe(m);
      const out = [];
      for (const run of [obs.runs.filled, obs.runs.hostile]) for (const o of run.outputs) if (o.kind === "mcp" && ro.has(o.name) && o.wrote > 0) out.push(`l'action « ${o.name} » est en lecture seule mais a écrit (${o.wrote} écriture${o.wrote > 1 ? "s" : ""} ou e-mail)`);
      return [...new Set(out)];
    },
  },
  {
    id: "mcp.described", level: "advice", group: "mcp",
    title: "Les outils MCP sont bien décrits",
    what: "Chaque action a une description claire (une phrase) ; chaque paramètre est décrit, les textes ont une longueur maximale, et chaque paramètre « required » existe.",
    why: "L'assistant ne voit que ces descriptions pour choisir l'outil et remplir ses paramètres. Une description vague donne des erreurs et des appels inutiles.",
    fix: "Complétez « description » de l'action et de chacun de ses paramètres, ajoutez \"maxLength\" aux textes, en anglais simple.",
    run(m) {
      const mcp = m.manifest?.mcp;
      if (!Array.isArray(mcp) || !mcp.length) return { na: "le module n'a pas d'actions MCP" };
      const out = [];
      for (const a of mcp) {
        if (String(a.description ?? "").trim().length < 20) out.push(`l'action « ${a.name} » a une description trop courte`);
        const props = a.input?.properties ?? {};
        for (const [k, p] of Object.entries(props)) {
          if (!p.description) out.push(`le paramètre « ${k} » de « ${a.name} » n'a pas de description`);
          if (p.type === "string" && !p.enum && !p.maxLength) out.push(`le paramètre texte « ${k} » de « ${a.name} » n'a pas de longueur maximale ("maxLength")`);
        }
        for (const r of a.input?.required ?? []) if (!(r in props)) out.push(`« ${r} » est « required » dans « ${a.name} » mais n'est pas un paramètre`);
        if (!a.input) out.push(`l'action « ${a.name} » ne déclare pas ses paramètres ("input")`);
      }
      return out;
    },
  },
  {
    id: "tasks.valid", level: "mandatory", group: "tasks",
    title: "Les tâches planifiées sont bien déclarées",
    what: "Chaque tâche a un intervalle « everyMinutes » (nombre d'au moins 1) et une fonction « run ».",
    why: "Le cœur lance les tâches une fois par minute au plus : un intervalle absent ou inférieur à 1 minute n'est jamais respecté, la tâche ne tournerait pas comme prévu.",
    fix: "Écrivez par exemple tasks: { refresh: { everyMinutes: 60, async run(ctx) { … } } }.",
    run(m) {
      const tasks = m.definition?.tasks;
      if (!tasks || !Object.keys(tasks).length) return { na: "le module n'a pas de tâches planifiées" };
      return Object.entries(tasks).filter(([, t]) => !(typeof t?.everyMinutes === "number" && Number.isFinite(t.everyMinutes) && t.everyMinutes >= 1)).map(([k, t]) => `la tâche « ${k} » a un intervalle invalide (${JSON.stringify(t?.everyMinutes)}) : il faut un nombre de minutes d'au moins 1`);
    },
  },
  {
    id: "tasks.idempotent", level: "mandatory", group: "tasks",
    title: "Lancer une tâche deux fois de suite ne duplique rien",
    what: "Exécuter deux fois la même tâche, dans la même situation, ne crée pas de nouvelles données et n'envoie pas deux fois la même notification.",
    why: "Le cœur peut relancer une tâche (après une panne, un redémarrage, une exécution en retard). Sans cette garantie, le site se remplit de doublons ou prévient dix fois du même événement.",
    fix: "Avant de créer un élément, cherchez s'il existe déjà (par un identifiant stable de la source) et mettez-le à jour au lieu d'en ajouter un. Mémorisez ce qui a déjà été notifié.",
    async run(m) {
      const tasks = m.definition?.tasks;
      if (!tasks || !Object.keys(tasks).length) return { na: "le module n'a pas de tâches planifiées" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const out = [];
      for (const [name, task] of Object.entries(tasks)) {
        if (typeof task?.run !== "function") continue;
        const ctx = makeCtx(m, { mode: "filled", locale: "fr" });
        const snap = () => JSON.stringify(ctx.dumpStore().map((r) => [r.collection, r.data]));
        const count = () => ctx.dumpStore().length;
        try {
          await Promise.race([task.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error("trop long")), 8000).unref())]);
          const afterFirst = { rows: count(), mails: ctx.calls.mail.length };
          await Promise.race([task.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error("trop long")), 8000).unref())]);
          if (count() > afterFirst.rows) out.push(`la tâche « ${name} » a ajouté ${count() - afterFirst.rows} élément(s) de plus à la deuxième exécution (doublons)`);
          if (ctx.calls.mail.length > afterFirst.mails) out.push(`la tâche « ${name} » a renvoyé un e-mail à la deuxième exécution`);
          void snap;
        } catch (e) {
          // une tâche qui échoue sans réseau ne duplique rien : l'échec est jugé par « tasks.failure »
          void e;
        }
      }
      return out;
    },
  },
  {
    id: "tasks.failure", level: "advice", group: "tasks",
    title: "Une tâche supporte un service indisponible",
    what: "Quand le réseau ne répond pas, la tâche se termine sans erreur (elle note l'échec et réessaiera) au lieu de s'interrompre.",
    why: "Le cœur isole les erreurs, mais une tâche qui lève une exception perd son travail en cours et affiche une erreur dans l'administration à chaque panne passagère.",
    fix: "Entourez l'appel réseau d'un try/catch : en cas d'échec, gardez les anciennes données et terminez normalement.",
    async run(m) {
      const tasks = m.definition?.tasks;
      if (!tasks || !Object.keys(tasks).length) return { na: "le module n'a pas de tâches planifiées" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const out = [];
      const { watchNetwork } = await import("../loader.mjs");
      for (const [name, task] of Object.entries(tasks)) {
        if (typeof task?.run !== "function") continue;
        const ctx = makeCtx(m, { mode: "filled", locale: "fr" });
        const saved = { log: console.log, warn: console.warn, error: console.error };
        console.log = console.warn = console.error = () => {};
        try { await watchNetwork(() => Promise.race([task.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Error("trop long")), 8000).unref())])); } catch (e) { out.push(`la tâche « ${name} » s'interrompt quand le réseau est coupé : ${String(e?.message ?? e).slice(0, 100)}`); } finally { Object.assign(console, saved); }
      }
      return out;
    },
  },
  {
    id: "data.version", level: "mandatory", group: "data",
    title: "dataVersion et migrations sont cohérentes",
    what: "Chaque migration porte un numéro entre 2 et dataVersion ; un module sans dataVersion n'a pas de migrations ; un module qui change la forme de ses données (dataVersion > 1) les convertit.",
    why: "Quand la forme des données stockées change, les anciennes données d'un site doivent suivre. Le cœur rejoue les migrations dans l'ordre après une mise à jour : une migration au mauvais numéro ne serait jamais jouée et laisserait des données illisibles.",
    fix: "Augmentez « dataVersion » de 1 à chaque changement de forme des données et écrivez migrations: { 2: async (ctx) => { … } } qui convertit celles de la version précédente.",
    run(m) {
      const man = m.manifest ?? {};
      const migs = Object.keys(m.definition?.migrations ?? {});
      const dv = man.dataVersion ?? 1;
      if (!migs.length && dv <= 1) return { na: "les données n'ont jamais changé de forme (dataVersion 1)" };
      const out = [];
      for (const k of migs) {
        const n = Number(k);
        if (!Number.isInteger(n) || n < 2) out.push(`la migration « ${k} » n'a pas un numéro valide (2 ou plus)`);
        else if (n > dv) out.push(`la migration ${n} ne sera jamais jouée : dataVersion vaut ${dv}`);
      }
      if (dv > 1 && !migs.length) out.push(`dataVersion vaut ${dv} mais le module n'a aucune migration : les anciennes données ne seraient pas converties`);
      return out;
    },
  },
  {
    id: "data.migrations", level: "advice", group: "data",
    title: "Les migrations se déroulent sans erreur",
    what: "Chaque migration s'exécute sans erreur sur un stockage vide, et deux fois de suite sans rien dupliquer.",
    why: "Une migration qui échoue met l'instance à l'écart sur le site réel. Le test sur stockage vide attrape les erreurs les plus bêtes avant qu'un administrateur ne les rencontre.",
    fix: "Traitez le cas « rien à convertir » (liste vide) et ne supposez aucun champ : lisez-les avec une valeur par défaut.",
    async run(m) {
      const migs = m.definition?.migrations;
      if (!migs || !Object.keys(migs).length) return { na: "pas de migrations" };
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const out = [];
      for (const [k, fn] of Object.entries(migs)) {
        if (typeof fn !== "function") continue;
        const ctx = fakeCtx({ ...{ migration: true, moduleId: m.manifest.id, permissions: m.manifest.permissions ?? [], messages: m.locales.fr ?? {} } });
        try { await fn(ctx); const n = ctx.dumpStore().length; await fn(ctx); if (ctx.dumpStore().length > n) out.push(`la migration ${k} duplique des données quand elle est jouée deux fois`); } catch (e) { out.push(`la migration ${k} échoue sur un stockage vide : ${String(e?.message ?? e).slice(0, 100)}`); }
      }
      return out;
    },
  },
  {
    id: "privacy.declared", level: "mandatory", group: "privacy",
    title: "Un module qui collecte des données le déclare (privacy)",
    what: "Si le module reçoit des données de visiteurs (formulaire public qui enregistre ou envoie quelque chose), module.json a un texte « privacy » en français et en anglais : quoi, pourquoi, comment faire effacer.",
    why: "Le site écrit lui-même sa politique de confidentialité d'après ce que déclarent ses modules. Sans votre déclaration, elle serait fausse — et le propriétaire du site responsable d'une collecte qu'il ignore.",
    fix: "Ajoutez dans module.json : \"privacy\": { \"fr\": \"Si vous … votre nom et votre message sont … Pour les faire retirer, écrivez au contact du site.\", \"en\": \"…\" }.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const collects = [];
      for (const run of Object.values(obs.runs)) for (const o of run.outputs) if (o.kind === "route" && o.ok && o.method === "POST" && (o.wrote > 0 || o.mailed > 0) && o.value?.status < 400) collects.push(o.route);
      const publicForms = [...new Set(Object.values(obs.runs).flatMap((r) => r.forms).filter((f) => !f.admin).map((f) => String(f.action).split(/[?#]/)[0].split("/").filter(Boolean).pop()).filter(Boolean))];
      if (!collects.length && !publicForms.length) return { na: "le module ne collecte rien auprès des visiteurs" };
      const p = m.manifest.privacy;
      const miss = ["fr", "en"].filter((l) => !String(typeof p === "string" ? p : p?.[l] ?? "").trim());
      if (miss.length === 2 || (typeof p === "string" && !p.trim())) return [`le module reçoit des données de visiteurs (route ${[...new Set([...collects, ...publicForms])].join(", ")}) mais module.json n'a pas de « privacy »`];
      return miss.map((l) => `la déclaration « privacy » n'a pas de texte ${l === "fr" ? "français" : "anglais"}`);
    },
  },
  {
    id: "privacy.thirdParty", level: "advice", group: "privacy",
    title: "Les services tiers chargés chez le visiteur sont mentionnés",
    what: "Si une page du module charge quelque chose depuis un autre site (vidéo intégrée, script, iframe), module.json le dit dans « privacy ».",
    why: "Charger un service tiers transmet l'adresse (IP) du visiteur à ce service. C'est une information que le propriétaire doit connaître et pouvoir donner dans sa politique de confidentialité.",
    fix: "Ajoutez une phrase dans « privacy » (fr et en) : « Cette page charge un lecteur de <service> : … », ou n'intégrez pas le service.",
    async run(m) {
      if (!m.parsed?.ok) return { skip: "module.json invalide" };
      const obs = await observe(m);
      const found = new Set();
      for (const run of obs.plain) for (const o of run.outputs) if (o.ok) walkValue(o.value, (x) => {
        if (x && typeof x === "object" && x.type === "embed" && /^https?:\/\//.test(String(x.src ?? ""))) found.add(String(x.src).slice(0, 60));
        if (typeof x === "string" && /<(iframe|script)[^>]+src\s*=\s*["']?https?:\/\//i.test(x)) found.add("un iframe ou script externe");
        if (x && typeof x === "object" && x.tag === "script" && /^https?:\/\//.test(String(x.src ?? ""))) found.add(String(x.src).slice(0, 60));
      });
      if (!found.size) return { na: "aucun service tiers chargé" };
      return m.manifest.privacy ? [] : [`une page charge un service extérieur (${[...found].join(", ")}) mais module.json ne le mentionne pas dans « privacy »`];
    },
  },
  {
    id: "srp.single", level: "mandatory", group: "srp",
    title: "Un module fait une chose ; chaque donnée a un seul propriétaire",
    what: "Comparé aux autres modules du même ensemble : pas de service offert par deux modules, pas d'action MCP du même nom, pas de réglage secret identique demandé à deux modules sans lien, pas de collection de données de même nom chez deux modules sans lien.",
    why: "Deux modules qui offrent la même chose ou demandent la même clé obligent l'administrateur à tout saisir deux fois et créent des conflits. Une donnée a un propriétaire ; les autres modules la demandent à ce propriétaire (service).",
    fix: "Confiez la donnée ou la clé à un seul module (fournisseur) que l'autre appelle par un service (offers / requires), ou renommez ce qui n'est qu'une coïncidence de nom.",
    async run(m) {
      if (!m.manifest) return { skip: "module.json illisible" };
      const sib = (m.siblings ?? []).filter((s) => s && s.id !== (m.manifest.id ?? m.name));
      if (!sib.length) return { na: "aucun autre module fourni pour comparer (option --voisins)" };
      const me = { id: m.manifest.id ?? m.name, ...m.manifest };
      const out = findSrpViolations([me, ...sib.map((s) => ({ id: s.id, ...s.manifest }))]).filter((v) => v.modules.includes(me.id)).map((v) => v.message);
      const colls = (code) => new Set([...stripComments(code).matchAll(/(?:store\.(?:add|list|count)|\ball)\(\s*(?:ctx,\s*)?"([A-Za-z]+)"/g)].map((x) => x[1]));
      const offeredBy = (service) => [me, ...sib.map((s) => ({ id: s.id, ...s.manifest }))].filter((x) => (x.offers ?? []).some((o) => o.service === service)).map((x) => x.id);
      const related = (a, b) => [[a, b], [b, a]].some(([x, y]) => (x.requires ?? []).some((r) => offeredBy(r.service).includes(y.id)));
      for (const c of colls(m.code)) for (const s of sib) if (colls(s.code).has(c) && !related(me, { id: s.id, ...s.manifest })) out.push(`la collection de données « ${c} » est utilisée par ce module et par « ${s.id} », qui ne sont ni fournisseur ni consommateur l'un de l'autre`);
      return out;
    },
  },
  {
    id: "srp.coupling", level: "advice", group: "srp",
    title: "Le module ne connaît pas un autre module par son nom",
    what: "Le code ne cherche pas les instances d'un module précis (ctx.api.instances.list({ module: \"…\" })) : il dépend d'un service ou d'un sujet, pas d'un module.",
    why: "On dépend d'un service, jamais d'un module précis : n'importe quel module qui l'offre doit convenir. Une dépendance nommée casse dès que l'autre module est remplacé ou renommé.",
    fix: "Déclarez ce dont vous avez besoin avec « requires » (service) ou « consumes » (sujet) et appelez ctx.api.services / ctx.api.topics.",
    run(m) {
      const hit = [...stripComments(m.code).matchAll(/instances\s*\.\s*list\s*\(\s*\{[^}]*\bmodule\s*:\s*["']([^"']+)["']/g)].map((x) => x[1]);
      return [...new Set(hit)].map((id) => `le code cherche les instances du module « ${id} » par son nom`);
    },
  },
];
export default requirements;

