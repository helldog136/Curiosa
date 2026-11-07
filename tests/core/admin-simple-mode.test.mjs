// GARDE-FOU DU MODE SIMPLE : les pages d'administration du cœur, rendues pour une personne en mode simple (le mode d'un site neuf),
// doivent parler comme une personne qui crée du contenu, pas comme le code.
//   1. aucun mot de la liste R9 (testsupport/ergonomics.mjs, FORBIDDEN_WORDS) dans un texte visible, libellé, aide, placeholder ou info-bulle ;
//   2. au plus 7 réglages simples visibles par onglet (R4/R5 : un champ replié sous « Plus d'options » ou caché derrière le mode avancé ne compte pas) ;
//   3. aucune entrée de menu « avancée » en mode simple (adminMenu.ts : ADVANCED_ONLY_ENTRIES) ;
//   4. le changement de mode (réglage de la personne en base) : persistant, propre à chacune, relu à chaque rechargement, sans fuite par un lien direct.
// Chaque page est vraiment rendue (react-dom/server, base jetable), pas lue dans le code. Une page qui ne peut pas être rendue ici (réseau) est listée
// explicitement dans SKIPPED, avec la raison : elle n'est jamais ignorée en silence.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
/** Rend un arbre React jusqu'au bout, Suspense compris (les pages qui attendent des données avec des composants asynchrones). */
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const { forbiddenWords } = await import("../../testsupport/ergonomics.mjs");
const { RedirectError } = await import("next/navigation");
const { administrationEntries, ADVANCED_ONLY_ENTRIES, ADVANCED_ONLY_TABS, maintenanceTabs } = await import("@/core/modules/adminMenu");
const { setSetting } = await import("@/core/settings");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");

after(() => db.close());

const PANEL = "../../src/app/admin/(panel)";
/** Les pages du cœur du mode simple. `args` : les propriétés de la page (paramètres d'adresse). */
const PAGES = [
  ["dashboard", "page.tsx"], ["settings", "settings/page.tsx"], ["appearance", "appearance/page.tsx"], ["users", "users/page.tsx"], ["backup", "backup/page.tsx"],
  ["updates", "updates/page.tsx"], ["health", "maintenance/content/page.tsx"], ["redirects", "redirects/page.tsx"], ["social", "social/page.tsx"],
  ["navigation", "navigation/page.tsx"], ["home", "home/page.tsx"], ["overlay-pages", "overlay-pages/page.tsx"],
  ["assistants", "assistants/page.tsx"], ["account", "account/page.tsx"], ["mode", "mode/page.tsx"], ["extensions", "extensions/page.tsx"],
  ["extensions/add", "extensions/add/page.tsx"], ["extensions/updates", "extensions/updates/page.tsx"], ["maintenance/legacy", "maintenance/legacy/page.tsx"],
];
/** Pages qu'on ne peut pas rendre sans réseau ni dépôt : la raison est écrite ici. Vide aujourd'hui : tout se rend. */
const SKIPPED = new Map();

/**
 * Mots de la liste R9 qui sont le BON mot à cet endroit (un tiers l'impose, ou ce n'est pas le sens technique). Chaque entrée dit pourquoi.
 * `re` : le texte entier doit la vérifier. Ce n'est pas une dette : une dette ne se met pas ici, elle se corrige.
 */
