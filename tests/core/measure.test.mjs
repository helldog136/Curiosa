import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { measure, referencedResources, toMarkdown } = await import("../../scripts/measure.mjs");

test("mesure : les fichiers référencés par une page sont trouvés (scripts, styles, images, polices), sans doublon ni adresse inutilisable", () => {
  const html = `<html><head><link rel="stylesheet" href="/a.css"><link rel="preload" as="font" href="/f.woff2"><link rel="icon" href="/i.png"><script src="/a.js"></script><script src="/a.js"></script></head>
    <body><img src="/p.png" srcset="/p1.png 1x, /p2.png 2x"><video src="/v.mp4"></video><img src="data:image/png;base64,AA"><a href="mailto:x@y.z">m</a><script src="https://cdn.example/x.js"></script></body></html>`;
  const r = referencedResources(html, "http://site.test/");
  const by = (k) => r.filter((x) => x.kind === k).map((x) => new URL(x.url).pathname + (new URL(x.url).host !== "site.test" ? "@" + new URL(x.url).host : ""));
  assert.deepEqual(by("style"), ["/a.css"]);
  assert.deepEqual(by("font"), ["/f.woff2"]);
  assert.deepEqual(by("script"), ["/a.js", "/x.js@cdn.example"], "doublon retiré, script externe gardé");
  assert.deepEqual(by("image"), ["/i.png", "/p.png", "/p1.png", "/p2.png"], "data: ignoré");
  assert.deepEqual(by("media"), ["/v.mp4"]);
});

test("mesure : requêtes, poids, services tiers et cookies d'une vraie page", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/") { res.setHeader("set-cookie", ["session=abc; Path=/"]); res.setHeader("content-type", "text/html"); res.end('<link rel="stylesheet" href="/s.css"><script src="/a.js"></script><script src="https://tiers.example/t.js"></script><img src="/i.png">'); }
    else if (req.url === "/s.css") { res.setHeader("content-type", "text/css"); res.end("body{color:red}".repeat(100)); }
    else if (req.url === "/a.js") { res.setHeader("set-cookie", ["pref=1"]); res.setHeader("content-type", "text/javascript"); res.end("console.log(1);".repeat(200)); }
    else if (req.url === "/i.png") { res.setHeader("content-type", "image/png"); res.end(Buffer.alloc(500)); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const m = await measure(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(m.status, 200);
    assert.equal(m.requests, 4, "page + css + js + image (le script tiers n'est pas téléchargé)");
    assert.deepEqual(m.externalHosts, ["tiers.example"]);
    assert.deepEqual(m.cookies.sort(), ["pref", "session"], "les cookies des fichiers comptent aussi");
    assert.equal(m.byKind.CSS.bytes, 1500);
    assert.equal(m.byKind.JavaScript.bytes, 3000);
    assert.ok(m.byKind.JavaScript.gzip < m.byKind.JavaScript.bytes, "estimation gzip plus petite pour du texte répétitif");
    assert.equal(m.byKind.Images.bytes, 500);
    assert.equal(m.codeBytes, m.byKind.HTML.bytes + 1500 + 3000);
    const md = toMarkdown(m);
    assert.match(md, /Services tiers appelés par la page\*\* : tiers\.example/);
    assert.match(md, /Cookies déposés à la première visite\*\* : (session, pref|pref, session)/);
  } finally { server.close(); }
});

test("preuves : les chiffres du README viennent de docs/MESURES.md, et le document dit ce qui n'est pas mesuré ; aucun « open source » à tort", async () => {
  const fs = await import("node:fs");
  const readme = fs.readFileSync("README.md", "utf8");
  const mesures = fs.readFileSync("docs/MESURES.md", "utf8");
  for (const chiffre of ["868 Mo", "223 Mo", "850 tests", "636 Ko", "≈ 23 s"]) {
    assert.ok(mesures.includes(chiffre.replace(" tests", " tests automatiques")) || mesures.includes(chiffre), `${chiffre} absent de docs/MESURES.md`);
  }
  assert.match(mesures, /## Ce qui n'est PAS mesuré/);
  assert.match(mesures, /node scripts\/measure\.mjs/);
  assert.match(readme, /docs\/MESURES\.md/);
  assert.match(readme, /Choisissez plutôt autre chose si/);
  assert.ok(!/open[- ]?source/i.test(readme.replace(/pas\*\* de l'« open source »[^.]*\./, "")), "« open source » n'est employé que pour dire que ce n'est pas le cas");
  assert.match(readme, /code source disponible/);
  for (const f of ["README.md", "docs/INSTALL.md", "docs/MODULES.md", "docs/CREATE-A-MODULE.md", "package.json"]) {
    const t = fs.readFileSync(f, "utf8").replace(/pas\*\* de l'« open source »[^.]*\./, "");
    assert.ok(!/open[- ]?source/i.test(t), `${f} : « open source » employé à tort`);
  }
});
