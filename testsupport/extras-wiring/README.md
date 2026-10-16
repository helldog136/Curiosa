# Brancher la suite de conformité du cœur dans curiosa-extras

Fichiers prêts à poser dans le dépôt `curiosa-extras` (rien n'y est écrit automatiquement) :

1. `tests/conformance.test.mjs` → `curiosa-extras/tests/conformance.test.mjs` : lance, pour chaque dossier de `modules/` et `examples/`, une exigence = un test nommé (`[guestbook] settings.optional (obligatoire) — …`).
2. `scripts/test.mjs` → remplace `curiosa-extras/scripts/test.mjs` : vérifie que le cœur a `testsupport/` et passe `CURIOSA_DIR` aux tests.
3. Les défauts déjà connus sont listés dans `KNOWN` (module → exigence → raison) : ils s'affichent « à corriger » sans arrêter la suite, et le test échoue le jour où ils sont corrigés (« retirez l'exception »).
4. Lancer : `CURIOSA_DIR=../Curiosa npm test` (le cœur doit contenir ce kit, version 0.1.23 ou la branche `agent/testsupport`).
5. Ensuite, retirer les tests qui font doublon avec la suite (liste dans le rapport de livraison) : `optional-settings.test.mjs`, les tests de cohérence/version/imports/Prisma/README/MCP de `repo-rules.test.mjs`, les tests SRP « outil MCP / collection / service / secret » de `srp-guard.test.mjs`, et les `assertValidManifest` / `assertLocalesParity` / `assertSettingsSane` / `assertDefinitionMatchesManifest` répétés dans les tests de chaque module.
6. Un nouveau module n'a plus rien à écrire pour être contrôlé : son dossier est repris tout seul.
