import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const S = await import("@/core/social");
const { installModule } = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { getSiteConfig } = await import("@/core/settings");

beforeEach(() => db.reset());
after(() => db.close());

/** Un « réseau » : un module d'un seul réglage (l'adresse du profil) qui fournit son bouton. */
const network = (id, { items, instances = "multiple" } = {}) => ({
  "module.json": { apiVersion: 2, version: "1.0.0", id, name: id, instances, provides: [{ topic: "social.link" }], settings: [{ key: "url", type: "url", label: "Adresse" }], main: "index.mjs" },
  "index.mjs": `export default { exports: { "social.link": (ctx) => ${items ?? `[{ label: ctx.setting("url") ? "${id}" : "", url: ctx.setting("url") ?? "", icon: "${id}" }]`} } };`,
});
async function add(id, mod, nickname, names = { en: nickname ?? id }) {
  if (!(await R.getModule(id))) { await installModule(makeRepo(mod).url);}
  const inst = await createInstance(db.prisma, { manifest: (await R.getModule(id)).manifest, nickname, names });
  return inst;
}

test("réseaux : le cœur ne connaît aucun réseau — il collecte le bouton (nom, adresse, icône) de chaque module qui fournit « social.link »", async () => {
  await add("twitch", network("twitch", { items: `[{ label: "Twitch", url: "https://twitch.tv/moncompte", icon: "twitch" }]` }));
  await add("youtube", network("youtube", { items: `[{ label: "YouTube", url: "https://youtube.com/@x", icon: "youtube" }]` }));
  const links = await S.loadSocialLinks("en");
  assert.deepEqual(links.map((l) => [l.label, l.href, l.icon, l.module]), [["Twitch", "https://twitch.tv/moncompte", "twitch", "twitch"], ["YouTube", "https://youtube.com/@x", "youtube", "youtube"]]);
});

test("réseaux : plusieurs instances du même réseau — chacune apporte SON bouton (la chaîne de l'un, celle d'un ami)", async () => {
  const mod = { "module.json": { apiVersion: 2, version: "1.0.0", id: "twitch", name: "Twitch", instances: "multiple", provides: [{ topic: "social.link" }], settings: [{ key: "channel", type: "text", label: "Chaîne" }], main: "index.mjs" },
    "index.mjs": `export default { exports: { "social.link": (ctx) => ctx.setting("channel") ? [{ label: "Twitch " + ctx.setting("channel"), url: "https://twitch.tv/" + ctx.setting("channel"), icon: "twitch" }] : [] } };` };
  const a = await add("twitch", mod, "Moi", { en: "Moi" });
  const b = await add("twitch", mod, "Ami", { en: "Ami" });
  const set = (inst, channel) => db.prisma.setting.create({ data: { key: `instance.${inst.id}.channel`, locale: "", value: JSON.stringify(channel) } });
  await set(a, "moncompte"); await set(b, "ami");
  const links = await S.loadSocialLinks("en");
  assert.deepEqual(links.map((l) => l.href).sort(), ["https://twitch.tv/ami", "https://twitch.tv/moncompte"]);
  assert.notEqual(links[0].instance, links[1].instance);
});

test("réseaux : adresses dangereuses, éléments invalides et doublons écartés ; 10 boutons au plus ; un réseau en panne ne casse pas les autres", async () => {
  await add("mauvais", network("mauvais", { items: `[{ label: "JS", url: "javascript:alert(1)" }, { label: "Sans url" }, { url: "https://sans-nom.example" }, { label: "Local", url: "/page" }, { label: "Ok", url: "https://ok.example/a" }, { label: "Doublon", url: "https://ok.example/a" }]` }));
  await add("panne", network("panne", { items: `(() => { throw new Error("panne"); })()` }));
  await add("zbeaucoup", network("zbeaucoup", { items: `Array.from({ length: 20 }, (_, i) => ({ label: "N" + i, url: "https://r" + i + ".example" }))` }));
  const log = console.error; console.error = () => {};
  try {
    const links = await S.loadSocialLinks("en");
    assert.equal(links.length, 10);
    assert.deepEqual(links.filter((l) => l.module === "mauvais").map((l) => l.href), ["https://ok.example/a"], "ni javascript:, ni chemin local, ni élément incomplet, ni doublon");
    assert.ok(!links.some((l) => /javascript/.test(l.href)));
  } finally { console.error = log; }
});

