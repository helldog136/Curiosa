// Redirections 2 : briques pures (fuseau et heure d'été, date de fin, QR code, page « lien terminé », robots, nom proposé).
import test from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import QRCode from "qrcode";

const T = await import("@/core/siteTime");
const E = await import("@/core/redirectEnd");
const Q = await import("@/core/redirectQr");
const G = await import("@/core/redirectGone");
const S = await import("@/core/redirectStats");
const R = await import("@/core/redirects");

const BX = "Europe/Brussels";

test("fuseau : noms valides seulement", () => {
  assert.ok(T.isTimezone("Europe/Brussels") && T.isTimezone("UTC") && T.isTimezone("America/Montreal"));
  for (const bad of ["", "Mars/Olympus", "../etc", "Europe/Brussels; drop", 5, null, "x".repeat(80)]) assert.equal(T.isTimezone(bad), false, String(bad));
  assert.ok(T.isTimezone(T.systemTimezone()));
});

test("heure d'été : l'heure qui n'existe pas avance, celle qui existe deux fois prend la première", () => {
  const at = (d, t) => T.zonedToUtc(d, t, BX).toISOString();
  assert.equal(at("2026-01-15", "12:00"), "2026-01-15T11:00:00.000Z", "hiver : UTC+1");
  assert.equal(at("2026-07-15", "12:00"), "2026-07-15T10:00:00.000Z", "été : UTC+2");
  assert.equal(at("2026-03-29", "02:30"), "2026-03-29T01:30:00.000Z", "saut de printemps : 02:30 n'existe pas → 03:30 locale");
  assert.equal(T.timeKey(T.zonedToUtc("2026-03-29", "02:30", BX), BX), "03:30");
  assert.equal(at("2026-10-25", "02:30"), "2026-10-25T00:30:00.000Z", "retour d'automne : la première des deux 02:30");
  assert.equal(T.zonedToUtc("2026-02-31", "10:00", BX), null);
  assert.equal(T.zonedToUtc("2026-13-01", "10:00", BX), null);
  assert.equal(T.zonedToUtc("pas une date", "10:00", BX), null);
});

test("jour du site : minuit local, pas minuit UTC", () => {
  const instant = new Date("2026-07-15T22:30:00Z"); // 00:30 le 16 à Bruxelles (été)
  assert.equal(T.dayKey(instant, BX), "2026-07-16");
  assert.equal(T.dayKey(instant, "UTC"), "2026-07-15");
  assert.equal(T.nextDay("2026-12-31"), "2027-01-01");
  assert.deepEqual(T.lastDays("2026-03-01", 3), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.equal(T.lastDays("2026-10-22", 120).length, 120);
});

test("date de fin : « jusqu'à la fin du jour » à l'heure du site, aller-retour exact", () => {
  const end = E.endInstant("2026-03-28", "", BX); // fin du 28 mars = début du 29 (veille du changement d'heure)
  assert.equal(end.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.deepEqual(E.endFields(end, BX), { date: "2026-03-28", time: "" });
  const day29 = E.endInstant("2026-03-29", "", BX); // le jour du changement d'heure ne dure que 23 h
  assert.equal(day29.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.deepEqual(E.endFields(day29, BX), { date: "2026-03-29", time: "" });
  const exact = E.endInstant("2026-07-01", "18:30", BX);
  assert.equal(exact.toISOString(), "2026-07-01T16:30:00.000Z");
  assert.deepEqual(E.endFields(exact, BX), { date: "2026-07-01", time: "18:30" });
  assert.equal(E.endInstant("", "", BX), null);
  for (const bad of [["31/03/2026", ""], ["2026-03-31", "6h"], ["1999-01-01", ""], ["2026-02-30", ""]]) assert.equal(E.endInstant(bad[0], bad[1], BX), undefined, bad.join(" "));
  assert.deepEqual(E.endFields(null, BX), { date: "", time: "" });
  assert.match(E.formatEnd(end, BX, "fr"), /28 mars 2026/);
  assert.match(E.formatEnd(exact, BX, "en"), /July 1, 2026.*6:30/);
});

/* ───────────── QR ───────────── */

const ADDRESS = "https://monsite.be/twitch";

function svgGrid(svg) {
  const full = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)[1]);
  const grid = Array.from({ length: full }, () => Array(full).fill(false));
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(m[3]); i++) grid[Number(m[2])][Number(m[1]) + i] = true;
  return { full, grid };
}

