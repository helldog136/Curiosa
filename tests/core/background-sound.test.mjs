import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as F from "../helpers/audio-fixtures.mjs";

const db = await (await import("../helpers/db.mjs")).useTestDb();
const { SoundPlayer, SOUND_STORAGE_KEY, MAX_REFUSALS } = await import("@/core/soundPlayer");
const C = await import("@/core/soundConfig");
const { SoundToggleView } = await import("../../src/components/site/BackgroundSound.tsx");
const { setSetting, getSetting } = await import("@/core/settings");
const { getSoundConfig, activeSound } = await import("@/core/backgroundSound");
const U = await import("@/core/services/uploads");

// ── A fake world: audio element, storage, timers ──────────────────────────────────────────────────────────────────────────────────────────────
function world({ saved = null, hidden = false, reduced = false, refuse = 0, refuseName = "NotAllowedError", storage = "ok" } = {}) {
  const w = { created: 0, audio: null, store: new Map(saved ? [[SOUND_STORAGE_KEY, saved]] : []), timers: [], hidden, reduced, refuse, plays: 0, writes: [] };
  w.env = {
    createAudio() {
      w.created++;
      const listeners = new Map();
      const a = {
        src: "", loop: false, volume: 1, preload: "auto", currentTime: 0, paused: true, pauses: 0,
        async play() { w.plays++; if (w.refuse > 0) { w.refuse--; const e = new Error("blocked"); e.name = refuseName; throw e; } a.paused = false; },
        pause() { a.paused = true; a.pauses++; },
        addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); },
        fire(t) { listeners.get(t)?.(); },
      };
      w.audio = a; return a;
    },
    readChoice() { if (storage === "throws") return null; const v = w.store.get(SOUND_STORAGE_KEY); return v === "on" || v === "off" ? v : null; },
    writeChoice(c) { if (storage === "throws") return; w.writes.push(c); w.store.set(SOUND_STORAGE_KEY, c); },
    isHidden: () => w.hidden,
    reducedMotion: () => w.reduced,
    setTimer(fn, ms) { const t = { fn, ms, live: true }; w.timers.push(t); return t; },
    clearTimer(t) { if (t) t.live = false; },
  };
  w.run = () => { let guard = 0; while (guard++ < 200) { const t = w.timers.find((x) => x.live); if (!t) return; t.live = false; t.fn(); } };
  return w;
}
const cfg = { src: "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.ogg", volume: 40, startMuted: false };
const mk = (opts, over = {}) => { const w = world(opts); const p = new SoundPlayer({ ...cfg, ...over }, w.env); return { w, p }; };
const settle = () => new Promise((r) => setImmediate(r));

// ── Start rules ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("sound player: nothing exists or is fetched before the first gesture", () => {
  const { w, p } = mk();
  assert.equal(w.created, 0, "no audio element yet");
  assert.deepEqual(p.getView(), { playing: false, wanted: true, failed: false });
  p.setActive(true); p.setHidden(true); p.setHidden(false); p.setActive(false); p.setActive(true);
  assert.equal(w.created, 0, "route and visibility events alone never start anything");
  assert.equal(w.plays, 0);
});

test("sound player: the first gesture starts a looping, fading-in sound at the chosen volume", async () => {
  const { w, p } = mk();
  p.gesture(); await settle();
  assert.equal(w.created, 1);
  assert.equal(w.audio.src, cfg.src); assert.equal(w.audio.loop, true); assert.equal(w.audio.preload, "none");
  assert.equal(w.audio.volume, 0, "starts silent and fades in");
  assert.equal(p.getView().playing, true);
  w.run();
  assert.ok(Math.abs(w.audio.volume - 0.4) < 1e-9, "ends at the chosen volume");
  p.gesture(); p.gesture(); await settle();
  assert.equal(w.plays, 1, "further gestures do nothing once playing");
});

test("sound player: reduced motion skips the fade", async () => {
  const { w, p } = mk({ reduced: true });
  p.gesture(); await settle();
  assert.equal(w.audio.volume, 0.4, "immediately at volume");
  assert.equal(w.timers.length, 0, "no timer used");
  p.toggle();
  assert.equal(w.audio.paused, true, "mute pauses at once");
});

