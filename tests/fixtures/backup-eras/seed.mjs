// Runs INSIDE a throwaway copy of a published release (see generate.mjs): fills a fresh database with DEMO data through that release's own code, then writes the backup that
// release would write. Version independent on purpose: rows are written with the columns the release's schema has, the rest takes its default.
import fs from "node:fs";
import path from "node:path";

const out = process.env.ERA_OUT;
const era = process.env.ERA_TAG;
const { prisma } = await import("@/core/db");
const { Prisma } = await import("@prisma/client");
const columns = (model) => new Set(Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.filter((f) => f.kind === "scalar").map((f) => f.name) ?? []);
const has = (model) => !!Prisma.dmmf.datamodel.models.find((m) => m.name === model);
const make = async (model, data) => {
  const cols = columns(model);
  const row = Object.fromEntries(Object.entries(data).filter(([k]) => cols.has(k)));
  return prisma[model[0].toLowerCase() + model.slice(1)].create({ data: row });
};
const setting = (key, value, locale = "") => make("Setting", { key, locale, value: JSON.stringify(value) });
const [maj, min, patch] = era.replace(/^v/, "").split(".").map(Number);
const before = (a, b) => maj < a || (maj === a && min < b);

await make("User", { id: "u-owner", email: "owner@example.org", name: "Camille", role: "owner", passwordHash: "$2a$12$hash-demo-du-proprietaire", locale: "fr" });
await setting("i18n.default", "fr"); await setting("i18n.enabled", ["fr", "en"]); await setting("setup.completed", true);
await setting("site.name", "Site de démonstration", "fr");
await make("Redirect", { path: "etoile_nord", targetUrl: "https://example.org/etoile", permanent: true, hits: 3 });

// A blog-like instance with an entry in two languages, and a second one that shows in the menu.
await make("ModuleInstance", { id: "i-blog", moduleId: "blog", key: "blog", basePath: "blog", enabled: true, showInNav: true, navOrder: 1, display: "list" });
await make("InstanceTranslation", { id: "it-blog-fr", instanceId: "i-blog", locale: "fr", name: "Actualités", description: "" });
await make("Entry", { id: "e-1", instanceId: "i-blog", status: "published", sourceLocale: "fr", publishedAt: new Date("2025-03-01T10:00:00Z"), tags: JSON.stringify(["demo"]) });
await make("EntryTranslation", { id: "et-1-fr", entryId: "e-1", instanceId: "i-blog", locale: "fr", slug: "premier-article", title: "Premier article", summary: "Résumé", body: "Texte de démonstration" });
await make("EntryTranslation", { id: "et-1-en", entryId: "e-1", instanceId: "i-blog", locale: "en", slug: "first-article", title: "First article", summary: "", body: "Demo text" });
await make("ModuleInstance", { id: "i-links", moduleId: "links", key: "links", basePath: "liens", enabled: true, showInNav: true, navOrder: 2, display: "list" });
await make("ModuleRecord", { id: "r-1", instanceId: "i-blog", collection: "messages", data: JSON.stringify({ name: "lune_douce", message: "Bonjour" }) });

// Era specific state.
if (maj === 0 && min === 1 && patch < 20) {
  // Before 0.1.20: an instance switched off (the state ended with 0.1.20).
  if (columns("ModuleInstance").has("enabled")) await make("ModuleInstance", { id: "i-old", moduleId: "radio", key: "radio", basePath: "radio", enabled: false, showInNav: false });
}
if (before(0, 7)) {
  // The core of those releases kept the RAWG code and the cover fixes in its own settings, and the menu in the instances + nav.custom.
  await setting("rawg.key", "code-demo-0001");
  await setting("rawg.fixes", { hades: { title: "Hades", kind: "game", rawgId: 22, name: "Hades II", img: "/media/games/fix/hades-2.jpg", at: "2025-01-01T00:00:00.000Z" } });
  await setting("nav.custom", [{ label: { fr: "Aide", en: "Help" }, href: "https://example.org/aide" }]);
}
if (!before(0, 7)) await setting("nav.menu", { version: 1, items: [{ kind: "instance", ref: "i-blog" }, { kind: "instance", ref: "i-links" }] });
if (has("Module") && before(0, 32)) {
  // Installed-module rows of that time (the code is reinstalled from the catalogue at restore).
  const cols = columns("Module");
  const mk = (id, extra = {}) => make("Module", { id, source: "bundled", version: "1.0.0", enabled: true, ...extra }).catch(() => null);
  void cols;
  await mk("blog"); await mk("links");
}
// An uploaded image.
const { UPLOADS_DIR } = await import("@/core/config");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.writeFileSync(path.join(UPLOADS_DIR, "0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("image-demo")]));

const { createBackup } = await import("@/core/backup/export");
const b = await createBackup("un-mot-de-passe-solide", { iterations: 1000 });
fs.writeFileSync(out, b.buffer);
console.log(`${era}: ${b.filename} ${b.buffer.length} bytes, framework ${b.manifest.frameworkVersion}, schema ${b.manifest.schemaVersion ?? "-"}`);
await prisma.$disconnect();
