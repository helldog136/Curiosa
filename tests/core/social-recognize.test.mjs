import test from "node:test";
import assert from "node:assert/strict";

// Reconnaissance de l'adresse d'un profil (0.6.2) : pure, sans base ; le bloc `social` des manifestes est validé, recopié par le catalogue et ignoré s'il est abîmé.
const R = { ...(await import("@/core/socialRecognize")), ...(await import("@/core/socialSpec")) };
const { parseManifest } = await import("@/core/modules/manifest");
const { sanitizeEntries } = await import("@/core/modules/recognized");

const single = (reserved, chars = "A-Za-z0-9._-", { at = false, max = 60 } = {}) => ({ re: `^/${at ? "@" : "@?"}${reserved.length ? `(?!(?:${reserved.join("|")})(?:/|$))` : ""}([${chars}]{1,${max}})/?$`, handle: true });
const SPECS = {
  instagram: { name: "Instagram", icon: "instagram", hosts: ["instagram.com"], template: "https://www.instagram.com/{h}/", shapes: [single(["p", "reel", "stories"], "A-Za-z0-9._", { max: 30 })] },
  x: { name: "X", icon: "x", hosts: ["x.com"], template: "https://x.com/{h}", aliases: [["twitter.com", "x.com"]], shapes: [single(["home", "intent"], "A-Za-z0-9_", { max: 15 })] },
  facebook: { name: "Facebook", icon: "facebook", hosts: ["facebook.com"], template: "https://www.facebook.com/{h}", aliases: [["fb.me", "www.facebook.com"], ["fb.com", "www.facebook.com"]], shapes: [single(["profile\\.php", "groups"], "A-Za-z0-9.-")] },
  mastodon: { name: "Mastodon", icon: "mastodon", hosts: null, template: null, fediverse: true, shapes: [{ re: "^/@([A-Za-z0-9_.-]{1,60})/?$", withHost: true }] },
  reddit: { name: "Reddit", icon: "reddit", hosts: ["reddit.com"], template: "https://www.reddit.com/user/{h}", tag: "u/",
    forms: [["^/?r/([A-Za-z0-9_]{2,21})/?$", "https://www.reddit.com/r/{1}"], ["^/?(?:u|user)/([A-Za-z0-9_-]{2,21})/?$", "https://www.reddit.com/user/{1}"]],
    shapes: [{ re: "^/(?:u|user)/([A-Za-z0-9_-]{2,21})/?$", handle: true }, { re: "^/r/([A-Za-z0-9_]{2,21})/?$", prefix: "r/", template: "https://www.reddit.com/r/{h}" }] },
  discord: { name: "Discord", icon: "discord", hosts: ["discord.gg", "discord.com"], template: "https://discord.gg/{h}", shapes: [{ host: "^discord\\.gg$", re: "^/([A-Za-z0-9-]{2,32})/?$", handle: true }, { host: "^discord\\.com$", re: "^/invite/([A-Za-z0-9-]{2,32})/?$", handle: true }] },
  bandcamp: { name: "Bandcamp", icon: "bandcamp", hosts: ["bandcamp.com"], template: "https://{h}.bandcamp.com", handle: "^@?[A-Za-z0-9-]{1,60}$", shapes: [{ host: "^([a-z0-9-]+)\\.bandcamp\\.com$", fromHost: true, re: "^/?$", handle: true }] },
  github: { name: "GitHub", icon: "github", hosts: ["github.com"], template: "https://github.com/{h}", shapes: [single(["orgs", "settings"], "A-Za-z0-9-", { max: 39 })] },
};
for (const [k, v] of Object.entries(SPECS)) assert.ok(R.parseSocialSpec(v), `${k} : bloc valide`);
const one = (id, text) => { const m = R.recognizeOne(SPECS[id], text); return m && [R.buttonLabel(SPECS[id], m), m.url]; };

