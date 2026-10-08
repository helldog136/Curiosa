import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-video-"));
process.env.DATA_DIR = dir;
const U = await import("@/core/services/uploads");
const { GET } = await import("../../src/app/uploads/[name]/route.ts");

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 9)]);

test("vidéo : formats reconnus à leur signature (MP4/WebM), le reste refusé, SVG et scripts compris", () => {
  assert.equal(U.sniffVideo(MP4), "mp4");
  assert.equal(U.sniffVideo(WEBM), "webm");
  for (const bad of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>   "), Buffer.from("<?php echo 1; ?>" + " ".repeat(20)), Buffer.alloc(4), Buffer.alloc(64)]) assert.equal(U.sniffVideo(bad), null);
});

test("vidéo : enregistrée sous un nom aléatoire, limites séparées (50 Mo vidéo, 5 Mo image)", async () => {
  const url = await U.saveUpload(MP4);
  assert.match(url, /^\/uploads\/[0-9a-f-]{36}\.mp4$/);
  assert.ok(U.UPLOAD_NAME_RE.test(url.slice(9)));
  assert.equal(U.mimeFor("x.webm"), "video/webm");
  assert.equal(U.MAX_VIDEO_BYTES, 50 * 1024 * 1024);
  assert.equal(await U.saveUpload(Buffer.concat([MP4, Buffer.alloc(U.MAX_VIDEO_BYTES)])), null, "trop lourde");
});

test("vidéo : servie par morceaux (Range → 206), entière sinon, plage invalide → 416, nom invalide → 404", async () => {
  const url = await U.saveUpload(MP4);
  const name = url.slice(9);
  const call = (headers = {}) => GET(new Request("http://x/uploads/" + name, { headers }), { params: Promise.resolve({ name }) });
  const full = await call();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal((await full.arrayBuffer()).byteLength, MP4.length);
  const part = await call({ range: "bytes=4-11" });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), `bytes 4-11/${MP4.length}`);
  assert.equal(Buffer.from(await part.arrayBuffer()).toString("ascii"), "ftypisom");
  assert.equal((await call({ range: "bytes=-8" })).status, 206, "les 8 derniers octets");
  assert.equal((await call({ range: `bytes=${MP4.length + 5}-` })).status, 416);
  assert.equal((await GET(new Request("http://x/"), { params: Promise.resolve({ name: "../x.mp4" }) })).status, 404);
});

test("vidéo : branchements — réglage « video » validé côté serveur, section d'accueil, lecture seulement à l'écran, son au choix", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/app/admin/(panel)/instances/actions.ts"), /field\.type === "video"[\s\S]*mp4\|webm/);
  const comp = read("src/components/site/HeroVideo.tsx");
  assert.match(comp, /IntersectionObserver/);
  assert.match(comp, /visibilitychange/);
  assert.match(comp, /muted=\{muted\}/, "démarre sans son");
  assert.match(comp, /prefers-reduced-motion/);
});