test("QR : l'adresse COMPLÈTE est encodée, SVG noir sur blanc plein, zone de silence de 4 modules, texte alternatif", () => {
  const svg = Q.qrSvg(ADDRESS, { label: "QR code qui mène à monsite.be/twitch" });
  const lib = QRCode.create(ADDRESS, { errorCorrectionLevel: "M" }).modules;
  const { full, grid } = svgGrid(svg);
  assert.equal(full, lib.size + 8);
  for (let r = 0; r < full; r++) for (let c = 0; c < full; c++) {
    const inside = r >= 4 && c >= 4 && r < full - 4 && c < full - 4;
    assert.equal(grid[r][c], inside ? lib.get(r - 4, c - 4) === 1 : false, `module ${r},${c}`);
  }
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#ffffff"\/>/);
  assert.match(svg, /<path fill="#000000"/);
  assert.match(svg, /role="img" aria-label="QR code qui mène à monsite.be\/twitch"/);
  assert.match(svg, /<title>QR code qui mène/);
  assert.ok(!/<script|onload|href=/i.test(svg));
  assert.match(Q.qrSvg(ADDRESS, { label: '"><script>x</script>' }), /aria-label="&quot;&gt;&lt;script&gt;/, "texte alternatif échappé");
});

test("QR : niveau M par défaut, Q en option ; le QR ne dépend QUE de l'adresse courte", () => {
  assert.equal(Q.DEFAULT_LEVEL, "M");
  assert.equal(Q.parseLevel(undefined), "M"); assert.equal(Q.parseLevel("q"), "Q"); assert.equal(Q.parseLevel("H"), "M"); assert.equal(Q.parseLevel("<x>"), "M");
  assert.equal(Q.qrSvg(ADDRESS), Q.qrSvg(ADDRESS, { level: "M" }));
  assert.notEqual(Q.qrSvg(ADDRESS, { level: "Q" }), Q.qrSvg(ADDRESS, { level: "M" }));
  // « Je change la cible sans réimprimer » : le texte encodé est l'adresse du lien court, la destination n'y entre jamais.
  assert.equal(R.redirectShortUrl("twitch").endsWith("/twitch"), true);
  assert.equal(Q.qrSvg(R.redirectShortUrl("twitch")), Q.qrSvg(R.redirectShortUrl("twitch")));
  assert.throws(() => Q.qrSvg(""), /out of bounds/);
  assert.throws(() => Q.qrSvg("x".repeat(Q.MAX_QR_TEXT + 1)), /out of bounds/);
});

test("QR : PNG grand, modules entiers, noir sur blanc plein, zone de silence blanche", async () => {
  const buf = await Q.qrPng(ADDRESS);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const png = PNG.sync.read(buf);
  const n = QRCode.create(ADDRESS, { errorCorrectionLevel: "M" }).modules.size + 8;
  assert.ok(png.width >= 1500 && png.width === png.height && png.width % n === 0, `largeur ${png.width}`);
  assert.equal(png.width, await Q.pngWidth(ADDRESS));
  const scale = png.width / n;
  const px = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]; };
  for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1], [scale * 3, scale * 3], [png.width - 1 - scale * 3, png.height / 2 | 0]]) assert.deepEqual(px(x, y), [255, 255, 255, 255], "zone de silence blanche et opaque");
  assert.deepEqual(px(scale * 4 + 2, scale * 4 + 2), [0, 0, 0, 255], "le coin du repère est noir");
  const lib = QRCode.create(ADDRESS, { errorCorrectionLevel: "M" }).modules;
  for (let r = 0; r < lib.size; r += 3) for (let c = 0; c < lib.size; c += 3) assert.deepEqual(px((c + 4) * scale + 1, (r + 4) * scale + 1).slice(0, 3), lib.get(r, c) ? [0, 0, 0] : [255, 255, 255]);
  const q = await Q.qrPng(ADDRESS, { level: "Q" });
  assert.notDeepEqual(q, buf);
});

/* ───────────── Page « lien terminé » ───────────── */

