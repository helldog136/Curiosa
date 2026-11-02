// Changement de domaine : liste de contrôle réelle (comptes, adresses de retour déclarées par les modules, recherche de l'ancien domaine en lecture seule, aucun secret),
// commandes du serveur, pages « Adresse du site » et « Après le changement », contrôles sortants sûrs, coches mémorisées.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { prisma } = db;
process.env.SITE_URL = "https://ancien.example.org";
const { renderToStaticMarkup } = await import("react-dom/server");
const { parseManifest } = await import("@/core/modules/manifest");
const { installModule } = await import("@/core/modules/installer");
const { createInstance } = await import("@/core/instanceService");
const R = await import("@/core/modules/registry");
const { setSetting } = await import("@/core/settings");
const { createToken } = await import("@/core/services/mcp/tokens");
const C = await import("@/core/domainChecklist");
const K = await import("@/core/domainChecks");
const Cmd = await import("@/core/domainCommands");
const { state: headerState } = await import("../helpers/stubs/next-headers.mjs");

beforeEach(async () => { await db.reset(); globalThis.curiosaTestSession = null; headerState.headers.clear(); delete process.env.LEGACY_HOSTS; });
after(() => db.close());

const OLD = "https://ancien.example.org", NEW = "https://nouveau.example.org";
const L = (fr, en = fr) => ({ fr, en });
const manifest = (id, over = {}) => ({
  apiVersion: 2, version: "1.0.0", id, name: L(id), type: "integration", instances: "multiple", main: "index.mjs",
  settings: [
    { key: "note", type: "text", optional: true, label: L("Note") },
    { key: "apiSecret", type: "secret", optional: true, label: L("Mot secret") },
  ],
  returnAddresses: [{ path: "/m/{instance}/oauth/callback", label: L("Service A"), where: L("Console de développement, « adresse de retour »", "Developer console, \"return address\"") }],
  siteAddressUses: [{ label: L("Domotique"), where: L("Dans l'application, ouvrez Reconfigurer", "In the app, open Reconfigure") }],
  ...over,
});
async function withModule(id, over = {}) {
  assert.equal((await installModule(makeRepo({ "module.json": manifest(id, over), "index.mjs": "export default {};" }).url, { dependencies: false })).ok, true);
  const mod = await R.getModule(id);
  const inst = await createInstance(prisma, { manifest: mod.manifest, names: L(id) });
  return inst;
}
async function admin(role = "admin", advanced = true) {
  const u = await prisma.user.create({ data: { email: `${role}@example.org`, name: "Adam", role, locale: "fr", advanced, passwordHash: "x" } });
  globalThis.curiosaTestSession = { user: { id: u.id, sv: 0 } };
  return u;
}

/* ───────────── manifeste ───────────── */

test("manifeste : returnAddresses et siteAddressUses sont facultatifs, bornés et vérifiés ; un module sans eux ne change pas", () => {
  assert.equal(parseManifest(manifest("alpha")).ok, true);
  assert.equal(parseManifest(manifest("alpha", { returnAddresses: undefined, siteAddressUses: undefined })).ok, true);
  const bad = (returnAddresses) => parseManifest(manifest("alpha", { returnAddresses }));
  assert.equal(bad([{ path: "/oauth/callback", label: "x" }]).ok, false, "doit commencer par /m/ ou /api/");
  assert.equal(bad([{ path: "https://autre.example/m/x", label: "x" }]).ok, false, "jamais une adresse complète");
  assert.equal(bad([{ path: "/m/{instance}/../x", label: "x" }]).ok, false);
  assert.equal(bad([{ path: "/m/{instance}//x", label: "x" }]).ok, false);
  assert.equal(bad([{ path: "/m/{autre}/x", label: "x" }]).ok, false, "un seul espace réservé : {instance}");
  assert.equal(bad([{ path: "/m/a?code=1", label: "x" }]).ok, false, "pas de paramètre");
  assert.equal(bad([{ path: "/m/a/b", label: "x", extra: 1 }]).ok, false, "clé inconnue refusée");
  assert.equal(bad([{ path: "/m/a", label: "x" }, { path: "/m/a", label: "y" }]).ok, false, "doublon");
  assert.equal(bad(Array.from({ length: 6 }, (_, i) => ({ path: `/m/a${i}`, label: "x" }))).ok, false, "5 au plus");
  assert.equal(parseManifest(manifest("alpha", { siteAddressUses: [{ label: "x" }] })).ok, false, "`where` est obligatoire");
});

