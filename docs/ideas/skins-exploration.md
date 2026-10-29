# Skins : constats de l'exploration (cœur v0.2.14, modules v1.22.0)

Document de travail qui fonde `docs/SKINS.md`. Chiffres relevés par lecture du code et par `grep` (reproductibles ; commandes en fin de document). Ce qui n'a pas pu être vérifié est dit en fin de document.

## 1. Rendu du site public aujourd'hui

- **Pile** : Next.js 16.4.1, React 19.2.8, **Tailwind CSS 4.3.3** via `@tailwindcss/postcss` (`postcss.config.mjs`) ; `src/app/globals.css` (118 lignes) = `@import "tailwindcss"`, un `@theme inline` qui relie `bg-bg`, `text-fg`, `border-line`, `bg-accent`… aux variables `--v-*`, des valeurs par défaut `:root`, quelques règles de base (focus, `prefers-reduced-motion`), l'accueil fluide (`.vh-flow`, `.vh-cell`, `.vh-small|medium|large|full`), l'animation des boutons, le bandeau de cookies, et le bloc `[data-accent2]` / `[data-surface]` (15 règles) qui n'agit que si la personne a choisi un accent secondaire ou une surface.
- **Pas de CSS de composant** : 265 `className` dans `src/components/site` et `src/app/(site)`, tous en utilitaires. Pas de modules CSS.
- `globals.css` est importé par **deux** layouts : `src/app/(site)/layout.tsx` et `src/app/admin/layout.tsx`. L'administration partage donc le même Tailwind et se distingue par `adminThemeCss()` (`src/core/adminTheme.ts`, variables `--v-*` claires/sombres, indépendant du site). Conséquence de conception : toute liaison `@theme inline` vers des jetons doit avoir **un repli égal à la valeur actuelle**, pour que l'administration ne change pas.
- **Les overlays OBS** (`src/app/overlays/`) n'importent ni Tailwind ni `globals.css` : `<html>` transparent, `themeCss(theme)` + le CSS du module. Les pages autonomes de modules (stream-story, platform-links, audience/remote, twitch-raid dock, …) ont leur propre `<!doctype html>` : 8 occurrences dans `curiosa-extras/modules`.
- **Aucun en-tête CSP** (`docs/SECURITE.md`) : un `<style>` en ligne n'est pas bloqué, aucune règle `font-src`/`img-src` à adapter. Si un CSP est ajouté un jour, il faudra `font-src 'self'` et `img-src 'self'` (les polices et images des skins sont servies par le site).
- **Un seul mode** : il n'y a pas de `prefers-color-scheme` dans le site public. Clair ou sombre = luminance du fond choisi (`isDarkBackground`, seuil 0,4 ; `buildPalette` dérive tout). Le logo est choisi côté serveur (`pickLogo(…, dark)`). Un skin à deux modes oblige donc à (a) émettre les jetons des deux modes sous `prefers-color-scheme` et (b) rendre les deux variantes du logo et laisser le CSS du cœur choisir selon le mode effectif.

## 2. Réglages d'apparence existants (`theme.*`)

`src/core/settings.ts` (`getSiteConfig`) : `theme.background` (défaut `#121214`), `theme.accent` (`#e8a23b`), `theme.accent2`, `theme.surface`, `theme.text` (facultatifs, vides = dérivés), `theme.font` (`sans`|`serif`|`mono`, défaut `sans` ; piles dans `FONT_STACKS`), `theme.glow` (`none|soft|strong|custom`) + `theme.glow.custom`, `theme.bgPreset` (`none|dusk|grid|svg|custom`) + `theme.bgCustom` / `theme.bgImage` / `theme.bgSvg*`, `header.layout` (`classic|twoRows|centered|minimal`) + `header.socials|secondaryLabel|buttonLabel…`, `site.logo*`.

Constat important : **le site n'enregistre jamais l'identifiant d'une palette**, seulement les couleurs (`palettes.ts`). Les 15 `THEME_PRESETS` (cinq couleurs) ne sont que des raccourcis de saisie. C'est ce qui rend la migration sans donnée possible : les clés `theme.*` deviennent les « retouches » ; absentes, elles prennent la valeur du skin (basic = les anciens défauts).

