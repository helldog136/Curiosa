# Lots S2 (DOM stable) et S3 (composants par les jetons) : état d'avancement

> Fichier de reprise : le conteneur peut redémarrer et vider `/dev/shm`. Tout ce qui est ici suffit à reprendre. À supprimer avant la fusion.

## Branche et commits
- `feat/skins-s2`, partie de `origin/feat/skins-s1` (fedccd5).
- `731256a` = **S2** (coquille, régions, pièces, menu dans la feuille du cœur, test `tests/core/skins-dom.test.mjs`).
- `e8b2867` = **S3** (jetons dans les composants, `tests/core/skins-components.test.mjs`, `dom-check.mjs`, profil `skin-test`, reprise du navigateur dans `capture.mjs`).
- Commits suivants : documentation, scripts de reprise.

## Commandes de reprise (un seul clone de travail, tout derrière `flock /dev/shm/heavy.lock`)
Les scripts sont dans `docs/ideas/skins-s2-run/` (copie de ceux du scratchpad) : `lib.sh`, `ref.sh` (référence v0.3.1 → `/dev/shm/visual-baseline-031`, fichier `READY` à la fin), `cand.sh <étiquette> <commit>` (construit le commit, capture profil par profil, compare à la référence, supprime la capture, écrit `results/<étiquette>-<profil>.txt`).
Reprise : `git clone … /dev/shm/skins-s2 && git checkout feat/skins-s2`, copier `scripts/visual` dans un dossier `harness-s2`, puis `ref.sh`, `cand.sh s2 731256a`, `cand.sh s3 <dernier commit>`.

## Reste à faire (mettre à jour à chaque jalon)
- [x] référence v0.3.1 prête (1168 captures, en série, fichier READY)
- [x] S2 (731256a) : 1 168 / 1 168 identiques, 0 pixel
- [x] S3 (60f013d) : 1 168 / 1 168 identiques, 0 pixel
- [x] `npm test` x2 : 7 492 tests, 7 488 réussis, 0 échec, 4 ignorés ; tsc propre ; eslint 103 = 103 problèmes (aucun nouveau)
- [x] `npm run visual:dom` : 3 952 contrôles, 0 écart
- [x] skin d'essai « colonne latérale » : preuve (36 pages, 0 écart) et captures 390/768/1280/1920
- [x] release-pack + smoke-release : « Archive validée »
- [x] déterminisme : 3 captures de la galerie identiques entre elles et à la référence
- Reste : rien (supprimer ce fichier avant la fusion).
