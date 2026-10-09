import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { changelogFor, sections } = await import("../../scripts/changelog.mjs");
const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
const { releaseNotes } = await import("@/core/updates/versions");

test("changelog : chaque version publiée porte sa section ; celle de package.json existe et n'est pas vide (jamais de release sans notes)", () => {
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const text = changelogFor(version, changelog);
  assert.ok(text.length > 40, `CHANGELOG.md : aucune section pour la version ${version} (ni « Prochaine version »)`);
  if (!/-rc\.|-dev/.test(version)) {
    assert.ok(sections(changelog).some((s) => s.title.replace(/^\[|\]/g, "").split(/\s+/)[0] === version), `une version stable (${version}) doit avoir SA section, pas « Prochaine version »`);
  }
});

test("changelog : la section d'une version est trouvée telle quelle ; une version sans section prend « Prochaine version » ; rien sinon", () => {
  const md = "# Changelog\n\nintro\n\n## Prochaine version (non publiée)\n\nA\n\n## 0.2.0\n\nB\n\n## [0.1.0] — 2026-01-01\n\nC\n";
  assert.equal(changelogFor("0.2.0", md), "B");
  assert.equal(changelogFor("0.1.0", md), "C");
  assert.equal(changelogFor("0.3.0-rc.1", md), "A");
  assert.equal(changelogFor("0.3.0", "# x\n\n## 0.2.0\n\nB\n"), "");
  assert.ok(changelog.includes("## 0.1.2") && changelog.includes("## 0.1.1"));
});

test("changelog : repris comme texte de chaque release (CI) et affiché dans l'admin avec la mise à jour proposée", () => {
  const wf = fs.readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(wf, /node scripts\/changelog\.mjs/);
  assert.match(wf, /--notes-file "\$RUNNER_TEMP\/notes\.md"/);
  assert.ok(!wf.includes("--generate-notes"), "plus de notes automatiques vides de sens");
  assert.match(fs.readFileSync("src/app/admin/(panel)/updates/page.tsx", "utf8"), /data-testid="update-notes"/);
  assert.equal(releaseNotes([{ tag_name: "v1.0.0", body: "## Notes\n- a" }], "v1.0.0"), "## Notes\n- a");
  assert.equal(releaseNotes([{ tag_name: "v1.0.0" }], "v1.0.0"), "");
  assert.equal(releaseNotes("n'importe quoi", "v1.0.0"), "");
  assert.equal(releaseNotes([{ tag_name: "v1.0.0", body: "x".repeat(9000) }], "v1.0.0").length, 6000, "borné");
});

test("changelog : écrit pour un non-technicien — un point = 1 à 3 phrases courtes, sans jargon ni code hors de la rubrique « Pour les développeurs »", () => {
  const JARGON = /\b(archive|migration|manifeste|sqlite|typescript|compilateur|prisma|next\.js|webassembly|serveur de production|endpoint|api)\b/i;
  const problems = [];
  for (const section of sections(changelog)) {
    let rubric = "";
    for (const line of section.body.split("\n")) {
      const h = /^### (.+)/.exec(line);
      if (h) { rubric = h[1]; continue; }
      if (!line.startsWith("- ")) continue;
      const text = line.slice(2);
      const where = `${section.title} › ${rubric} : « ${text.slice(0, 50)}… »`;
      const dev = /développeurs/i.test(rubric);
      const sentences = text.replace(/\*\*/g, "").split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÝÉ«(])/).filter(Boolean).length;
      if (sentences > 3) problems.push(`${where} — ${sentences} phrases (3 au plus)`);
      if (text.length > (dev ? 420 : 330)) problems.push(`${where} — ${text.length} caractères (${dev ? 420 : 330} au plus) : résumez`);
      if (!dev && /`/.test(text)) problems.push(`${where} — du code (« \` ») : à mettre dans « Pour les développeurs »`);
      if (!dev && JARGON.test(text)) problems.push(`${where} — mot technique « ${JARGON.exec(text)[0]} » : dites ce que ça change pour l'utilisateur`);
    }
  }
  assert.deepEqual(problems, [], "\n" + problems.join("\n"));
});
