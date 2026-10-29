# Skins : passation (mise à jour pour la 0.4.0)

> **État : la version 0.4.0 du cœur livre le système de skins** (lots S1 à S8 et corrections d'intégration, branche `release/0.4.0`, fichiers de suivi supprimés). Les tableaux ci-dessous décrivent l'historique des lots ; ce qui reste vraiment à faire est la liste « Après la 0.4.0 » en bas de page.

Ce document permet de reprendre le chantier des skins sans la conversation d'origine. Les décisions du propriétaire sont dans `skins-decisions.md` (même dossier) ; le contrat est `docs/SKINS.md` ; le découpage en lots est `skins-effort.md`.

## État des branches (cœur : https://github.com/helldog136/Curiosa)

| Lot | Branche | Contenu | État |
|---|---|---|---|
| Conception | `feat/skins` | docs/SKINS.md, exploration, lots | fait |
| S6 | `feat/skins-s6` | assainisseur de feuilles de style, lisibilité (src/core/skins/) | fait, 5270 tests |
| S0 | `feat/skins-visual` | harnais d'images 0 pixel (scripts/visual/) | fait ; capture en série (un seul Chromium) |
| S1 | `feat/skins-s1` | jetons --sk-*, skin basic, composition, bascule clair/sombre | fait |
| S2+S3 | `feat/skins-s2` | DOM stable (régions, pièces), composants par les jetons | fait, 1 168 captures à 0 pixel |
| S5 | `feat/skins-s5` | installation des skins depuis un dépôt git | fait |
| S4 | `feat/skins-s4` | pièces de modules (clé `skin` du manifeste) | fait (module pilote : thanks-wall, curiosa-extras `feat/skins-pilot`) |
| Intégration | `feat/skins-int` | S1 à S5 fusionnés + master v0.3.1 | fait, 0 pixel, 7 599 tests |
| S7 | `feat/skins-s7` | page Apparence, retouches des deux modes, MCP | en cours |
| S8 | `feat/skins-s8` | kit `skin:check` complet, banc d'essai, gabarits, docs/CREER-UN-SKIN.md | en cours |

Skins (https://github.com/helldog136/curiosa-skins, une branche par skin, `main` ne contient que le README) : `skin/brutaliste-clair`, `skin/retro-neon`, `skin/editorial-papier`, `skin/verre-doux` : en cours. Fichier PROGRESS.md dans chaque branche.

## Reste à faire pour la version 0.4.0 (nouvelle majeure, décision du propriétaire)
1. Terminer S7 et S8 ; fusionner dans `feat/skins-int` (conflits attendus : locales, package.json, docs/SKINS.md, allowlist) ; refaire la preuve des 1 168 captures (référence v2 : worktree du tag v0.3.1, `visual:prepare` puis `visual:capture` en série, ~25 min).
2. Terminer les 4 skins, les montrer au propriétaire (captures dans le dossier de la galerie), publier le dépôt curiosa-skins (catalogue/index.json, README).
3. S9 : convertir les 18 autres modules à CSS public aux pièces de skin (estimation ~24 jours d'agent, planning = 6) ; plusieurs sous-sessions possibles, un module par sous-session ou par groupe ; chaque conversion prouvée à 0 pixel (harnais) et en version mineure (apparence par défaut inchangée) ; `minCore` 0.4.0.
4. S10 : docs finales ; version 0.4.0, CHANGELOG, release (PR integration → master, CI, fusion, release, alignement de dev), puis mise à jour des sites (sauvegarde, cœur, diagnostic).
5. Cinquième skin demandé par le propriétaire, à lancer EN DERNIER (après les autres chantiers) : « steampunk / victorien / Peaky Blinders » (cuivre, laiton, cuir, papier vieilli, bois sombre, engrenages ou damas en décor discret, serif d'époque, cadres ornés, colonne étroite à marges d'encadrement ; sombre par défaut, éventuel mode clair « parchemin » si AA tenable ; AUCUNE marque ni image d'une série).

## Règles de travail apprises
- /dev/shm est de la RAM : un seul clone de travail, nettoyer, une tâche lourde à la fois (verrou `flock /dev/shm/heavy.lock`), arrêter les serveurs de test par PID.
- Pousser après chaque jalon ; le conteneur a redémarré 3 fois.
- Commits en français avec les trailers `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` et `Claude-Session: …`.
- Jamais de publication sans les vérifications : CI verte, SHA complet de 40 caractères pour fusionner, release vérifiée, `dev` aligné sur `master`, sauvegarde avant mise à jour des sites, diagnostic après.
- Les travaux se font par SOUS-AGENTS (l'instruction « sous-sessions » a été retirée par le propriétaire).
- **Preuve visuelle complète (1 168 captures, 0 pixel)** : décision du propriétaire, elle n'a été exigée que pour la 0.4.0 (première version à toucher le rendu public). Pour les versions suivantes, ne la relancer QUE si le code de rendu public change (régions/pièces, `globals.css`, `layout.tsx`, composants du site public, jetons de `basic`) ou sur demande ; sinon, les tests et la CI suffisent. Un changement de texte seul n'en demande pas (deux phrases de la page Confidentialité ont d'ailleurs changé volontairement en 0.4.0 : 34 captures, expliquées).
- Les outils de pilotage des sites (MCP) se déconnectent parfois : les recharger par ToolSearch ; un appel `maintenance_modules_update_all` peut dépasser 60 s sans échouer côté site : ne pas le relancer, attendre (« Another maintenance operation is running » le confirme).

## Autres sujets ouverts
- Message à l'entreprise ChatDeck (module tiers) : prêt, guide `docs/PUBLIER-SON-MODULE.md` et dossier `starter/` de curiosa-extras en ligne sur master (cœur 0.3.1, modules 1.22.1).
- À faire par le propriétaire : cliquer « Tester la clé » dans le module « Jaquettes de jeux » (helldog136.be) pour confirmer la reprise de la clé RAWG.
- Évolution du contrat des modules envisagée : champ de manifeste pour déclarer les hôtes contactés (`network: [{ host, why }]`), non engagée.
- Phase 3 d'entretien (retrait du code `bundled` et des colonnes `enabled`) repoussée (`removeAfter` 0.4.99 depuis la 0.4.0) ; rappel programmé le 3 novembre 2026.
- Audit à faire si le propriétaire le souhaite : sauvegarde module par module (partie lisible manquante sur 50 modules sur 70) avec test de sauvegarde-restauration.

## Après la 0.4.0
- Dépôt curiosa-skins : une branche par skin (`skin/brutaliste-clair`, `skin/retro-neon`, `skin/editorial-papier`, `skin/verre-doux`), `catalogue/index.json` sur `main` avec des `ref` épinglés (étiquettes à poser par le propriétaire), README. Voir `docs/CREER-UN-SKIN.md` §procédure des étiquettes et `docs/SKINS.md` §25.
- S9 : convertir les modules à CSS public aux pièces de skin (un module par sous-session ou par groupe, preuve à 0 pixel, version mineure, `minCore` 0.4.0).
- Cinquième skin « steampunk / victorien » (voir plus haut), en dernier.
- Les points « Autres sujets ouverts » ci-dessus restent valables.
