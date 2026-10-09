import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { entryState } from "@/core/content/state";

const read = (p) => fs.readFileSync(p, "utf8");
const dir = "src/app/admin/(panel)/entries";

test("état d'une entrée : brouillon, programmée, expirée ou publiée", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const d = (s) => new Date(`${s}T00:00:00Z`);
  assert.equal(entryState({ status: "draft", publishedAt: null, expiresAt: null }, now), "draft");
  assert.equal(entryState({ status: "draft", publishedAt: d("2020-01-01"), expiresAt: d("2020-02-01") }, now), "draft");
  assert.equal(entryState({ status: "published", publishedAt: d("2026-07-01"), expiresAt: null }, now), "scheduled");
  assert.equal(entryState({ status: "published", publishedAt: d("2026-01-01"), expiresAt: d("2026-02-01") }, now), "expired");
  assert.equal(entryState({ status: "published", publishedAt: null, expiresAt: null }, now), "published");
});

test("éditeur d'entrée : titre, infos propres, texte, image, publication, puis Options ; pas de bouton Enregistrer en double", () => {
  const f = read(`${dir}/EntryForm.tsx`);
  const at = (s) => { const i = f.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('name="title"') < at('name="code"'));
  assert.ok(at('name="code"') < at("<MarkdownField"));
  assert.ok(at("<MarkdownField") < at("<ImageField"));
  assert.ok(at("<ImageField") < at('name="status"'));
  assert.ok(at('name="status"') < at("<details open"));
  assert.ok(at("<details open") < at('name="summary"') && at("<details open") < at('name="slug"'), "le facultatif est rangé dans Options");
  assert.ok(!/<button/.test(f), "la barre flottante enregistre");
  assert.match(f, /type="radio" name="status"/);
});

test("liste d'entrées : état vide avec action, même ordre que le site, état en puce", () => {
  const l = read(`${dir}/page.tsx`);
  assert.match(l, /entries\.createFirst/);
  assert.match(l, /orderBy\(sort\)/);
  assert.match(l, /entryState\(e\)/);
});

test("suppression : zone à part, avec confirmation", () => {
  const p = read(`${dir}/[id]/page.tsx`);
  assert.match(p, /entries\.dangerTitle/);
  assert.equal((p.match(/<ConfirmButton/g) ?? []).length, 2);
  assert.match(p, /entries\.deleteConfirm/);
});

test("textes : nouvelles clés présentes en français et en anglais", () => {
  const fr = JSON.parse(read("src/locales/fr.json")), en = JSON.parse(read("src/locales/en.json"));
  for (const k of ["tabs.content", "entries.createFirst", "entries.options", "entries.state.scheduled", "sources.allUsed", "entries.deleteConfirm"]) {
    assert.ok(fr[k] && en[k], k);
  }
});