test("un nom, une adresse sans https ou sans www, un lien de partage : le même bouton et la même adresse", () => {
  for (const t of ["monpseudo", "@monpseudo", "instagram.com/monpseudo", "www.instagram.com/monpseudo/", "https://instagram.com/monpseudo", "https://www.instagram.com/monpseudo/?igsh=MWxk&utm_source=qr", "  <https://www.instagram.com/monpseudo/>  "]) {
    assert.deepEqual(one("instagram", t), ["Instagram · monpseudo", "https://www.instagram.com/monpseudo/"], t);
  }
  assert.deepEqual(one("x", "https://twitter.com/monpseudo?s=20&t=abc"), ["X · monpseudo", "https://x.com/monpseudo"]);
  assert.deepEqual(one("facebook", "fb.me/monpseudo"), ["Facebook · monpseudo", "https://www.facebook.com/monpseudo"]);
  assert.deepEqual(one("facebook", "https://www.facebook.com/profile.php?id=1&mibextid=x"), ["Facebook", "https://www.facebook.com/profile.php?id=1"]);
  assert.deepEqual(one("mastodon", "@nom@mastodon.social"), ["Mastodon · nom@mastodon.social", "https://mastodon.social/@nom"]);
  assert.deepEqual(one("reddit", "r/communaute"), ["Reddit · r/communaute", "https://www.reddit.com/r/communaute"]);
  assert.deepEqual(one("reddit", "u/pseudo"), ["Reddit · u/pseudo", "https://www.reddit.com/user/pseudo"]);
  assert.deepEqual(one("discord", "https://discord.com/invite/abcDEF"), ["Discord · abcDEF", "https://discord.gg/abcDEF"]);
  assert.deepEqual(one("bandcamp", "monnom.bandcamp.com"), ["Bandcamp · monnom", "https://monnom.bandcamp.com"]);
  assert.deepEqual(one("github", "https://gist.github.com/x"), ["GitHub", "https://gist.github.com/x"], "un sous-domaine garde son adresse");
});

test("ce qui n'est pas ce réseau est refusé : autre site, http, identifiants, port, javascript:, texte avec espaces, page du site", () => {
  for (const t of ["", "   ", "http://www.instagram.com/x", "https://user:pw@www.instagram.com/x", "https://www.instagram.com.evil.example/x", "evil.example/instagram.com/x", "javascript:alert(1)", "data:text/html,x", "mon pseudo", "a".repeat(80), "../x"]) {
    assert.equal(R.recognizeOne(SPECS.instagram, t), null, JSON.stringify(t));
  }
  assert.equal(R.recognizeOne(SPECS.mastodon, "https://mastodon.social/about"), null);
  assert.equal(R.recognizeOne(SPECS.mastodon, "mastodon.social:8443/@a"), null);
  assert.equal(R.recognizeOne(SPECS.mastodon, "nom"), null, "Mastodon exige le serveur");
  assert.equal(one("instagram", "https://www.instagram.com/p/Cabc123/")[0], "Instagram", "une page du site n'est pas un nom de compte");
});

test("texte collé : une ou plusieurs adresses (lignes, espaces, virgules), sans doublon ; chacune reconnue, ambiguë ou inconnue", () => {
  const sources = Object.entries(SPECS).map(([id, spec]) => ({ id, spec }));
  assert.deepEqual(R.splitAddresses("a.com/x\n  b.com/y , a.com/x;c"), ["a.com/x", "b.com/y", "c"]);
  assert.equal(R.splitAddresses(Array.from({ length: 60 }, (_, i) => `u${i}`).join(" ")).length, 30, "30 au plus");
  const out = R.recognizeSocial("instagram.com/moi\nhttps://github.com/moi  r/mon_sub monpseudo n'importe-quoi.example/x", sources);
  assert.deepEqual(out.map((r) => [r.kind, r.id ?? r.choices?.map((c) => c.id).join(",") ?? ""]), [
    ["match", "instagram"], ["match", "github"], ["match", "reddit"], ["ambiguous", out[3].choices.map((c) => c.id).join(",")], ["unknown", ""]]);
  assert.ok(out[3].choices.length >= 4, "un nom seul va à plusieurs réseaux : à choisir");
  assert.ok(out[3].choices.every((c) => c.label && c.url.startsWith("https://")));
  assert.equal(out[0].label, "Instagram · moi");
});

