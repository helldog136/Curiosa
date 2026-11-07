// L'entrée « Entretien » : une seule entrée de menu, une barre d'onglets (liens) sur les cinq pages, chacune gardant son adresse.
//   1. quels onglets pour quel rôle et quel mode (logique pure) ; une seule entrée de menu ;
//   2. chaque page se rend avec la barre, l'onglet ouvert est signalé (aria-current), aucun libellé en double entre entrées ;
//   3. les anciennes adresses répondent toujours (même route, pas de redirection), la sauvegarde/restauration (API) n'est pas touchée.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { prisma } = db;
const { renderToPipeableStream } = await import("react-dom/server");
const { Writable } = await import("node:stream");
function renderAll(el) {
  return new Promise((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _e, cb) { out += chunk.toString(); cb(); } });
    const stream = renderToPipeableStream(el, { onAllReady() { stream.pipe(sink); sink.on("finish", () => resolve(out)); }, onError: reject, onShellError: reject });
  });
}
const { RedirectError } = await import("next/navigation");
const M = await import("@/core/modules/adminMenu");
const L = await import("@/core/adminLinks");
const { isCurrent } = await import("../../src/components/admin/navCurrent.ts");

after(() => db.close());
const PANEL = "../../src/app/admin/(panel)";
const read = (p) => fs.readFileSync(p, "utf8");

test("onglets d'Entretien par rôle et par mode", () => {
  const tabs = (role, advanced) => M.maintenanceTabs({ role, advanced });
  assert.deepEqual(tabs("owner", false), ["health", "backup", "updates", "upkeep"]);
  assert.deepEqual(tabs("owner", true), ["health", "backup", "updates", "upkeep", "audit"], "le journal d'activité n'existe qu'en mode avancé");
  assert.deepEqual(tabs("editor", true), [], "un éditeur n'a aucun onglet");
  assert.deepEqual(tabs("none", true), []);
  for (const role of ["admin", "coordinator", "owner"]) assert.ok(tabs(role, false).includes("health"), role);
  assert.ok(!tabs("editor", true).includes("backup"));
});

test("une seule entrée « Entretien » dans Administration, plus les cinq anciennes", () => {
  assert.deepEqual(M.administrationEntries({ role: "owner", advanced: false }), ["extensions", "overlays", "assistants", "users", "maintenance"]);
  assert.deepEqual(M.administrationEntries({ role: "owner", advanced: true }), ["extensions", "overlays", "assistants", "users", "maintenance"], "le journal d'activité ne rajoute pas d'entrée");
  assert.ok(!M.administrationEntries({ role: "editor", advanced: true }).includes("maintenance"));
  const layout = read("src/app/admin/(panel)/layout.tsx");
  for (const gone of ["nav.health", "nav.backup", "nav.updates", "nav.upkeep\"", "nav.audit"]) assert.ok(!layout.includes(gone), gone);
  assert.match(layout, /key="maintenance" href=\{maintenanceTabList\.length > 0 \? MAINTENANCE_TAB_HREFS/);
});

test("l'entrée de menu reste en évidence sur les cinq pages et leurs sous-pages", () => {
  const tabs = Object.values(L.MAINTENANCE_TAB_HREFS);
  for (const p of tabs) assert.ok(isCurrent(tabs[0], p, "", { also: tabs }), p);
  assert.ok(!isCurrent(tabs[0], "/admin/settings", "", { also: tabs }));
  assert.ok(!isCurrent(tabs[0], "/admin/extensions/updates", "", { also: tabs }), "les mises à jour des extensions restent sous « Extensions »");
});

test("les cinq anciennes adresses n'ont pas bougé : chaque route existe et ne redirige pas", () => {
  assert.deepEqual(L.MAINTENANCE_TAB_HREFS, { health: "/admin/maintenance/content", backup: "/admin/backup", updates: "/admin/updates", upkeep: "/admin/maintenance/legacy", audit: "/admin/audit" });
  for (const dir of ["maintenance/content", "backup", "updates", "maintenance/legacy", "audit"]) {
    const page = read(`src/app/admin/(panel)/${dir}/page.tsx`);
    assert.doesNotMatch(page, /\bredirect\(/, `${dir} : une page, pas une redirection`);
    assert.match(page, /<MaintenanceHeader /, `${dir} : la barre d'onglets`);
  }
  // Les routes qui ne sont pas des onglets existent toujours, intactes.
  for (const f of ["src/app/api/admin/backup/route.ts", "src/app/api/admin/backup/restore/route.ts", "src/app/api/admin/backup/restore/apply/route.ts"]) assert.ok(fs.existsSync(f), f);
  assert.ok(fs.existsSync("src/app/admin/(panel)/overlay-pages/[id]/preview/route.ts") || fs.existsSync("src/app/admin/(panel)/overlay-pages/[id]/preview/page.tsx"), "l'aperçu d'une page d'overlay");
});

let owner;
before(async () => {
  await db.reset();
  const { setSetting } = await import("@/core/settings");
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr"]);
  owner = await prisma.user.create({ data: { email: "emma@example.org", name: "Emma", role: "owner", passwordHash: "x", locale: "fr" } });
  const { syncSystemAssignments } = await import("@/core/auth/roles");
  await syncSystemAssignments();
});
const as = (u) => { globalThis.curiosaTestSession = u ? { user: { id: u.id, sv: u.sessionVersion ?? 0, role: u.role } } : null; };
async function render(file) {
  as(owner);
  const mod = await import(`${PANEL}/${file}`);
  try { return await renderAll(await mod.default({ searchParams: Promise.resolve({}), params: Promise.resolve({}) })); }
  catch (e) { if (e instanceof RedirectError) return `redirect:${e.url}`; throw e; }
}
const PAGES = { health: "maintenance/content/page.tsx", backup: "backup/page.tsx", updates: "updates/page.tsx", upkeep: "maintenance/legacy/page.tsx", audit: "audit/page.tsx" };

for (const advanced of [false, true]) {
  for (const [tab, file] of Object.entries(PAGES)) {
    test(`page ${tab} (${advanced ? "avancé" : "simple"}) : titre Entretien, onglets, onglet ouvert signalé`, async () => {
      await prisma.user.update({ where: { id: owner.id }, data: { advanced } });
      const html = await render(file);
      assert.doesNotMatch(html, /^redirect:/);
      assert.match(html, /data-testid="maintenance-tabs"/);
      assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, "un seul titre de niveau 1");
      assert.match(html, /<h1[^>]*>[^<]*<span aria-hidden="true">🛠️(?:<!-- -->)? <\/span>Entretien<\/h1>/);
      const current = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*aria-current="page"[^>]*data-tab="(\w+)"/g)];
      assert.deepEqual(current.map((m) => m[2]), [tab], "un seul onglet ouvert, le bon");
      assert.equal(current[0][1], L.MAINTENANCE_TAB_HREFS[tab]);
      const shown = [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
      const expected = ["health", "backup", "updates", "upkeep", "audit"].filter((id) => id === tab || M.maintenanceTabs({ role: "owner", advanced }).includes(id));
      assert.deepEqual(shown, expected, "les onglets visibles = ceux du rôle et du mode, plus la page ouverte à la main");
      const labels = [...html.matchAll(/data-tab="\w+"[^>]*>([^<]+)</g)].map((m) => m[1]);
      assert.equal(new Set(labels).size, labels.length, "deux onglets ne portent jamais le même nom");
      assert.ok(labels.every((l) => l.length <= 24), `libellés courts : ${labels}`);
    });
  }
}
