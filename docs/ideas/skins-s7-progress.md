# Lot S7 (page Apparence) : état d'avancement

> Fichier de reprise (le conteneur peut vider /dev/shm). À supprimer avant la fusion.

## Branche
`feat/skins-s7`, partie de `origin/feat/skins-int` (0f77a6e). Un seul clone : `/dev/shm/s7` (`git clone --no-hardlinks`, node_modules copié de Website-Rosaliax, `npx prisma generate`).

## Fait (poussé)
- Page `/admin/appearance` (skins, aperçu par jeton signé, retouches un mode / deux modes, Revenir au skin, Annuler, options, mises à jour, retrait, adresse personnelle) ; code : `src/app/admin/(panel)/appearance/`, `src/core/skins/{appearance,appearanceView,previewToken}.ts`.
- Réglages : couleurs/police/halo/fond/en-tête déplacés vers Apparence (tests anciens repointés).
- MCP : `maintenance_skin_{status,list,install,activate,remove}` (`src/core/maintenance/skins.ts`), docs/MAINTENANCE-IA.md, docs/SKINS.md §23.
- Aperçu dans l'éditeur d'entrée (`EntryPreview*.tsx`).
- Tests : tests/core/skins-appearance{,-dom,-backup}.test.mjs, tests/services/mcp-skins.test.mjs.
- Navigateur (Chromium, 390 et 1280, FR/EN, admin clair/sombre) : 19 contrôles OK x2, 0 erreur console ; scripts dans `docs/ideas/skins-s7-run/` (`run-both.sh`, `journey.mjs`, `en-dark.mjs`, `entry.mjs`). Clics « catalogue -> activé » : 1 (Installer et utiliser).

## Reste
1. Suite complète x2 verte (`/dev/shm/s7-work/full.sh N` -> scratchpad/skins-s7/fullN.txt ; run 1 : 11 échecs corrigés depuis, runs 2 et 3 en cours), eslint (base 103) et tsc.
2. Images : référence v0.3.1 (`docs/ideas/skins-s7-run/ref.sh`, VISUAL_ROOT=/dev/shm/s7-visual, ports 3550+, résultat /dev/shm/s7-baseline-031/READY) puis build de HEAD, capture par profil, `compare.mjs` : 0 pixel attendu.
3. Rapport final au coordinateur.

## Pièges
- Mots interdits par tests/modules-mgmt/no-embedded-modules.test.mjs (ex. readSnapshot) ; clés de traduction à insérer avant `theme.custom` ; `useRouter` ajouté au double de next/navigation ; ne pas utiliser les ports 3550-3555 pour d'autres serveurs pendant les captures ; `pkill -f` ne pas utiliser (tue son propre shell).
