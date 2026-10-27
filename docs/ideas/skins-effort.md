# Skins : découpage en lots d'implémentation

Effort : **S** = 1 à 2 jours, **M** = 3 à 5 jours, **L** = 1 à 2 semaines (un agent). Risque = risque de **régression visuelle sur basic** (le rendu actuel doit rester identique pixel pour pixel, `docs/SKINS.md` §12) ou de régression fonctionnelle. Contrat : `docs/SKINS.md`.

## Lots

| Lot | Contenu | Effort | Risque visuel | Dépend de |
|---|---|---|---|---|
| **S0 Harnais d'images** | `scripts/skin-visual-diff.mjs` : captures de référence du cœur v0.2.14 + modules v1.22.0 (accueil et blocs, pages, listes, entrées, privacy, 404, menu ouvert, cookies, 4 `header.layout`, `data-accent2`/`data-surface`, palettes claire/sombre, une page par module à affichage public) × 390/768/1280/1920, comparaison 0 pixel. Données de test fixes. **À faire d'abord, sur master non modifié**, et à garder en CI manuelle. | M | — (c'est le filet) | — |
| **S1 Jetons + basic + composition** | `src/core/skins/` : types (`SkinManifest`, `SkinTokens`), vocabulaire de jetons (§4.2), `basic` (valeurs = anciens défauts), `composeSkin()` (4 couches, repli, modes, options, mono-mode si retouche, dérivation `buildPalette`), émission des `<style>` jetons ; `<html data-skin>` ; lecture de `skin.active` (absent = basic) | M | faible (aucun composant ne change encore) | — |
| **S2 DOM stable et mise en page** (lot majeur) | Coquille `shell` + régions (`backdrop`, `tray`, `banner`, `header`, `nav`, `tools`, `main`, `content`, `footer`), attributs `data-skin-part` sur toutes les pièces du §9.2, `main`/en-tête/pied qui lisent `--sk-page-*`, **déplacement des classes responsives du menu** (`SiteNav`, `MenuToggle`) vers la feuille du cœur avec `data-open`, accueil fluide en jetons, `<picture>` du logo | **L** | **élevé** : un wrapper de plus et des classes déplacées peuvent décaler d'1 px (marges, `position:relative` du menu, empilement `z-index`, focus). Le harnais S0 est le garde-fou ; viser 0 pixel, corriger avant de continuer. | S0, S1 |
| **S3 Composants du cœur par les jetons** | `@theme inline` avec repli de basic pour toutes les échelles utilisées (rayons, textes, espaces, ombres, graisses) ; pièces sémantiques (`--sk-radius-card`…) ; 14 couleurs noir/blanc et 8 valeurs arbitraires → jetons (`--sk-color-veil`…) ; règles `data-accent2` conservées ; test d'architecture (aucun utilitaire hors liaison) | M | moyen (~450 utilitaires ; faible par construction car le repli = valeur actuelle ; les 22 conversions manuelles sont le risque) | S0, S1 (parallèle à S2 sur des fichiers différents ; conflits dans `Header`/`SiteNav`/`Panel`, à ordonner) |
| **S4 Pièces des modules (mécanisme)** | clé `skin` du `module.json` (validation dans `manifest.ts`, additive, `minCore`), registre des pièces, jetons de module émis avant le skin, règle de conformité du kit des modules (conseil), doc `docs/MODULES.md`/`CREATE-A-MODULE.md` | M | nul (additif) | S1 |
| **S5 Installation depuis un dépôt** | client du catalogue de skins (`catalogue/index.json`, cache 15 min, `CURIOSA_SKINS_REPO`, `SKINS_INDEX_URL`), installateur (clone épinglé, validation, copie `DATA_DIR/skins/<id>/<version>/`, mise à jour atomique, retour arrière, retrait), route `/skins/<id>/<version>/*` (polices/images, nosniff, immutable), `skin.installed`, dépôt personnel avec confirmation, sauvegarde/restauration (réinstallation par `ref`), audit | **L** | nul pour basic | S1 (modèle : `src/core/modules/installer.ts`, `catalogue.ts`, `recognized.ts`) |
| **S6 Assainisseur de feuille + lisibilité** | PostCSS : liste blanche de sélecteurs/at-règles/propriétés/valeurs (§6), préfixe de portée, plafonds, renommage `@keyframes`, réécriture `url(skin:…)`, signatures de fichiers, `sanitizeSvg` ; contrôle de lisibilité (12 paires, échelle de correction §7.3) réutilisant `color.ts` ; corpus d'attaques | **L** | nul | S1 (la bibliothèque sert S5, S7, S8) |
| **S7 Page Apparence** | `/admin/appearance` (mobile d'abord, FR+EN, clés `skins.*`), choisir/aperçu/installer/mettre à jour/retirer/revenir au skin, options, notice de lisibilité, crédits/licences, aperçu admin `/admin/appearance/preview/<id>`, reprise de l'onglet Apparence de Réglages ; outils MCP lecture + demande | M à L | nul pour le public ; risque UX | S5, S6 |
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
4. **Mode sombre/clair** (S1+S2) : `<picture>` du logo et `color-scheme` ; basic reste mono-mode (aucun changement pour les sites existants).
5. **Cache** : la sortie composée est mise en cache 10 min ; un changement de réglage doit invalider (clé de cache incluant le hash des retouches).

## Définition de « terminé » pour la publication (par le propriétaire)

basic identique à l'actuel (harnais S0, 0 pixel) ; installation, repli, contrôle de lisibilité, mise à jour, retour arrière, sauvegarde/restauration testés ; kit et banc d'essai fournis ; captures des quatre skins sur les vraies pages (clair/sombre, 390/768/1280/1920) montrées au propriétaire ; documentation et changelog ; rien n'est publié avant son accord.
