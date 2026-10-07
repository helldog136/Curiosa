import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * La documentation des modules ne doit pas pourrir en silence : ce test lit le CODE (types.ts, manifest.ts, blocks.ts,
 * color.ts…) et vérifie que docs/MODULES.md (la référence) mentionne chaque capacité qu'il y trouve ; docs/CREATE-A-MODULE.md
 * (le tutoriel) doit, lui, présenter chacune des capacités d'un module. Ajouter un champ au code sans le documenter fait échouer ce test.
 */
const read = (p) => fs.readFileSync(p, "utf8");
const types = read("src/core/modules/types.ts");
const manifestSrc = read("src/core/modules/manifest.ts");
const blocksSrc = read("src/core/blocks.ts");
const colorSrc = read("src/core/color.ts");
const reference = read("docs/MODULES.md");
const tutorial = read("docs/CREATE-A-MODULE.md");

/** Corps d'un `export type X = {` ... `};` (accolades équilibrées). */
function bodyOf(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `introuvable dans le code : ${header}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}" && --depth === 0) return src.slice(src.indexOf("{", start) + 1, i);
  }
  throw new Error(`accolade non fermée : ${header}`);
}
/** Clés (ou méthodes) d'un objet type TypeScript, à une indentation donnée. */
const keysAt = (body, indent) => [...body.matchAll(new RegExp(`^ {${indent}}(?:readonly )?([A-Za-z_][A-Za-z0-9_]*)\\??[(:<]`, "gm"))].map((m) => m[1]);
const enumValues = (src) => [...src.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

/** Le mot figure dans le document entre accents graves ou guillemets (`word`, "word"), pas par hasard dans une phrase. */
const mentions = (doc, word) => new RegExp("[`\"']" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[`\"'(<?]|\\." + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(doc);
const missing = (doc, words) => [...new Set(words)].filter((w) => !mentions(doc, w));

test("les deux documents existent et se renvoient l'un à l'autre, et à l'exemple", () => {
  assert.ok(/CREATE-A-MODULE\.md/.test(reference.slice(0, 1500)), "MODULES.md doit pointer vers le tutoriel dès son début");
  assert.ok(/modules-examples\/guestbook/.test(reference.slice(0, 1500)), "MODULES.md doit pointer vers l'exemple guestbook dès son début");
  assert.ok(/MODULES\.md/.test(tutorial) && /modules-examples\/guestbook/.test(tutorial));
});

test("tous les liens relatifs des deux documents mènent à un fichier qui existe", () => {
  for (const [name, raw] of [["docs/MODULES.md", reference], ["docs/CREATE-A-MODULE.md", tutorial]]) {
    const doc = raw.replace(/```[\s\S]*?```/g, ""); // le code d'exemple n'est pas du Markdown
    for (const m of doc.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) {
      const target = path.resolve(path.dirname(name), m[1]);
      assert.ok(fs.existsSync(target), `${name} : lien cassé vers ${m[1]}`);
    }
  }
});

test("ModuleDefinition : chaque clé de premier niveau (et chaque sous-clé) est documentée", () => {
  const body = bodyOf(types, "export type ModuleDefinition");
  const top = keysAt(body, 2);
  for (const k of ["slots", "sections", "page", "overlay", "exports", "routes", "filters", "adminPanel", "adminActions", "mcp", "backup", "hooks"]) assert.ok(top.includes(k), `clé attendue absente du code : ${k}`);
  assert.deepEqual(missing(reference, top), [], "clés de ModuleDefinition absentes de docs/MODULES.md");
  assert.deepEqual(missing(tutorial, top), [], "clés de ModuleDefinition absentes de docs/CREATE-A-MODULE.md");
  const nested = ["entryBody", "readable", "onInstanceCreate", "onInstanceDelete"];
  for (const k of nested) assert.ok(body.includes(k), `sous-clé attendue absente du code : ${k}`);
  assert.deepEqual(missing(reference, nested), [], "sous-clés (filters, backup, hooks) absentes de docs/MODULES.md");
});

test("ModuleApi : chaque membre est documenté (qr, store, topics, mail, site, brand, instances, entries, siteUrl…)", () => {
  const body = bodyOf(types, "export type ModuleApi");
  const top = keysAt(body, 2);
  for (const k of ["qr", "store", "topics", "mail", "site", "brand", "instances", "entries", "siteUrl"]) assert.ok(top.includes(k), k);
  for (const k of top) assert.ok(reference.includes(`ctx.api.${k}`), `ctx.api.${k} absent de docs/MODULES.md`);
  // les méthodes des services : ctx.api.<service>.<méthode>
  for (const service of ["topics", "entries", "instances", "mail", "store"]) {
    const inner = bodyOf(body, `  ${service}: {`);
    for (const method of keysAt(inner, 4)) assert.ok(reference.includes(`ctx.api.${service}.${method}`), `ctx.api.${service}.${method} absent de docs/MODULES.md`);
  }
  for (const k of top) assert.ok(tutorial.includes(`api.${k}`), `api.${k} absent de docs/CREATE-A-MODULE.md`);
});

test("ModuleContext et SlotContext : chaque membre est documenté", () => {
  const ctxKeys = keysAt(bodyOf(types, "export type ModuleContext"), 2);
  const slotKeys = keysAt(bodyOf(types, "export type SlotContext"), 2);
  for (const k of ctxKeys) assert.ok(reference.includes(`ctx.${k}`), `ctx.${k} absent de docs/MODULES.md`);
  for (const k of slotKeys) assert.ok(reference.includes(`ctx.${k}`), `ctx.${k} (slots) absent de docs/MODULES.md`);
});

test("manifeste : chaque champ de module.json est documenté", () => {
  const body = bodyOf(manifestSrc, "export const manifestSchema");
  const fields = keysAt(body, 2);
  for (const k of ["apiVersion", "id", "name", "version", "main", "icon", "type", "instances", "consumes", "provides", "mcp", "content", "page", "basePath", "sections", "settings", "starter", "onboarding", "defaultEnabled", "permissions"]) assert.ok(fields.includes(k), k);
  assert.deepEqual(missing(reference, fields), []);
});

test("manifeste : sous-champs (réglage, section, action MCP, contenu, abonnement, assistant) documentés", () => {
  const setting = keysAt(bodyOf(manifestSrc, "export const settingField"), 2);
  assert.deepEqual(missing(reference, setting), [], "champs d'un réglage");
  const mcp = ["name", "description", "readOnly", "default", "destructive", "input"];
  assert.deepEqual(missing(reference, mcp), [], "champs d'une action MCP");
  const section = ["id", "label", "options", "size"];
  assert.deepEqual(missing(reference, section), [], "champs d'une section");
  const content = keysAt(bodyOf(manifestSrc, "const content = z.object"), 2);
  assert.deepEqual(missing(reference, content), [], "champs de content");
  const consumes = ["topic", "label", "schema", "tags"];
  assert.deepEqual(missing(reference, consumes), [], "champs de consumes");
  const onboarding = keysAt(bodyOf(types, "  onboarding?:"), 4);
  assert.deepEqual(missing(reference, onboarding), [], "champs de onboarding");
  const json = ["type", "properties", "required", "enum", "maxLength", "minimum", "maximum", "items"];
  assert.deepEqual(missing(reference, json), [], "champs du schéma d'arguments MCP");
});

test("permissions : chacune est documentée", () => {
  const m = manifestSrc.match(/permissions: z\.array\(z\.enum\(\[([^\]]*)\]/);
  assert.ok(m);
  const perms = enumValues(m[1]);
  assert.ok(perms.includes("mail") && perms.length >= 11);
  assert.deepEqual(missing(reference, perms), []);
  assert.deepEqual(missing(tutorial, perms), []);
});

test("types de réglage : chacun est documenté", () => {
  const m = manifestSrc.match(/type: z\.enum\(\[([^\]]*)\]\),\s*\n\s*help/);
  assert.ok(m);
  const kinds = enumValues(m[1]);
  assert.ok(kinds.includes("secret") && kinds.includes("image") && kinds.includes("color"));
  assert.deepEqual(missing(reference, kinds), []);
});

test("types de module, tailles de section, jetons de thème : documentés", () => {
  const sizes = enumValues(types.match(/SECTION_SIZES = \[([^\]]*)\]/)[1]);
  const moduleTypes = enumValues(types.match(/MODULE_TYPES = \[([^\]]*)\]/)[1]);
  const tokens = enumValues(colorSrc.match(/THEME_TOKENS = \[([^\]]*)\]/)[1]);
  assert.deepEqual(sizes, ["small", "medium", "large", "full"]);
  for (const [what, list] of [["tailles", sizes], ["types", moduleTypes], ["jetons de thème", tokens]]) assert.deepEqual(missing(reference, list), [], what);
  assert.deepEqual(missing(tutorial, sizes), [], "tailles dans le tutoriel");
});

test("blocs : chaque type de Block (et chaque genre de champ d'admin, chaque balise de head) est documenté", () => {
  const block = bodyOf(blocksSrc, "export type Block =");
  // `bodyOf` s'arrête à la première accolade fermée : on prend ici toute l'union, jusqu'au premier « export » suivant
  const union = blocksSrc.slice(blocksSrc.indexOf("export type Block ="), blocksSrc.indexOf("export type Slot"));
  const names = [...union.matchAll(/\btype: "([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(block.length > 0);
  for (const k of ["markdown", "html", "banner", "links", "entries", "hero", "embed", "form", "table", "adminForm", "heading", "swatches", "downloads", "copy", "head"]) assert.ok(names.includes(k), k);
  assert.deepEqual(missing(reference, names), [], "types de blocs");
  const kinds = enumValues(blocksSrc.match(/kind\?: ([^;]*);/)[1]);
  assert.deepEqual(missing(reference, kinds), [], "genres de champs d'admin");
  const tags = [...blocksSrc.slice(0, blocksSrc.indexOf("export type AdminField")).matchAll(/tag: "([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(missing(reference, tags), [], "balises de head");
});

test("emplacements (Slot) : chacun est documenté", () => {
  const slots = enumValues(blocksSrc.slice(blocksSrc.indexOf("export type Slot"), blocksSrc.indexOf("export const SLOTS")));
  assert.equal(slots.length, 8);
  assert.deepEqual(missing(reference, slots), []);
  assert.deepEqual(missing(tutorial, slots), []);
});

test("résultats et formats : page, overlay, action d'admin, sauvegarde, sujets, e-mail", () => {
  const groups = {
    PageResult: keysAt(bodyOf(types, "export type PageResult"), 2),
    OverlayResult: enumValues("").concat([...types.match(/export type OverlayResult = \{([^}]*)\}/)[1].matchAll(/(\w+)\??:/g)].map((m) => m[1])),
    AdminActionResult: [...types.match(/export type AdminActionResult = \{([^}]*)\}/)[1].matchAll(/(\w+)\??:/g)].map((m) => m[1]),
    BackupFile: [...types.match(/export type BackupFile = \{([^}]*)\}/)[1].matchAll(/(\w+)\??:/g)].map((m) => m[1]),
    TopicQuery: [...types.match(/export type TopicQuery = \{([^}]*)\}/)[1].matchAll(/(\w+)\??:/g)].map((m) => m[1]),
    TopicField: enumValues(types.match(/export type TopicField = \{[^}]*type: ([^;]*);/)[1]),
    mailReasons: enumValues(types.match(/reason: ([^}]*)\}/)[1]),
  };
  for (const [name, list] of Object.entries(groups)) {
    assert.ok(list.length > 0, name);
    assert.deepEqual(missing(reference, list), [], name);
  }
});

test("entrées (EntrySummary) et identité (ModuleBrand) lisibles par un module : champs documentés", () => {
  const entry = keysAt(bodyOf(types, "export type EntrySummary"), 2);
  const brand = keysAt(bodyOf(types, "export type ModuleBrand"), 2);
  assert.deepEqual(missing(reference, entry), [], "EntrySummary");
  assert.deepEqual(missing(reference, brand), [], "ModuleBrand");
});

test("variables d'environnement et chemins cités par le code d'installation : documentés", () => {
  const installer = read("src/core/modules/installer.ts") + read("src/core/modules/catalogue.ts");
  const vars = [...new Set([...installer.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]))];
  assert.ok(vars.includes("MODULES_INDEX_URL") && vars.includes("VITRINE_ALLOW_LOCAL_MODULES") && vars.includes("MODULES_ALLOWED_HOSTS"));
  for (const v of vars) assert.ok(reference.includes(v) && tutorial.includes(v), `${v} absent de la documentation`);
  const bundled = [...read("src/core/modules/marketplace.ts").matchAll(/dir: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bundled.sort(), ["modules-community", "modules-examples"]);
  for (const d of bundled) assert.ok(reference.includes(d) && tutorial.includes(d), `${d} absent de la documentation`);
});

test("version de l'API des modules : la documentation cite celle du cœur", () => {
  const v = read("src/core/config.ts").match(/MODULE_API_VERSION = (\d+)/)[1];
  assert.ok(reference.includes(`"apiVersion": ${v}`), "docs/MODULES.md doit montrer apiVersion " + v);
  assert.ok(tutorial.includes(`"apiVersion": ${v}`), "docs/CREATE-A-MODULE.md doit montrer apiVersion " + v);
});

test("le tutoriel couvre chaque étape annoncée (checklist, test local, publication, sécurité, modules sans code)", () => {
  for (const needle of ["VITRINE_ALLOW_LOCAL_MODULES", "file://", "fakeCtx", "MODULES_INDEX_URL", "Checklist", "eval", "content", "theme:accent", "destructive", "readOnly", "backup", "overlay", "filters", "onInstanceDelete", "consumes", "provides", "feed.item"]) {
    assert.ok(tutorial.includes(needle), `le tutoriel ne parle pas de : ${needle}`);
  }
});

test("la documentation reste agnostique : aucune donnée métier réelle", () => {
  for (const doc of [reference, tutorial]) assert.ok(!/helldog|rosalia|gmail\.com/i.test(doc));
});
