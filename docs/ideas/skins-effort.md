# Skins : découpage en lots d'implémentation

Effort : **S** = 1 à 2 jours, **M** = 3 à 5 jours, **L** = 1 à 2 semaines (un agent). Risque = risque de **régression visuelle sur basic** (le rendu actuel doit rester identique pixel pour pixel, `docs/SKINS.md` §12) ou de régression fonctionnelle. Contrat : `docs/SKINS.md`.

## Lots

| Lot | Contenu | Effort | Risque visuel | Dépend de |
|---|---|---|---|---|
| **S0 Harnais d'images** | `scripts/skin-visual-diff.mjs` : captures de référence du cœur v0.2.14 + modules v1.22.0 (accueil et blocs, pages, listes, entrées, privacy, 404, menu ouvert, cookies, 4 `header.layout`, `data-accent2`/`data-surface`, palettes claire/sombre, une page par module à affichage public) × 390/768/1280/1920, comparaison 0 pixel. Données de test fixes. **À faire d'abord, sur master non modifié**, et à garder en CI manuelle. | M | — (c'est le filet) | — |
| **S1 Jetons + basic + composition** | `src/core/skins/` : types (`SkinManifest`, `SkinTokens`), vocabulaire de jetons (§4.2), `basic` (valeurs = anciens défauts), `composeSkin()` (4 couches, repli, modes, options, mono-mode si retouche, dérivation `buildPalette`), émission des `<style>` jetons ; `<html data-skin>` ; lecture de `skin.active` (absent = basic) ; **bascule clair/sombre du visiteur** (pièce `mode-switch`, `/skins/mode.js` externe bloquant, `localStorage`, variantes de logo `data-for`, déclaration `privacy` + `PRIVACY.md` + page de confidentialité) ; réglages `theme.palette` / `theme.light.*` / `theme.dark.*` | **M à L** (M avant : +2 jours pour la bascule et son script, +1 pour la déclaration privacy) | faible (aucun composant ne change encore) | — |
| **S2 DOM stable et mise en page** (lot majeur) | Coquille `shell` + régions (`backdrop`, `tray`, `banner`, `header`, `nav`, `tools`, `main`, `content`, `footer`), attributs `data-skin-part` sur toutes les pièces du §9.2, `main`/en-tête/pied qui lisent `--sk-page-*`, **déplacement des classes responsives du menu** (`SiteNav`, `MenuToggle`) vers la feuille du cœur avec `data-open`, accueil fluide en jetons, deux `<img data-for>` pour le logo | **L** | **élevé** : un wrapper de plus et des classes déplacées peuvent décaler d'1 px (marges, `position:relative` du menu, empilement `z-index`, focus). Le harnais S0 est le garde-fou ; viser 0 pixel, corriger avant de continuer. | S0, S1 |
| **S3 Composants du cœur par les jetons** | `@theme inline` avec repli de basic pour toutes les échelles utilisées (rayons, textes, espaces, ombres, graisses) ; pièces sémantiques (`--sk-radius-card`…) ; 14 couleurs noir/blanc et 8 valeurs arbitraires → jetons (`--sk-color-veil`…) ; règles `data-accent2` conservées ; test d'architecture (aucun utilitaire hors liaison) | M | moyen (~450 utilitaires ; faible par construction car le repli = valeur actuelle ; les 22 conversions manuelles sont le risque) | S0, S1 (parallèle à S2 sur des fichiers différents ; conflits dans `Header`/`SiteNav`/`Panel`, à ordonner) |
| **S4 Pièces des modules (mécanisme)** | clé `skin` du `module.json` (validation dans `manifest.ts`, additive, `minCore`), registre des pièces, jetons de module émis avant le skin, règle de conformité du kit des modules (conseil), doc `docs/MODULES.md`/`CREATE-A-MODULE.md` | M | nul (additif) | S1 |
| **S5 Installation depuis un dépôt** | client du catalogue de skins (`catalogue/index.json`, cache 15 min, `CURIOSA_SKINS_REPO`, `SKINS_INDEX_URL`), installateur (clone épinglé, validation, copie `DATA_DIR/skins/<id>/<version>/`, mise à jour atomique, retour arrière, retrait), route `/skins/<id>/<version>/*` (polices/images, nosniff, immutable), `skin.installed`, dépôt personnel avec confirmation, sauvegarde/restauration (réinstallation par `ref`), audit | **L** | nul pour basic | S1 (modèle : `src/core/modules/installer.ts`, `catalogue.ts`, `recognized.ts`) |
| **S6 Assainisseur de feuille + lisibilité** | PostCSS : liste blanche de sélecteurs/at-règles/propriétés/valeurs (§6), préfixe de portée, plafonds, renommage `@keyframes`, réécriture `url(skin:…)`, signatures de fichiers, `sanitizeSvg` ; contrôle de lisibilité (12 paires, échelle de correction §7.3) réutilisant `color.ts` ; corpus d'attaques | **L** | nul | S1 (la bibliothèque sert S5, S7, S8) |
| **S7 Page Apparence** | `/admin/appearance` (mobile d'abord, FR+EN, clés `skins.*`), choisir/aperçu/installer/mettre à jour/retirer/revenir au skin, options, notice de lisibilité, crédits/licences, aperçu admin `/admin/appearance/preview/<id>`, reprise de l'onglet Apparence de Réglages ; **édition des couleurs en un seul mode ou pour les deux modes** (onglets Clair/Sombre, aperçu des deux modes, avertissement de contraste en direct sous le champ) ; outils MCP lecture + demande | **L** (M à L avant : +3 jours pour l'édition des deux modes) | nul pour le public ; risque UX | S5, S6 |
| **S8 Kit de test + banc d'essai** | `testsupport/skins/` (`npm run skin:check`, `--visual`), `npm run skin:bench` (+ `skin:bench:refresh` : fragments générés des vrais composants), contrôle de l'ordre de lecture/tabulation, contraste rendu, quatre largeurs + points de rupture ; documentation `docs/CREATE-A-SKIN.md` | **L** | nul | S1, S2 (DOM stable), S6 (bibliothèque) |
| **S9 Conversion des modules** | par module (voir tableau ci-dessous) : `var(jeton-module, var(jeton-commun, valeur-actuelle))`, `data-skin-part`, clé `skin`, `skin.demo` ; un test de non-régression d'image par module (S0) ; mise à jour à chaud inchangée | S à L par module | **moyen à élevé** par module (CSS écrit à la main) ; faible si on ne change que des déclarations en gardant la valeur actuelle en repli | S0, S3, S4 (chaque module indépendant : **parallélisable**) |
| **S10 Documentation et tests de fond** | `docs/SKINS.md` mis à jour, `CHANGELOG`, neutralité (`.neutrality-terms`), `SECURITE.md`/`PRIVACY.md`/`BACKUP.md` | S | nul | tous |
| **S11 Les quatre skins** (dépôt `curiosa-skins`, hors cœur) | Brutaliste clair, Éditorial papier, Rétro néon / arcade, Verre / dégradés doux : chacun `skin.json` + `tokens.json` + `skin.css` + polices OFL + aperçus ; chacun validé par `skin:check --visual` ; captures pour le propriétaire | **M chacun** (4 agents en parallèle) | sans objet pour basic | S1, S2, S3, S6 minimum côté contrat ; mieux après S8 et la conversion des modules principaux |

### Conversion des modules (S9) : combien ?

Sur 70 modules : **~45 n'ont rien à convertir** (blocs du cœur) ; **19 ont du CSS public à convertir** (29 fichiers) ; 6 overlays et 8 pages autonomes hors portée V1.

| Taille | Modules | Raison |
|---|---|---|
| **L** | `planning` | 9 fichiers de CSS (7 mises en page), 24 couleurs en dur, déjà 5 rayons en variable ; apparences interchangeables à préserver |
| **M** | `events` (20 rayons, 84 espacements), `gallery`, `map`, `daily-game`, `videos` (29 couleurs en dur), `directory` (23), `polls`, `faq`, `thanks-wall`, `supporters`, `mascot` (19), `countdown`, `twitch-raid` (public) | CSS de 100 à 250 lignes chacun, couleurs en dur à reprendre pour 8 d'entre eux |
| **S** | `testimonials`, `live-status`, `commissions`, `content-planner`, `audience` | CSS court, presque tout en variables de couleur |

Priorité pour les captures du propriétaire : `events`, `gallery`, `planning`, `faq`, `videos`, `directory`, `polls`, `map`.

### Conversion des modules (S9) : mesure et procédure (lot S4)

**Mesure** (script `scripts/skin-module-census.mjs <dépôt de modules>`, lecture seule, `curiosa-extras` 1.22.1 avant conversion) : nombre de **déclarations dont la valeur est écrite en dur** dans le CSS public. Une valeur lue par `var(--v-…, repli)` n'est pas en dur (le repli d'une variable de palette est déjà un jeton) : les « couleurs en dur » du recensement initial étaient en fait des replis de variables ; presque tout ce qui reste à convertir est rayons, espaces, tailles de texte, ombres et durées. « À convertir en priorité » = couleurs + rayons + ombres + durées + écarts de grille (ce que les skins changent) ; les marges intérieures et les tailles de texte (colonnes « en dur » moins « priorité ») ne se convertissent que si un skin en a besoin. Taille : S ≤ 40 valeurs en dur dans 2 fichiers au plus, M ≤ 150 dans 4 au plus, L au-delà. Jours-agent indicatifs : 0,5 de base (lecture, jetons, test) + 0,01 par valeur en dur + 0,25 par fichier de CSS de plus + 0,1 par règle `[data-accent2]` (à traiter à part, voir `docs/MODULES.md`, piège n°2).

| Module | Fichiers de CSS | Valeurs en dur | dont à convertir en priorité | Rayons | Règles `[data-accent2]` | Taille | Jours indicatifs |
|---|---:|---:|---:|---:|---:|:-:|---:|
| `events` | 1 | 102 | 37 | 20 | 0 | M | 1.5 |
| `gallery` | 1 | 84 | 29 | 15 | 0 | M | 1.3 |
| `planning` | 11 | 240 | 99 | 27 | 3 | L | 5.7 |
| `map` | 1 | 71 | 25 | 13 | 0 | M | 1.2 |
| `polls` | 1 | 70 | 31 | 12 | 0 | M | 1.2 |
| `faq` | 1 | 58 | 16 | 8 | 0 | M | 1.1 |
| `directory` | 1 | 67 | 27 | 8 | 2 | M | 1.4 |
| `videos` | 1 | 72 | 29 | 15 | 4 | M | 1.6 |
| `daily-game` | 1 | 89 | 30 | 15 | 0 | M | 1.4 |
| `mascot` | 1 | 24 | 15 | 6 | 0 | S | 0.7 |
| `countdown` | 1 | 38 | 16 | 6 | 0 | S | 0.9 |
| `thanks-wall` | 1 | 40 | 15 | 6 | 2 | S | 1.1 |
| `supporters` | 1 | 36 | 12 | 7 | 0 | S | 0.9 |
| `testimonials` | 1 | 43 | 24 | 9 | 0 | M | 0.9 |
| `live-status` | 1 | 21 | 9 | 6 | 0 | S | 0.7 |
| `commissions` | 1 | 37 | 15 | 5 | 0 | S | 0.9 |
| `content-planner` | 1 | 31 | 14 | 7 | 0 | S | 0.8 |
| `twitch-raid` | 1 | 29 | 12 | 6 | 0 | S | 0.8 |
| `audience` | 1 | 17 | 6 | 4 | 0 | S | 0.7 |
| **19 modules** | 29 | **1169** | **461** | 195 | 11 | | **24.8** |

Pilote : `thanks-wall` 1.0.1 → 1.1.0 (taille S, 40 valeurs en dur dont 15 prioritaires ; **14 jetons et 6 pièces**, 7 valeurs converties : arrondis, bordures, ombres, surfaces, écarts de grille ; le reste, marges intérieures et tailles de texte, est resté à l'échelle du module). Le script estime ce module à 1,1 jour (module, test de non-régression, aperçu) ; la preuve d'image (0 pixel) demande une référence restreinte prise avec l'ancienne version du module (`--only merci`, 16 captures en quelques minutes).

**Procédure pour chaque module** (une branche et un test par module, parallélisable ; le détail et les pièges sont dans `docs/MODULES.md`, « Rendre un module stylable par les skins ») :

1. Lancer le recensement du module et noter les valeurs prioritaires ; lister 3 à 8 **pièces** (carte, liste, bouton, étiquette, en-tête de section…), pas une par classe.
2. Écrire la clé `skin` (pièces FR/EN, jetons `--sk-m-<module>-…`, défauts = valeurs d'aujourd'hui ou jeton commun **égal sous basic**), `minCore` `0.4.0`, version **mineure**, `skin-demo.html`.
3. Réécrire les valeurs en `var(jeton-du-module, var(jeton-commun, valeur-actuelle))` et poser `data-skin-part` sur chaque élément de pièce. Ne pas toucher aux règles conditionnelles (`[data-accent2]`, états) ni aux propriétés qui masquent ou déplacent.
4. Recopier le test de `thanks-wall` (`tests/thanks-wall-skin.test.mjs`) : réduction exacte à l'ancienne feuille, défauts = valeurs d'avant sous basic, pièces posées = pièces déclarées, aucun texte ajouté.
5. `npm run module:check -- modules/<id>` : aucun ❌ ; `CURIOSA_DIR=<cœur construit> node scripts/test.mjs` : `fail 0`.
6. Harnais d'images : référence prise avec l'ancienne version du module, candidate avec la nouvelle, sur le même cœur construit : **0 pixel** (`--only <page du module>`), clair et sombre. Un écart = soit une valeur de repli fausse (le test de l'étape 4 la désigne), soit un piège n°2 ou n°3.
7. Un fichier d'extrait de changelog (`docs/changelog-parts/<module>-skin.md`) : « prêt pour les skins, rien ne change pour vous ».

## Dépendances et parallélisation

```
S0 (harnais) ──┬─────────────┬───────────────┐
S1 (jetons) ───┤             │               │
               ├─ S2 (DOM) ──┼─ S8 (kit) ────┤
               ├─ S3 (jetons │               │
               │   composants)               ├─ S11 (4 skins)
               ├─ S4 (pièces modules) ─ S9 (modules ×19, en parallèle)
               ├─ S6 (assainisseur) ─┬─ S5 (installation) ─ S7 (Apparence)
               │                     └─ S8
               └──────────────────── S10 (docs)
```

- **Chemin critique** : S0 → S1 → S2 → S8 → S11 (≈ 4 à 5 semaines à un agent par lot).
- **En parallèle dès S1** : S3 (fichiers de composants différents de S2, mais conflits à ordonner dans `Header.tsx`, `SiteNav.tsx`, `Panel.tsx` : faire S2 d'abord pour ces trois fichiers ou les confier au même agent), S4, S6.
- **En parallèle ensuite** : S5 ‖ S6 ‖ S8 ; S9 module par module (19 agents possibles ; regrouper par 3-4).
- **S7** attend S5 et S6 (mais l'écran peut être maquetté avec des données de test dès S1).
- Un skin « jetons seuls » est utilisable dès **S1 + S3**, un skin avec mise en page dès **S2**, l'installation depuis un dépôt dès **S5 + S6**.

## Risques de régression visuelle sur basic, et parades

1. **S2 (wrapper, déplacement des classes responsives du menu)** : le plus risqué. Parades : harnais S0 à 0 pixel avant de fusionner ; wrapper `display:block` ; tests clavier du menu (`tests/core` existants du menu + test Playwright Tab/Échap) ; garder `data-testid` et repères existants.
2. **S3** : un utilitaire qui n'est pas dans `@theme inline` retombe sur la valeur Tailwind d'origine (donc sans régression) mais n'est pas skinnable : le test d'architecture le détecte.
3. **S9** : le CSS des modules est écrit à la main ; on ne change que les valeurs (repli = valeur actuelle). Test image par module ; la mise à jour d'un module n'est pas conditionnée au cœur (les repli littéraux fonctionnent sur un cœur sans skins ; `minCore` seulement pour la clé `skin`).
4. **Mode sombre/clair** (S1+S2) : logo à deux variantes piloté par le CSS du cœur, script bloquant `/skins/mode.js` (pas de flash ; risque : une requête bloquante de plus dans `<head>`, immutable) et `color-scheme` ; basic reste mono-mode (aucun changement pour les sites existants, aucune bascule rendue).
5. **Cache** : la sortie composée est mise en cache 10 min ; un changement de réglage doit invalider (clé de cache incluant le hash des retouches).

## Définition de « terminé » pour la publication (par le propriétaire)

basic identique à l'actuel (harnais S0, 0 pixel) ; installation, repli, contrôle de lisibilité, mise à jour, retour arrière, sauvegarde/restauration testés ; kit et banc d'essai fournis ; captures des quatre skins sur les vraies pages (clair/sombre, 390/768/1280/1920) montrées au propriétaire ; documentation et changelog ; rien n'est publié avant son accord.

## Recomptage après les décisions du propriétaire (cœur : nouvelle version majeure, `0.4.0` réservé)

- **S1** passe de M à **M à L** (bascule visiteur + script du cœur + déclaration de confidentialité + clés `theme.*` par mode).
- **S7** passe à **L** (édition des deux modes et aperçu).
- **S8** : +1 jour (contrôles de la bascule, rendu dans chaque mode après bascule). **S10** : +1 jour (PRIVACY.md, page de confidentialité, règle de version des modules).
- **S9** : règle de version : un module qui adopte `skin` sans changer son rendu par défaut = mineure ; avec changement visible = majeure (arbitré par le harnais S0).
- Total du chemin critique : inchangé en ordre de grandeur (S0, S1, S2, S8, S11 ≈ 5 semaines), S1 s'allonge de ~3 jours. La bascule n'a pas de dépendance sur S2 sauf l'emplacement dans `tools` (la pièce peut être posée dans `Header.tsx` dès S1, puis déplacée par S2).
- Vocabulaire : « skin » dans toutes les chaînes `skins.*` (FR+EN).