/* ───────────── liste de contrôle ───────────── */

test("liste de contrôle : compte les clés d'accès, les liens courts, les accès d'assistants et les overlays réels de CE site", async () => {
  const u = await prisma.user.create({ data: { email: "a@example.org", name: "A", role: "admin", passwordHash: "x" } });
  const v = await prisma.user.create({ data: { email: "b@example.org", name: "B", role: "editor", passwordHash: "x" } });
  for (const [i, user] of [[1, u], [2, u], [3, v]]) await prisma.passkey.create({ data: { userId: user.id, credentialId: `cred-${i}`, publicKey: Buffer.from([1]), name: `Clé ${i}` } });
  await prisma.redirect.createMany({ data: [{ path: "a", targetUrl: "https://x.example/a" }, { path: "b", targetUrl: "https://x.example/b", active: false }] });
  const secretA = await createToken("Assistant A", "read", u.id, { byUrl: true });
  await createToken("Assistant B", "read", u.id);
  await prisma.overlayPage.create({ data: { name: "Scène", secretHash: "h1", secretSealed: "s1" } });
  const c = await C.buildChecklist({ oldBase: OLD, newBase: NEW, oldHost: "ancien.example.org", locale: "fr", defaultLocale: "fr" });
  assert.deepEqual(c.passkeys, { keys: 3, people: 2 });
  assert.deepEqual(c.shortLinks, { total: 2, active: 1 });
  assert.deepEqual(c.assistants, { byAddress: 1, active: 2 });
  assert.deepEqual(c.overlays, { pages: 1, sources: 0 });
  // Aucun secret nulle part dans ce que renvoie la liste (jeton en clair, empreintes, texte scellé).
  const dump = JSON.stringify(c);
  for (const secret of [secretA, "h1", "s1", "cred-1"]) assert.ok(!dump.includes(secret), `fuite : ${secret}`);
});

test("liste de contrôle : les adresses de retour déclarées par les modules actifs, ANCIENNE et NOUVELLE, avec la clé de l'instance ; les endroits hors du site", async () => {
  const inst = await withModule("alpha");
  const c = await C.buildChecklist({ oldBase: OLD, newBase: NEW, oldHost: "ancien.example.org", locale: "fr", defaultLocale: "fr" });
  assert.equal(c.returns.length, 1);
  assert.equal(c.returns[0].oldUrl, `${OLD}/m/${inst.key}/oauth/callback`);
  assert.equal(c.returns[0].newUrl, `${NEW}/m/${inst.key}/oauth/callback`);
  assert.equal(c.returns[0].service, "Service A");
  assert.match(c.returns[0].where, /Console/);
  assert.equal(c.uses.length, 1);
  assert.equal(c.uses[0].label, "Domotique");
  const en = await C.buildChecklist({ oldBase: OLD, newBase: NEW, oldHost: "ancien.example.org", locale: "en", defaultLocale: "fr" });
  assert.match(en.returns[0].where, /Developer console/, "texte dans la langue de la personne");
  // Un module désinstallé ou sans déclaration ne produit rien.
  await db.reset();
  const none = await C.buildChecklist({ oldBase: OLD, newBase: NEW, oldHost: "ancien.example.org", locale: "fr", defaultLocale: "fr" });
  assert.deepEqual([none.returns, none.uses], [[], []]);
});