const ALLOWED = [
  { term: /^cl[ée]s?$/, re: /cl[ée]s? d['’]acc[èe]s|passkey/i, why: "« clé d'accès » est le nom français imposé par les appareils et les navigateurs pour la connexion sans mot de passe" },
  { term: /^cl[ée]s?$/, re: /cl[ée] de s[ée]curit[ée]/i, why: "« clé de sécurité » : l'objet physique que la personne tient en main" },
  { term: /^sujets?$/, re: /\bsujet (?:du|de votre|de l['’]|d['’])\s*(?:message|e-?mail|courriel|mail)/i, why: "« sujet » d'un e-mail est le mot courant" },
  { term: /^services?$/, re: /\bservice (?:client|public)\b/i, why: "« service client » est une expression ordinaire" },
  { term: /^routes?$/, re: /mise en route/i, why: "« mise en route » : l'expression ordinaire pour « démarrer », pas la route d'un serveur" },
  { term: /^cache$/, re: /\bcache\b.{0,20}(?:les|des) /i, why: "« cache » verbe (cacher), pas la mémoire technique" },
];

/** Texte lisible d'une page : le texte, plus placeholder, title, aria-label, alt, value des boutons. Les scripts et styles n'en font pas partie. */
function visibleTexts(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const out = [];
  for (const m of body.matchAll(/\s(?:placeholder|title|aria-label|alt)="([^"]*)"/g)) out.push(m[1]);
  const text = body.replace(/<[^>]*>/g, "\n").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  for (const l of text.split("\n")) if (l.trim()) out.push(l.trim());
  return out.map((s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&"));
}

/** Les champs visibles de chaque onglet : ni replié (<details> fermé), ni caché, ni de type hidden. Un petit lecteur de balises suffit (pas de DOM ici). */
function fieldsPerTab(html) {
  const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "path", "circle", "rect", "source"]);
  const stack = []; // { tag, tabs, folded }
  const counts = new Map();
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g)) {
    const [, close, rawTag, attrs, selfClose] = m; const tag = rawTag.toLowerCase();
    if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    const parent = stack[stack.length - 1];
    const tabAttr = /\sdata-tab="([^"]*)"/.exec(attrs)?.[1];
    const folded = (parent?.folded ?? false) || (tag === "details" && !/\sopen(?:=|\s|$)/.test(attrs + " ")) || /\shidden(?:=|\s|$)/.test(attrs + " ") || /\sclass="[^"]*\bhidden\b/.test(attrs);
    const tabs = tabAttr ? tabAttr.split(/\s+/) : (parent?.tabs ?? ["(page)"]);
    const isField = tag === "select" || tag === "textarea" || (tag === "input" && !/\stype="(?:hidden|submit|button|image|file|reset)"/.test(attrs) && !/\stype="checkbox"[^>]*\sclass="[^"]*\bsr-only/.test(attrs));
    if (isField && !folded && !/\sdisabled(?:=|\s|$)/.test(attrs + " ")) for (const t of tabs) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (!VOID.has(tag) && !selfClose) stack.push({ tag, tabs, folded });
  }
  return counts;
}

let owner, editorUser;
before(async () => {
  await db.reset();
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]); // un site neuf : une seule langue (le multilingue montre un champ par langue) await setSetting("i18n.adminDefault", "fr"); await setSetting("setup.completed", true);
  await setSetting("site.name", "Le site d'Emma", "fr");
  owner = await prisma.user.create({ data: { email: "emma@example.org", name: "Emma", role: "owner", passwordHash: "x", locale: "fr" } }); // advanced : faux par défaut = mode simple
  editorUser = await prisma.user.create({ data: { email: "lea@example.org", name: "Léa", role: "editor", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});

const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
async function render(file, props = {}) {
  as(owner);
  const mod = await import(`${PANEL}/${file}`);
  try { return await renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}), ...props })); }
  catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}
const setMode = (u, advanced) => prisma.user.update({ where: { id: u.id }, data: { advanced } });

/* ───────────── 1 et 2 : les pages du cœur en mode simple ───────────── */

const simpleHtml = new Map();
for (const [name, file] of PAGES) {
  test(`mode simple : « ${name} » se rend`, async (t) => {
    if (SKIPPED.has(name)) return t.skip(SKIPPED.get(name));
    await setMode(owner, false);
    const html = await render(file);
    assert.doesNotMatch(html, /^redirect:/, `${name} redirige en mode simple : ${html}`);
    assert.ok(html.length > 500, `${name} : page vide`);
    simpleHtml.set(name, html);
  });
}

