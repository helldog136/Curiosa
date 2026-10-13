import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { parseNeutralityRules, findViolations, loadNeutralityText } from "../helpers/neutrality.mjs";

const { ADAPTERS, generic, pickAdapter, readPage } = await import("../../scripts/import-links/index.mjs");
const { profileFromSource } = await import("../../scripts/import-links/pipeline.mjs");
const { makePage } = await import("../../scripts/import-links/page.mjs");
const { normalise, revalidateProfile, PROFILE_KIND, MAX_LINKS } = await import("../../scripts/import-links/model.mjs");
const { classify, PLATFORMS, MAX_SOCIALS } = await import("../../scripts/import-links/socials.mjs");
const { cleanLinkUrl, assertPublicUrl, isPrivateAddress, urlKey } = await import("../../scripts/import-links/urls.mjs");
const { cleanText } = await import("../../scripts/import-links/text.mjs");
const { fetchPage, LIMITS } = await import("../../scripts/import-links/fetch.mjs");
const { readSource } = await import("../../scripts/import-links/source.mjs");
const { reportJson, reportText } = await import("../../scripts/import-links/report.mjs");
const { parseHtml, jsonBlocks, textOf, find } = await import("../../scripts/import-links/html.mjs");
const { finalUrl } = await import("../../scripts/import-links/adapters/allmylinks.mjs");
const { taglineOf } = await import("../../scripts/import-links/backup.mjs");

const FIX = "tests/fixtures/links";
const URLS = { linktree: "https://linktr.ee/lune_demo", beacons: "https://beacons.ai/mael_demo", biolink: "https://bio.link/noa_demo", linkinbio: "https://linkin.bio/demo_fictif", lnkbio: "https://lnk.bio/sacha_demo", taplink: "https://taplink.cc/iris_demo", soloto: "https://solo.to/ravi_demo", campsite: "https://campsite.bio/ondine_demo", allmylinks: "https://allmylinks.com/yanis_demo", carrd: "https://pia-demo.carrd.co/", milkshake: "https://msha.ke/zoe_demo", generic: "https://lou-demo.example.org/" };
const html = (name) => fs.readFileSync(path.join(FIX, `${name}.html`), "utf8");
const load = (name, url = URLS[name], opts = {}) => profileFromSource({ kind: "page", input: url, url, html: html(name) }, opts);
const summary = (p) => ({ links: p.links.map((l) => [l.section, l.title]), socials: p.socials.map((s) => `${s.platform}:${s.value}`) });

/* ───────────── un test par adaptateur, sur sa fixture (réaliste, entièrement fictive) ───────────── */

test("les onze services sont pris en charge, chacun par son propre adaptateur, plus l'adaptateur générique", () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id), ["linktree", "beacons", "biolink", "linkinbio", "lnkbio", "taplink", "soloto", "campsite", "allmylinks", "carrd", "milkshake"]);
  for (const a of [...ADAPTERS, generic]) assert.ok(typeof a.extract === "function" && typeof a.detect === "function" && Array.isArray(a.hosts), a.id);
  for (const a of ADAPTERS) assert.ok(fs.existsSync(`scripts/import-links/adapters/${a.id}.mjs`), `un fichier par adaptateur : ${a.id}`);
});

test("Linktree : nom, bio, avatar, liens dans l'ordre, sections, groupes, réseaux ; blocs sans adresse et adresses dangereuses signalés", async () => {
  const p = await load("linktree");
  assert.equal(p.source.adapter, "linktree"); assert.equal(p.source.fallback, false);
  assert.equal(p.site.name, "Lune Démo");
  assert.match(p.site.description, /^Créatrice fictive/);
  assert.equal(p.site.avatar, "https://images.example.org/avatar-demo.png");
  assert.deepEqual(summary(p).links, [["Mes chaînes", "Ma chaîne YouTube"], ["Boutique et soutien", "Ma boutique"], ["Projets", "Le jeu de la jam"], ["Projets", "Le dépôt du jeu"], ["Boutique et soutien", "Contenu réservé"], ["Boutique et soutien", "Mon site"], ["", "LinkedIn"], ["", "E-mail"]]);
  assert.deepEqual(p.sections, ["Mes chaînes", "Boutique et soutien", "Projets"]);
  assert.deepEqual(summary(p).socials, ["instagram:demo_fictif", "twitch:demo_fictif", "mastodon:https://social.example.org/@demo_fictif", "tiktok:demo_fictif", "kofi:demo_fictif"]);
  assert.deepEqual(p.notRetained.map((n) => n.title), ["Mon pack de stickers", "Piège"]);
  assert.match(p.notRetained[1].reason, /adresse non autorisée/);
  assert.ok(p.toCheck.some((t) => /Contenu réservé.*protégé/.test(t)), "lien protégé signalé");
  assert.ok(p.toCheck.some((t) => /YouTube/.test(t)), "chaîne YouTube sans identifiant UC… : à compléter");
  assert.equal(p.links[0].icon, "youtube");
  assert.equal(p.links.find((l) => l.title === "Mon site").title, "Mon site", "balise HTML retirée du titre");
});