test("recherche de l'ancien domaine : contenus, liens courts, menu, réglages — emplacements et liens, jamais une valeur ; réglages secrets ignorés ; borné ; lecture seule", async () => {
  const inst = await withModule("alpha");
  const entry = await prisma.entry.create({ data: { instanceId: inst.id, status: "draft", sourceLocale: "fr", translations: { create: [{ instanceId: inst.id, locale: "fr", slug: "a", title: "Page A", body: "Voir https://ancien.example.org/contact pour écrire." }] } } });
  await prisma.entry.create({ data: { instanceId: inst.id, status: "published", sourceLocale: "fr", url: "https://Ancien.example.org/x", translations: { create: [{ instanceId: inst.id, locale: "fr", slug: "b", title: "Lien B" }] } } });
  await prisma.entry.create({ data: { instanceId: inst.id, status: "published", sourceLocale: "fr", translations: { create: [{ instanceId: inst.id, locale: "fr", slug: "c", title: "Propre", body: "rien" }] } } });
  const redirect = await prisma.redirect.create({ data: { path: "ig", targetUrl: "https://ancien.example.org/insta" } });
  await setSetting("nav.custom", [{ label: { fr: "Contact" }, href: "https://ancien.example.org/contact" }]);
  await setSetting("site.about", { fr: "Bienvenue sur ancien.example.org" });
  await setSetting("mail.password", "ancien.example.org-secret-123");
  await setSetting(`instance.${inst.id}.note`, "voir ancien.example.org");
  await setSetting(`instance.${inst.id}.apiSecret`, "ancien.example.org-jeton-secret");
  await setSetting("autre.reglage", "ancien.example.org");
  const before = await prisma.setting.count();
  const { hits, more } = await C.findOldAddressInContent("ancien.example.org", "fr", "fr");
  assert.equal(more, false);
  const byKind = (k) => hits.filter((h) => h.kind === k);
  assert.equal(byKind("entry").length, 2);
  assert.ok(byKind("entry").some((h) => h.href.startsWith(`/admin/entries/${entry.id}`) && h.title === "Page A"));
  assert.deepEqual(byKind("redirect").map((h) => h.href), [`/admin/redirects/${redirect.id}`]);
  assert.equal(byKind("menu").length, 1);
  assert.equal(byKind("settings").length, 1);
  assert.equal(byKind("module").length, 1, "le champ « Note » est listé, une seule fois par extension");
  const dump = JSON.stringify(hits);
  for (const leak of ["jeton-secret", "secret-123", "Bienvenue sur", "Voir https://", "voir ancien"]) assert.ok(!dump.includes(leak), `la recherche ne doit rendre aucune valeur : ${leak}`);
  assert.ok(!hits.some((h) => /mail|apiSecret|autre/i.test(h.href + h.title + h.detail)), "réglages secrets ou inconnus : jamais listés");
  assert.equal(await prisma.setting.count(), before, "lecture seule");
  assert.equal((await C.findOldAddressInContent("", "fr", "fr")).hits.length, 0, "un nom vide ne cherche rien");
  // Borne : 30 par rubrique, « plus » signalé.
  for (let i = 0; i < 35; i++) await prisma.redirect.create({ data: { path: `l${i}`, targetUrl: `https://ancien.example.org/${i}` } });
  const many = await C.findOldAddressInContent("ancien.example.org", "fr", "fr");
  assert.equal(many.hits.filter((h) => h.kind === "redirect").length, C.CONTENT_HITS_MAX);
  assert.equal(many.more, true);
});

/* ───────────── commandes ───────────── */

