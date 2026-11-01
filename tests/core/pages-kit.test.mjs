// Kit de conformité et fausse ctx (cœur 0.2.14) : les fonctions nouvelles (multichoice, family, sitemapFromPage, robots/sitemap, route « :slug ») demandent minCore 0.2.14,
// et un module qui s'en sert réussit le kit (le kit appelle la route « :slug » avec un segment plausible, passé dans ctx.params.slug).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { checkModule, fakeCtx } from "../../testsupport/index.mjs";
import { FEATURES } from "../../testsupport/requirements/manifest.mjs";
import { makeModule, dispose, editManifest } from "../fixtures/testsupport/fullModule.mjs";

const made = [];
const mk = (edit) => { const d = makeModule(edit); made.push(d); return d; };
after(() => { for (const d of made) dispose(d); });
const status = (report, id) => report.results.find((r) => r.id === id);

const NEW = FEATURES.filter((f) => f.since === "0.2.14");

test("kit : cinq fonctions du cœur 0.2.14 sont déclarées, et chacune se reconnaît dans un module", () => {
  assert.equal(NEW.length, 5);
  const by = (word) => NEW.find((f) => f.label.includes(word));
  const code = (s) => ({ code: s, definition: {} });
  assert.equal(by("multichoice").test(code(""), { settings: [{ key: "a", type: "multichoice" }] }), true);
  assert.equal(by("multichoice").test(code(""), { settings: [{ key: "a", type: "select" }] }), false);
  assert.equal(by("family").test(code(""), { family: "content" }), true);
  assert.equal(by("family").test(code(""), {}), false);
  assert.equal(by("sitemapFromPage").test(code(""), { sitemapFromPage: true }), true);
  assert.equal(by("sitemapFromPage").test(code(""), {}), false);
  const page = (c) => ({ code: c, definition: { page: () => ({}) } });
  assert.equal(by("robots").test(page('return { blocks: [], robots: "noindex" };'), {}), true);
  assert.equal(by("robots").test(page("return { blocks: [], sitemap: [a] };"), {}), true);
  assert.equal(by("robots").test(page("// robots: \"noindex\"\nreturn { blocks: [] };"), {}), false, "un commentaire ne compte pas");
  assert.equal(by("robots").test({ code: 'robots: "noindex"', definition: {} }, {}), false, "pas de page : rien");
  assert.equal(by(":slug").test({ code: "", definition: { routes: { "go/:slug": () => {} } } }, {}), true);
  assert.equal(by(":slug").test({ code: "", definition: { routes: { ":slug": () => {} } } }, {}), true);
  assert.equal(by(":slug").test({ code: "const s = ctx.params.slug;", definition: {} }, {}), true);
  assert.equal(by(":slug").test({ code: "", definition: { routes: { go: () => {} } } }, {}), false);
});

test("un module qui les utilise sans minCore 0.2.14 échoue compat.minCore (une ligne par fonction) ; avec minCore 0.2.14 il réussit", async () => {
  const edit = (minCore) => (f) => {
    editManifest(f, (m) => {
      m.minCore = minCore; m.family = "content"; m.sitemapFromPage = true;
      m.settings.push({ key: "topics", type: "multichoice", label: { en: "Interests", fr: "Centres d'intérêt" }, options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], defaultValues: ["a"] });
    });
    f["index.mjs"] = f["index.mjs"]
      .replace("title: ctx.setting(\"title\") || ctx.t(\"title\"),", "title: ctx.setting(\"title\") || ctx.t(\"title\"), robots: \"noindex\", sitemap: [\"/\" + ctx.instance.basePath + \"/more\"],")
      .replace("  routes: {\n", "  routes: {\n    async \"go/:slug\"(request, ctx) { return Response.json({ slug: ctx.params.slug, topics: ctx.setting(\"topics\") }); },\n");
    assert.ok(f["index.mjs"].includes("go/:slug") && f["index.mjs"].includes("robots"));
  };
  const old = await checkModule(mk(edit("0.2.13")), { siblings: [] });
  const r = status(old, "compat.minCore");
  assert.equal(r.status, "fail");
  assert.equal(r.problems?.length ?? r.details?.length ?? r.messages?.length, 5, JSON.stringify(r).slice(0, 600));
  const fresh = await checkModule(mk(edit("0.2.14")), { siblings: [] });
  assert.equal(status(fresh, "compat.minCore").status, "pass");
  const bad = fresh.results.filter((x) => x.status === "fail" && x.id !== "compat.minCoreKnown").map((x) => `${x.id}: ${JSON.stringify(x.problems ?? x.details ?? x.messages)}`);
  assert.deepEqual(bad, [], "(hors « minCore plus récent que ce cœur », vrai tant que la version du cœur n'est pas montée) le kit valide le manifeste (family, sitemapFromPage, multichoice) et fait tourner la route « :slug »");
});

test("fakeCtx : params vide par défaut, { slug } à la demande, figé", () => {
  assert.deepEqual({ ...fakeCtx().params }, {});
  const ctx = fakeCtx({ params: { slug: "abc" } });
  assert.equal(ctx.params.slug, "abc");
  assert.throws(() => { "use strict"; ctx.params.slug = "x"; }, TypeError);
});
