# Intégration 2 (S7 + S8 + frictions des auteurs) : état d'avancement

> Fichier de reprise (le conteneur peut redémarrer). À supprimer avant la fusion dans master, avec `skins-s7-progress.md`, `skins-s8-progress.md` et `skins-s7-run/`.

Branche `feat/skins-int2` (partie de `feat/skins-int`), un seul clone : `/home/user/Curiosa`. Travail lourd sous `/home/user/work` (disque, pas la RAM).

## Fait (poussé)
- Fusion de `feat/skins-s7` puis `feat/skins-s8` (un seul conflit : `docs/SKINS.md`, §23 = S7, §24 = S8).
- Frictions des auteurs (docs/SKINS.md §25) : (a) profil `skin-test` du harnais (empreinte, `VISUAL_SKIN_IGNORE_MINCORE`), (b) `div`/`span`/`section`/`article`/`[data-marker]` sous `module-html`, (c) pièce `card-body` et jeton `--sk-card-pad`, (d) jeton `--sk-gradient` + paires de lisibilité 13 et 14, (e) 600 caractères, exemples, `[data-site-nav]`, aperçus 1280 × 800 ou 390 × 844, notes de l'auteur tolérées à la racine, (f) procédure des étiquettes.
- Harnais : chaque billet de démonstration porte un titre de niveau 6.

## Preuves : commandes
- Référence v0.3.1 (en série, ~25 min) : `scratchpad/ref.sh <commit-du-harnais>` (arbre `/home/user/work/ref031`, captures `/home/user/work/baseline-031`, `READY` à la fin).
- Candidate : même harnais, même instantané (`VISUAL_ROOT=/home/user/work/visual`), `compare.mjs` profil par profil.
- Tests : `npm test` deux fois ; `npx tsc --noEmit` ; `npx eslint .` (base : 103 problèmes) ; `npm run release-pack` puis `smoke-release`.
- Skins : `npm run skin:check -- /home/user/work/sk-<id>/skins/<id> --visual --strict` (dépôt cloné dans `/home/user/work/skins-repo`).

## Pièges
- Ne jamais lancer deux commandes lourdes ensemble ; arrêter les serveurs par PID (`node scripts/visual/site.mjs down <profil>`).
- La correction h6 de S8 (`globals.css`) : la preuve est dans la capture (les billets de démonstration ont maintenant un h6).
