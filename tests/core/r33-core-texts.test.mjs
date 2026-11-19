// R33 on the texts of the core (docs/ERGONOMIE-ADMIN.md): every FR and EN text of src/locales is scanned with the automatic checks of the kit (testsupport/ergonomics.mjs):
//   R33e  conditional or approximate wording ("if not already done", "normally", "usually", "maybe")
//   R33g  filler and reassurance ("nothing to do", "all is well", "that is normal", "nothing is lost")
//   R33a  an internal word used as a state in a chip text ("Taken over", "Legacy", "Bridged")
// Two lists, both visible and both justified:
//   ALLOWED   a text that the checks flag but that is the right text (a category name, an answer to an action, a checklist state). Each says why; one that no longer matches fails.
//   BASELINE  tests/r33-core-baseline.json: the known debt. It can only SHRINK: a new gap fails, and so does a line whose gap has gone (remove it). It is EMPTY today.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { conditionalWording, fillerPhrases, forbiddenStatus, STATE_KEY, shortHash, compareToBaseline, baselineGrowth } from "../../testsupport/ergonomics.mjs";

const read = (f) => fs.readFileSync(f, "utf8");
const locales = { fr: JSON.parse(read("src/locales/fr.json")), en: JSON.parse(read("src/locales/en.json")) };

/** key -> why this text is right although a check flags it. */
const ALLOWED = new Map([
  ["aim.level.2", "\"Safe actions\" is the NAME of a rights level (level 2 of the AI access), not a reassurance"],
  ["mcp.profile.l2", "names the level 2 rights (\"safe actions\") that the profile leaves off"],
  ["mcp.profile.help", "names the levels \"safe actions\" and \"risky actions\" that the profile leaves off"],
  ["assistants.new.kind.upkeepHelp", "names the levels \"safe actions\" and \"risky actions\" that stay blocked"],
  ["skins.error.nosnapshot", "the answer to \"Undo\" when there is nothing to undo: the exact result of the action"],
  ["aim.req.change.same", "an AI request that would change nothing: says so to the person who approves"],
  ["domain.row.none", "the state chip of a checklist row, the pair of \"To do\": the person scans the rows for the ones to do"],
]);

function gaps() {
  const out = [];
  for (const [lang, loc] of Object.entries(locales)) {
    for (const [k, text] of Object.entries(loc)) {
      if (typeof text !== "string" || ALLOWED.has(k)) continue;
      const where = `locale:${lang}:${k}`;
      for (const c of conditionalWording(text)) out.push({ rule: "R33e", key: `R33e ${where} #${shortHash(text)}`, message: `${where}: conditional wording « ${c} »: ${text.slice(0, 90)}` });
      for (const c of fillerPhrases(text)) out.push({ rule: "R33g", key: `R33g ${where} #${shortHash(text)}`, message: `${where}: filler « ${c} »: ${text.slice(0, 90)}` });
      if (STATE_KEY.test(k)) for (const c of forbiddenStatus(text)) out.push({ rule: "R33a", key: `R33a ${where} #${shortHash(text)}`, message: `${where}: internal state word « ${c} »: ${text.slice(0, 90)}` });
    }
  }
  return out;
}
const baseline = JSON.parse(read("tests/r33-core-baseline.json"));

test("R33: the texts of the core have no new conditional wording, filler or internal state word (the baseline only shrinks)", () => {
  const r = compareToBaseline(gaps(), baseline.keys);
  assert.deepEqual(r.fresh.map((g) => g.message), [], "new gaps: fix the text (do not add it to the baseline)");
  assert.deepEqual(r.stale, [], "these lines of tests/r33-core-baseline.json no longer match a gap: remove them");
});

test("R33: the baseline is empty or only shrinks (growth against the previous version is refused)", () => {
  assert.ok(Array.isArray(baseline.keys));
  assert.deepEqual(baselineGrowth({ modules: { core: [] } }, { modules: { core: baseline.keys } }), baseline.keys.map((k) => `core : ${k}`), "any key is growth against the empty state of 0.36.0");
  assert.equal(baseline.keys.length, 0, "the baseline of 0.36.0 is empty: every flagged text was fixed or justified in ALLOWED");
});

