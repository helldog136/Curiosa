# Je crée mon skin en 30 minutes

Ce guide s'adresse à **une personne (ou une IA qui travaille pour elle) qui veut offrir un skin à des sites Curiosa**, dans **son propre dépôt git**. Un skin est l'apparence complète d'un site : couleurs, polices, formes, **mise en page**. Il ne touche jamais au contenu. Le contrat complet est dans [SKINS.md](SKINS.md) ; ici, le chemin le plus court, de zéro à « mes utilisateurs l'installent », calqué sur [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md).

> *English summary at the end of this page.*

## Le principe, en cinq phrases

1. Un skin est **un dossier de données** : un `skin.json`, un `tokens.json` (les valeurs), un `skin.css` (la mise en page et les formes) et, si vous voulez, des polices et des images **dans le dossier**. Il n'y a **aucun programme** : pas de JavaScript, pas de composant, rien à compiler.
2. **Un skin ne définit que de l'APPARENCE.** Le contenu et la structure d'une page ne dépendent jamais de lui : on change de skin à tout moment, à l'infini, sans rien perdre ni réécrire. C'est la règle qui évite l'erreur des thèmes de Grav (qui apportaient leurs propres blocs et rendaient tout changement de thème impossible).
3. **La mise en page, elle, est de l'apparence** : vous pouvez tout changer de ce qu'on voit (menu en colonne latérale, en-tête en bandeau, grille de cartes, héros plein écran, colonnes, marges…), **pour les mêmes éléments**.
4. Curiosa **vérifie votre skin tout seul** (kit de test, une commande) avant qu'il soit installé : il refuse ce qui masque, ajoute du texte, appelle un autre site ou se lit mal. Les mêmes contrôles tournent sur votre machine et dans votre dépôt.
5. Vos utilisateurs collent **l'adresse de votre dépôt** dans l'administration (**Apparence → Ajouter depuis une adresse**). Aucune inscription chez nous. Être au catalogue officiel est facultatif.

## 1. Ce qu'il vous faut (5 minutes)

- **Node 22** et **git**.
- Un dépôt **public** sur GitHub, GitLab, Codeberg ou Bitbucket.
- Le **cœur de Curiosa cloné à côté** : il ne sert qu'à **tester** (le kit en fait partie). Vous ne lancez pas de site.
- Pour le contrôle **dans un navigateur** (fortement conseillé) : Chromium et le module `playwright` (`npm install --global playwright && npx playwright install chromium`).

```bash
git clone --depth 1 https://github.com/helldog136/Curiosa ../Curiosa          # ajoutez --branch vX.Y.Z pour une version précise
(cd ../Curiosa && npm ci --ignore-scripts && npx prisma generate)           # une fois ; ne lance pas le site
```

## 2. Le plus simple : copiez le dépôt de départ

Le dossier [`docs/skin-starter/`](skin-starter/) du cœur est **un dépôt de skin complet et valide** (il passe `skin:check --visual --strict`). Copiez-le dans votre dépôt :

```
mon-depot/
├── skins/mon-skin/          LE SKIN (le dossier et l'id de skin.json portent le même nom)
│   ├── skin.json            qui est le skin
│   ├── tokens.json          les valeurs (couleurs, polices, arrondis, largeurs…)
│   ├── skin.css             la mise en page et les formes
│   ├── previews/            deux captures 1280 × 800 (le banc d'essai les fabrique)
│   ├── README.md  LICENSE
├── docs/skin.commente.jsonc le skin.json expliqué ligne par ligne (JSON n'accepte pas les commentaires)
├── .github/workflows/ci.yml le contrôle automatique à chaque envoi (contre la dernière version publiée du cœur)
├── README.md  LICENSE  .gitignore
```

Plusieurs skins dans un dépôt : un dossier chacun sous `skins/`. Un seul skin : mettez son contenu à la racine (l'adresse n'a alors pas de `:dossier`).

Dans le dossier du skin, **seuls ces fichiers existent** (tout le reste est refusé) : `skin.json`, le fichier de jetons, la feuille de style, `README.md`, `LICENSE`, et les dossiers `fonts/`, `images/`, `previews/`, `LICENSES/` (un seul niveau).

## 3. Les trois fichiers

### `skin.json` : qui est le skin