test("Linktree : forme inattendue du JSON → lecture générique du JSON, dite dans les notes ; JSON absent → adaptateur générique", async () => {
  const odd = html("linktree").replace(/"links":\[/, '"items":[').replace('"socialLinks":[]}}', '"socialLinks":[]}}');
  const p = await profileFromSource({ kind: "page", input: "x", url: URLS.linktree, html: odd });
  assert.ok(p.links.length >= 4, "les liens sont retrouvés malgré le changement de nom du champ");
  const redesigned = await load("linktree-redesigned", URLS.linktree);
  assert.equal(redesigned.source.adapter, "generic"); assert.equal(redesigned.source.fallback, true);
  assert.match(redesigned.source.fallbackReason, /Linktree/);
  assert.ok(redesigned.toCheck.some((t) => /lecture de secours/.test(t)), "l'IA le voit dans le rapport");
  assert.deepEqual(summary(redesigned).links.map((l) => l[1]), ["Mon site", "Ma lettre d'information"], "navigation et pied de page du service ignorés");
  assert.deepEqual(summary(redesigned).socials, ["twitch:demo_fictif"]);
});

test("Beacons : profil, intertitres, liens, réseaux ; texte sans adresse non repris", async () => {
  const p = await load("beacons");
  assert.equal(p.source.adapter, "beacons");
  assert.equal(p.site.name, "Maël Démo"); assert.match(p.site.description, /^Musicien fictif/); assert.equal(p.site.avatar, "https://images.example.org/mael.jpg");
  assert.deepEqual(summary(p).links, [["Me suivre", "Concerts"]]);
  assert.deepEqual(summary(p).socials, ["instagram:mael_demo_fictif", "youtube:UCdemoFictif0123456789ab", "spotify:https://open.spotify.com/artist/4aBcDeFgHiJkLmNoPqRsTu", "bandcamp:https://mael-demo.bandcamp.com/", "bluesky:mael-demo.example.org", "discord:DemoFictif"]);
  assert.deepEqual(p.notRetained.map((n) => n.title), ["Un texte sans lien"]);
});

test("Bio.link : nom, bio, avatar, boutons, section, rangée d'icônes ; pied de page du service ignoré", async () => {
  const p = await load("biolink");
  assert.equal(p.source.adapter, "biolink");
  assert.equal(p.site.name, "Noa Démo"); assert.match(p.site.description, /^Illustratrice fictive/); assert.equal(p.site.avatar, "https://images.example.org/noa.png");
  assert.deepEqual(summary(p).links, [["", "Portfolio"], ["", "Commandes"], ["Boutique", "Impressions"]]);
  assert.deepEqual(summary(p).socials, ["instagram:noa_demo_fictif", "x:noa_demo_fictif"]);
});

test("Linkin.bio (Later) : la légende de l'image devient le titre, tronquée ; image sans légende → adresse du site", async () => {
  const p = await load("linkinbio");
  assert.equal(p.source.adapter, "linkinbio");
  assert.equal(p.site.name, "demo_fictif");
  assert.deepEqual(p.links.map((l) => l.title), ["Le monstera est de retour en stock, commandez-le avant dimanche", "Pothos doré : nos conseils d'entretien", "blog.example.org"]);
  assert.deepEqual(summary(p).socials, ["instagram:demo_fictif"]);
  assert.ok(p.toCheck.some((t) => /présentation/.test(t)), "bio absente signalée");
});

test("Lnk.Bio : profil, liens, réseaux", async () => {
  const p = await load("lnkbio");
  assert.equal(p.source.adapter, "lnkbio");
  assert.equal(p.site.name, "Sacha Démo"); assert.equal(p.site.description, "Podcast fictif sur la cuisine.");
  assert.deepEqual(p.links.map((l) => l.title), ["Le podcast", "Tous les épisodes"]);
  assert.deepEqual(summary(p).socials, ["telegram:sacha_demo_fictif", "facebook:sacha.demo.fictif"]);
});

test("Taplink : état initial de la page, intertitre, liens, boutons, réseaux ; bloc de texte non repris, pixel de mesure ignoré", async () => {
  const p = await load("taplink");
  assert.equal(p.source.adapter, "taplink");
  assert.equal(p.site.name, "Iris Démo"); assert.equal(p.site.description, "Coach sportive fictive.");
  assert.deepEqual(summary(p).links, [["Réserver", "Séance d'essai"], ["Réserver", "Tarifs"]]);
  assert.deepEqual(summary(p).socials, ["instagram:iris_demo_fictif", "tiktok:iris_demo_fictif"]);
  assert.deepEqual(p.notRetained.map((n) => n.title), ["Horaires"]);
  assert.ok(!p.links.some((l) => /stats\./.test(l.url)));
});

test("Solo.to : profil, boutons, réseaux (Twitch, Kick, Reddit) et profils reconnus dans la liste (Steam, Patreon)", async () => {
  const p = await load("soloto");
  assert.equal(p.source.adapter, "soloto");
  assert.equal(p.site.name, "Ravi Démo"); assert.match(p.site.description, /^Streamer fictif/);
  assert.deepEqual(p.links.map((l) => l.title), ["Planning des lives"]);
  assert.deepEqual(summary(p).socials, ["twitch:ravi_demo_fictif", "kick:ravi_demo_fictif", "reddit:ravi_demo_fictif", "steam:ravi_demo_fictif", "patreon:ravi_demo_fictif"]);
});

test("Campsite.bio : identité et réseaux (sameAs) depuis les données structurées, boutons par section, mailto accepté", async () => {
  const p = await load("campsite");
  assert.equal(p.source.adapter, "campsite");
  assert.equal(p.site.name, "Ondine Démo"); assert.equal(p.site.avatar, "https://images.example.org/ondine.jpg");
  assert.deepEqual(summary(p).links, [["Mes projets", "Galerie"], ["Mes projets", "Stages photo"], ["Contact", "Écrire"]]);
  assert.equal(p.links[2].url, "mailto:ondine@example.org");
  assert.deepEqual(summary(p).socials, ["instagram:ondine_demo_fictif", "pinterest:ondine_demo_fictif", "soundcloud:ondine_demo_fictif"]);
});

test("AllMyLinks : adresse finale prise dans la page quand elle y est, sinon lien « à résoudre » ; résolution à la demande, bornée", async () => {
  const p = await load("allmylinks");
  assert.equal(p.source.adapter, "allmylinks");
  assert.deepEqual(p.links.map((l) => [l.title, l.url]), [["Mes jeux", "https://yanis-demo.example.org/jeux"], ["Sur itch", "https://itch-demo.example.org/yanis"]]);
  assert.equal(p.notRetained.length, 1);
  assert.match(p.notRetained[0].reason, /--resolve-redirects/);
  assert.deepEqual(finalUrl("/link/out?id=1", { "data-url": "https://a.example.org/x" }), { url: "https://a.example.org/x" });
  assert.equal(finalUrl("/link/out?id=1").needsResolve, true);
  const calls = [];
  const resolved = await load("allmylinks", URLS.allmylinks, { resolveRedirects: true, resolve: async (u) => { calls.push(u); return "https://cible.example.org/ok"; } });
  assert.equal(calls.length, 1, "un seul lien à résoudre, une seule requête");
  assert.equal(resolved.links.length, 3); assert.equal(resolved.notRetained.length, 0);
});

test("Carrd : titre, texte, photo, boutons, rangée d'icônes (étiquettes) ; page sans bouton → dit ce qui manque", async () => {
  const p = await load("carrd");
  assert.equal(p.source.adapter, "carrd");
  assert.equal(p.site.name, "Pia Démo"); assert.equal(p.site.description, "Autrice fictive de romans policiers."); assert.equal(p.site.avatar, "https://images.example.org/pia.png");
  assert.deepEqual(p.links.map((l) => l.title), ["Mes romans", "Dédicaces"]);
  assert.deepEqual(summary(p).socials, ["instagram:pia_demo_fictif", "github:pia-demo-fictif"]);
  const bare = await profileFromSource({ kind: "page", input: "x", url: URLS.carrd, html: '<html><body id="wrapper"><div id="main"><h1 id="title01">Seule</h1></div><!-- carrd.co --></body></html>' });
  assert.ok(bare.toCheck.some((t) => /aucun lien/.test(t)));
});

test("Milkshake : cartes du mini-site, cartes sans adresse non reprises", async () => {
  const p = await load("milkshake");
  assert.equal(p.source.adapter, "milkshake");
  assert.equal(p.site.name, "Zoé Démo"); assert.match(p.site.description, /^Cuisinière fictive/);
  assert.deepEqual(p.links.map((l) => l.title), ["Le carnet de recettes", "Ateliers", "Newsletter"]);
  assert.deepEqual(p.notRetained.map((n) => n.title), ["Recettes", "Photo du jour"]);
});

test("adaptateur générique : page inconnue (données structurées, Open Graph, liens hors navigation et pied de page, adresses relatives résolues)", async () => {
  const p = await load("generic");
  assert.equal(p.source.adapter, "generic"); assert.equal(p.source.aggregator, "unknown"); assert.equal(p.source.fallback, false);
  assert.equal(p.site.name, "Lou Démo"); assert.match(p.site.description, /sans service connu/);
  assert.equal(p.site.avatar, "https://lou-demo.example.org/images/lou.png");
  assert.deepEqual(p.links.map((l) => [l.title, l.url]), [["Mon blog", "https://lou-demo.example.org/blog"], ["À propos", "https://lou-demo.example.org/apropos"], ["Dossier de presse", "https://lou-demo.example.org/dossier.pdf"]]);
  assert.deepEqual(p.notRetained.map((n) => n.title), ["Rien", "Téléphone"]);
  assert.ok(!p.links.some((l) => /mentions|contact/.test(l.url)), "navigation et pied de page exclus");
});

test("un service reconnu à sa signature (domaine personnalisé) passe par son adaptateur", () => {
  const page = makePage({ url: "https://liens.example.org/", html: html("beacons") });
  assert.equal(pickAdapter(page).adapter.id, "beacons"); assert.equal(pickAdapter(page).by, "signature");
  assert.equal(readPage(page).adapter, "beacons");
  assert.equal(pickAdapter(makePage({ url: "https://linktr.ee/x", html: "" })).by, "adresse");
  assert.throws(() => pickAdapter(page, "inconnu"), /adaptateur inconnu/);
  assert.equal(readPage(makePage({ url: "https://x.example.org/", html: html("beacons") }), { adapter: "generic" }).adapter, "generic");
});

test("repli propre : adaptateur reconnu mais page vide ou méconnaissable → générique, raison donnée ; jamais d'exception", async () => {
  for (const bad of ["", "<html><body><p>rien</p></body></html>", "\u0000\u0001<<<>>>&&&", "<a href=", "<script id=\"__NEXT_DATA__\" type=\"application/json\">{pas du json</script>", "x".repeat(200_000)]) {
    const p = await profileFromSource({ kind: "page", input: "x", url: "https://linktr.ee/personne", html: bad });
    assert.equal(p.source.adapter, "generic"); assert.equal(p.source.fallback, true);
    assert.ok(p.toCheck.some((t) => /aucun lien trouvé/.test(t)));
  }
  const json = await profileFromSource({ kind: "page", input: "x", url: "", json: { props: { pageProps: { account: { pageTitle: "Nom JSON" }, links: [{ title: "Un", url: "https://a.example.org/" }] } } } });
  assert.equal(json.site.name, "Nom JSON"); assert.equal(json.links.length, 1);
});

/* ───────────── réseaux sociaux ───────────── */

test("réseaux : vingt-trois domaines reconnus, un module par réseau (identifiants du catalogue), seulement pour un PROFIL", () => {
  const cases = {
    twitch: ["https://www.twitch.tv/Demo_Fictif", "twitch-channel", "demo_fictif"], youtube: ["https://www.youtube.com/channel/UCdemoFictif0123456789ab", "youtube-channel", "UCdemoFictif0123456789ab"],
    instagram: ["https://instagram.com/demo_fictif/", "instagram", "demo_fictif"], tiktok: ["https://www.tiktok.com/@demo_fictif", "tiktok", "demo_fictif"], x: ["https://twitter.com/demo_fictif", "x-twitter", "demo_fictif"],
    facebook: ["https://fb.com/demo.fictif", "facebook", "demo.fictif"], discord: ["https://discord.com/invite/DemoFictif", "discord", "DemoFictif"], github: ["https://github.com/demo-fictif", "github", "demo-fictif"],
    bluesky: ["https://bsky.app/profile/demo.example.org", "bluesky", "demo.example.org"], mastodon: ["https://mastodon.social/@demo_fictif", "mastodon", "https://mastodon.social/@demo_fictif"], threads: ["https://www.threads.net/@demo_fictif", "threads", "demo_fictif"],
    kick: ["https://kick.com/demo_fictif", "kick", "demo_fictif"], spotify: ["https://open.spotify.com/artist/4aBcDeFgHiJkLmNo?si=abc", "spotify", "https://open.spotify.com/artist/4aBcDeFgHiJkLmNo"], reddit: ["https://www.reddit.com/u/demo_fictif", "reddit", "demo_fictif"],
    patreon: ["https://www.patreon.com/demo_fictif", "patreon", "demo_fictif"], kofi: ["https://ko-fi.com/demo_fictif", "kofi", "demo_fictif"], snapchat: ["https://www.snapchat.com/add/demo_fictif", "snapchat", "demo_fictif"],
    pinterest: ["https://www.pinterest.com/demo_fictif/", "pinterest", "demo_fictif"], telegram: ["https://t.me/demo_fictif", "telegram", "demo_fictif"], steam: ["https://steamcommunity.com/id/demo_fictif", "steam", "demo_fictif"],
    soundcloud: ["https://soundcloud.com/demo_fictif", "soundcloud", "demo_fictif"], bandcamp: ["https://demo-fictif.bandcamp.com/music", "bandcamp", "https://demo-fictif.bandcamp.com/"],
  };
  assert.deepEqual(PLATFORMS.map((p) => p.id).sort(), Object.keys(cases).sort());
  for (const [id, [url, module, value]] of Object.entries(cases)) {
    const c = classify(url);
    assert.ok(c, id); assert.equal(c.platform, id); assert.equal(c.module, module, id); assert.equal(c.value, value, id);
  }
  for (const nope of ["https://www.twitch.tv/videos/123456", "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://github.com/demo-fictif/le-depot", "https://github.com/sponsors/demo", "https://www.instagram.com/p/AbC123/", "https://www.tiktok.com/@demo/video/1", "https://x.com/demo/status/1", "https://open.spotify.com/track/abc", "https://www.facebook.com/sharer/sharer.php", "https://example.org/@demo", "https://medium.com/@demo", "https://soundcloud.com/discover"]) assert.equal(classify(nope), null, nope);
  assert.equal(classify("https://www.youtube.com/@demo_fictif").unresolved, true, "YouTube @nom : le module demande l'identifiant UC…");
  assert.equal(classify("https://social.example.org/@demo", { hint: "mastodon" }).platform, "mastodon", "Mastodon sur une instance inconnue : seulement si la page l'annonce");
  assert.equal(MAX_SOCIALS, 10);
});

test("réseaux : cohérents avec les vrais modules du catalogue quand il est présent (adresse produite sur le bon site)", async (t) => {
  const dir = [process.env.CURIOSA_EXTRAS_DIR, "/home/user/curiosa-extras/modules", "/tmp/agent-33-cat/modules"].find((d) => d && fs.existsSync(path.join(d, "instagram/index.mjs")));
  if (!dir) return t.skip("catalogue curiosa-extras absent");
  const sample = { instagram: "https://instagram.com/demo_fictif", tiktok: "https://www.tiktok.com/@demo_fictif", "x-twitter": "https://x.com/demo_fictif", github: "https://github.com/demo-fictif", kick: "https://kick.com/demo_fictif", spotify: "https://open.spotify.com/artist/4aBcDeFgHiJkLmNo", bandcamp: "https://demo.bandcamp.com/", mastodon: "https://mastodon.social/@demo_fictif", discord: "https://discord.gg/DemoFictif", bluesky: "https://bsky.app/profile/demo.example.org", reddit: "https://www.reddit.com/user/demo_fictif", steam: "https://steamcommunity.com/id/demo_fictif", kofi: "https://ko-fi.com/demo_fictif", patreon: "https://www.patreon.com/demo_fictif", snapchat: "https://www.snapchat.com/add/demo_fictif", pinterest: "https://www.pinterest.com/demo_fictif/", telegram: "https://t.me/demo_fictif", threads: "https://www.threads.net/@demo_fictif", soundcloud: "https://soundcloud.com/demo_fictif", facebook: "https://www.facebook.com/demo.fictif" };
  for (const [module, url] of Object.entries(sample)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, module, "module.json"), "utf8"));
    const c = classify(url);
    assert.equal(c.module, module);
    assert.equal(manifest.settings.some((s) => s.key === c.setting), true, `${module} : réglage « ${c.setting} »`);
    const mod = (await import(path.join(dir, module, "index.mjs"))).default;
    const [btn] = mod.exports["social.link"]({ setting: (k) => (k === c.setting ? c.value : undefined) });
    assert.ok(btn, `${module} : le module accepte la valeur « ${c.value} »`);
    assert.equal(new URL(btn.url).hostname.replace(/^www\./, "").split(".").slice(-2).join("."), new URL(url).hostname.replace(/^www\./, "").split(".").slice(-2).join("."), module);
  }
});