test("sound player: 'start with the sound off' waits for the control; a saved choice wins over the setting", async () => {
  const a = mk({}, { startMuted: true });
  a.p.gesture(); await settle();
  assert.equal(a.w.created, 0, "a gesture elsewhere does not start it");
  a.p.toggle(); await settle();
  assert.equal(a.w.audio.paused, false);
  assert.deepEqual(a.w.writes, ["on"]);
  const b = mk({ saved: "on" }, { startMuted: true });
  assert.equal(b.p.getView().wanted, true);
  const c = mk({ saved: "off" });
  assert.equal(c.p.getView().wanted, false);
  c.p.gesture(); await settle();
  assert.equal(c.w.created, 0, "a visitor who muted is never started by a gesture");
});

test("sound player: mute and unmute are remembered, fade out then pause, written only on a press", async () => {
  const { w, p } = mk();
  p.gesture(); await settle(); w.run();
  assert.deepEqual(w.writes, [], "the automatic start saves nothing");
  p.toggle();
  assert.equal(p.getView().playing, false);
  assert.equal(w.audio.paused, false, "still fading");
  w.run();
  assert.equal(w.audio.paused, true);
  assert.equal(w.audio.volume, 0);
  assert.deepEqual(w.writes, ["off"]);
  p.toggle(); await settle();
  assert.equal(p.getView().playing, true);
  assert.equal(w.created, 1, "the same element is reused");
  assert.deepEqual(w.writes, ["off", "on"]);
});

test("sound player: the choice survives a new visit (storage), and broken storage never breaks the player", async () => {
  const first = mk();
  first.p.gesture(); await settle(); first.p.toggle(); first.w.run();
  const again = new SoundPlayer(cfg, { ...world({ saved: first.w.store.get(SOUND_STORAGE_KEY) }).env });
  assert.equal(again.getView().wanted, false);
  const broken = mk({ storage: "throws" });
  broken.p.gesture(); await settle(); broken.p.toggle(); broken.w.run();
  assert.equal(broken.p.getView().playing, false, "works without storage");
});

// ── Autoplay policy ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("sound player: a refused play() is not retried in a loop, and the control stays usable", async () => {
  const { w, p } = mk({ refuse: 100 });
  for (let i = 0; i < 10; i++) { p.gesture(); await settle(); }
  assert.equal(w.plays, MAX_REFUSALS, "gives up after a few refused gestures");
  assert.equal(p.getView().playing, false);
  assert.equal(p.getView().failed, false, "not an error: the control stays");
  p.setHidden(true); p.setHidden(false); p.setActive(false); p.setActive(true); await settle();
  assert.equal(w.plays, MAX_REFUSALS, "no attempt without a gesture after a refusal");
  w.refuse = 0;
  p.toggle(); await settle();
  assert.equal(p.getView().playing, true, "the visitor's own press always gets a new try");
});

test("sound player: a refusal without a gesture (tab shown again) waits for the next gesture", async () => {
  const { w, p } = mk();
  p.gesture(); await settle(); w.run();
  p.setHidden(true);
  assert.equal(w.audio.paused, true); assert.equal(p.getView().playing, false);
  w.refuse = 1;
  p.setHidden(false); await settle();
  assert.equal(p.getView().playing, false, "refused: waiting");
  p.gesture(); await settle();
  assert.equal(p.getView().playing, true);
});

// ── Tab visibility and navigation ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("sound player: pauses when the tab is hidden and continues when it is shown", async () => {
  const { w, p } = mk();
  p.gesture(); await settle(); w.run();
  p.setHidden(true);
  assert.equal(w.audio.paused, true);
  p.setHidden(false); await settle();
  assert.equal(w.audio.paused, false);
  assert.equal(p.getView().playing, true);
  assert.equal(w.created, 1);
  w.run();
  assert.ok(Math.abs(w.audio.volume - 0.4) < 1e-9);
});

test("sound player: a muted visitor stays muted when the tab comes back; a hidden tab is never started", async () => {
  const { w, p } = mk({ hidden: true });
  p.gesture(); await settle();
  assert.equal(w.created, 0, "hidden: nothing starts");
  p.setHidden(false); await settle();
  assert.equal(w.created, 0, "shown again: still nothing without a gesture");
  p.gesture(); await settle();
  assert.equal(w.created, 1, "the next gesture starts it");
  const m = mk({ saved: "off" });
  m.p.setHidden(true); m.p.setHidden(false); await settle();
  assert.equal(m.w.created, 0);
});