test("commandes : sed sur .env avec le chemin connu, ancien domaine ajouté à LEGACY_HOSTS (10 au plus), redémarrage déduit, configurations nginx / Caddy / Apache", () => {
  const server = { sitePath: "/var/www/mon site", siteName: "monsite", supervisor: { kind: "systemd", unit: "monsite" }, port: 3100, legacy: ["vieux.example.net"] };
  const c = Cmd.migrationCommands({ oldHost: "ancien.example.org", newHost: "nouveau.example.org", newUrl: NEW, server });
  assert.equal(c.legacyValue, "ancien.example.org,vieux.example.net");
  assert.match(c.env, /^cd '\/var\/www\/mon site'\n/);
  assert.match(c.env, /cp \.env \.env\.avant-changement-domaine/);
  assert.match(c.env, /SITE_URL="https:\/\/nouveau\.example\.org"/);
  assert.match(c.env, /LEGACY_HOSTS="ancien\.example\.org,vieux\.example\.net"/);
  assert.match(c.env, /grep -q '\^SITE_URL=' \.env; then sudo sed -i -E/);
  assert.deepEqual(c.restart, { kind: "systemd", text: "sudo systemctl restart monsite" });
  assert.match(c.nginx.keep, /server_name nouveau\.example\.org ancien\.example\.org vieux\.example\.net;/);
  assert.match(c.nginx.keep, /proxy_pass http:\/\/127\.0\.0\.1:3100;/);
  assert.match(c.nginx.keep, /proxy_set_header Host \$host;/);
  assert.match(c.nginx.redirect, /server_name ancien\.example\.org;\n\s+return 301 https:\/\/nouveau\.example\.org\$request_uri;/);
  assert.match(c.nginx.certificate, /^sudo certbot --nginx -d nouveau\.example\.org -d ancien\.example\.org -d vieux\.example\.net$/);
  assert.match(c.caddy.keep, /^nouveau\.example\.org, ancien\.example\.org, vieux\.example\.net \{\n\s+reverse_proxy 127\.0\.0\.1:3100/);
  assert.match(c.caddy.redirect, /redir https:\/\/nouveau\.example\.org\{uri\} permanent/);
  assert.match(c.apache.keep, /ServerName nouveau\.example\.org\n\s+ServerAlias ancien\.example\.org\n\s+ServerAlias vieux\.example\.net/);
  assert.match(c.apache.redirect, /Redirect permanent \/ https:\/\/nouveau\.example\.org\//);
  assert.equal(c.folderKnown, true);
  // Plus de dix : borné ; le nouveau domaine ne se liste jamais lui-même.
  const lots = Cmd.migrationCommands({ oldHost: "o.example.org", newHost: "n.example.org", newUrl: "https://n.example.org", server: { ...server, legacy: Array.from({ length: 14 }, (_, i) => `d${i}.example.org`).concat("n.example.org") } });
  assert.equal(lots.legacyValue.split(",").length, 10);
  assert.ok(!lots.legacyValue.split(",").includes("n.example.org"));
});

test("commandes : le chemin du site est protégé pour le shell ; sans chemin connu un exemple est donné ; les gestionnaires sont déduits de l'environnement sans rien inventer", () => {
  assert.equal(Cmd.shellQuote("a'b; rm -rf /"), "'a'\\''b; rm -rf /'");
  const hostile = Cmd.migrationCommands({ oldHost: "a.example.org", newHost: "b.example.org", newUrl: "https://b.example.org", server: { sitePath: "/x/'; touch /tmp/pwn; '", siteName: null, supervisor: { kind: "manual" }, port: 3000, legacy: [] } });
  assert.ok(hostile.env.startsWith("cd '/x/'\\''; touch /tmp/pwn; '\\'''\n"), "l'apostrophe ne ferme jamais la citation");
  const unknown = Cmd.migrationCommands({ oldHost: "a.example.org", newHost: "b.example.org", newUrl: "https://b.example.org", server: { sitePath: null, siteName: null, supervisor: { kind: "manual" }, port: 3000, legacy: [] } });
  assert.match(unknown.env, /^cd '\/chemin\/de\/votre\/site'/);
  assert.equal(unknown.folderKnown, false);
  assert.equal(unknown.restart.kind, "manual");
  const ctx = (env, cwd = "/nonexistent-dir-xyz") => Cmd.detectServerContext(env, cwd, []);
  assert.deepEqual(ctx({ CURIOSA_RESTART_COMMAND: "sudo systemctl restart curiosa" }).supervisor, { kind: "command", command: "sudo systemctl restart curiosa" });
  assert.deepEqual(ctx({ CURIOSA_INSTALL: "docker" }).supervisor, { kind: "docker" });
  assert.deepEqual(ctx({ PM2_HOME: "/root/.pm2" }).supervisor, { kind: "pm2" });
  assert.equal(ctx({ INVOCATION_ID: "abc" }, "/var/www/monsite").supervisor.unit, "monsite");
  assert.deepEqual(ctx({ CURIOSA_SUPERVISED: "1" }).supervisor, { kind: "systemd", unit: null });
  assert.deepEqual(ctx({}).supervisor, { kind: "manual" });
  assert.equal(ctx({ CURIOSA_READY_URL: "http://127.0.0.1:3456/" }).port, 3456);
  assert.equal(ctx({ PORT: "abc" }).port, 3000);
});

/* ───────────── contrôles de fin de migration ───────────── */

const headers = (h = {}) => new Headers(h);
const answer = (status, h = {}, body = "") => ({ ok: true, status, headers: headers(h), body });
const fakeProbe = (table) => async (url, method) => { const hit = table[`${method} ${url}`]; if (hit === undefined) throw new Error(`appel inattendu : ${method} ${url}`); return hit; };

test("après le changement : tout va bien — adresse visitée, https, santé, HSTS, renvoi http→https et redirection de chaque ancien domaine", async () => {
  const probe = fakeProbe({
    "GET https://nouveau.example.org/api/health": answer(200, { "strict-transport-security": "max-age=1" }, "ok"),
    "HEAD http://nouveau.example.org/": answer(308, { location: "https://nouveau.example.org/" }),
    "HEAD https://ancien.example.org/": answer(301, { location: "https://nouveau.example.org/" }),
  });
  const r = await K.runAfterChecks({ siteUrl: NEW, hostHeader: "nouveau.example.org", legacy: ["ancien.example.org"], probe });
  assert.deepEqual(r.map((x) => `${x.id}:${x.status}`).sort(), ["health:ok", "hsts:ok", "httpRedirect:ok", "https:ok", "legacy:ok", "visited:ok"]);
});

test("après le changement : adresse visitée différente, pas de HSTS, ancien domaine qui ne redirige pas ou qui ne répond pas — signalés avec la raison", async () => {
  const probe = fakeProbe({
    "GET https://nouveau.example.org/api/health": answer(502, {}, "bad gateway"),
    "HEAD http://nouveau.example.org/": { ok: false, error: "network" },
    "HEAD https://ancien.example.org/": answer(200),
    "HEAD https://vieux.example.net/": answer(301, { location: "https://evil.example.com/" }),
    "HEAD https://mort.example.net/": { ok: false, error: "tls" },
  });
  const r = await K.runAfterChecks({ siteUrl: NEW, hostHeader: "ancien.example.org", legacy: ["ancien.example.org", "vieux.example.net", "mort.example.net"], probe });
  const by = (id, host) => r.find((x) => x.id === id && (!host || x.params?.host === host));
  assert.equal(by("visited").status, "warn");
  assert.equal(by("health").status, "fail");
  assert.equal(by("httpRedirect").status, "warn");
  assert.equal(by("legacy", "ancien.example.org").status, "fail");
  assert.equal(by("legacy", "vieux.example.net").status, "fail", "une 301 vers un AUTRE domaine n'est pas la bonne redirection");
  assert.equal(by("legacy", "mort.example.net").params.reason, "tls");
  assert.equal(r.filter((x) => x.id === "legacy").length, 3);
});

test("après le changement : site local ou privé — aucun appel sortant (test sauté et dit)", async () => {
  const probe = async () => { throw new Error("aucun appel sortant permis"); };
  for (const site of ["http://localhost:3000", "https://192.168.1.5", "https://monsite.local"]) {
    const r = await K.runAfterChecks({ siteUrl: site, hostHeader: "localhost:3000", legacy: [], probe });
    assert.ok(r.every((x) => x.status === "skipped" || x.id === "https"), site);
    assert.ok(r.find((x) => x.id === "health"), site);
  }
});

test("sondeur sûr : refuse les adresses numériques et les noms privés sans résoudre, refuse un nom qui résout vers une adresse privée, ne suit pas les redirections, borne la durée", async () => {
  let resolved = 0;
  const resolve = async (host) => { resolved++; return host === "prive.example.org" ? { ok: true, addresses: ["10.0.0.5", "93.184.216.34"] } : host === "perdu.example.org" ? { ok: false, reason: "notfound" } : host === "lent.example.org" ? { ok: false, reason: "timeout" } : { ok: true, addresses: ["93.184.216.34"] }; };
  const probe = K.createProbe({ resolve, fetch: async () => { throw new Error("pas de connexion attendue"); } });
  for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://nas.local/", "https://169.254.169.254/latest/meta-data"]) assert.deepEqual(await probe(url, "GET"), { ok: false, error: "private" }, url);
  assert.equal(resolved, 0, "aucune résolution pour une adresse numérique ou un nom privé");
  assert.deepEqual(await probe("https://prive.example.org/", "GET"), { ok: false, error: "private" }, "une seule adresse privée parmi les réponses suffit à refuser");
  assert.deepEqual(await probe("https://perdu.example.org/", "GET"), { ok: false, error: "dns" });
  assert.deepEqual(await probe("https://lent.example.org/", "GET"), { ok: false, error: "timeout" });
  assert.deepEqual(await probe("ftp://x.example.org/", "GET"), { ok: false, error: "invalid" });
  // Réponse : redirection non suivie (redirect: "manual"), corps borné, en-têtes lus.
  let seen;
  const ok = K.createProbe({ resolve, fetch: async (url, init) => { seen = { url, init }; return new Response("ok" + "x".repeat(500), { status: 301, headers: { location: NEW } }); } });
  const res = await ok("https://ancien.example.org/", "GET");
  assert.equal(res.status, 301);
  assert.equal(res.body.length, 200);
  assert.equal(seen.init.redirect, "manual");
  assert.ok(seen.init.signal instanceof AbortSignal);
  // Délai dur : une réponse qui ne vient jamais est coupée.
  const slow = K.createProbe({ resolve, timeoutMs: 600, fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))) });
  const t0 = Date.now();
  assert.deepEqual(await slow("https://ancien.example.org/", "GET"), { ok: false, error: "timeout" });
  assert.ok(Date.now() - t0 < 2000);
  const tls = K.createProbe({ resolve, fetch: async () => { const e = new Error("unable to verify the first certificate"); e.code = "UNABLE_TO_VERIFY_LEAF_SIGNATURE"; throw e; } });
  assert.deepEqual(await tls("https://ancien.example.org/", "GET"), { ok: false, error: "tls" });
});