`buildPalette(background, accent, extra)` (`color.ts`) dérive `fg`, `surface`, `muted` (≥ 4,5:1 sur bg et surface), `line` (`mix(bg, fg, 0.16)`), `accent-fg`, états (`success|warning|danger` + `-fg`, versions claire/sombre rapprochées du texte par `reach()`), `accent2(-fg)`, `gradient`. `contrastIssues()` avertit sur texte/fond (4,5) et accent/fond (3) ; `contrast()`, `mix()`, `textOn()` existent déjà : le contrôle de lisibilité des skins les **réutilise**. Le fond de page (`background.ts`) est déjà un format JSON borné de ≤ 6 couches (dégradés, points, grille, taches, SVG assaini par `svg.ts`, image) ; un skin peut en fournir par `defaults.background`. Remarque vie privée : `isBackgroundImage` accepte une image `https://…` : c'est une exception déjà existante pour la personne, que les skins ne reproduisent pas.

Les modules reçoivent le thème par `ctx.theme` et `ctx.api.brand()` (couleurs hex + police) et des réglages `color` à défaut `"theme:accent"` ; ce contrat public (`--v-*`, `ctx.theme`) doit rester inchangé.

## 3. Composants du site public (mesures)

Sur `src/components/site/*.tsx` (19 fichiers, 1 381 lignes) + `src/app/(site)/**` :