test("dédoublonnage : liens (barre finale, www, paramètres de suivi) et réseaux (même compte écrit autrement) ; plusieurs comptes d'un même réseau gardés", () => {
  const p = normalise({ name: "N", links: [
    { title: "A", url: "https://site.example.org/page?utm_source=x" }, { title: "A bis", url: "https://www.site.example.org/page/" }, { title: "B", url: "https://site.example.org/page?id=2" },
    { title: "T1", url: "https://www.twitch.tv/Demo_Fictif" }, { title: "T1 bis", url: "https://twitch.tv/demo_fictif/" }, { title: "T2", url: "https://www.twitch.tv/autre_chaine" },
  ], socials: [{ url: "https://www.twitch.tv/DEMO_FICTIF", type: "TWITCH" }] }, { input: "x", url: "https://x.example.org/", serviceHosts: [] });
  assert.deepEqual(p.links.map((l) => l.title), ["A", "B"]);
  assert.deepEqual(p.socials.map((s) => s.value), ["demo_fictif", "autre_chaine"], "une instance par compte, sans doublon");
  assert.equal(p.duplicates.length, 3);
  assert.equal(urlKey("https://WWW.Example.org/a/?fbclid=1&b=2"), urlKey("https://example.org/a?b=2"));
});

test("bornes : au plus 200 liens et 10 réseaux dans l'en-tête ; le surplus reste en lien, dit dans le rapport", () => {
  const links = Array.from({ length: 230 }, (_, i) => ({ title: `Lien ${i}`, url: `https://site.example.org/${i}` }));
  const p = normalise({ name: "N", links }, { input: "x", url: "https://x.example.org/", serviceHosts: [] });
  assert.equal(p.links.length, MAX_LINKS); assert.equal(p.notRetained.length, 30); assert.match(p.notRetained[0].reason, /200/);
  const socials = Array.from({ length: 12 }, (_, i) => ({ url: `https://www.instagram.com/compte_${i}/`, type: "instagram" }));
  const q = normalise({ name: "N", links: [], socials }, { input: "x", url: "", serviceHosts: [] });
  assert.equal(q.socials.length, MAX_SOCIALS); assert.equal(q.links.length, 2);
  assert.ok(q.toCheck.some((t) => /plus de 10 réseaux/.test(t)));
  const keep = normalise({ name: "N", links: [{ title: "Ma chaîne", url: "https://www.twitch.tv/demo_fictif" }] }, { input: "x", url: "", serviceHosts: [], keepSocialsInLinks: true });
  assert.equal(keep.links.length, 1); assert.equal(keep.socials.length, 1);
});