test("coches mémorisées : seule une tâche connue est retenue, décocher l'enlève, la liste est bornée", async () => {
  await admin();
  const known = new Set(["passkeys", "assistants"]);
  assert.equal(await K.setAfterTick("passkeys", true, known), true);
  assert.equal(await K.setAfterTick("n'importe quoi", true, known), false);
  assert.equal(await K.setAfterTick("__proto__", true, known), false);
  assert.deepEqual(await K.getAfterTicks(), ["passkeys"]);
  await K.setAfterTick("assistants", true, known);
  await K.setAfterTick("passkeys", false, known);
  assert.deepEqual(await K.getAfterTicks(), ["assistants"]);
  const tasks = K.afterTasks({ passkeys: { keys: 2, people: 1 }, shortLinks: { total: 0, active: 0 }, returns: [{ instanceKey: "a" }], uses: [], assistants: { byAddress: 0, active: 0 }, overlays: { pages: 1, sources: 1 }, content: { hits: [{}], more: false } });
  assert.deepEqual(tasks.map((x) => x.id), ["passkeys", "return:a:0", "overlays", "content"]);
  assert.equal(tasks.find((x) => x.id === "overlays").count, 2);
});

/* ───────────── pages ───────────── */

const page = async (path, sp = {}) => {
  const mod = await import(path);
  return renderToStaticMarkup(await mod.default({ searchParams: Promise.resolve(sp) }));
};
const ADDRESS = "@/app/admin/(panel)/settings/address/page";
const AFTER = "@/app/admin/(panel)/settings/address/after/page";

