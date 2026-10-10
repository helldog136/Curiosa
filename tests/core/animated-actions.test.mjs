import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DONE_MS, MIN_MS, fillStyle, isBusy, runAtLeast, shownPhase } from "@/components/admin/animatedAction";
import fr from "@/locales/fr.json" with { type: "json" };
import en from "@/locales/en.json" with { type: "json" };

const read = (p) => fs.readFileSync(p, "utf8");
const button = read("src/components/admin/AnimatedActionButton.tsx");

test("boutons animés : durée minimale 0,9 s, occupé pendant l'action ou quand le serveur travaille", () => {
  assert.equal(MIN_MS, 900);
  assert.ok(DONE_MS > 0);
  assert.equal(isBusy("idle"), false);
  assert.equal(isBusy("working"), true);
  assert.equal(isBusy("done"), true);
  assert.equal(isBusy("error"), false);
  assert.equal(isBusy("idle", true), true, "mise à jour déjà en cours : désactivé");
  assert.equal(shownPhase("idle", true), "working");
  assert.equal(shownPhase("done", true), "done");
  assert.equal(shownPhase("idle"), "idle");
  assert.deepEqual(fillStyle("idle"), { width: "0%", transitionDuration: "0ms" });
  assert.deepEqual(fillStyle("working"), { width: "100%", transitionDuration: "900ms" });
});

test("boutons animés : runAtLeast attend au moins la durée minimale et absorbe les exceptions", async () => {
  const t0 = Date.now();
  assert.deepEqual(await runAtLeast(async () => ({ ok: true }), 120), { ok: true });
  assert.ok(Date.now() - t0 >= 110);
  assert.equal(await runAtLeast(async () => { throw new Error("x"); }, 10), null);
});

test("boutons animés : un composant commun sert l'installation, la mise à jour du site et celles des modules", () => {
  for (const f of ["InstallButton", "UpdateButton", "ModuleUpdateButton"]) assert.match(read(`src/components/admin/${f}.tsx`), /AnimatedActionButton/, f);
  assert.match(button, /motion-safe:animate-bounce/, "la flèche ne rebondit pas si l'animation est réduite");
  assert.match(button, /aria-live="polite"/);
  assert.match(button, /askConfirm\(confirmMessage\)/, "la confirmation passe par la boîte dans la page (la boîte native est supprimée en silence hors premier plan)");
  assert.match(read("src/app/globals.css"), /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
  assert.match(read("src/app/globals.css"), /\.curiosa-indeterminate/);
});

test("mise à jour du site : le bouton animé remplace le formulaire, confirmation conservée, animé et désactivé si déjà en cours", () => {
  const page = read("src/app/admin/(panel)/updates/page.tsx");
  assert.match(page, /<UpdateButton running=\{false\} confirm=\{check\.prerelease/);
  assert.match(page, /<UpdateButton running confirm=""/, "en cours au chargement : bouton animé");
  assert.ok(!page.includes("action={applyUpdate}"));
  const comp = read("src/components/admin/UpdateButton.tsx");
  assert.match(comp, /applyUpdate\(\)/);
  assert.match(comp, /running=\{running\}/);
  assert.match(comp, /progress="continuous"/);
});

test("modules : chercher / mettre à jour passent par le bouton animé ; les actions ne redirigent plus mais disent où aller", () => {
  const page = read("src/app/admin/(panel)/modules/[id]/page.tsx");
  assert.match(page, /<ModuleUpdateButton id=\{row\.id\} kind="check"/);
  assert.match(page, /<ModuleUpdateButton id=\{row\.id\} kind="update"/);
  const actions = read("src/app/admin/(panel)/modules/actions.ts");
  const check = actions.slice(actions.indexOf("export async function checkUpdateAction"), actions.indexOf("export async function uninstallModuleAction"));
  assert.ok(!check.includes("redirect("));
  assert.match(check, /await adminCtx\("owner"\)/);
  assert.match(check, /audit\(user\.email, "module\.update", id\)/);
  assert.match(check, /revalidatePath\("\/", "layout"\)/);
});

test("textes : mêmes clés en français et en anglais pour les boutons animés", () => {
  for (const k of ["modules.checking", "modules.checked", "modules.updating", "modules.updated", "modules.updateFailed", "updates.working", "updates.done"]) {
    assert.ok(fr[k] && en[k], k);
  }
  const keys = ["modules.checking", "modules.checked", "modules.updating", "modules.updated", "modules.updateFailed", "updates.working", "updates.done"];
  for (const dict of [fr, en]) {
    const all = Object.keys(dict);
    const at = all.indexOf(keys[0]);
    assert.deepEqual(all.slice(at, at + keys.length), keys, "nouvelles clés groupées, dans le même ordre");
    assert.ok(at >= all.length - 120, "vers la fin du fichier (avant les clés de thème et de couleurs)");
  }
});

test("mise à jour du site : 2 s d'attente avant de relire la page (le serveur redémarre), et le suivi automatique ne relit que si le serveur répond", () => {
  assert.match(read("src/components/admin/animatedAction.ts"), /AFTER_UPDATE_MS = 2000/);
  assert.match(read("src/components/admin/UpdateButton.tsx"), /sleep\(AFTER_UPDATE_MS\)/);
  const auto = read("src/components/admin/AutoRefresh.tsx");
  assert.match(auto, /status >= 500/);
  assert.match(auto, /catch \{ return; \}/);
});