test("sound player: continues across client-side navigations (same element, same player) and pauses off the eligible pages", async () => {
  const { w, p } = mk();
  p.gesture(); await settle(); w.run();
  const el = w.audio;
  el.currentTime = 12.5;
  for (const route of ["/blog", "/blog/a-post", "/"]) { p.setActive(true); await settle(); assert.equal(w.audio, el); assert.equal(el.paused, false, route); assert.equal(el.currentTime, 12.5); }
  p.setActive(false);
  assert.equal(el.paused, true, "off the eligible pages");
  p.setActive(true); await settle();
  assert.equal(el.paused, false);
  assert.equal(w.created, 1, "never a second element");
});

test("sound player: a file that cannot be played hides the control instead of looping on errors", async () => {
  const { w, p } = mk();
  p.gesture(); await settle();
  w.audio.fire("error");
  assert.equal(p.getView().failed, true);
  p.gesture(); p.toggle(); await settle();
  assert.equal(w.plays, 1);
  const x = mk({ refuse: 1, refuseName: "NotSupportedError" });
  x.p.gesture(); await settle();
  assert.equal(x.p.getView().failed, true);
});

test("sound player: muting while the browser is still starting leaves silence; destroy releases the element", async () => {
  const { w, p } = mk();
  p.gesture(); await settle();
  p.toggle(); // the visitor presses while the sound is still fading in
  w.run();
  assert.equal(p.getView().playing, false);
  assert.equal(w.audio.paused, true);
  p.toggle(); await settle(); w.run();
  assert.equal(w.audio.paused, false);
  p.destroy();
  assert.equal(w.audio.src, "");
  assert.equal(w.audio.paused, true);
});

test("sound player: when the browser answers late, a muted visitor or a hidden tab still gets silence", async () => {
  for (const interrupt of [(p) => p.setHidden(true), (p) => p.setActive(false)]) {
    const w = world();
    let release;
    const create = w.env.createAudio;
    w.env.createAudio = () => { const a = create(); a.play = () => new Promise((r) => { release = () => { a.paused = false; r(); }; }); return a; };
    const p = new SoundPlayer(cfg, w.env);
    p.gesture();
    interrupt(p);
    release(); await settle(); w.run();
    assert.equal(p.getView().playing, false);
    assert.equal(w.audio.paused, true);
  }
});

// ── Configuration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("sound settings: off by default, damaged values fall back, only a sound of the site is accepted", () => {
  assert.deepEqual(C.normalizeSound({}), { enabled: false, file: null, volume: 30, pages: "all", corner: "bottom-right", startMuted: false });
  const f = "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp3";
  assert.equal(C.normalizeSound({ enabled: true, file: f }).file, f);
  for (const bad of ["https://example.org/a.mp3", "/uploads/../a.mp3", `${f}?x=1`, "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.png", 5, null]) assert.equal(C.normalizeSound({ file: bad }).file, null, String(bad));
  assert.equal(C.normalizeSound({ enabled: "true" }).enabled, false, "only a real true");
  for (const [raw, out] of [[40, 40], ["55", 55], [4, 30], [101, 30], [12.5, 30], ["abc", 30], [undefined, 30], [5, 5], [100, 100]]) assert.equal(C.normalizeVolume(raw), out, String(raw));
  assert.equal(C.normalizeSound({ pages: "nowhere", corner: "top" }).pages, "all");
  assert.equal(C.normalizeSound({ corner: "top" }).corner, "bottom-right");
});

test("sound settings: where it plays (all pages, or the home page with or without a language prefix)", () => {
  const locales = ["en", "fr"];
  for (const p of ["/", "/blog", "/fr/blog", "/x/y"]) assert.equal(C.soundVisibleOn(p, "all", locales), true, p);
  for (const p of ["/", "", null, "/fr", "/fr/", "/en", "/?a=1", "/fr#top"]) assert.equal(C.soundVisibleOn(p, "home", locales), true, String(p));
  for (const p of ["/blog", "/fr/blog", "/de", "/frx", "/privacy", "/fr/privacy"]) assert.equal(C.soundVisibleOn(p, "home", locales), false, p);
});

test("sound settings: server loader — hidden when disabled, without a file, or when the file is gone", async () => {
  await db.reset();
  assert.equal(await activeSound(), null, "off by default");
  const url = await U.saveUpload(F.oggVorbis());
  await setSetting("sound.file", url);
  assert.equal(await activeSound(), null, "a file but not enabled");
  await setSetting("sound.enabled", true);
  const on = await activeSound();
  assert.equal(on.file, url); assert.equal(on.volume, 30);
  await setSetting("sound.volume", 55); await setSetting("sound.pages", "home"); await setSetting("sound.corner", "bottom-left"); await setSetting("sound.startMuted", true);
  assert.deepEqual(await getSoundConfig(), { enabled: true, file: url, volume: 55, pages: "home", corner: "bottom-left", startMuted: true });
  await setSetting("sound.file", "https://example.org/x.mp3");
  assert.equal(await activeSound(), null, "an outside address is never used");
  await setSetting("sound.file", "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp3");
  assert.equal(await activeSound(), null, "a file that does not exist");
  await setSetting("sound.enabled", false);
});