test("réseaux : sans aucun réseau, rien n'est affiché ; les icônes de l'en-tête sont affichées par défaut dès qu'il y en a un (case de masquage)", async () => {
  assert.deepEqual(await S.loadSocialLinks("en"), []);
  assert.equal((await getSiteConfig()).header.socials, true);
  await db.prisma.setting.create({ data: { key: "header.socials", locale: "", value: "false" } });
  assert.equal((await getSiteConfig()).header.socials, false);
});

test("réseaux : l'en-tête lit les réseaux auprès du cœur (plus aucune liste « liens » lue d'office) ; les réglages ne montrent la case que s'il y a un réseau", async () => {
  const fs = await import("node:fs");
  const header = fs.readFileSync("src/components/site/Header.tsx", "utf8");
  assert.match(header, /loadSocialLinks\(locale\)/);
  assert.ok(!/display !== "links"|listEntries/.test(header));
  const settings = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  assert.match(settings, /socialCount > 0/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/settings/actions.ts", "utf8"), /providersOf\(SOCIAL_TOPIC\)\)\.length > 0\) await setSetting\("header\.socials"/);
});

let n = 0;
const one = async (spec) => {
  await db.reset(); n++;
  const id = "lien" + n;
  await add(id, network(id, { items: `[{ label: "L", url: "https://l.example/a", icon: "link"${spec ? ", " + spec : ""} }]` }));
  const [l] = await S.loadSocialLinks("en");
  return l;
};

test("réseaux : sans demande du module, rien ne change — noopener noreferrer, _blank, pas de politique de référent", async () => {
  const l = await one("");
  assert.deepEqual([l.rel, l.referrerPolicy, l.target], ["noopener noreferrer", null, "_blank"]);
});

test("réseaux : un module peut demander rel, referrerPolicy et target (listes fermées) ; noopener est toujours ajouté, ordre fixe, sans doublon", async () => {
  const l = await one(`rel: "UGC  sponsored nofollow nofollow", referrerPolicy: "Origin", target: "_self"`);
  assert.deepEqual([l.rel, l.referrerPolicy, l.target], ["noopener nofollow sponsored ugc", "origin", "_self"]);
  const m = await one(`rel: ["noopener", "noreferrer"], target: " _BLANK "`);
  assert.deepEqual([m.rel, m.target], ["noopener noreferrer", "_blank"]);
});

test("réseaux : valeurs invalides ignorées (défauts sûrs), l'élément reste affiché ; aucun attribut libre ni injection", async () => {
  const l = await one(`rel: "external me", referrerPolicy: "unsafe-url", target: "_top"`);
  assert.deepEqual([l.rel, l.referrerPolicy, l.target], ["noopener noreferrer", null, "_blank"]);
  const bad = await one(`rel: 42, referrerPolicy: { a: 1 }, target: ["_self"], onclick: "alert(1)", style: "x", download: "y"`);
  assert.deepEqual([bad.rel, bad.referrerPolicy, bad.target], ["noopener noreferrer", null, "_blank"]);
  assert.deepEqual(Object.keys(bad).sort(), ["href", "icon", "instance", "label", "module", "referrerPolicy", "rel", "target"]);
  const quote = await one(`rel: 'noopener" onmouseover="x', referrerPolicy: 'origin" x="'`);
  assert.deepEqual([quote.rel, quote.referrerPolicy], ["noopener noreferrer", null]);
});

test("réseaux : une politique de référent choisie sans rel remplace noreferrer (qui l'annulerait) ; avec un rel explicite, le rel du module gagne", async () => {
  const a = await one(`referrerPolicy: "strict-origin-when-cross-origin"`);
  assert.deepEqual([a.rel, a.referrerPolicy], ["noopener", "strict-origin-when-cross-origin"]);
});

test("réseaux : javascript: reste refusé même avec des attributs valides", async () => {
  await add("lienjs", network("lienjs", { items: `[{ label: "JS", url: "javascript:alert(1)", rel: "nofollow", target: "_self" }]` }));
  assert.deepEqual(await S.loadSocialLinks("en"), []);
});

test("réseaux : l'en-tête écrit les attributs calculés par le cœur (plus de rel/target figés)", async () => {
  const fs = await import("node:fs");
  const header = fs.readFileSync("src/components/site/Header.tsx", "utf8");
  assert.match(header, /rel=\{s\.rel\} referrerPolicy=\{s\.referrerPolicy \?\? undefined\} target=\{s\.target\}/);
});