La copie annotée du fichier est dans `docs/skin-starter/docs/skin.commente.jsonc`. L'essentiel : `id` (identique au nom du dossier), `name` et `description` **dans les deux langues**, `version` (égale à l'étiquette git), `minCore`, `license` (MIT, Apache-2.0, BSD, ISC, CC0, CC-BY, CC-BY-SA ou OFL-1.1), `modes` (`["light"]`, `["dark"]` ou les deux), `previews` (WebP 1280 × 800, 150 Ko au plus, `alt` obligatoire), `assets` (chaque police ou image, avec sa licence), `breakpoints` (les largeurs où **votre** mise en page change).

### `tokens.json` : les valeurs

```json
{
  "light": { "--v-bg": "#fbfaf7", "--v-surface": "#ffffff", "--v-fg": "#1c1b1f", "--v-accent": "#5b3fd6" },
  "dark":  { "--v-bg": "#17161b", "--v-surface": "#211f27", "--v-fg": "#f1eff5", "--v-accent": "#b9a6ff" },
  "common": { "--sk-radius-card": "0.75rem", "--sk-page-width": "46rem", "--sk-font-heading": "Georgia, serif" },
  "modules": {}
}
```

Les **quatre couleurs de base** (`--v-bg` fond, `--v-surface` cartes, `--v-fg` texte, `--v-accent` marque) sont **obligatoires dans chaque mode** déclaré ; Curiosa calcule le reste (texte secondaire, filets, texte des boutons, couleurs d'état). Les autres jetons (`--sk-…`) sont facultatifs : tailles de texte, arrondis, bordures, ombres, largeurs, espacements, durées… La liste complète, avec la valeur de basic, est dans [SKINS.md §4.2](SKINS.md). Un jeton inconnu est **ignoré** (le kit vous le dit). Les valeurs ne sont que du texte CSS court : pas de `url()` autre que `url(skin:…)`.

### `skin.css` : la mise en page et les formes

Chaque règle vise une **région** (`[data-skin-region="header"]`) ou une **pièce** (`[data-skin-part="card"]`) : les noms sont fixes, listés dans [SKINS.md §9](SKINS.md) et **tous montrés par le banc d'essai**. Ni classe, ni identifiant, ni `body`, ni `*`. Curiosa préfixe chaque sélecteur pour que rien ne sorte de votre skin. Exemple (colonne latérale à gauche, à partir de 40 rem) :

```css
@media (min-width: 40rem) {
  [data-skin-region="shell"] { display: grid; grid-template-columns: 16rem minmax(0, 1fr); grid-template-areas: "header main" "header footer"; }
  [data-skin-region="header"] { position: sticky; top: 0; align-self: start; }
}
```

À savoir (détails dans [SKINS.md §25](SKINS.md)) :

- **Boîtes des modules** : `div`, `span`, `section`, `article` et `[data-marker]` ne se ciblent que **sous** `[data-skin-part="module-html"]` (`[data-skin-part="module-html"] > div`). Partout ailleurs, visez la région ou la pièce.
- **Cartes** : `--sk-card-pad` règle leur remplissage (alignez vos filets dessus) et `[data-skin-part="card-body"]` désigne la zone de texte des cartes à image.
- **Dégradé du second accent** : si vous ne le voulez pas, `"--sk-gradient": "flat"` dans `tokens.json`. S'il reste actif, le kit contrôle la seconde couleur et le texte du panneau d'appel à l'action posé dessus.
- **Refusés, et par quoi les remplacer** : `:first-of-type` → `:first-child` ou `:nth-of-type(1)` ; `line-height` sous 0,8 → 1,2 ; `float` → `display: grid` ou `flex` ; `[data-site-nav]` → `[data-skin-region="nav"] [data-skin-part="nav-list"]`. Un sélecteur fait 600 caractères au plus (factorisez avec `:is()`).
- **Notes** : `PROGRESS.md`, `NOTES.md`, `TODO.md`, `CHANGELOG.md`, `CONTRIBUTING.md` peuvent rester à la racine du skin : ils ne sont ni lus ni installés.

## 4. Les règles, et pourquoi

| Vous pouvez | Vous ne pouvez pas (le kit refuse) | Pourquoi |
|---|---|---|
| Couleurs, polices, tailles, graisses, interlignes, espacements, rayons, bordures, ombres, lueurs, dégradés, motifs, images **embarquées** | Charger une police, une image ou une feuille **d'un autre site** (Google Fonts, CDN…) | Vie privée : le visiteur ne contacte jamais un tiers |
| **Changer la mise en page** : grille, colonnes, en-tête en colonne ou en bandeau, menu en pilules, cartes en maçonnerie, largeur du contenu, héros, densité, **ordre visuel** | Ajouter, retirer, renommer ou **masquer** un lien, un bouton, un champ, un titre, un texte, une image, une pastille, le crédit « Propulsé par » ou le lien Confidentialité | Un skin qui disparaît se remplace par basic **sans rien perdre** |
| Décorer avec `::before` / `::after` **vides** ou de la ponctuation (`"·"`, `"—"`) | **Du texte injecté** : `content` avec une lettre ou un chiffre, `attr()`, `counter()` | Un skin ne change jamais un libellé |
| Animer, avec un mouvement court, **sous** `@media (prefers-reduced-motion: no-preference)` | Une animation qui clignote ou qui boucle sans fin et gêne la lecture ; un mouvement qui échappe à « moins de mouvement » | Accessibilité |
| Réordonner visuellement avec `order`, `grid-area`… **sans casser** l'ordre de lecture et de tabulation | Un menu à l'envers, une grille dont le clavier saute partout | Un clavier ou un lecteur d'écran suit le DOM |
| Changer l'apparence du menu mobile (le bouton « Menu », la liste, les sous-menus) | Retirer le moyen d'ouvrir le menu, changer son comportement (le JavaScript est celui du cœur) | Le menu doit rester utilisable |
| Un texte lisible : contraste **AA** dans chaque mode (4,5 pour le texte, 3 pour les grands titres et le cadre de focus) | Un texte pâle, un focus invisible (`outline: none` sans remplacement), des cibles minuscules | Un skin illisible ne doit enfermer personne |
| Vos règles de pièces de modules (`[data-skin-part="mon-module.carte"]`) | Cibler une classe d'un module, restyler l'administration, les overlays OBS ou les pages autonomes | Seules les régions et pièces déclarées sont stables |

La règle pour trancher : **« si on retire le skin, la personne perd-elle une information ou une action ? »** Oui : c'est interdit. Elle ne perd qu'une impression : c'est permis.

## 5. Les 30 minutes, pas à pas

1. **(5 min) Copiez** `docs/skin-starter/` dans votre dépôt. Renommez `skins/mon-skin` **et** l'`id`. Mettez votre nom, votre licence (le fichier `LICENSE` aussi).
2. **(5 min) Couleurs et formes** : changez les quatre couleurs de chaque mode dans `tokens.json`, la largeur (`--sk-page-width`), les rayons, la police des titres.
3. **(10 min) Mise en page** : dans `skin.css`, changez l'en-tête, le menu, la grille des cartes. À chaque modification, rechargez le banc d'essai :

   ```bash
   cd ../Curiosa
   npm run skin:bench -- ../mon-depot/skins/mon-skin          # http://127.0.0.1:3560/__bench/
   ```

   Le **banc d'essai** est une page locale (sans installer de site, sans base de données) qui montre **toutes les régions et toutes les pièces**, fabriquées par les vrais composants du cœur, en clair et en sombre, aux largeurs 390 / 768 / 1280 / 1920 px (et les vôtres), avec les quatre mises en page d'en-tête, le menu ouvert et le bandeau de cookies. Le skin est relu à chaque chargement : modifiez un fichier, rechargez.
4. **(5 min) Contrôlez** :

   ```bash
   npm run skin:check -- ../mon-depot --visual
   ```

   Tout ce qui est ❌ est à corriger (le message dit **quoi**, **pourquoi** et **comment**) ; ⚠️ est à corriger ensuite ; 💡 est un conseil (`--advice`).
5. **(3 min) Aperçus** : `npm run skin:bench -- <skin> --previews <skin>/previews` écrit `home-light.webp` et `home-dark.webp` (1280 × 800, moins de 150 Ko) et vous donne le bloc `previews` à copier dans `skin.json`.
6. **(2 min) Publiez** : voir la [section 9](#9-publier).

## 6. Polices, images et licences

- **Une police** : un fichier `.woff2` dans `fonts/` (150 Ko au plus, 4 polices et 400 Ko au total), **déclarée dans `assets`** avec `family`, `weight`, `style`, `license`, `licenseFile` (le texte de la licence, dans `LICENSES/`), `author` et `source`. Puis un `@font-face` **tout en haut** de `skin.css` : `src: url(skin:fonts/ma-police.woff2) format("woff2")`, et la famille dans `--v-font` ou `--sk-font-heading`. N'embarquez que des polices dont la licence le permet (OFL-1.1 est la plus courante).
- **Une image** : `png`, `webp`, `avif`, `jpg` (200 Ko) ou `svg` (30 Ko, nettoyé par Curiosa : pas de script), 12 au plus, 1,2 Mo au total, déclarée dans `assets`, appelée par `url(skin:images/motif.svg)`. Jamais une image qui **porte une information** (un texte dessiné) : c'est du décor.
- Le kit vérifie : l'extension **et** le contenu du fichier (une police qui n'en est pas une est refusée), les plafonds, les licences (liste permise), la présence du fichier de licence, les polices et images **inutilisées**, et — dans le navigateur — que **la police se charge vraiment**.
- **Aucune** ressource d'un tiers, jamais : ni police, ni image, ni feuille.

## 7. Lisibilité

Curiosa contrôle, **dans chaque mode**, 12 paires de couleurs (texte/fond, texte/cartes, texte secondaire, texte des boutons, liens, couleur principale, cadre de focus, états, titres…). **AA est obligatoire** (le skin est refusé en dessous), **AAA est un conseil** (`--advice`). Le message donne la couleur à essayer : « Le texte serait trop pâle sur ce fond. Essayez `#1d1d21`. » Au rendu, si une retouche de la personne rend une paire illisible, Curiosa corrige la couleur ; si rien ne suffit, le mode concerné de votre skin est **suspendu** et basic s'applique.

Le niveau navigateur contrôle en plus le contraste **réellement rendu** : pour chaque texte, la couleur du texte contre les pixels qu'il y a vraiment derrière (dégradé, motif, image, flou). Un `backdrop-filter` (verre dépoli) est testé **avec et sans** l'effet : le fond doit rester lisible sans lui.

## 8. Les tests : `skin:check`

```bash
npm run skin:check -- <dossier> [--visual] [--shots <dossier>] [--modules <dossier>] [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z] [--neutrality <fichier>] [--lock <fichier>]
```

`<dossier>` : un skin (il contient `skin.json`) ou un dépôt de skins (`skins/<id>/skin.json` : tous sont contrôlés). Code de sortie : **0** tout va bien · **1** au moins un skin refusé (ou un avertissement avec `--strict`) · **2** mauvais usage. `--json` : le même rapport pour une machine.

### Les huit niveaux

| Niveau | Ce qui est contrôlé |
|---|---|
| **Manifeste** | `skin.json` valide ; `id` = dossier ; FR + EN ; version, contrat, `minCore` ; licence ; étiquettes ; `modes` ; aperçus avec `alt` |
| **Ressources** | chaque fichier de `fonts/` ou `images/` est listé, chaque fichier listé existe ; signatures ; plafonds ; SVG nettoyé ; licences ; aperçus 1280 × 800 ; polices et images utilisées ; LICENSE, README |
| **Jetons** | couleurs de base par mode ; type de chaque valeur ; jetons inconnus ; jetons de pièces de modules (`--modules`) ; corrections de lisibilité que Curiosa devrait faire |
| **Feuille** | sélecteurs, at-règles, propriétés, valeurs, plafonds ; animations hors `prefers-reduced-motion` ; points de rupture non déclarés ; cibles, interligne et taille de texte réglés trop bas |
| **Principe fondateur** | aucun masquage, aucun texte injecté, aucune région ou pièce inventée ; **dans le navigateur** : rien de masqué, recouvert, repoussé hors de l'écran ou ajouté par rapport à basic |
| **Lisibilité** | les 12 paires WCAG AA par mode ; AAA en conseil ; **dans le navigateur** : contraste rendu |
| **Neutralité** | aucun nom de site, d'association ou de ville dans les textes (liste locale : `--neutrality`, variable `NEUTRALITY_TERMS` ou `.neutrality-terms`) |
| **Navigateur** (`--visual`) | voir ci-dessous |

### Le niveau navigateur (`--visual`)

Curiosa lance, **sur votre machine**, un site de démonstration minimal avec votre skin (la vraie coquille du site, les vrais composants, la feuille composée comme le fait le site) et un vrai Chromium. Il photographie les pages-types — **accueil, blog (liste), article, formulaire, page introuvable, confidentialité** — à **390, 768, 1280, 1920 px** (et vos `breakpoints`), **en clair et en sombre**, et vérifie :

- **mêmes textes, liens, images, titres et éléments cliquables que sous le skin de base** ; rien de masqué, **recouvert** par un décor, hors de l'écran ; **aucun texte ajouté** ;
- **l'ordre visuel suit l'ordre de tabulation** (mesure ci-dessous) ;
- **cibles** : un élément cliquable de moins de 24 px est une erreur (hors liens dans un paragraphe) ; sous 44 px sur téléphone, un avertissement ; **taille du texte** (12 px minimum partout, 14 px conseillé pour le texte courant) et **interligne** (1,4 au moins sur plusieurs lignes) ;
- **indicateur de focus** visible : on atteint chaque élément avec Tab, on compare la capture avec et sans focus ; rien qui change = erreur ; un changement sous 3:1 = avertissement ;
- **contraste rendu** (voir §7) ; **aucun défilement horizontal** ; pas de texte coupé ;
- **menu mobile** : le bouton « Menu » se touche, la liste s'ouvre et ses liens sont visibles, Échap la referme ; sur grand écran, le sous-menu s'ouvre au survol ; si le skin masque le bouton « Menu » (permis), la liste doit alors être visible d'emblée ;
- **bascule clair/sombre** (skin à deux modes) : la pièce est visible aux quatre largeurs, ses trois boutons se touchent, basculer ne change **que** les couleurs (aucun texte, aucun élément) ;
- **mouvement réduit** : rien ne bouge quand la personne a demandé moins de mouvement ;
- **aucune requête extérieure** : toute adresse qui n'est pas celle du site de démonstration est une erreur ; **polices embarquées effectivement chargées** ;
- **régression de basic** : la page de basic est comparée, **pixel pour pixel**, à la même page avec les seules couleurs d'origine du site (avant les skins) : **0 pixel** de différence.

**Une règle que basic enfreint aussi** (par exemple les petites icônes de réseaux de l'en-tête) n'est reprochée à votre skin que s'il fait **pire** ; la même constatation est alors donnée en conseil, avec « le skin de base fait pareil ».

`--shots <dossier>` garde toutes les captures (PNG). `--lock <fichier>` attend un verrou (`flock`) avant de lancer Chromium : utile quand plusieurs contrôles tournent sur une même machine. `--widths 390,1280` et `--only-pages home,blog` restreignent les contrôles pour un essai rapide.

### L'ordre de tabulation : la mesure et ses seuils

Le clavier suit l'ordre du DOM ; `order`, `row-reverse` ou une zone de grille peuvent changer l'ordre **visuel**. Le §6.5 de SKINS.md fixe : avertissement au-delà de **3 %** de paires inversées, erreur au-delà de **10 %**. Ces seuils sont gardés. La **mesure** a été ajustée après essai sur des mises en page réelles :

- Un tri brut « de haut en bas puis de gauche à droite » de tous les éléments **condamne à tort** deux blocs côte à côte de hauteurs inégales (cartes de l'accueil, colonne de menu et contenu) : mesuré, **6 à 7 %** de « paires inversées » sur le skin de base, alors que chacun se lit très bien.
- La mesure compare donc, pour chaque paire d'éléments cliquables, leurs deux **branches frères** sous leur plus proche ancêtre commun (la paire est inversée si la branche du second est visuellement avant celle du premier) ; les ancêtres sans boîte (`display: contents`) et les conteneurs en **colonnes CSS** sont ignorés (le DOM descend la colonne avant de passer à la suivante).
- Le pourcentage de la page **dilue** une inversion locale. Les seuils (3 % / 10 %) s'appliquent donc **aussi au pire conteneur** : parmi les paires de branches d'un même conteneur (la liste du menu, la grille de cartes, la coquille), combien sont à l'envers ?

| Mise en page essayée | Page entière | Pire conteneur | Verdict |
|---|---|---|---|
| Basic (accueil, blog) | 0 % | 0 % (33 % pour la pagination du cœur sur téléphone) | ✅ (ce que basic fait aussi est un conseil) |
| Colonne latérale à gauche (menu et contenu) | 0 % | 0 % | ✅ |
| Cartes en colonnes CSS (maçonnerie) | 0 % | 0 % | ✅ |
| Menu à l'envers (`row-reverse`) | 2,8 % | 100 % | ❌ erreur |
| Cartes à l'envers dans chaque rangée | 0,5 % | 13,3 % | ❌ erreur |
| En-tête placé **après** le contenu | 35 à 38 % | 33 % | ❌ erreur |

### Les codes

Chaque problème porte un code stable (entre crochets dans le rapport), dans les deux langues. Les codes `kit-…` sont ceux du kit ; les autres viennent de la bibliothèque du cœur (la même qu'à l'installation). Table des codes du kit :

| Code | Gravité | Sens |
|---|---|---|
| `kit-token-unknown` | ⚠️ | jeton hors du vocabulaire (ignoré) |
| `kit-module-tokens-unverified` | 💡 | jetons de modules non vérifiables sans `--modules` |
| `kit-module-unknown` | ⚠️ | le skin règle un module absent du dossier donné |
| `kit-module-token-unknown` | ⚠️ | jeton que le module ne déclare pas |
| `kit-readability-adjusted` | ⚠️ | Curiosa corrigera une couleur au rendu |
| `kit-mode-suspended` | ❌ | un mode serait suspendu (illisible même corrigé) |
| `kit-preview-size` | ⚠️ | aperçu qui n'est pas 1280 × 800 |
| `kit-preview-unreadable` | ⚠️ | dimensions d'aperçu illisibles |
| `kit-font-unused` | ⚠️ | police embarquée mais inutilisée |
| `kit-image-unused` | ⚠️ | image embarquée mais inutilisée |
| `kit-no-own-license` | 💡 | pas de fichier LICENSE |
| `kit-no-readme` | 💡 | pas de README.md |
| `kit-breakpoint-undeclared` | 💡 | largeur de rupture absente de `breakpoints` |
| `kit-target-small` | ⚠️ | cible réglée sous 44 px |
| `kit-leading-low` | ⚠️ | interligne réglé trop serré |
| `kit-text-small` | ⚠️ | texte courant réglé sous 14 px |
| `kit-neutral` | ❌ | nom interdit dans les textes |
| `kit-neutral-skipped` | 💡 | liste de neutralité non fournie |
| `kit-browser-unavailable` | ❌ | Chromium n'a pas démarré |
| `kit-browser-skipped` | 💡 | niveau navigateur non lancé |
| `kit-hidden` | ❌ | élément visible sous basic, masqué par le skin |
| `kit-text-changed` | ❌ | un texte de la page a changé |
| `kit-structure-changed` | ❌ | liens, images, titres ou éléments cliquables changés |
| `kit-injected-text` | ❌ | texte ajouté (`content`) |
| `kit-covered` | ❌ | élément cliquable recouvert par un décor |
| `kit-offscreen` | ❌ | élément repoussé hors de l'écran |
| `kit-tab-order` | ❌ | ordre de tabulation à l'envers (page entière) |
| `kit-tab-order-warn` | ⚠️ | ordre de tabulation qui s'écarte de l'ordre visuel |
| `kit-tab-order-region` | ❌ | ordre à l'envers dans un groupe (menu, cartes…) |
| `kit-target-size` | ❌ | cible tactile sous 24 px |
| `kit-target-size-warn` | ⚠️ | cible sous 44 px sur téléphone |
| `kit-text-size` | ❌ | texte sous 12 px |
| `kit-text-size-warn` | ⚠️ | texte courant sous 14 px |
| `kit-leading` | ⚠️ | interligne rendu trop serré |
| `kit-focus-missing` | ❌ | le focus ne se voit pas |
| `kit-focus-weak` | ⚠️ | le focus se voit mal (sous 3:1) |
| `kit-scroll-x` | ❌ | la page déborde sur le côté |
| `kit-text-clipped` | ⚠️ | texte coupé par sa boîte |
| `kit-menu-closed-unreachable` | ❌ | le menu ne s'ouvre pas ou ses liens restent invisibles |
| `kit-menu-keyboard` | ❌ | le menu ne se parcourt pas ou ne se referme pas au clavier |
| `kit-contrast-rendered` | ❌ | texte trop pâle sur ce qu'il y a derrière |
| `kit-contrast-nofilter` | ❌ | texte illisible sans l'effet de flou |
| `kit-reduced-motion` | ❌ | quelque chose bouge malgré « moins de mouvement » |
| `kit-external-request` | ❌ | requête vers un autre site |
| `kit-request-failed` | ❌ | fichier du skin qui ne se charge pas |
| `kit-font-not-loaded` | ❌ | police embarquée qui ne se charge pas |
| `kit-font-not-used` | ⚠️ | police déclarée qu'aucune page n'affiche |
| `kit-mode-switch` | ❌ | bascule clair/sombre défaillante |
| `kit-basic-regression` | ❌ | basic n'est plus identique à l'apparence d'origine (pas votre faute) |
| `kit-page-error` | ❌ | page de démonstration non chargée |
| `kit-console-error` | ⚠️ | erreur du navigateur sur une page |

## 9. Publier

1. Poussez sur votre dépôt public. **Mettez le contrôle en CI** : le fichier `.github/workflows/ci.yml` du dépôt de départ lance `skin:check --visual --strict` contre **la dernière version publiée** du cœur, à chaque envoi.
2. Étiquetez : `git tag v1.0.0 && git push origin v1.0.0`. L'étiquette est égale à `version` de `skin.json`. Dans un dépôt qui porte **plusieurs** skins, préfixez l'étiquette par l'id (`mon-skin/v1.0.0`) et mettez **cette étiquette** dans `ref` du catalogue, jamais un hash de commit (un écrasement ou une fusion « squash » change les hash : [SKINS.md §25.5](SKINS.md)). **Ne supprimez jamais une étiquette** ; une version ne change jamais de contenu (publiez la suivante).
3. **Installation par l'utilisateur** (administration → **Apparence**) : **Ajouter depuis une adresse** (option avancée), coller `https://github.com/<vous>/<depot>#v1.0.0:skins/mon-skin` (`#v1.0.0` seul si le skin est à la racine). Curiosa clone, **refait le même contrôle**, montre le résumé (auteur, licences des polices, taille, lisibilité) et demande une confirmation : « Ce skin ne vient pas de la liste vérifiée. Il ne peut pas faire tourner de programme : il ne peut changer que l'apparence. » Il peut alors le choisir, retoucher ses couleurs ou **revenir aux valeurs du skin**. Les mises à jour se proposent d'elles-mêmes quand vous publiez une version plus haute (une majeure demande une confirmation).
4. **Inscription au catalogue officiel** (facultative, « ✔ vérifié », installation en un clic) : ouvrez une demande (issue ou demande de fusion) sur le dépôt `curiosa-skins` avec l'adresse de votre dépôt, l'étiquette à relire et le résultat de `skin:check --visual --strict`. Le propriétaire relit, puis ajoute une entrée à `catalogue/index.json` (sa CI relance le kit sur chaque skin) :

   ```json
   { "id": "mon-skin", "name": { "fr": "Mon skin", "en": "My skin" }, "description": { "fr": "…", "en": "…" },
     "repo": "https://github.com/<vous>/<depot>", "subdir": "skins/mon-skin", "ref": "v1.0.0", "version": "1.0.0",
     "skinContract": 1, "author": "Votre nom", "tags": ["light", "dark"], "modes": ["light", "dark"],
     "requires": { "core": "0.4.0" }, "preview": "skins/mon-skin/previews/home-light.webp" }
   ```

   `ref` est une étiquette **épinglée et relue** (jamais une branche) : une nouvelle version demande une nouvelle relecture. Neutralité exigée (aucun nom de site réel dans le skin) : lancez le kit avec la liste `--neutrality`.

## 10. Les pièces des modules

Un module peut déclarer ses propres **pièces stylables** et leurs jetons (clé `skin` de son `module.json`, [SKINS.md §8](SKINS.md)). Pour les voir et les contrôler : `--modules <dossier du dépôt de modules>` sur `skin:check` et `skin:bench`. La planche montre alors chaque pièce (avec l'exemple `demo` du module s'il existe, sinon un gabarit selon son `kind`), et le kit vérifie que vos jetons `modules.<id>` existent bien. Un jeton de module absent est **ignoré sans erreur** : un skin écrit aujourd'hui reste valable avec les modules de demain.

## 11. Pour une IA qui crée un skin pour quelqu'un

Vous êtes un assistant qui écrit un skin pour une personne qui n'est pas technique. Procédure :

1. **Demandez peu, en mots simples** : l'ambiance (clair, sombre, les deux ?), 2 ou 3 adjectifs (« chaleureux », « sobre », « rétro »), une couleur de marque si elle en a une, la lisibilité avant tout. Ne lui parlez ni de CSS ni de jetons.
2. **Partez du dépôt de départ** (`docs/skin-starter/`), jamais d'une page blanche. Changez d'abord `tokens.json` (couleurs de **chaque mode**, polices du système, arrondis, largeur), **puis seulement** `skin.css` (mise en page).
3. **Respectez le principe fondateur** : vous ne définissez que de l'apparence. **Interdit** : masquer (`display: none`, `opacity` très basse, `font-size: 0`, `clip`, décalage hors de l'écran, décor opaque par-dessus un lien), ajouter du texte (`content` avec une lettre ou un chiffre, `attr()`), charger une adresse extérieure, cibler une classe, inventer une région ou une pièce, mettre une animation hors de `prefers-reduced-motion: no-preference`. N'embarquez **aucune** police ni image sans en connaître **la licence** ; à défaut, utilisez les polices du système.
4. **Boucle de vérification obligatoire** (chaque modification) :

   ```bash
   npm run skin:check -- <dépôt> --visual --strict --json --lang fr
   ```

   Lisez le JSON : `ok`, puis `skins[].issues[]` (`code`, `severity`, `message`, `hint`, `where`). Corrigez **chaque `error`, puis chaque `warning`**, en suivant `hint`, jusqu'à `ok: true` et zéro avertissement ; relancez après **chaque** correction (une correction peut en créer une autre). Les `advice` ne sont jamais bloquants ; ceux qui disent « le skin de base fait pareil » ne viennent pas de vous. **Ne contournez jamais un contrôle** (n'affaiblissez pas un contraste « pour que ça passe » : changez la couleur). Si `kit-basic-regression` apparaît, ce n'est pas votre faute : dites-le.
5. **Regardez le résultat** : `npm run skin:bench -- <skin> --shots <dossier>` produit les planches PNG (clair et sombre, 390 à 1920 px, quatre en-têtes). Ouvrez-les : un skin qui passe le kit peut encore être laid. Montrez à la personne **les captures**, pas le code.
6. **Fabriquez les aperçus** (`--previews`) et copiez le bloc `previews` dans `skin.json`.
7. **Ne publiez rien sans l'accord de la personne** : ni étiquette, ni dépôt public, ni demande de catalogue. Donnez-lui l'adresse d'installation à coller et dites-lui, en une phrase, qu'elle pourra revenir à l'apparence d'avant quand elle le voudra, **sans rien perdre**.
8. Ce que **vous ne pouvez pas** faire pour elle : installer le skin (c'est un geste de la personne propriétaire dans l'administration, comme pour un module) et modifier son contenu. Les deux sont voulus.

## Votre liste de contrôle avant chaque étiquette

- [ ] `npm run skin:check -- <dépôt> --visual --strict` : ✅ partout, aucun avertissement.
- [ ] Les captures regardées (planches, mobile compris), en clair **et** en sombre si le skin a les deux.
- [ ] `version` de `skin.json` = l'étiquette ; `README.md` à jour (polices, licences, comment tester).
- [ ] Chaque police et chaque image : licence, fichier de licence, auteur et source dans `assets`.
- [ ] Aucun nom de site, d'association ou de ville dans les textes.

## English summary

A Curiosa skin is a folder of data in your own git repository: `skin.json` (who it is, FR + EN texts, license, modes, assets, previews), `tokens.json` (colors, fonts, radii, widths…) and `skin.css` (layout and shapes, targeting only the stable `data-skin-region` / `data-skin-part` names). No code runs. A skin only defines **appearance**: it may change the layout of the same elements radically, but it can never add, remove, rename or hide an element that carries content or an action, inject text, or load anything from a third party. Fonts and images are embedded in the folder with their license. Start from `docs/skin-starter/`; preview with `npm run skin:bench -- <skin>` (a local page showing every region and part, light and dark, all widths, built from the real core components); check with `npm run skin:check -- <repo> --visual --strict` (manifest, resources, tokens, style sheet, founding principle, readability AA, neutrality, and a real Chromium: nothing hidden, covered or added versus the basic skin, tab order vs visual order, 24/44 px targets, text size and line spacing, visible focus, rendered contrast, no horizontal scroll, mobile menu, light/dark switch, reduced motion, no external request, fonts really loaded, basic unchanged to the pixel). Exit code 0 ok, 1 refused, 2 misuse; `--json` for machines. Publish with a git tag `vX.Y.Z`; users paste `https://github.com/<you>/<repo>#vX.Y.Z:skins/<id>` in Admin → Appearance → Add from an address (explicit confirmation). Registration in the official catalogue (`catalogue/index.json` of the skins repository) is optional and reviewed by the owner. An AI creating a skin for someone must start from the starter, never bypass a check, loop on the JSON report until `ok` with no warning, show screenshots, and publish nothing without the person's consent.

Good to know ([SKINS.md §25](SKINS.md)): `div`, `span`, `section`, `article` and `[data-marker]` can only be targeted **under** `[data-skin-part="module-html"]`; `--sk-card-pad` sets the padding of cards and `[data-skin-part="card-body"]` is the text area of image cards; `"--sk-gradient": "flat"` turns the second-accent gradient into the plain main color; a selector may be 600 characters long (factor with `:is()`); `PROGRESS.md`, `NOTES.md`, `TODO.md`, `CHANGELOG.md` and `CONTRIBUTING.md` may stay at the skin's root (never read, never installed); in a repository with several skins, tag releases as `<id>/v1.0.0` and put the tag (never a commit hash) in the catalogue `ref`.