// ── The control ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const labels = { label: "Sound", playTitle: "Sound off — click to play", muteTitle: "Sound on — click to mute", statusOn: "Background sound on", statusOff: "Background sound off" };
const html = (view, corner = "bottom-right") => renderToStaticMarkup(React.createElement(SoundToggleView, { view, corner, labels, status: "", onToggle() {} }));

test("sound control: a button with aria-pressed, a visible label, an icon with no name of its own, a stable skin part, 44 px target, hidden in print", () => {
  const off = html({ playing: false, wanted: true, failed: false });
  assert.match(off, /<button[^>]*type="button"/);
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /data-skin-part="sound-toggle"/);
  assert.match(off, /data-state="off"/);
  assert.match(off, /title="Sound off — click to play"/);
  assert.match(off, /<span>Sound<\/span>/, "visible label");
  assert.match(off, /<svg[^>]*aria-hidden="true"/);
  assert.match(off, /min-h-target min-w-target/, "target size token (2.75rem, 44 px)");
  assert.match(off, /print:hidden/);
  assert.match(off, /role="status"[^>]*aria-live="polite"/);
  assert.match(off, /motion-reduce:transition-none/);
  const on = html({ playing: true, wanted: true, failed: false });
  assert.match(on, /aria-pressed="true"/); assert.match(on, /data-state="on"/); assert.match(on, /title="Sound on — click to mute"/);
  assert.notEqual(off.replace(/data-state="\w+"|aria-pressed="\w+"|title="[^"]*"/g, ""), on.replace(/data-state="\w+"|aria-pressed="\w+"|title="[^"]*"/g, ""), "the icon differs by shape, not by color alone");
});

test("sound control: themed by tokens only, fixed in the chosen corner, clear of a phone's home bar", () => {
  const right = html({ playing: false, wanted: true, failed: false }, "bottom-right");
  const left = html({ playing: false, wanted: true, failed: false }, "bottom-left");
  assert.match(right, /fixed bottom-4 z-40 right-4/); assert.match(left, /fixed bottom-4 z-40 left-4/);
  assert.match(right, /safe-area-inset-bottom/);
  assert.doesNotMatch(right, /#[0-9a-f]{3,6}\b|rgb\(/i, "no raw color: the theme tokens decide");
  assert.match(right, /bg-surface/); assert.match(right, /text-fg/); assert.match(right, /border-line/); assert.match(right, /aria-pressed:bg-accent/);
});

// ── Wiring ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("background sound: mounted in the root layout of the public site only; never in admin, overlays, or a skin preview", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  const layout = read("src/app/(site)/layout.tsx");
  assert.match(layout, /<BackgroundSound key=/);
  assert.match(layout, /preview === null \? await activeSound\(\) : null/, "never in a skin preview");
  assert.match(layout, /locales=\{config\.locales\}/);
  // Only the public layout imports it.
  const users = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(e.name) && /import[^;]*BackgroundSound/.test(read(p))) users.push(p); } };
  walk("src");
  assert.deepEqual(users.filter((p) => !p.endsWith("BackgroundSound.tsx")).sort(), ["src/app/(site)/layout.tsx"]);
  for (const layoutFile of ["src/app/overlays/layout.tsx", "src/app/admin/layout.tsx", "src/app/admin/(panel)/layout.tsx"]) assert.doesNotMatch(read(layoutFile), /BackgroundSound/, layoutFile);
  const comp = read("src/components/site/BackgroundSound.tsx");
  assert.match(comp, /visibilitychange/);
  assert.match(comp, /window\.self !== window\.top/, "not inside a frame");
  assert.match(comp, /prefers-reduced-motion: reduce/);
  assert.match(comp, /usePathname/);
  assert.match(comp, /pointerdown[\s\S]*keydown/);
  assert.doesNotMatch(comp, /\.autoplay|autoPlay/, "never autoplay");
  assert.doesNotMatch(comp, /document\.cookie/, "no cookie");
});