/* ───────────── sécurité ───────────── */

test("sécurité : adresses non publiques refusées (localhost, IP privées, link-local, IPv6, IPv4 déguisée, schémas, identifiants, ports)", async () => {
  const refused = ["http://localhost/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://10.0.0.5/", "http://192.168.1.10/", "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://0.0.0.0/", "http://intranet/", "http://serveur.internal/", "http://imprimante.local/", "http://x.localhost/", "file:///etc/passwd", "ftp://example.org/", "javascript:alert(1)", "https://user:pass@example.org/", "https://example.org:8080/", "https://example.org:22/"];
  for (const u of refused) assert.throws(() => assertPublicUrl(u), (e) => e.name === "ImportError", u);
  for (const u of ["https://linktr.ee/demo", "http://example.org/", "https://sous.domaine.example.org/a?b=c"]) assert.doesNotThrow(() => assertPublicUrl(u), u);
  for (const ip of ["127.0.0.1", "10.1.2.3", "::1", "::ffff:10.0.0.1", "fc00::1", "198.18.0.1", "224.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  // et le téléchargement lui-même ne se connecte jamais à ces adresses
  let hits = 0;
  const srv = http.createServer((req, res) => { hits++; res.end("ok"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(() => fetchPage(`http://127.0.0.1:${srv.address().port}/`), (e) => e.code === "bad-port" || e.code === "private-address");
    await assert.rejects(() => fetchPage("http://localhost/"), (e) => e.code === "private-address");
    await assert.rejects(() => readSource("file:///etc/passwd"), (e) => e.code === "bad-scheme");
    await assert.rejects(() => readSource("ftp://example.org/x"), (e) => e.code === "bad-scheme");
    assert.equal(hits, 0, "aucune connexion vers le serveur local");
  } finally { srv.close(); }
});

test("sécurité : seuls http, https et mailto passent comme liens ; texte extrait réduit à du texte brut ; rien n'est exécuté", async () => {
  for (const bad of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "tel:+0000", "sms:+0000", "blob:https://example.org/x", "https://u:p@example.org/", "//", "", "mailto:", "mailto:pas-une-adresse", "https://" + "a".repeat(2100) + ".example.org/"]) assert.equal(cleanLinkUrl(bad, "https://base.example.org/"), null, JSON.stringify(bad.slice(0, 40)));
  assert.equal(cleanLinkUrl("//cdn.example.org/x", "https://base.example.org/"), "https://cdn.example.org/x");
  assert.equal(cleanLinkUrl("/a", "https://base.example.org/z"), "https://base.example.org/a");
  assert.equal(cleanLinkUrl("mailto:contact@example.org?subject=Bonjour"), "mailto:contact@example.org?subject=Bonjour");
  assert.equal(cleanText('<img src=x onerror=alert(1)>Boutique <b>gras</b> &amp; <script>alert(1)</script>cie'), "Boutique gras & cie");
  assert.equal(cleanText("a\u0000b‮c​d\ne"), "a b c d e");
  assert.equal(cleanText("x".repeat(500), 20).length, 20);
  assert.equal(cleanText({ toString() { return "objet"; } }), "");
  const dangerous = html("linktree").replace("Mon site", '<script>alert(1)<\\/script>&lt;b&gt;Mon site&lt;/b&gt;');
  const p = await profileFromSource({ kind: "page", input: "x", url: URLS.linktree, html: dangerous });
  const all = JSON.stringify(p);
  assert.ok(!/<script|javascript:|onerror/i.test(all.replace(/"reason":"[^"]*"/g, "").replace(/"url":"javascript:[^"]*"/g, "")), "ni balise ni schéma dangereux dans la fiche");
  assert.ok(p.notRetained.some((n) => /javascript:/.test(n.url)), "mais le refus est signalé");
  assert.ok(p.links.every((l) => /^(https?:|mailto:)/.test(l.url)));
});

test("sécurité du téléchargement : bornes de taille, de durée et de redirections ; ni cookie ni identifiant envoyés ; compression décodée sous la même limite", async () => {
  process.env.CURIOSA_ALLOW_LOCAL_IMPORT = "1"; // test seulement : serveur local (la vérification d'adresse publique est levée)
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.headers);
    const u = req.url;
    if (u === "/ok") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end("<html><title>ok</title></html>"); }
    if (u === "/gzip") { res.setHeader("content-type", "text/html"); res.setHeader("content-encoding", "gzip"); return res.end(zlib.gzipSync("<html>zippé</html>")); }
    if (u === "/bomb") { res.setHeader("content-type", "text/html"); res.setHeader("content-encoding", "gzip"); return res.end(zlib.gzipSync(Buffer.alloc(LIMITS.maxBytes + 10_000, 97))); }
    if (u === "/big") { res.setHeader("content-type", "text/html"); res.write(Buffer.alloc(LIMITS.maxBytes + 10_000, 97)); return res.end(); }
    if (u === "/loop") { res.statusCode = 302; res.setHeader("location", "/loop"); return res.end(); }
    if (u === "/redirect") { res.statusCode = 301; res.setHeader("location", "/ok"); return res.end(); }
    if (u === "/slow") return; // ne répond jamais
    if (u === "/image") { res.setHeader("content-type", "image/png"); return res.end(Buffer.alloc(20)); }
    if (u === "/missing") { res.statusCode = 404; return res.end("non"); }
    res.end("?");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const saved = LIMITS.timeoutMs;
  try {
    const ok = await fetchPage(`${base}/ok`);
    assert.match(ok.text, /<title>ok/);
    assert.equal((await fetchPage(`${base}/gzip`)).text, "<html>zippé</html>");
    assert.equal((await fetchPage(`${base}/redirect`)).url, `${base}/ok`);
    await assert.rejects(() => fetchPage(`${base}/big`), (e) => e.code === "too-large");
    await assert.rejects(() => fetchPage(`${base}/bomb`), (e) => e.code === "too-large");
    await assert.rejects(() => fetchPage(`${base}/loop`), (e) => e.code === "too-many-redirects");
    await assert.rejects(() => fetchPage(`${base}/image`), (e) => e.code === "bad-type");
    await assert.rejects(() => fetchPage(`${base}/missing`), (e) => e.code === "http-status" && /404/.test(e.message));
    LIMITS.timeoutMs = 300;
    await assert.rejects(() => fetchPage(`${base}/slow`), (e) => e.code === "timeout");
    for (const h of seen) { assert.equal(h.cookie, undefined); assert.equal(h.authorization, undefined); assert.match(h["user-agent"], /CuriosaImport/); }
  } finally { LIMITS.timeoutMs = saved; delete process.env.CURIOSA_ALLOW_LOCAL_IMPORT; srv.close(); srv.closeAllConnections?.(); }
  assert.match(fs.readFileSync("scripts/import-links/fetch.mjs", "utf8"), /for \(let hop[\s\S]*assertPublicUrl\(current/, "chaque redirection est revérifiée");
  assert.match(fs.readFileSync("scripts/import-links/fetch.mjs", "utf8"), /lookup: safeLookup/, "l'adresse résolue est vérifiée au moment de la connexion");
});

test("analyse HTML : bornée et tolérante (entités, balises mal fermées, script ignoré, JSON embarqué)", () => {
  const root = parseHtml('<p>Caf&eacute; &amp; <b>thé</p><script>if (a < b) {}</script><a href=x>un<a href=y>deux</a>');
  assert.match(textOf(root), /^Café & thé/);
  assert.equal(find(root, (n) => n.tag === "a").attrs.href, "x");
  assert.ok(!textOf(root).includes("if (a"), "le script n'est pas du texte");
  assert.equal(jsonBlocks('<script type="application/json">{"a":1}</script><script>var x = 1; window.__INITIAL_STATE__ = {"k":["v"]};</script><script type="application/json">{cassé</script>').length, 2);
  const huge = "<div>".repeat(200_000);
  assert.doesNotThrow(() => parseHtml(huge));
  assert.ok(find(parseHtml("<main><h1>x</h1></main>"), (n) => n.tag === "h1"));
});

/* ───────────── fiche, rapport, sortie stable ───────────── */

test("sortie JSON stable : mêmes entrées, mêmes octets ; clés dans un ordre fixe ; aucun horodatage ni secret", async () => {
  const a = JSON.stringify(await load("linktree")), b = JSON.stringify(await load("linktree"));
  assert.equal(a, b);
  assert.deepEqual(Object.keys(JSON.parse(a)), ["kind", "version", "source", "site", "links", "socials", "sections", "notRetained", "duplicates", "toCheck", "notes"]);
  assert.equal(JSON.parse(a).kind, PROFILE_KIND);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a), "pas d'horodatage");
  const r = JSON.stringify(reportJson(JSON.parse(a), { file: "/x/s.enc", modules: [{ id: "links", instances: 1 }], owner: { email: "a@example.org", name: "A", password: "secret-provisoire" }, avatar: { status: "downloaded" }, toCheck: [], notes: [] }));
  assert.ok(!r.includes("secret-provisoire"), "le mot de passe n'entre jamais dans le rapport");
  assert.deepEqual(Object.keys(JSON.parse(r)), ["ok", "source", "site", "counts", "retained", "notRetained", "duplicates", "toCheck", "notes", "backup"]);
});

test("rapport : ce qui est repris, ce qui ne l'est pas (avec la raison), ce qui est à vérifier, comment la page a été lue", async () => {
  const text = reportText(await load("linktree"), null);
  assert.match(text, /Repris : 8 liens en 3 sections \(Mes chaînes, Boutique et soutien, Projets\), 5 réseaux sociaux/);
  assert.match(text, /2 éléments non repris :/);
  assert.match(text, /« Piège » — javascript:alert\(document\.cookie\) — adresse non autorisée/);
  assert.match(text, /À vérifier :/);
  assert.match(text, /lecture spécialisée « linktree »/);
  const fallback = reportText(await load("linktree-redesigned", URLS.linktree), null);
  assert.match(fallback, /lecture de secours \(générique\) : la structure d'une page Linktree n'a pas été reconnue/);
  assert.match(reportText(await load("generic"), null), /service non reconnu/);
});

test("fiche corrigée à la main : relue et revalidée comme si elle venait d'une page (liens dangereux refusés, doublons retirés)", async () => {
  const p = await load("carrd");
  const edited = JSON.parse(JSON.stringify(p));
  edited.links.push({ title: "Ajout à la main", url: "https://ajout.example.org/", section: "Mes ajouts", icon: null }, { title: "Mauvais", url: "javascript:alert(1)", section: "", icon: null }, { title: "Doublon", url: "https://pia-demo.example.org/romans", section: "", icon: null });
  edited.site.name = "Nom corrigé";
  const again = revalidateProfile(edited);
  assert.equal(again.site.name, "Nom corrigé");
  assert.deepEqual(again.links.map((l) => l.title), ["Mes romans", "Dédicaces", "Ajout à la main"]);
  assert.deepEqual(again.sections, ["Mes ajouts"]);
  assert.ok(again.notRetained.some((n) => n.title === "Mauvais"));
  assert.deepEqual(again.socials.map((s) => s.value), p.socials.map((s) => s.value));
  assert.throws(() => revalidateProfile({ kind: "autre" }), /pas une fiche/);
  const file = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "il-")), "fiche.json");
  fs.writeFileSync(file, JSON.stringify(p));
  assert.equal((await readSource(file)).kind, "profile");
});