test("mode simple : aucun mot de la liste R9 dans les textes visibles des pages du cœur", () => {
  const problems = [];
  for (const [name, html] of simpleHtml) {
    for (const line of visibleTexts(html)) {
      for (const w of forbiddenWords(line)) {
        if (ALLOWED.some((a) => a.term.test(w) && a.re.test(line))) continue;
        problems.push(`${name} : « ${w} » dans « ${line.slice(0, 100)} »`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], [], "mots techniques visibles en mode simple (à reformuler, ou à passer en mode avancé) :\n" + [...new Set(problems)].join("\n"));
});

test("mode simple : au plus 7 réglages visibles par onglet (R4/R5), les champs repliés ne comptent pas", () => {
  const problems = [];
  for (const [name, html] of simpleHtml) for (const [tab, n] of fieldsPerTab(html)) if (n > 7) problems.push(`${name} / ${tab} : ${n} champs visibles`);
  assert.deepEqual(problems, [], "trop de champs visibles en mode simple (à replier sous « Plus d'options » ou à passer en avancé)");
});

test("le compteur de champs sait compter (et ne compte ni le replié, ni le caché)", () => {
  const html = '<div data-tab="a"><input type="text" name="x"/><input type="hidden" name="h"/><details><summary>+</summary><input name="y"/></details><details open><summary>+</summary><select name="z"></select></details><textarea hidden></textarea></div><div data-tab="b"><input name="u"/></div>';
  const c = fieldsPerTab(html);
  assert.equal(c.get("a"), 2);
  assert.equal(c.get("b"), 1);
});

test("la liste R9 attrape bien un texte technique (le garde-fou n'est pas muet)", () => {
  assert.ok(forbiddenWords("Collez votre jeton et votre clé").length >= 2);
  assert.deepEqual(forbiddenWords("Collez le lien de votre page."), []);
});

/* ───────────── 3 : le menu ───────────── */

test("menu : aucune entrée avancée en mode simple, pour chaque palier ; le mode avancé ne retire rien", () => {
  assert.deepEqual(ADVANCED_ONLY_TABS, ["audit"], "le journal d'activité est l'onglet avancé d'Entretien");
  for (const role of ["owner", "coordinator", "admin", "editor", "none"]) {
    const simple = administrationEntries({ role, advanced: false });
    const adv = administrationEntries({ role, advanced: true });
    for (const e of ADVANCED_ONLY_ENTRIES) assert.ok(!simple.includes(e), `${role} : « ${e} » ne doit pas apparaître en mode simple`);
    for (const e of simple) assert.ok(adv.includes(e), `${role} : le mode avancé garde « ${e} »`);
  }
  assert.ok(maintenanceTabs({ role: "owner", advanced: true }).includes("audit"), "le journal d'activité est bien là en mode avancé");
  for (const role of ["owner", "coordinator", "admin", "editor", "none"]) assert.ok(!maintenanceTabs({ role, advanced: false }).includes("audit"), `${role} : pas de journal d'activité en mode simple`);
});

test("menu rendu : le journal d'activité n'est pas un onglet d'Entretien en mode simple, il y est en mode avancé", async () => {
  const Layout = (await import(`${PANEL}/layout.tsx`)).default;
  const nav = async (advanced) => { await setMode(owner, advanced); as(owner); return await renderAll(await Layout({ children: null })); };
  const simple = await nav(false); const adv = await nav(true);
  // Les onglets sont dans les pages (MaintenanceHeader), pas dans la barre latérale : le menu n'a qu'une entrée.
  assert.doesNotMatch(simple, /href="\/admin\/audit"/);
  assert.doesNotMatch(adv, /href="\/admin\/audit"/);
  assert.match(simple, /href="\/admin\/maintenance\/content"/, "une seule entrée « Entretien »");
  const { MaintenanceHeader } = await import("../../src/components/admin/MaintenanceHeader.tsx");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  const bar = async (advanced) => renderAll(await MaintenanceHeader({ t: makeTranslator("fr"), level: "owner", advanced, current: "health" }));
  assert.doesNotMatch(await bar(false), /href="\/admin\/audit"/);
  assert.match(await bar(true), /href="\/admin\/audit"/);
  assert.match(simple, /href="\/admin\/settings"/, "le menu simple garde l'essentiel");
  assert.match(simple, /data-testid="app-version"/);
  await setMode(owner, false);
});

/* ───────────── 4 : le changement de mode ───────────── */

test("un site neuf est en mode simple ; le mode est un réglage de la personne, pas du site", async () => {
  const fresh = await prisma.user.create({ data: { email: "neuf@example.org", name: "Neuf", role: "admin", passwordHash: "x" } });
  assert.equal(fresh.advanced, false);
  assert.equal(owner.advanced, false);
});

test("changer de mode : persistant au rechargement, propre à chaque personne, réversible, la page Mode dit où on en est", async () => {
  const { setAdminMode } = await import(`${PANEL}/mode/actions.ts`);
  await setMode(owner, false); await setMode(editorUser, false);
  as(owner);
  const page = async () => render("mode/page.tsx");
  assert.match(await page(), /data-testid="mode-simple"[^>]*aria-current="true"|aria-current="true"[^>]*data-testid="mode-simple"/);
  await setAdminMode(true).catch((e) => { if (!/revalidatePath|static generation store/.test(String(e))) throw e; });
  assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).advanced, true, "le choix est enregistré");
  assert.match(await page(), /data-testid="mode-advanced"[^>]*aria-current="true"|aria-current="true"[^>]*data-testid="mode-advanced"/, "relu au rechargement");
  assert.equal((await prisma.user.findUnique({ where: { id: editorUser.id } })).advanced, false, "une autre personne garde son mode");
  await setAdminMode(false).catch((e) => { if (!/revalidatePath|static generation store/.test(String(e))) throw e; });
  assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).advanced, false, "retour au mode simple");
  assert.match(await page(), /data-testid="mode-simple"[^>]*aria-current="true"|aria-current="true"[^>]*data-testid="mode-simple"/);
});