| Famille | Occurrences | Passe par une variable aujourd'hui ? |
|---|---:|---|
| couleurs (`bg-bg`, `text-muted`, `border-line`, `bg-accent`…) | ~majorité | oui (`--v-*`) |
| couleurs en dur : `bg-black`/`text-white`/`border-white`/`bg-white` (+ `/55`) | 14 | non (voile sur image, boutons sur voile) |
| `rgba(0,0,0,0.18)` | 1 | non |
| rayons `rounded-*` | 57 | non (échelle Tailwind) |
| tailles de texte `text-xs…5xl` | 82 | non |
| espacements (`p/m/gap/space-y-*`) | 217 | non (mais Tailwind 4 = un multiplicateur `--spacing`) |
| bordures (`border*`) | 109 | couleur oui, épaisseur non |
| ombres `shadow*` | 10 | non |
| largeurs `max-w-*` | 16 (dont `max-w-5xl` du contenu et de l'en-tête) | non |
| graisses `font-*` | 50 | non |
| `transition*` | 11 | non |
| cibles tactiles (`min-h-11`, `h-9`, `w-9`…) | 17 | non |
| valeurs arbitraires `[13px]`, `[15px]`, `[90vh]`, `[0.9em]` | 8 | non |

Constat clé : **Tailwind 4 écrit ses échelles en variables** (`--radius-xl`, `--text-sm`, `--spacing`, `--shadow-lg`, `--font-weight-*`), donc les remplacer par `var(--sk-…, valeur-actuelle)` dans `@theme inline` fait passer ~450 utilitaires par des jetons **sans changer une ligne de composant** et sans changer le rendu. Ce qui exige un vrai travail : le balisage de mise en page (voir §4), les 14 couleurs noires/blanches, les 8 valeurs arbitraires.

## 4. Mise en page imposée en dur dans le DOM (ce qui doit devenir pilotable)

`src/app/(site)/layout.tsx` rend : `<div class="cbg">` (fond), lien de saut, bandeau de cookies, blocs `layout.banner`, `<Header>`, `<main class="mx-auto max-w-5xl px-4 py-10">`, `<Footer>`, balise de visites. **Pas de conteneur commun** : une grille de page ne peut pas être posée sans wrapper.

- `Header.tsx` : 4 variantes (`classic`, `twoRows`, `centered`, `minimal`) avec balisage différent ; `shell = "mx-auto max-w-5xl px-4 py-4"` ; le menu `minimal` est un autre composant (`MenuToggle`, JS).
- `SiteNav.tsx` : le menu mobile/bureau est fait de **classes responsives dans le JSX** (`max-sm:absolute max-sm:inset-x-0…`, `sm:hidden`, `sm:absolute sm:left-0…`) + de l'état React qui ajoute `hidden`/`flex`. Un skin ne peut pas re-exprimer cela en CSS ; il faut déplacer ces règles dans la feuille du cœur (sélecteurs `data-skin-part`, état `data-open`) avec le même seuil (`sm` = 40 rem). Les `@media` ne pouvant pas lire de variable, les points de rupture d'un skin sont écrits en dur dans sa feuille et déclarés dans son manifeste.
- `Footer.tsx` : `max-w-5xl px-4 py-8`. `Blocks.tsx` : pile `space-y-6`, pas de région.
- `Panel.tsx` : `rounded-2xl px-6 py-10 sm:px-10`, collage d'images avec positions en pourcentages, boutons à trois styles (`BUTTON_STYLES`), voile `bg-black/55`.
- Accueil : `.vh-flow` / `.vh-cell` / `.vh-small…` dans `globals.css`, tailles en `rem` en dur.
- Repères déjà stables : `data-card` (5 occurrences), `data-btn="primary"` (3), `data-chip` (2), `data-marker` (2), `data-stat` (2), `data-testid="panel"` + `data-kind`/`data-on`, `data-header-layout`, `data-site-nav`, `data-pagination`, `role="tab"` + `aria-selected`. Ils servent aux règles `data-accent2` ; `tests/core/components-colors.test.mjs` verrouille certains d'entre eux (à conserver).

## 5. Les modules (70 dans `curiosa-extras` v1.22.0)

Trois catégories :
1. **Sans HTML public propre** (~45 sur 70 : connecteurs, réseaux sociaux, `blog`, `links`, `pages`, `sponsors`, `hero`, `contact-form`, `game-covers`, `twitch-*`…) : ils renvoient des blocs du cœur (`entries`, `hero`, `panel`, `links`, `form`, `markdown`) ; ils suivront le skin **sans changement**.
2. **HTML et CSS propres sur le site public** (~19 modules, 29 fichiers de CSS) : `events`, `gallery`, `planning` (9 fichiers de CSS : `index`, `kit`, 6 mises en page, aperçu), `map`, `polls`, `faq`, `directory`, `videos`, `daily-game`, `mascot`, `countdown`, `thanks-wall`, `supporters`, `testimonials`, `live-status`, `commissions`, `content-planner`, `twitch-raid` (page publique), `audience`. Ils émettent `{ type: "html", html: "<div class=\"ev\"><style>…</style>…" }` : CSS en ligne, **non rangé en `@layer`**, classes préfixées (`.ev-`, `.gal-`, `.cpl-`…).
3. **Overlays OBS et pages autonomes** (6 overlays : `alerts-overlay`, `ticker-overlay`, `maze-overlay`, `sponsor-ticker`, `countdown`/`polls` en partie ; 8 documents `<!doctype html>`) : hors portée des skins en V1.

Mesure sur les 29 fichiers de CSS de la catégorie 2 :

| Famille | Total | Dont via variable |
|---|---:|---|
| `var(--v-…)` (couleurs de thème) | **719** | — (bien tokenisé : environ 82 % des couleurs) |
| couleurs hexadécimales en dur | **140** | 0 |
| `rgb()/rgba()/hsl()` en dur | 14 | 0 |
| `border-radius` | **196** | 5 (planning seulement) |
| `font-size` | **222** | 0 |
| `padding/margin/gap` | **831** | 0 |
| `font-weight` | 185 | 0 |
| `box-shadow` | 23 | 0 |

Par module (hex / `var(--v)` / rayons / tailles / espacements) : `videos` 29/53/15/10/49, `directory` 23/48/8/16/39, `mascot` 19/25/6/3/11, `planning` (index+kit) 24/46/19/24/58, `thanks-wall` 16/32/6/10/24, `twitch-raid` 13/23/6/5/19, `supporters` 12/25/7/5/26, `countdown` 8/21/6/14/26 ; `events` 0/78/20/15/84, `gallery` 0/56/15/10/68, `map` 0/57/13/9/54, `daily-game` 0/68/15/14/64 sont entièrement en variables de couleur mais 100 % en dur pour le reste. Les **couleurs en dur** à convertir sont donc concentrées dans 8 modules ; les **rayons/tailles/espacements** concernent les 19.

Le HTML des modules n'a **pas** de `data-skin-part` : il faut en ajouter (attribut seulement, pas de changement de contenu) et déclarer les pièces dans `module.json` (clé `skin`, nouvelle, facultative, additive).

## 6. Familles de « pièces » visuelles récurrentes

carte (`data-card`, `.ev-card`, `.gal-*`, `.cpl-card`, `.dr-*`, `.vl-*`), bouton (plein, contour, pilule, sur voile, sur accent), pastille/chip (liens, filtres, vues), étiquette/badge (date, expiré, langue, tag), champ (recherche, formulaires), liste (filets, grille, pastilles), tableau (bloc `table`, Markdown), en-tête/pied/menu/sous-menu/pagination/onglets, bandeau (bannière d'état, cookies), séparateur (`hr`, `divide-y`), titre/petite ligne/chiffre clé, citation, code (en ligne, bloc, copier), image/couverture/avatar, pastille de nouveauté, panneau (5 sortes), héros (2 sortes), carte-vue modulaire (agenda, carte, sondage, FAQ…). Liste normalisée : `docs/SKINS.md` §9.2.

## 7. Ce qui limite la « radicalité » d'un skin aujourd'hui

1. Les rayons, tailles, espacements, ombres des composants du cœur et des modules ne sont pas des variables (corrigé par la liaison `@theme inline` et la conversion des modules).
2. Pas de conteneur de page : impossible d'agencer en colonne latérale ou en grille (corrigé par la région `shell`).
3. Menu mobile fait de classes JSX, pas de CSS stylable (corrigé : règles déplacées dans la feuille du cœur).
4. Un seul mode, logo choisi côté serveur (corrigé : deux modes + bascule du visiteur + variantes de logo gérées par le cœur).
5. CSS des modules en ligne et sans `@layer` : un skin doit gagner par la spécificité (prefix `:root[data-skin="…"]`, `(0,2,0)` plancher).
6. Les 140 couleurs en dur de 8 modules ne suivent aucun skin.

## 8. Ce qui n'a PAS pu être vérifié

- Aucun build ni rendu n'a été lancé (pas de `node_modules` dans le clone ; pas de cœur de référence construit) : les valeurs « basic = identique » reposent sur les valeurs par défaut de Tailwind 4 que je cite de mémoire (`--radius-xl: .75rem`, `--text-sm: .875rem`, `--spacing: .25rem`, `shadow-lg`…). **À vérifier en lisant le CSS compilé** avant d'écrire basic.
- Je n'ai pas confirmé l'ordre exact des `<style>`/`<link>` que Next 16 produit dans `<head>` (la conception évite d'en dépendre : feuille non rangée en `@layer`, spécificité plancher).
- Les décomptes de CSS de modules sont des `grep` sur les fichiers nommés (lignes de CSS et déclarations), pas un parseur : ordre de grandeur fiable, pas exact au chiffre près. Les modules `contacts`, `stream-story`, `home-assistant`, `youtube-*` ont du CSS d'**administration** (non compté).
- Je n'ai pas lu les 70 modules : 25 ont été examinés (CSS, vues, manifestes). Les catégories 1 et 3 viennent de `module.json`/greps.
- Le comportement exact de la restauration de sauvegarde pour de nouveaux réglages (`src/core/backup`) n'a pas été relu en détail.

## Commandes de mesure

```
grep -c className src/components/site/*.tsx
grep -rhoE "rounded(-[a-z0-9]+)?\b" src/components/site "src/app/(site)" | wc -l
# modules : script /dev/shm/tmp-skins/measure.sh (grep des déclarations CSS par fichier)
```
