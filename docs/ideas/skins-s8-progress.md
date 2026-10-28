# Lot S8 : état d'avancement (kit de test, banc d'essai, gabarits)

Branche `feat/skins-s8` (partie de `feat/skins-int`). Dépôt de travail : un seul clone sous /dev/shm (volatile : pousser souvent).

## Fait
- `npm run skin:check -- <dossier> [--visual --shots --modules --json --strict --advice --lang --neutrality --lock --widths --only-pages]` : `scripts/skin-check.mjs`, `testsupport/skins/` (static, report, messages, levels, neutrality, modules, version) ; huit niveaux.
- Niveau navigateur : `testsupport/skins/visual/` (run, inpage, order, pixels) ; seuils d'ordre mesurés (CREER-UN-SKIN.md §8).
- Banc : `npm run skin:bench -- <skin> [--shots --previews --serve]` ; `testsupport/skins/bench/` ; fragments générés par `npm run skin:bench:refresh` (vrais composants).
- Gabarits : `docs/skin-starter/` (passe `--visual --strict`), `docs/CREER-UN-SKIN.md`, SKINS.md §23.
- Correctif du cœur trouvé par le kit : titres de niveau 6 de basic (globals.css).
- Tests : tests/core/skins-kit-{static,order,visual}.test.mjs, skins-bench.test.mjs (visual : 17 tests, ~8 min, derrière flock).

## Reste
- Suite complète du cœur ×2, tsc, eslint (base 103), release-pack + smoke-release, harnais d'images (référence absente : non comparé).

## Commandes
- Tests : `HOME=/dev/shm/s8/home TMPDIR=/dev/shm/tmp-s8 flock /dev/shm/heavy.lock npm test`
- Visuel seul : `flock /dev/shm/heavy.lock node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/helpers/register.mjs --test tests/core/skins-kit-visual.test.mjs`
- Fragments : `npm run skin:bench:refresh` (puis versionner).

## Pièges
- git : `git config user.name/email` locaux (HOME changé). node_modules copié de Rosaliax : `npx prisma generate` peut manquer (tsc signale store.ts : sans rapport).
- Focus : partir du body (`body.focus()`), sinon Tab ne part pas. Fermer le survol du menu avant de cliquer la bascule.
- Ne pas piper `| head` sur skin:bench (EPIPE). Arrêter les serveurs par PID du node enfant.