test("le mode survit au changement de langue de l'interface et à une autre page (relu en base à chaque requête)", async () => {
  await setMode(owner, true);
  await prisma.user.update({ where: { id: owner.id }, data: { locale: "en" } });
  as(owner);
  const html = await render("mode/page.tsx");
  assert.match(html, /aria-current="true"/);
  assert.match(html, /Advanced mode/, "interface en anglais, mode avancé gardé");
  const { adminCtx } = await import("@/core/admin");
  assert.equal((await adminCtx("member")).advanced, true);
  await prisma.user.update({ where: { id: owner.id }, data: { locale: "fr" } });
  await setMode(owner, false);
  assert.equal((await adminCtx("member")).advanced, false);
});

test("lien direct : un onglet ou un réglage avancé d'une extension ne s'ouvre pas en mode simple (?tab=sources, réglage avancé absent)", async () => {
  const manifest = {
    apiVersion: 2, id: "demo-mode", name: "Demo", version: "1.0.0", main: "index.mjs", minCore: "0.2.0",
    consumes: [{ topic: "demo.topic", label: { fr: "Source de démonstration", en: "Demo source" } }],
    settings: [
      { key: "title", type: "text", label: "Titre visible", optional: true },
      { key: "secretknob", type: "text", label: "Réglage technique XYZ", optional: true, advanced: true },
    ],
  };
  const res = await installModule(makeRepo({ "module.json": manifest, "index.mjs": "export default {};" }).url, { dependencies: false });
  assert.equal(res.ok, true, JSON.stringify(res));
  await prisma.moduleInstance.deleteMany({ where: { moduleId: "demo-mode" } });
  const inst = await createInstance(prisma, { manifest: (await R.getModule("demo-mode")).manifest, names: { fr: "Démo" } });
  const view = async (query) => { as(owner); const P = (await import(`${PANEL}/instances/[id]/page.tsx`)).default; return await renderAll(await P({ params: Promise.resolve({ id: inst.id }), searchParams: Promise.resolve(query) })); };

  await setMode(owner, false);
  for (const q of [{}, { tab: "sources" }, { tab: "advanced" }, { tab: "general" }, { tab: "settings" }]) {
    const html = await view(q);
    assert.doesNotMatch(html, /Réglage technique XYZ/, `réglage avancé visible en mode simple (${JSON.stringify(q)})`);
    assert.doesNotMatch(html, /Source de démonstration/, `onglet Sources visible en mode simple (${JSON.stringify(q)})`);
    assert.doesNotMatch(html, /Options avancées/, `« Options avancées » visible en mode simple (${JSON.stringify(q)})`);
    assert.match(html, /Titre visible/, `le réglage simple reste visible (${JSON.stringify(q)})`);
  }
  await setMode(owner, true);
  const adv = await view({ tab: "settings" });
  assert.match(adv, /Réglage technique XYZ/, "le mode avancé montre le réglage avancé");
  assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).advanced, true);
  await setMode(owner, false);
});

test("un réglage passé en avancé garde sa valeur : l'enregistrement en mode simple n'efface pas les réglages avancés", async () => {
  const { saveInstanceSettings } = await import(`${PANEL}/instances/actions.ts`);
  const inst = await prisma.moduleInstance.findFirst({ where: { moduleId: "demo-mode" } });
  const { instanceSettingKey } = await import("@/core/modules/context");
  const { getSettingByLocale } = await import("@/core/settings");
  await setSetting(instanceSettingKey(inst.id, "secretknob"), "valeur-avancee");
  as(owner); await setMode(owner, false);
  const fd = new FormData(); fd.set("id", inst.id); fd.set("s__title", "Bonjour");
  assert.ok((await saveInstanceSettings(null, fd)).ok);
  assert.equal((await getSettingByLocale(instanceSettingKey(inst.id, "secretknob")))[""], "valeur-avancee", "la valeur avancée est intacte");
});