test("page « Adresse du site » : le rôle admin y entre, une rédaction non ; adresse actuelle, avertissement non bloquant si l'adresse visitée diffère", async () => {
  await admin("editor");
  await assert.rejects(page(ADDRESS), "un compte de rédaction n'y entre pas");
  await db.reset();
  await admin("admin");
  headerState.headers.set("host", "ancien.example.org");
  let html = await page(ADDRESS);
  assert.match(html, /data-testid="domain-current-url"[^>]*>https:\/\/ancien\.example\.org</);
  assert.ok(!html.includes("domain-mismatch"));
  headerState.headers.set("host", "autre.example.org");
  html = await page(ADDRESS);
  assert.match(html, /data-testid="domain-mismatch"/);
  assert.match(html, /domain-step1/, "l'assistant reste utilisable malgré l'avertissement");
});

test("page : étape 1 — erreur SOUS le champ avec un exemple, saisie conservée, focus sur le champ ; adresse identique signalée sans bloquer", async () => {
  await admin();
  headerState.headers.set("host", "ancien.example.org");
  for (const [input, fragment] of [["http://monsite.be", "https"], ["https://monsite.be/blog", "sans chemin"], ["https://10.0.0.1", "nom de domaine"], ["", "Écrivez l"]]) {
    const html = await page(ADDRESS, { to: input, step: "2" });
    assert.match(html, /domain-step1/, input);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /autofocus/i);
    assert.ok(html.includes(fragment), `${input} → ${fragment}`);
    assert.match(html, /https:\/\/monsite\.be/, "l'erreur donne un exemple");
    if (input) assert.ok(html.includes(`value="${input}"`), "saisie conservée");
  }
  const same = await page(ADDRESS, { to: "https://ancien.example.org", step: "2" });
  assert.match(same, /data-testid="domain-same"/);
});