test("sources : fichier HTML ou JSON enregistré lu tel quel (adresse d'origine indiquée à part) ; fichier absent ou trop gros refusé", async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "il-"));
  const f = path.join(dir, "page.html"); fs.writeFileSync(f, html("carrd"));
  const src = await readSource(f, { url: "https://pia-demo.carrd.co/" });
  assert.equal(src.kind, "page"); assert.equal(src.url, "https://pia-demo.carrd.co/"); assert.match(src.html, /Pia Démo/);
  const j = path.join(dir, "next.json"); fs.writeFileSync(j, JSON.stringify({ props: { pageProps: { account: { pageTitle: "Via JSON" }, links: [{ title: "L", url: "https://a.example.org/" }] } } }));
  const p = await profileFromSource(await readSource(j, { url: "https://linktr.ee/x" }));
  assert.equal(p.site.name, "Via JSON"); assert.equal(p.source.adapter, "linktree");
  await assert.rejects(() => readSource(path.join(dir, "absent.html")), (e) => e.code === "not-found");
  await assert.rejects(() => readSource(""), (e) => e.code === "no-input");
  fs.writeFileSync(path.join(dir, "cassé.json"), "{pas du json");
  await assert.rejects(() => readSource(path.join(dir, "cassé.json")), (e) => e.code === "bad-json");
  assert.equal(taglineOf("Première phrase. Deuxième."), "Première phrase.");
  assert.ok(taglineOf("x".repeat(300)).length <= 140);
});

