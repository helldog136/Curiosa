// The new texts of the onboarding (invitations, forgot password, suspension, role presets): EN/FR parity, same {variables}, and the kit's rules on tone, words, labels and filler.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { forbiddenWords, toneProblems, labelProblems, conditionalWording, fillerPhrases } from "../../testsupport/ergonomics.mjs";

const read = (f) => fs.readFileSync(f, "utf8");
const en = JSON.parse(read("src/locales/en.json")), fr = JSON.parse(read("src/locales/fr.json"));
const MINE = /^(invite\.|forgot\.|reset\.|rolePreset\.|roles\.preset\.|users\.(suspend|suspended|reactivate|suspendConfirm|needs2fa)$|audit\.action\.(invite|password\.reset|user\.suspend|user\.reactivate))/;
const keys = Object.keys(en).filter((k) => MINE.test(k));
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("onboarding texts: both languages, same keys, same variables", () => {
  assert.ok(keys.length > 90);
  for (const k of keys) { assert.ok(fr[k], `missing in FR: ${k}`); assert.equal(vars(fr[k]), vars(en[k]), k); }
});

test("every key used by the onboarding code exists in both languages", () => {
  const files = ["src/core/auth/invitations.ts", "src/core/auth/passwordReset.ts", "src/app/admin/(panel)/users/page.tsx", "src/app/admin/(panel)/users/actions.ts", "src/app/admin/(panel)/users/RolesPanel.tsx",
    "src/app/admin/(auth)/invitation/page.tsx", "src/app/admin/(auth)/invitation/actions.ts", "src/app/admin/(auth)/forgot-password/page.tsx", "src/app/admin/(auth)/forgot-password/actions.ts",
    "src/app/admin/(auth)/reset-password/page.tsx", "src/app/admin/(auth)/reset-password/actions.ts", "src/app/admin/(auth)/login/page.tsx"];
  for (const f of files) for (const m of read(f).matchAll(/\bt\("((?:invite|forgot|reset|roles\.preset|users\.(?:suspend|suspended|reactivate|suspendConfirm|needs2fa))[\w.]*)"/g)) {
    assert.ok(en[m[1]], `${f}: ${m[1]} missing in EN`); assert.ok(fr[m[1]], `${f}: ${m[1]} missing in FR`);
  }
  for (const k of ["24", "72", "168"]) assert.ok(en[`invite.ttl.${k}`] && fr[`invite.ttl.${k}`]);
});

test("onboarding texts: no forbidden word, short labels, neutral tone, no filler, no conditional wording", () => {
  for (const [lang, loc] of [["en", en], ["fr", fr]]) for (const k of keys) {
    if (k.startsWith("audit.action.")) continue;
    const text = loc[k];
    const bad = [...forbiddenWords(text), ...toneProblems(text, lang), ...conditionalWording(text), ...fillerPhrases(text), ...(/\.(label|title|button|submit|name|start|blank|link)$/.test(k) ? labelProblems(text) : [])];
    assert.deepEqual(bad, [], `${lang} ${k}: ${text}`);
  }
});

test("texts name no role: only the role's own name is ever written", () => {
  for (const k of keys.filter((x) => !x.startsWith("rolePreset.") && !x.startsWith("audit."))) assert.doesNotMatch(en[k], /\b(owner|coordinator|moderator)\b/i, k);
});