test("R33: every allowed text still exists in both languages and is still flagged (the list does not rot)", () => {
  for (const [k, why] of ALLOWED) {
    assert.ok(why.length > 20, `${k}: say why`);
    for (const lang of ["fr", "en"]) assert.equal(typeof locales[lang][k], "string", `${k} (${lang}) is gone: remove it from ALLOWED`);
    // The word lists differ per language ("sans risque" is flagged, "Safe" is not): flagged in at least one language is enough.
    const flagged = ["fr", "en"].some((lang) => { const text = locales[lang][k]; return conditionalWording(text).length + fillerPhrases(text).length > 0 || (STATE_KEY.test(k) && forbiddenStatus(text).length > 0); });
    assert.ok(flagged, `${k} is no longer flagged: remove it from ALLOWED`);
  }
});

test("R33: the two languages keep the same keys after the cleanup, and no deleted key is still used", () => {
  assert.deepEqual(Object.keys(locales.fr).sort(), Object.keys(locales.en).sort());
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p, o); else if (/\.(tsx?|mjs)$/.test(p)) o.push(p); } return o; };
  const sources = walk("src").map((f) => read(f)).join("\n");
  for (const k of ["dashboard.helloIntro", "dash.todo.none", "dash.activity.none", "dash.cards.empty", "dash.health.ok", "dash.create.none", "settings.layer.colorNote", "settings.layer.imageNote", "setup.profile.otherHelp", "setup.profile.skip", "setup.modules.skip", "setup.ai.skipNote", "updates.happens.rollback", "legacy.absent.keepHelp", "net.health.ok", "net.health.unknown", "net.health.summary"]) {
    assert.ok(!(k in locales.fr) && !(k in locales.en), `${k} was removed`);
    assert.ok(!sources.includes(`"${k}"`) && !sources.includes(`'${k}'`), `${k} is still used in the code`);
  }
});

test("R33e (0.38.0): « pour l'instant », « pour le moment », « for now », « for the moment » are flagged in a text and in the blocks of a page; the core texts have none", async () => {
  const { adminPageErgonomicsProblems, visibleTexts } = await import("../../testsupport/ergonomics.mjs");
  for (const t of ["Aucun brouillon pour l'instant.", "Aucun brouillon pour l’instant.", "Impossible pour le moment", "Empty for now.", "Nothing here for the moment"]) assert.equal(conditionalWording(t).length, 1, t);
  for (const t of ["Aucun brouillon.", "No drafts.", "Ce n'est pas encore fait"]) assert.deepEqual(conditionalWording(t), [], t);
  const blocks = [{ type: "heading", text: "Liste" }, { type: "table", columns: ["Nom"], rows: [["a"]], empty: "Aucune commande pour l'instant." }, { type: "adminForm", action: "x", submitLabel: "Enregistrer la commande", fields: [{ name: "n", label: "Nom", help: "Vide for now. Par exemple : hello" }] }];
  assert.ok(visibleTexts(blocks[1]).includes("Aucune commande pour l'instant."));
  const found = adminPageErgonomicsProblems(blocks).filter((p) => p.rule === "R33e");
  assert.equal(found.length, 2, found.map((p) => p.message).join("\n"));
  assert.deepEqual(adminPageErgonomicsProblems([{ type: "table", columns: ["Nom"], rows: [["a"]], empty: "Aucune commande." }]).filter((p) => p.rule === "R33e"), []);
  // The texts of the core carry none (the scan of the first test would also catch it; this one names the words).
  const all = Object.values(locales).flatMap((l) => Object.values(l)).filter((x) => typeof x === "string");
  assert.deepEqual(all.filter((x) => /pour l['’]instant|pour le moment|for now|for the moment/i.test(x)), []);
});
