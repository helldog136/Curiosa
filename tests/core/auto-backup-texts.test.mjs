// Automatic backup by e-mail: the texts and the page follow docs/ERGONOMIE-ADMIN.md with the automatic checks of the kit (testsupport/ergonomics.mjs).
// R9 (words), R10 (labels), R11 (help), R13 (tone), R19 (right control), R29 (FR/EN parity), R32/R33 (filler, conditional wording, state words), R4 (fields on the page).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forbiddenWords, labelProblems, toneProblems, conditionalWording, fillerPhrases, forbiddenStatus, STATE_VOCABULARY, HELP_INLINE_MAX, FORM_FIELDS_MAX } from "../../testsupport/ergonomics.mjs";

const read = (f) => fs.readFileSync(f, "utf8");
const loc = { en: JSON.parse(read("src/locales/en.json")), fr: JSON.parse(read("src/locales/fr.json")) };
const keys = Object.keys(loc.en).filter((k) => k.startsWith("autobackup.") || k.startsWith("audit.action.autobackup."));
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("R29: every text of the feature exists in French and English with the same variables", () => {
  assert.ok(keys.length > 80);
  for (const k of keys) {
    assert.equal(typeof loc.fr[k], "string", `${k} missing in French`);
    assert.deepEqual(vars(loc.fr[k]), vars(loc.en[k]), `${k}: variables differ`);
  }
  for (const k of Object.keys(loc.fr).filter((x) => x.startsWith("autobackup."))) assert.ok(k in loc.en, `${k} missing in English`);
});

test("R9, R13, R32, R33: no code word, no exclamation mark, long sentence, filler, conditional wording or internal state word in any text", () => {
  const problems = [];
  for (const lang of ["en", "fr"]) {
    for (const k of keys) {
      const text = loc[lang][k];
      for (const w of forbiddenWords(text, "core")) problems.push(`${lang} ${k}: forbidden word « ${w} »`);
      for (const p of toneProblems(text, lang)) problems.push(`${lang} ${k}: ${p}`);
      for (const c of conditionalWording(text)) problems.push(`${lang} ${k}: conditional « ${c} »`);
      for (const c of fillerPhrases(text)) problems.push(`${lang} ${k}: filler « ${c} »`);
      if (/state/.test(k)) for (const c of forbiddenStatus(text)) problems.push(`${lang} ${k}: internal state word « ${c} »`);
    }
  }
  assert.deepEqual(problems, []);
});

test("R10, R11: labels are short without a colon; the help under the page stays short", () => {
  const labels = ["switchLabel", "frequency", "recipient", "recipient.owner", "recipient.user", "recipient.address", "recipient.account", "recipient.typed", "limit", "now", "more", "saveOptions", "renew", "edit"];
  for (const lang of ["en", "fr"]) {
    for (const l of labels) assert.deepEqual(labelProblems(loc[lang][`autobackup.${l}`]), [], `${lang} ${l}`);
    assert.match(loc[lang]["autobackup.recipient.example"], /^(For example|Par exemple) ?:/);
  }
  // the long explanation of the panel is in the "?" bubble (Panel help), not on the page; the hint of a number says its bounds and its default (R20)
  assert.ok(loc.en["autobackup.limitHint"].includes("20") && loc.en["autobackup.limitHint"].includes("25"));
  assert.ok(HELP_INLINE_MAX >= 60);
});

test("R33a: the three states are written the same way as everywhere else", () => {
  for (const lang of ["en", "fr"]) {
    assert.equal(loc[lang]["autobackup.state.configured"], STATE_VOCABULARY[lang].configured);
    assert.equal(loc[lang]["autobackup.state.degraded"], STATE_VOCABULARY[lang].degraded);
    assert.equal(loc[lang]["autobackup.state.notConfigured"], STATE_VOCABULARY[lang].notConfigured);
  }
});

test("every reason has a text and a way out, in both languages, and the mail texts say what to do", () => {
  const reasons = ["mail_not_configured", "no_recipient", "mail_refused", "mail_login", "mail_unreachable", "mail_rate_limited", "backup_failed", "passphrase_unreadable", "disk_full", "too_big"];
  const src = read("src/core/backup/auto/config.ts");
  for (const r of reasons) { assert.ok(src.includes(`"${r}"`)); for (const lang of ["en", "fr"]) { assert.ok(loc[lang][`autobackup.reason.${r}`]); assert.ok(loc[lang][`autobackup.fix.${r}`]); } }
  assert.match(loc.en["autobackup.secretKeep"], /without it the e-mailed backups cannot be opened/);
  for (const k of ["autobackup.mail.restore", "autobackup.mail.off", "autobackup.mail.encrypted"]) assert.ok(loc.en[k].length > 20);
});

test("R2, R4, R17, R19, R3: the page has few fields in view, a switch, segmented choices, one secondary action and the rare ones folded", () => {
  const panel = read("src/components/admin/AutoBackupPanel.tsx");
  const [open, folded] = panel.split("<MoreOptions");
  // in view: the switch, the frequency (segmented), and nothing else that takes input
  assert.equal((open.match(/<Segmented\b/g) ?? []).length, 1);
  assert.equal((open.match(/<Switch\b/g) ?? []).length, 1);
  assert.equal((open.match(/<(TextField|Select|NumberField|input|textarea)\b/g) ?? []).length, 0);
  const inView = (open.match(/<(Segmented|Switch|TextField|Select|NumberField)\b/g) ?? []).length;
  assert.ok(inView <= 2 && inView <= FORM_FIELDS_MAX);
  // folded: recipient (segmented, account list, typed address) and the limit
  assert.equal((folded.match(/<(Segmented|Select|TextField|NumberField)\b/g) ?? []).length, 4);
  // one secondary action ("Send a backup now"); the destructive one (new passphrase) is outlined and confirmed
  assert.ok(open.includes('data-testid="autobackup-now"') && !/btnPrimary[^`]*autobackup-now/.test(open));
  assert.ok(folded.includes("btnDanger") && folded.includes("askConfirm"));
  // the status is a chip with text (never a colour alone), the switch shows its state in words (R17)
  assert.ok(open.includes("<Badge") && /onText=\{L\.on\}/.test(open));
  // a link to the mail settings when mail is not set up (R25)
  assert.ok(open.includes("view.mailHref"));
  // the page does not show the passphrase except through the one-time component
  assert.ok(!/passphrase/i.test(read("src/app/admin/(panel)/backup/page.tsx").replace(/autobackup\.[a-zA-Z.]*passphrase[a-zA-Z.]*/g, "")));
});

test("the rights: every action and the download need the backup right, and none writes the passphrase anywhere", () => {
  const actions = read("src/app/admin/(panel)/backup/auto-actions.ts");
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.equal(exported.length, 6);
  assert.equal((actions.match(/adminCtx\(right\)/g) ?? []).length, 6);
  assert.ok(/right = \{ right: "core:backup" \}/.test(actions));
  assert.ok(/can\(user, "core:backup"\)/.test(read("src/app/api/admin/backup/auto/route.ts")));
  const noLeak = [...actions.matchAll(/audit\([^)]*\)/g)].map((m) => m[0]).join("\n");
  assert.ok(!/passphrase\)|passphrase,/.test(noLeak));
});