test("script : --list-adapters et usage sans argument ; l'extraction seule n'a besoin ni du cœur ni du réseau", () => {
  const list = JSON.parse(execFileSync(process.execPath, ["scripts/import-links.mjs", "--list-adapters", "--json"], { encoding: "utf8" }));
  assert.equal(list.length, 12); assert.ok(list.some((a) => a.id === "generic"));
  const out = JSON.parse(execFileSync(process.execPath, ["scripts/import-links.mjs", path.join(FIX, "carrd.html"), "--url", URLS.carrd, "--extract-only", "--json"], { encoding: "utf8" }));
  assert.equal(out.ok, true); assert.equal(out.profile.site.name, "Pia Démo"); assert.equal(out.counts.links, 2);
  const text = execFileSync(process.execPath, ["scripts/import-links.mjs", path.join(FIX, "carrd.html"), "--url", URLS.carrd, "--extract-only"], { encoding: "utf8" });
  assert.match(text, /Repris : 2 liens/);
  let failed;
  try { execFileSync(process.execPath, ["scripts/import-links.mjs", "http://localhost/x", "--extract-only", "--json"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { failed = e; }
  assert.ok(failed, "adresse locale refusée"); assert.equal(JSON.parse(failed.stdout).error.code, "private-address");
});

/* ───────────── neutralité, documentation, skill ───────────── */

test("neutralité : fixtures, script et documentation ne contiennent aucun nom propre de personne ni de site réel (règles locales)", (t) => {
  const text = loadNeutralityText();
  const files = ["scripts/import-links.mjs", ...fs.readdirSync("scripts/import-links", { recursive: true }).map((f) => `scripts/import-links/${f}`).filter((f) => f.endsWith(".mjs")), ...fs.readdirSync(FIX).map((f) => `${FIX}/${f}`), "docs/IMPORT-LIENS.md", ".claude/skills/migrate-from-link-aggregator/SKILL.md", "tests/core/import-links.test.mjs"].filter((f) => fs.existsSync(f));
  assert.ok(files.length > 25);
  if (text.trim()) assert.deepEqual(findViolations(files.map((f) => [f, fs.readFileSync(f, "utf8")]), parseNeutralityRules(text)), []);
  else t.diagnostic("neutralité NON vérifiée : ni NEUTRALITY_TERMS ni .neutrality-terms");
  for (const f of fs.readdirSync(FIX)) assert.ok(!/@(gmail|hotmail|outlook|yahoo)\./i.test(fs.readFileSync(`${FIX}/${f}`, "utf8")), `${f} : adresse e-mail réelle`);
});

test("documentation : le guide, le skill et le script se renvoient l'un à l'autre ; README et INSTALL y mènent ; Grav est cité comme sœur", () => {
  const guide = fs.readFileSync("docs/IMPORT-LIENS.md", "utf8");
  const skill = fs.readFileSync(".claude/skills/migrate-from-link-aggregator/SKILL.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  assert.match(skill, /^---\nname: migrate-from-link-aggregator\ndescription: .{40,}\n---/);
  for (const a of ADAPTERS) { assert.ok(guide.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]), `le guide cite ${a.name}`); assert.ok(skill.toLowerCase().includes(a.id) || skill.toLowerCase().includes(a.name.toLowerCase().split(" ")[0]), `le skill cite ${a.name}`); }
  assert.match(skill, /install-curiosa/); assert.match(skill, /scripts\/import-links\.mjs/); assert.match(skill, /docs\/IMPORT-LIENS\.md/);
  assert.match(guide, /IMPORT-GRAV\.md/); assert.match(guide, /BACKUP\.md/);
  assert.match(readme, /docs\/IMPORT-LIENS\.md/);
  assert.match(fs.readFileSync("docs/INSTALL.md", "utf8"), /IMPORT-LIENS\.md/);
  assert.match(fs.readFileSync("docs/IMPORT-GRAV.md", "utf8"), /IMPORT-LIENS\.md/);
  for (const [name, doc] of [["guide", guide], ["skill", skill]]) for (const m of doc.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(?:#[^)]*)?\)/g)) assert.ok(fs.existsSync(path.resolve(name === "guide" ? "docs" : ".claude/skills/migrate-from-link-aggregator", m[1])), `${name} : lien cassé vers ${m[1]}`);
  for (const f of fs.readdirSync(".claude/skills/migrate-from-link-aggregator")) for (const m of fs.readFileSync(`.claude/skills/migrate-from-link-aggregator/${f}`, "utf8").matchAll(/`((?:scripts|docs)\/[\w./-]+\.(?:mjs|md))`/g)) assert.ok(fs.existsSync(m[1]), `${f} cite un fichier absent : ${m[1]}`);
  assert.match(fs.readFileSync("CHANGELOG.md", "utf8"), /Linktree/);
});
