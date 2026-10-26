// Le cœur ne documente que les sujets qu'il lit lui-même ; le registre complet vit dans le dépôt des modules (docs/TOPICS.md là-bas).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { SOCIAL_TOPIC } = await import("@/core/social");
const { FEED_ITEM_TOPIC } = await import("@/core/feeds");
const doc = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const reference = doc("docs/MODULES.md");

test("MODULES.md documente les trois sujets lus par le cœur, et seulement eux, et renvoie au registre", () => {
  const section = reference.slice(reference.indexOf("## Échanger des informations entre modules : les sujets"), reference.indexOf("```jsonc\n// module.json du CONSOMMATEUR"));
  assert.ok(section.length > 200, "section des sujets introuvable");
  const rows = [...section.matchAll(/^\| `([a-z]+(?:\.[a-z]+)+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(rows.sort(), ["core.entry", "feed.item", "social.link"], "le tableau ne liste que les sujets que le cœur lit");
  assert.equal(SOCIAL_TOPIC, "social.link");
  assert.equal(FEED_ITEM_TOPIC, "feed.item");
  assert.match(section, /docs\/TOPICS\.md/, "renvoi vers le registre du dépôt des modules");
  assert.match(section, /Règle d'évolution/, "règle d'évolution des sujets lus par le cœur");
  for (const word of ["facultatif", "liste fermée", "un champ = sa version"]) assert.ok(section.includes(word), `la règle d'évolution doit dire « ${word} »`);
});

test("CREATE-A-MODULE.md explique comment un dépôt tiers tient son registre de sujets", () => {
  const tutorial = doc("docs/CREATE-A-MODULE.md");
  assert.match(tutorial, /### Le registre des sujets de votre dépôt/);
  assert.match(tutorial, /docs\/TOPICS\.md/);
});

test("les sujets entre modules (social.stat, calendar.event…) ne sont plus dans la documentation du cœur : ils sont dans le registre du dépôt des modules", () => {
  for (const topic of ["social.stat", "calendar.event", "planning.slot", "map.place", "ha.state", "mascot.hint"]) assert.ok(!new RegExp(`^\\| \`${topic.replace(".", "\\.")}\` \\|`, "m").test(reference), `${topic} n'a pas sa ligne dans MODULES.md du cœur`);
});