test("background sound: the part is in the skin whitelist and the privacy page declares the stored choice", async () => {
  const { PARTS } = await import("@/core/skins/allowlist");
  assert.ok(PARTS.includes("sound-toggle"));
  const { buildPrivacyPolicy } = await import("@/core/privacy");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  const t = makeTranslator("en");
  const base = { siteName: "Etoile Nord", contactEmail: "", statsEnabled: false, newsToggle: false, features: [], extra: "", t };
  assert.doesNotMatch(buildPrivacyPolicy(base), /curiosa-sound/);
  assert.match(buildPrivacyPolicy({ ...base, sound: true }), /local storage "curiosa-sound"[\s\S]*not a cookie/);
  assert.match(buildPrivacyPolicy({ ...base, sound: true, t: makeTranslator("fr") }), /stockage local « curiosa-sound »/);
});

test("background sound: EN and FR texts have the same keys and the same variables", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const keys = Object.keys(en).filter((k) => /^(sound\.|settings\.sound|audit\.action\.settings\.sound|privacy\.cookies\.sound)/.test(k));
  assert.ok(keys.length >= 35);
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of keys) { assert.ok(k in fr, k); assert.equal(vars(fr[k]), vars(en[k]), k); if (!["settings.soundVolume", "settings.soundVolumeUnit"].includes(k)) assert.notEqual(fr[k], en[k], `${k} is translated`); }
});

// ── MCP: site_settings_get / site_settings_set ────────────────────────────────────────────────────────────────────────────────────────────
test("site settings tool: backgroundSound is read, validated against sounds already on the site, applied only by the approved plan", async () => {
  await db.reset();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en"]);
  const S = await import("@/core/maintenance/siteSettings");
  assert.equal((await S.siteSettingsGet()).backgroundSound.enabled, false);
  await assert.rejects(() => S.prepareSiteSettings({ backgroundSound: { enabled: true } }), /no sound file yet/);
  await assert.rejects(() => S.prepareSiteSettings({ backgroundSound: { file: "https://example.org/a.mp3" } }), /already on this site/);
  await assert.rejects(() => S.prepareSiteSettings({ backgroundSound: { file: "/uploads/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7.mp3" } }), /does not exist/);
  await assert.rejects(() => S.prepareSiteSettings({ backgroundSound: { volume: 3 } }), /5 to 100/);
  await assert.rejects(() => S.prepareSiteSettings({ backgroundSound: { pages: "x", wat: 1 } }), /unknown key[\s\S]*pages/);
  const url = await U.saveUpload(F.mp3WithId3());
  const plan = await S.prepareSiteSettings({ backgroundSound: { enabled: true, file: url, volume: 50, pages: "home" } });
  assert.equal(plan.site.changes.length, 4);
  assert.equal(await getSetting("sound.enabled"), undefined, "preparing saves nothing");
  const res = await S.executeSiteSettings(plan, "mcp:test");
  assert.equal(res.ok, true);
  assert.deepEqual(await getSoundConfig(), { enabled: true, file: url, volume: 50, pages: "home", corner: "bottom-right", startMuted: false });
  // Somebody changed it since the request: refused.
  const stalePlan = await S.prepareSiteSettings({ backgroundSound: { volume: 60 } });
  await setSetting("sound.volume", 70);
  assert.equal((await S.executeSiteSettings(stalePlan, "mcp:test")).ok, false);
  await setSetting("sound.enabled", false);
});

test("sound settings page: one task, two visible fields, the rest folded, empty state, test button, specific save verb", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/settings/page.tsx", "utf8");
  const section = page.slice(page.indexOf('data-tab="sound"'), page.indexOf('data-tab="ai"'));
  assert.match(section, /settings\.soundIntro/);
  assert.match(section, /<SwitchField name="soundEnabled"/);
  assert.match(section, /<ImageField name="soundFile" kind="audio"/);
  assert.match(section, /settings\.soundEmpty/, "the empty state says what to do");
  assert.match(section, /<SoundTest /);
  assert.match(section, /MoreOptions title/, "rare options are folded in simple mode");
  assert.match(section, /submitLabel=\{t\("settings\.soundSave"\)\}/);
  const visible = section.slice(0, section.indexOf("const fields"));
  assert.equal((visible.match(/<(SwitchField|ImageField|NumberField|Segmented|TextField|Select) /g) ?? []).length, 2);
  const actions = fs.readFileSync("src/app/admin/(panel)/settings/sound-actions.ts", "utf8");
  assert.match(actions, /errors: \{ soundFile:/);
  assert.match(actions, /errors: \{ soundVolume:/);
});