test("page : étape 2 — liste de contrôle personnalisée, adresses de retour à copier, aucun secret affiché", async () => {
  const u = await admin();
  headerState.headers.set("host", "ancien.example.org");
  const inst = await withModule("alpha");
  await prisma.passkey.create({ data: { userId: u.id, credentialId: "c1", publicKey: Buffer.from([1]), name: "k" } });
  const secret = await createToken("Assistant", "read", u.id, { byUrl: true });
  await prisma.overlayPage.create({ data: { name: "Scène", secretHash: "h1", secretSealed: "SCELLE-123" } });
  await prisma.redirect.create({ data: { path: "ig", targetUrl: "https://ancien.example.org/x" } });
  const html = await page(ADDRESS, { to: "nouveau.example.org", step: "2" });
  assert.match(html, /domain-step2/);
  assert.match(html, /1 clé d&#x27;accès à recréer/);
  assert.match(html, /1 lien court et son QR code/);
  assert.match(html, /1 assistant IA connecté par adresse secrète/);
  assert.match(html, /1 adresse d&#x27;overlay à reprendre dans OBS/);
  assert.ok(html.includes(`https://ancien.example.org/m/${inst.key}/oauth/callback`), "ancienne adresse de retour");
  assert.ok(html.includes(`https://nouveau.example.org/m/${inst.key}/oauth/callback`), "nouvelle adresse de retour");
  assert.ok(html.includes("Service A") && html.includes("Domotique"));
  assert.match(html, /1 endroit du site contient encore ancien\.example\.org/);
  assert.match(html, /Copier/);
  for (const leak of [secret, "SCELLE-123", "h1</"]) assert.ok(!html.includes(leak), `fuite : ${leak}`);
  assert.match(html, /aria-current="step"/);
});

test("page : étape 3 — commandes à copier (sed, redémarrage, nginx/Caddy/Apache, certificat) ; « déjà appliquées » quand le site utilise l'adresse", async () => {
  await admin();
  headerState.headers.set("host", "ancien.example.org");
  const html = await page(ADDRESS, { to: "https://nouveau.example.org", step: "3" });
  for (const part of ['SITE_URL=&quot;https://nouveau.example.org&quot;', "LEGACY_HOSTS=", "server_name nouveau.example.org ancien.example.org;", "certbot --nginx", "reverse_proxy", "ServerAlias ancien.example.org", "return 301", "Contrôler le site"]) assert.ok(html.includes(part), part);
  assert.ok(!html.includes('data-testid="domain-applied"'));
  const applied = await page(ADDRESS, { to: "https://ancien.example.org", step: "3" });
  assert.match(applied, /data-testid="domain-applied"/);
  process.env.LEGACY_HOSTS = "vieux.example.net";
  assert.match(await page(ADDRESS, { to: "https://nouveau.example.org", step: "3" }), /vieux\.example\.net/, "les anciens domaines déjà listés restent listés");
});

test("page « Après le changement » : aucun appel sortant sans clic ; les contrôles se lancent à la demande ; les coches sont mémorisées et reprises", async () => {
  const u = await admin();
  headerState.headers.set("host", "ancien.example.org");
  await prisma.passkey.create({ data: { userId: u.id, credentialId: "c1", publicKey: Buffer.from([1]), name: "k" } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("aucun appel sortant sans clic"); };
  try {
    const html = await page(AFTER);
    assert.match(html, /Lancer le contrôle/);
    assert.ok(!html.includes("domain-results"));
    assert.match(html, /Recréer 1 clé d&#x27;accès/);
    assert.match(html, /type="checkbox"/);
  } finally { globalThis.fetch = originalFetch; }
  // La coche passe par l'action du serveur, réservée au rôle admin, et se retrouve au rechargement.
  const { setAfterTask } = await import("@/app/admin/(panel)/settings/address/actions");
  assert.deepEqual(await setAfterTask("passkeys", true), { ok: true });
  assert.deepEqual(await setAfterTask("inconnue", true), { ok: false });
  assert.match(await page(AFTER), /id="tick-passkeys"[^>]*checked/);
  assert.deepEqual(await setAfterTask("passkeys", false), { ok: true });
  await db.reset();
  await admin("editor");
  await assert.rejects(setAfterTask("passkeys", true));
});

test("page « Réglages du site » : un lien mène à Adresse du site", async () => {
  await admin();
  const html = await page("@/app/admin/(panel)/settings/page");
  assert.match(html, /data-testid="to-address"/);
  assert.match(html, /href="\/admin\/settings\/address"/);
});

test("réglage AVANCÉ : en mode simple l'entrée est absente, les pages renvoient vers Réglages du site sans erreur et l'action est refusée", async () => {
  await admin("admin", false);
  const settings = await page("@/app/admin/(panel)/settings/page");
  assert.ok(!settings.includes("to-address"), "aucun lien en mode simple");
  for (const path of [ADDRESS, AFTER]) {
    await assert.rejects(page(path), (e) => /NEXT_REDIRECT/.test(String(e?.message ?? e?.digest)) && /\/admin\/settings$/.test(String(e.digest ?? "").split(";")[2] ?? "/admin/settings"));
  }
  const { setAfterTask } = await import("@/app/admin/(panel)/settings/address/actions");
  assert.deepEqual(await setAfterTask("passkeys", true), { ok: false });
});