test("page « lien terminé » : autonome, aux couleurs du site, message de la personne en texte simple, lien vers l'accueil", () => {
  const html = G.renderGonePage({ lang: "fr", siteName: "Chez <Emma>", title: "Ce lien est terminé", message: "Merci !\n<script>alert(1)</script>", defaultMessage: "défaut", homeLabel: "Retour à l'accueil", homeHref: "/en", themeCss: ":root{--v-bg:#fff}", logoUrl: "javascript:alert(1)" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="fr" dir="ltr">/);
  assert.match(html, /--v-bg:#fff/);
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Chez &lt;Emma&gt;") && !html.includes("<Emma>"));
  assert.match(html, /<a class="home" href="\/en">Retour à l&#39;accueil<\/a>/);
  assert.ok(!html.includes("<img"), "logo non sûr refusé");
  assert.match(html, /robots" content="noindex/);
  assert.match(G.renderGonePage({ lang: "ar", rtl: true, siteName: "s", title: "t", message: "  ", defaultMessage: "Message habituel", homeLabel: "h", homeHref: "/", themeCss: "", logoUrl: "/uploads/a.png" }), /dir="rtl"[\s\S]*<img class="logo" src="\/uploads\/a.png"[\s\S]*Message habituel/);
  assert.ok(!/<script|cookie|fetch\(/i.test(html.replace(/&lt;script&gt;.*?&lt;\/script&gt;/, "")), "aucun script");
});

/* ───────────── Robots ───────────── */

test("robots, aperçus de messagerie, scripts et préchargements ne sont pas comptés ; un vrai navigateur l'est", () => {
  const human = ["Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 330.0 FBAN/FBIOS"];
  for (const ua of human) assert.equal(S.isHumanVisit({ userAgent: ua }), true, ua);
  const bots = ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "WhatsApp/2.23.20.0 A", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "TelegramBot (like TwitterBot)", "Twitterbot/1.0", "LinkedInBot/1.0 (compatible; Mozilla/5.0)", "Mozilla/5.0 (compatible; bingbot/2.0)", "curl/8.5.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/126.0", "Mozilla/5.0 (compatible; UptimeRobot/2.0)", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0)", "Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)", "Mozilla/5.0 (compatible; Mastodon/4.2)", "Go-http-client/2.0", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", ""];
  for (const ua of bots) assert.equal(S.isHumanVisit({ userAgent: ua }), false, JSON.stringify(ua));
  assert.equal(S.isHumanVisit({ userAgent: human[0], prefetch: true }), false);
  assert.equal(S.isHumanVisit({ userAgent: human[0], team: true }), false, "l'équipe connectée n'est pas un visiteur");
  assert.equal(S.isHumanVisit({ userAgent: undefined }), false);
  assert.equal(S.isHumanVisit(undefined), true, "appel interne sans renseignement");
  const h = (o) => (n) => o[n] ?? null;
  assert.equal(S.isPrefetchRequest(h({ purpose: "prefetch" })), true);
  assert.equal(S.isPrefetchRequest(h({ "sec-purpose": "prefetch;prerender" })), true);
  assert.equal(S.isPrefetchRequest(h({ "x-moz": "prefetch" })), true);
  assert.equal(S.isPrefetchRequest(h({})), false);
});

/* ───────────── Nom proposé, adresse collée ───────────── */

test("adresse collée : guillemets, ponctuation de fin, espaces, https:// manquant", () => {
  assert.equal(R.cleanPastedAddress('  "www.twitch.tv/emma".  '), "https://www.twitch.tv/emma");
  assert.equal(R.cleanPastedAddress("«https://monsite.be/boutique»,"), "https://monsite.be/boutique");
  assert.equal(R.cleanPastedAddress("<https://a.example/x>"), "https://a.example/x");
  assert.equal(R.cleanPastedAddress("https://a.example/x?y=1 voilà mon lien"), "https://a.example/x?y=1");
  assert.equal(R.cleanPastedAddress("monsite.be/contact"), "https://monsite.be/contact");
  assert.equal(R.cleanPastedAddress(""), ""); assert.equal(R.cleanPastedAddress(null), "");
});

test("nom proposé d'après la fin de l'adresse : minuscules, chiffres, tirets, lisible", () => {
  const n = R.nameFromAddress;
  assert.equal(n("https://shop.monsite.be/mugs/Mug-Chat.html"), "mug-chat");
  assert.equal(n("https://www.twitch.tv/Emma_Stream"), "emma-stream");
  assert.equal(n("https://www.youtube.com/@emma"), "emma");
  assert.equal(n("https://www.youtube.com/watch?v=abc123"), "youtube", "segment générique → nom du site");
  assert.equal(n("https://boutique.monsite.be/"), "monsite");
  assert.equal(n("https://www.exemple.co.uk/"), "exemple");
  assert.equal(n("https://monsite.be/p/12345"), "monsite", "un numéro seul n'est pas un nom");
  assert.equal(n("https://monsite.be/a3f9c2d41b7e8a90c1d2e3f4"), "monsite", "un code illisible non plus");
  assert.equal(n("https://monsite.be/" + "très-long-".repeat(10)).length <= 32, true);
  assert.equal(n("https://monsite.be/Café-Crème-à-l'été"), "cafe-creme-a-l-ete");
  assert.equal(n("pas une adresse"), "");
});