test("le bloc social est validé : tailles, expressions régulières refusées si dangereuses, bloc abîmé ignoré", () => {
  assert.equal(R.parseSocialSpec(null), undefined);
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: "http://x.com/{h}" }), undefined, "modèle en http refusé");
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: null, shapes: [{ re: "^(a+)+$" }] }), undefined, "quantificateur imbriqué refusé");
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: null, shapes: [{ re: "(" }] }), undefined, "expression illisible refusée");
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: null, shapes: [{ re: "^/(a)\\1$" }] }), undefined, "référence arrière refusée");
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["not a host"], template: null }), undefined);
  assert.equal(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: null, shapes: Array(11).fill({ re: "^/a$" }) }), undefined, "trop de formes");
  assert.ok(R.parseSocialSpec({ name: "X", hosts: ["x.com"], template: null }));
  // une entrée qui plante ne casse pas la reconnaissance des autres
  assert.equal(R.recognizeSocial("x.com/moi", [{ id: "a", spec: SPECS.x }]).length, 1);
});

test("le temps de calcul reste borné même avec une saisie hostile (expression valide mais coûteuse, 300 caractères)", () => {
  const hostile = "a".repeat(300);
  const t0 = Date.now();
  for (const spec of Object.values(SPECS)) R.recognizeOne(spec, hostile);
  R.recognizeSocial(`${hostile} ${"x".repeat(299)}/${"y".repeat(100)}`, Object.entries(SPECS).map(([id, spec]) => ({ id, spec })));
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test("manifeste : le bloc social est lu, un bloc abîmé est ignoré sans refuser le module", () => {
  const base = { apiVersion: 2, id: "demo-net", name: "Demo", version: "1.0.0", type: "social", main: "index.mjs", provides: [{ topic: "social.link" }] };
  const good = parseManifest({ ...base, social: SPECS.instagram });
  assert.ok(good.ok && good.manifest.social?.name === "Instagram");
  const bad = parseManifest({ ...base, social: { name: "", hosts: 3 } });
  assert.ok(bad.ok, "le module reste valide");
  assert.equal(bad.manifest.social, undefined);
  assert.equal(parseManifest(base).manifest.social, undefined);
});

test("catalogue : l'index porte le bloc social des réseaux (relu sans installer) ; un bloc abîmé est écarté, l'entrée reste", () => {
  const entry = (id, social) => ({ id, name: id, description: "d", repo: "https://github.com/helldog136/curiosa-extras", ref: "v1.0.0", subdir: `modules/${id}`, provides: ["social.link"], social });
  const items = R.socialSourcesOf(sanitizeEntries({ modules: [entry("instagram", SPECS.instagram), entry("casse", { name: 1 }), entry("sans")] }));
  assert.deepEqual(items.map((s) => s.id), ["instagram"]);
  assert.equal(sanitizeEntries({ modules: [entry("casse", { name: 1 })] }).length, 1);
  assert.equal(R.recognizeSocial("instagram.com/moi", items)[0].kind, "match");
});

test("un réseau fédéré (Mastodon, n'importe quel serveur) ne vole pas l'adresse d'un réseau dont le site est celui de l'adresse", () => {
  const tiktok = { name: "TikTok", icon: "tiktok", hosts: ["tiktok.com"], template: "https://www.tiktok.com/@{h}", shapes: [single([], "A-Za-z0-9._", { at: true, max: 24 })] };
  const sources = [{ id: "mastodon", spec: SPECS.mastodon }, { id: "tiktok", spec: tiktok }];
  const [r] = R.recognizeSocial("https://www.tiktok.com/@moi", sources);
  assert.deepEqual([r.kind, r.id, r.label], ["match", "tiktok", "TikTok · moi"]);
  const [m] = R.recognizeSocial("https://piaille.fr/@moi", sources);
  assert.deepEqual([m.kind, m.id], ["match", "mastodon"]);
});
