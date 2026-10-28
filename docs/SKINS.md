# Les skins de Curiosa : le contrat

> Statut : **conception, avec les lots S1, S2 et S3 implémentés** : les jetons (`src/core/skins/tokens.ts`), le skin `basic` embarqué (`src/core/skins/basic/`), la composition (`compose.ts`, `sheet.ts`, `render.ts`), les retouches des deux modes (`retouch.ts`) et la bascule clair/sombre du visiteur (`modeScript.ts`, `src/components/site/ModeSwitch.tsx`) sont dans le cœur ; l'assainisseur et la lisibilité (lot S6) aussi. Le DOM stable (régions, pièces, coquille, menu dans la feuille du cœur : S2) et les composants du site public par les jetons (S3) le sont aussi (§20). L'installation depuis un dépôt git (lot S5, §21) et les pièces de modules (lot S4, §22) le sont aussi. La page Apparence (lot S7, §23) est faite aussi. Pas encore faits : kit et banc d'essai (S8). Cœur de référence : v0.3.0 ; modules de référence : `curiosa-extras` v1.22.0. Les constats chiffrés qui fondent les choix sont dans `docs/ideas/skins-exploration.md`, le découpage en lots dans `docs/ideas/skins-effort.md`.
>
> Les noms techniques (jetons, attributs, clés JSON, fichiers) sont en anglais comme dans le reste du dépôt ; le texte est en français. Aucun nom de site réel n'apparaît ici ni ne doit apparaître dans un skin, un test ou un texte par défaut.

## 0. Le principe fondateur : un skin ne définit que de l'APPARENCE

> « Un skin ne définit que de l'apparence ; ne faisons pas l'erreur que Grav a faite, où les thèmes définissent des éléments de page personnalisés, rendant la migration de thème impossible. » (le propriétaire)

Sur Grav, un thème apportait ses propres blocs, champs et gabarits de contenu : changer de thème obligeait à réécrire le contenu. **Curiosa n'ouvre jamais cette porte.** Conséquences, qui valent règle pour tout le reste du document :

1. **Le contenu et la structure sémantique ne dépendent JAMAIS du skin.** On change de skin à tout moment, à l'infini, sans rien perdre ni réécrire. Aucune page, entrée, section d'accueil, réglage de module ni bloc ne référence un skin (ni son id, ni une de ses valeurs). Le seul endroit où un skin est nommé est le réglage `skin.active` (et ses valeurs d'apparence, §3.4).
2. **Un skin ne peut ni ajouter, ni retirer, ni renommer, ni masquer un élément porteur de contenu ou d'action.** Pas de `display:none` / `visibility` / `clip` / `opacity:0` sur une pièce de contenu ; pas de texte injecté (`content:` autre qu'ornement vide ou ponctuation, §6.3) ; pas d'image porteuse d'information ; **pas de bloc, de section, de champ, d'emplacement ni de réglage de contenu défini par un skin**.
3. **La mise en page, elle, EST de l'apparence** (précision du propriétaire) : un skin peut changer radicalement la position et la forme de l'en-tête et du menu (barre en haut, colonne latérale gauche ou droite, menu centré), le nombre de colonnes, la largeur et l'alignement du contenu, la forme (grille, liste, cartes, maçonnerie) sous laquelle on voit **les mêmes données**, l'ordre **visuel** des régions, la densité, un héros plein écran ou compact, les marges. **Mise en page libre pour les MÊMES éléments ; contenu jamais défini par le skin.**
4. **Les « gabarits déclaratifs » sont ÉCARTÉS.** Ce n'est pas une évolution prévue. Si une évolution de mise en page est un jour envisagée, elle ne pourra être que de l'agencement (grille, ordre, espacement) des MÊMES éléments dans des pièces que le cœur définit, jamais de nouveaux éléments.
5. **Les « options de skin »** (variante, densité…) ne sont que des valeurs d'apparence, stockées à côté du skin (§3.4), jamais dans le contenu ni dans les réglages de module. Un skin qui disparaît est remplacé par `basic` sans perte.
6. **Pour les modules** : un module ne déclare que des **pièces d'apparence** (jetons et pièces stylables, §8), jamais des variantes de contenu selon le skin. Le contenu qu'un module produit est le même sous tous les skins.
7. **Le kit de test vérifie ces interdits automatiquement** (§13) : un skin qui les viole n'est pas listé au catalogue et est refusé à l'installation.

### 0.1 La frontière « apparence » / « structure-contenu »

| | Permis (apparence) | Interdit (structure-contenu) |
|---|---|---|
| Couleurs, polices, tailles, graisses, interlignes | tout, dans les jetons et les propriétés de la liste blanche (§6) | polices ou images chargées d'un tiers |
| Espacements, rayons, bordures, ombres, lueurs | tout | — |
| Arrière-plans décoratifs (dégradés, motifs, grilles, scanlines, images embarquées) | oui, sur le fond du site et sur les pièces | une image qui porte une information (un texte dessiné, un prix) |
| Transitions, animations décoratives | oui, bornées, coupées sous `prefers-reduced-motion` | animation déclenchée en boucle qui gêne la lecture (clignotement > 3 Hz), minuteur de fond |
| Agencement visuel des éléments existants | grille à zones nommées, flex, colonnes, `order`, largeur/alignement du contenu, en-tête en colonne latérale, cartes en maçonnerie | déplacer un bouton hors de sa pièce ; sortir un élément de l'écran ; contredire le DOM au point de casser l'ordre de focus (§6.5) |
| Ornements | `::before` / `::after` **vides** ou ponctuation sans signification (`"·"`, `"—"`, `"»"`, `"/"`) | tout `content:` avec lettre ou chiffre, `attr()`, `counter()` |
| Masquer | seulement du décor : `backdrop`, `divider`, ses propres pseudo-éléments, et le bouton « Menu » **si** la liste du menu est alors toujours visible | cacher un lien, un bouton, un champ, un titre, un texte, une image, une pastille de nouveauté, le crédit « Propulsé par », le lien de confidentialité |
| Ajouter | rien | tout élément, texte, champ, bloc, section, emplacement, réglage de contenu |
| Renommer / réétiqueter | rien | changer un libellé (y compris par `content`, `font-size:0` + texte de substitution, etc.) |

Une règle simple pour trancher un cas limite : **« si on retire le skin, la personne perd-elle une information ou une action ? »** Si oui, c'est interdit ; si elle ne perd qu'une impression, c'est permis.

### 0.2 Marge de radicalité réaliste avec cette règle

Un skin peut **tout** changer de ce qu'on voit tant que les mêmes éléments restent là, lisibles et atteignables. Pour les quatre directions voulues :

| Direction | Ce qu'elle peut faire (apparence ET mise en page) | Ce qu'elle ne pourra PAS faire |
|---|---|---|
| **Brutaliste clair** | fond crème/blanc, bordures noires de 3-4 px, ombres dures décalées (`box-shadow: 6px 6px 0 var(--v-fg)`), monospace, angles droits, couleurs vives plates ; **mise en page en grille de blocs encadrés** (page = grille 12 colonnes, cartes côte à côte de hauteurs inégales, titres énormes en capitales, en-tête en bandeau épais avec menu en onglets carrés, héros compact) | ajouter des « stickers » ou des numéros de section avec du texte ; masquer le logo pour n'afficher que le nom ; les « étiquettes » en `content` |
| **Éditorial papier** | serif, filets fins, grande lisibilité ; **colonne de lecture centrée** (~38-42 rem, grandes marges, menu discret centré au-dessus, listes d'entrées en colonne avec filet, cartes sans cadre, capitale ornée via `::first-letter`), hiérarchie typographique forte, pas d'ombres | ajouter une date « Édition du… », une devise, un sommaire ; changer les libellés ; une mise en page magazine à plusieurs « unes » qui supposerait des blocs que la personne n'a pas écrits |
| **Rétro néon / arcade** | noir profond, néons magenta/cyan, pixel/mono, lueurs (`text-shadow`, `box-shadow`), grille et scanlines en fond (dégradés répétés, coupés si `prefers-reduced-motion`) ; **colonne latérale gauche fixe** (logo en haut, menu vertical, langue et réseaux en bas) et contenu à droite ; pastilles en pixel | animer en boucle un texte clignotant ; ajouter un « INSERT COIN » ou des curseurs ; musique/son (aucun code) |
| **Verre / dégradés doux** | surfaces translucides floues (`backdrop-filter: blur`), dégradés pastel, très arrondi, ombres diffuses ; **cartes flottantes** sur un fond dégradé, en-tête « îlot » centré arrondi, menu en pilule, maçonnerie douce | dépendre d'`backdrop-filter` pour la lisibilité (le contrôle de contraste se fait avec le repli sans flou) ; images décoratives de tiers |

Ce que **aucun** skin ne peut faire en V1 : changer le HTML (ajouter un wrapper propre au skin, réordonner le DOM), exécuter du code, charger quoi que ce soit hors du site, restyler l'administration, les overlays OBS ou les pages autonomes des modules (§11), modifier un texte. Ces limites sont énumérées en §16.

---

## 1. Vocabulaire et vue d'ensemble

| Terme | Sens |
|---|---|
| **Jeton** (*token*) | une valeur d'apparence nommée, variable CSS (`--v-accent`, `--sk-radius-card`…). |
| **Pièce** (*part*) | un type d'élément visuel récurrent (carte, bouton, champ…), repérable par `data-skin-part="…"`. |
| **Région** | une zone de la page (en-tête, menu, contenu, pied…), repérable par `data-skin-region="…"`. |
| **basic** | le skin embarqué dans le cœur, identique à l'apparence actuelle. Il est LA BASE de tout. |
| **Skin** | un dossier (manifeste + jetons + feuille de style + ressources) qui redéfinit des jetons et restyle des pièces et des régions. |
| **Retouches** | les choix de la personne dans Apparence (palette de 5 couleurs, police, halo, fond, mise en page de l'en-tête). |
| **Banc d'essai** | page de démonstration qui liste toutes les pièces, en clair et en sombre, pour tester un skin sans installer un site (§14). |

Le site public est dessiné par **quatre couches**, de la plus faible à la plus forte :

```
1. basic            (jetons + feuille du cœur : embarqué, jamais absent)
2. pièces des modules (valeurs par défaut déclarées dans le module.json de chaque module installé)
3. le skin actif    (jetons + feuille de style)
4. les retouches    (réglages Apparence existants : theme.*, header.layout)
```

Valeur finale d'un jeton = la plus forte couche qui le définit. **Repli valeur par valeur** : tout jeton, toute règle que le skin ne définit pas vient de basic (§3). « Revenir au skin » supprime la couche 4.

---

## 2. Comment le site public est dessiné aujourd'hui (rappel utile)

(Détails et chiffres : `docs/ideas/skins-exploration.md`.)

- **Tailwind CSS 4.3.3** (`@import "tailwindcss"` dans `src/app/globals.css`, 118 lignes ; PostCSS `@tailwindcss/postcss`), Next.js 16.4.1, React 19.2.8. Les composants du site public (`src/components/site/*.tsx`, `src/app/(site)/`) sont écrits en classes utilitaires (265 `className`).
- Les couleurs passent déjà par des variables : `--v-bg`, `--v-fg`, `--v-muted`, `--v-surface`, `--v-line`, `--v-accent`, `--v-accent-fg`, `--v-success(-fg)`, `--v-warning(-fg)`, `--v-danger(-fg)`, `--v-accent2(-fg)`, `--v-gradient`, `--v-font`, posées sur `:root` par `src/app/(site)/layout.tsx` (via `buildTheme` + `themeCss`, `src/core/color.ts`) et reliées à Tailwind par `@theme inline` (`bg-bg`, `text-fg`, `border-line`, `bg-accent`…).
- Ce qui **n'est pas** une variable : rayons (57 usages `rounded-*`), tailles de texte (82 `text-*`), espacements (217), bordures (109), ombres (10), largeur du contenu (`max-w-5xl`), graisses (50), cibles tactiles (`min-h-11`). Dans les modules : sur 29 fichiers de CSS public, 719 `var(--v-…)` mais 140 couleurs hexadécimales en dur, 196 rayons, 222 tailles de police, 831 espacements, 23 ombres.
- Le site n'a **qu'un mode** (clair OU sombre, selon la luminance du fond choisi) ; il n'y a pas de `prefers-color-scheme` aujourd'hui.
- Les modules écrivent leur HTML dans des blocs `{ type: "html" }` avec leur propre `<style>` en ligne (non superposé en `@layer`), des classes préfixées (`.ev-`, `.gal-`, `.cpl-`…), et des `var(--v-…)`.
- Les overlays OBS (`/overlays/[key]`) n'importent ni Tailwind ni `globals.css` : seulement `themeCss(theme)` (les `--v-*`) + le CSS du module. Les pages autonomes de modules (`<!doctype html>` propres) ne passent pas par le layout.
- L'administration importe la même `globals.css` et a son propre thème (`adminThemeCss`, `src/core/adminTheme.ts`).

---

## 3. Le modèle : couches, repli, retouches, modes

### 3.1 Qui décide de quoi

| Couche | Où elle vit | Qui l'écrit |
|---|---|---|
| basic | `src/core/skins/basic/` (embarqué, voir §4.2) | le cœur |
| pièces des modules | clé `skin` du `module.json` (§8) | l'auteur du module |
| skin actif | `DATA_DIR/skins/<id>/<version>/` (installé depuis un dépôt, §5) | l'auteur du skin |
| retouches | réglages `theme.*` et `header.layout` existants | la personne (page Apparence) |

### 3.2 Réglages (clés de la table de réglages existante)

| Clé | Rôle | Absente = |
|---|---|---|
| `skin.active` | id du skin actif (`"basic"` ou id installé) | `"basic"` |
| `skin.installed` | liste JSON `[{ id, version, repo, ref, subdir, source: "catalogue"\|"personal", commit, tree, fingerprint, installedAt, previous?: {version, ref, commit, tree, fingerprint} }]` (voir §21.3) | `[]` |
| `skin.options` | objet `{ [optionId]: valeur }` (§3.4) | valeurs par défaut du skin |
| `skin.snapshot` | copie des retouches d'avant le dernier changement de skin, pour « Annuler » | rien |
| `theme.background`, `theme.accent`, `theme.accent2`, `theme.surface`, `theme.text` | **retouches des 5 couleurs (inchangées)** | la valeur du skin |
| `theme.font` | `sans` \| `serif` \| `mono` (retouche) | la police du skin |
| `theme.glow`, `theme.glow.custom`, `theme.bgPreset`, `theme.bgCustom`, `theme.bgImage`, `theme.bgSvg*` | retouches du halo et du fond | le halo et le fond du skin |
| `theme.palette` | `"single"` ou `"both"` : la personne définit ses couleurs pour un seul mode (comme aujourd'hui) ou pour les deux (§3.7) | `"single"` |
| `theme.light.background`, `theme.light.accent`, `theme.light.accent2`, `theme.light.surface`, `theme.light.text` | retouches du mode clair (utilisées si `theme.palette` = `both`) | la valeur du skin, mode clair |
| `theme.dark.background`, … `theme.dark.text` | retouches du mode sombre (idem) | la valeur du skin, mode sombre |
| `header.layout` | `classic` \| `twoRows` \| `centered` \| `minimal` (retouche) | l'agencement d'en-tête du skin (`defaults.headerLayout`) |

**Aucune donnée n'est migrée** : les clés `theme.*` et `header.layout` sont aujourd'hui « la valeur ou le défaut codé en dur » ; demain elles sont « la valeur ou le défaut du skin actif ». Un site existant sans `skin.active` est sur basic, dont les valeurs sont les anciens défauts codés en dur (`#121214`, `#e8a23b`, `sans`, aucun halo, aucun fond…) : **mêmes entrées, mêmes sorties** (§12).

### 3.3 Choisir un skin, retoucher, revenir au skin

- **Choisir un skin** : le cœur écrit `skin.active`, copie les retouches actuelles dans `skin.snapshot`, puis **supprime** les clés de retouche (`theme.*`, `header.layout`) pour que les valeurs du skin apparaissent (décision du propriétaire : « le skin donne les valeurs de départ »). Un bouton « Annuler » (tant qu'on n'a pas changé autre chose) restaure le snapshot. Rien n'est perdu.
- **Retoucher** : la personne change une couleur, la police, le halo, le fond ou l'agencement de l'en-tête dans Apparence : le cœur écrit la clé `theme.*` correspondante, comme aujourd'hui. Les couleurs dérivées (`muted`, `line`, `*-fg`, états) sont recalculées par `buildPalette` à partir des couleurs retouchées quand le skin ne les fixe pas, ou quand la retouche change leurs bases (§4.3).
- **Revenir au skin** : supprime les clés de retouche, d'un seul bouton, ou champ par champ (« ↺ valeur du skin » à côté de chaque réglage retouché).
- **Retoucher les couleurs d'un skin à deux modes** : voir §3.7 (la personne choisit un seul mode ou les deux).

### 3.4 Options de skin (valeurs d'apparence seulement)

Un skin peut déclarer des **options** : variantes d'apparence (densité, arrondi, intensité des lueurs…). Chaque valeur d'une option n'est qu'une **liste de jetons** qui s'ajoute à ceux du skin. Une option **ne peut pas** activer de règles de feuille de style, ni modifier un contenu. Exemple dans `skin.json` :

```json
"options": [
  { "id": "density", "label": { "fr": "Densité", "en": "Density" },
    "default": "normal",
    "values": [
      { "id": "compact", "label": { "fr": "Serrée",  "en": "Tight" },  "tokens": { "--sk-space": "0.1875rem" } },
      { "id": "normal",  "label": { "fr": "Normale", "en": "Normal" }, "tokens": {} },
      { "id": "airy",    "label": { "fr": "Aérée",   "en": "Airy" },   "tokens": { "--sk-space": "0.3125rem" } }
    ] }
]
```

Le choix est stocké dans `skin.options` (ex. `{"density":"airy"}`), jamais ailleurs. Si le skin disparaît, `skin.options` est ignoré (et nettoyé) ; si l'option ou la valeur n'existe plus dans une nouvelle version du skin, on retombe sur la valeur par défaut.

### 3.5 Clair et sombre

- `modes` dans `skin.json` : `["light","dark"]`, `["light"]` ou `["dark"]`.
- **Deux modes** : par défaut le visiteur voit le mode de son appareil (`prefers-color-scheme`) ; il peut aussi **choisir** « Clair », « Sombre » ou « Automatique » (§3.8). Le cœur émet les jetons ainsi :

```css
:root[data-skin]                                            { /* jetons du mode clair */ color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root[data-skin]:not([data-mode="light"])                 { /* jetons du mode sombre */ color-scheme: dark; }
}
:root[data-skin][data-mode="dark"]                          { /* jetons du mode sombre */ color-scheme: dark; }
```

  (l'attribut `data-mode` est posé par le petit script du cœur, §3.8 ; absent = Automatique). Le logo suit le mode **effectif** (§3.8).
- **Un seul mode déclaré** : il est **imposé** (`color-scheme` correspondant) ; aucune bascule n'est proposée.
- basic n'a **qu'un mode, le sombre actuel** : aucune bascule, aucun changement pour les sites existants.
- Le contrôle de lisibilité (§7) s'applique à **chaque mode déclaré**, séparément.

### 3.6 Où un skin s'applique (portée)

Seulement le **site public** : `<html data-skin="<id>">` est posé par `src/app/(site)/layout.tsx`. Toute règle d'un skin est préfixée par `:root[data-skin="<id>"]` par l'assainisseur (§6.1) : **rien ne peut sortir** de cette portée. L'administration (`src/app/admin/layout.tsx`), les overlays (`src/app/overlays/`), les routes `/m/…` et les pages autonomes des modules n'ont pas cet attribut : ils ne sont jamais restylés. Les overlays reçoivent seulement les couleurs `--v-*` **effectives** (skin + retouches, mode imposé sombre ou clair selon le fond) : ils peuvent s'accorder à l'identité du site sans que la feuille du skin ne s'y applique.

### 3.7 Retoucher les couleurs d'un skin à deux modes (décision du propriétaire)

La personne **choisit** (réglage `theme.palette`) :

- **« Un seul mode »** (`single`, défaut, **identique à aujourd'hui**) : ses couleurs (`theme.background`, `theme.accent`, `theme.accent2`, `theme.surface`, `theme.text`) s'appliquent à un seul mode, celui que dit la luminance du fond (`isDarkBackground`). Le site devient **mono-mode** ; la bascule du visiteur disparaît.
- **« Clair et sombre »** (`both`) : deux jeux de couleurs, `theme.light.*` et `theme.dark.*`. Une clé absente prend la valeur **du skin pour ce mode**. Le site garde ses deux modes et la bascule du visiteur.

**Compatibilité, sans migration** : un site existant n'a ni `theme.palette` ni `theme.light.*` / `theme.dark.*` ; ses `theme.*` actuels sont le jeu `single`, exactement comme aujourd'hui. Passer de `single` à `both` copie le jeu actuel dans le mode qui lui correspond (par luminance) et laisse l'autre mode aux valeurs du skin ; les anciennes clés `theme.*` sont **conservées** (pour revenir à `single` sans perte) mais ignorées tant que `both` est actif. « Revenir au skin » supprime toutes ces clés (`theme.*`, `theme.light.*`, `theme.dark.*`, `theme.palette`). Sur un skin à un seul mode ou sur basic, le choix « Clair et sombre » n'est pas proposé (basic n'a qu'un mode).

**Interface** (Apparence → Mes retouches → Couleurs, mobile d'abord) :

1. Choix en deux grandes cases, FR/EN : « **Un seul mode** : mes couleurs, clair ou sombre selon le fond » / « **Clair et sombre** : je choisis mes couleurs pour les deux » (EN : *One mode* / *Light and dark*).
2. En « Clair et sombre » : deux onglets « Clair » / « Sombre » (une colonne sur mobile) avec les cinq mêmes champs de couleur chacun, chacun avec « ↺ valeur du skin » ; un **aperçu des deux modes côte à côte** (empilés sur mobile) de la carte, du bouton, du texte secondaire et d'un lien.
3. **Avertissement en direct sous le champ** (calcul pur côté navigateur, `contrastIssues`/`contrast` de `color.ts`), **jamais bloquant** pour une retouche, en mots simples avec un exemple : « Dans le mode sombre, le texte serait difficile à lire sur ce fond. Essayez un texte plus clair, par exemple `#f4f4f5`. » Les chiffres (rapport 2,1 ; il faut 4,5) sont dans « Détails » (replié). L'enregistrement reste possible ; au rendu, l'échelle de correction du §7.3 s'applique.
4. Si l'une des deux palettes est illisible, l'encadré de la page dit lequel des deux modes est concerné.

### 3.8 La bascule clair / sombre par le visiteur

**Quand elle existe** : seulement si le skin effectif fournit **les deux modes** et que la personne n'a pas choisi « Un seul mode ». Sinon la pièce n'est pas rendue (rien à choisir).

**La pièce** : `data-skin-part="mode-switch"`, posée par le cœur dans la région `tools` de l'en-tête (et reprise dans le panneau du menu sobre `minimal`). Groupe de trois boutons `role="group"` + `aria-label` « Apparence » / *Appearance* : **Automatique** (appareil), **Clair**, **Sombre**, chacun avec `aria-pressed` (état annoncé), libellé texte (visible ou `sr-only`) + pictogramme `aria-hidden`, cible ≥ 44 px (`--sk-target`), opérable au clavier (Tab, Entrée/Espace ; flèches facultatives). Un skin la **stylise** (couleurs, forme, position dans `tools`) mais **ne peut ni la masquer ni la retirer** (§9.3).

**Stockage** : `localStorage["curiosa-mode"]` = `"light"` ou `"dark"` (absent = Automatique). **Jamais de cookie, jamais envoyé au serveur**, aucun suivi, aucun identifiant. C'est une préférence d'affichage strictement fonctionnelle, demandée par la visiteuse ou le visiteur lui-même : exemptée de consentement (`docs/PRIVACY.md`). Elle est **déclarée** dans la déclaration `privacy` du cœur et dans la page de confidentialité (une ligne : « Votre choix clair/sombre, gardé dans votre navigateur uniquement »), et ajoutée à `docs/PRIVACY.md`. Accès protégé par `try/catch` (navigation privée, stockage bloqué : on retombe sur Automatique).

**Script (du CŒUR, jamais d'un skin) — choix et justification.** Le site n'envoie aujourd'hui **aucune CSP** (`docs/SECURITE.md`) ; `docs/SECURITE.md` prévoit de fermer `script-src 'self'` sans `'unsafe-inline'` ni nonce. On choisit donc un **script externe bloquant, même origine, servi par le cœur** : `<script src="/skins/mode.js?v=<empreinte>"></script>` dans `<head>`, **sans `defer` ni `async`**, avant la feuille de jetons. ~0,4 Ko, `Cache-Control: public, max-age=31536000, immutable` (l'URL change avec l'empreinte), types `text/javascript`, `nosniff`. Il lit `localStorage` et pose `document.documentElement.dataset.mode` **avant le premier rendu** (pas de flash, pas de clignotement de mode) ; il branche aussi le clic des boutons par délégation (met à jour `aria-pressed`, `localStorage`, `data-mode`). Alternative écartée : un script en ligne exigerait un nonce (rendu dynamique de chaque page, perte du cache) ou un hash (à régénérer à chaque version) et casserait la future CSP ; un attribut posé côté serveur est impossible (le serveur ne voit pas `localStorage`, et un cookie serait un traceur à déclarer). Sans JavaScript, la pièce est rendue avec l'attribut `hidden` (posé par le cœur, levé par le script) : le visiteur sans script garde le mode de son appareil, qui est le défaut.

**Le logo suit le choix manuel** : quand les deux variantes existent (`logos.square/wide` et `…Dark`), le cœur rend **deux `<img>`** (`data-for="light"` / `data-for="dark"`) dont l'affichage est réglé par **les règles du cœur** (pas par la feuille d'un skin) :
`img[data-for="dark"]{display:none}` ; sous `prefers-color-scheme: dark` sans `data-mode="light"` et avec `data-mode="dark"` : la variante sombre s'affiche et la claire se masque, et inversement. Le skin ne peut pas modifier cela (ce sont des variantes d'une même image de marque, pas du contenu masqué). S'il n'y a qu'une variante, une seule `<img>`. (Ceci remplace l'idée du `<picture>` du §2/§3.5, qui ne sait pas suivre un choix manuel.)

**Le bandeau de cookies ne change pas.** `localStorage` n'est pas un cookie, rien n'est envoyé au serveur, le choix est demandé par la personne et sert uniquement l'affichage : il reste dans l'exception « strictement nécessaire / choisi par l'utilisateur » (`PRIVACY.md`). `core/cookieTray.ts` et `trayState` ne sont pas modifiés ; le bandeau n'apparaît toujours que pour les pastilles de nouveautés, comme aujourd'hui.

---

## 4. Le vocabulaire de jetons

### 4.1 Règles de nommage

- Les couleurs existantes **gardent leur nom** (`--v-*` ; c'est un contrat public des modules : `ctx.theme`, `theme:accent`).
- Tout nouveau jeton s'appelle `--sk-<groupe>-<nom>`.
- Les jetons d'un module : `--sk-m-<idDuModule>-<pièce>-<propriété>` (§8, préfixe `m` obligatoire) ; `-` seul comme séparateur ; l'id du module garde ses tirets.
- Un skin n'invente pas de jeton hors de ce vocabulaire ni de celui des modules installés ; un jeton inconnu est **ignoré sans erreur** (un skin écrit aujourd'hui reste valable avec les modules de demain, et inversement). Le kit de test avertit.
- Valeurs : une valeur est du texte CSS court, validé par type (couleur, longueur, durée, nombre, pile de polices, ombre, dégradé…) ; `url()` interdit sauf `url(skin:…)` (§6.4). Longueur max d'une valeur : 300 caractères.

### 4.2 Les jetons communs (valeurs de basic = apparence ACTUELLE, à l'identique)

La colonne « Basic » donne la valeur exacte à fixer pour que `basic` reproduise le rendu actuel. Les valeurs de basic ont été **relevées dans le CSS compilé** et `tailwindcss/theme.css` 4.3.3 (les premières versions de ce tableau étaient écrites de mémoire : surface, texte secondaire, filets et pile monospace étaient inexacts) ; `tests/core/skins-tokens.test.mjs` compare chaque valeur reliée à Tailwind à `theme.css`. Un rendu identique est **vérifié par comparaison d'images** (§12).

**Couleurs** (existantes ; le skin donne les 5 de base, les autres sont facultatives et dérivées sinon)

| Jeton | Rôle | Basic (sombre actuel) | Obligatoire dans le skin ? |
|---|---|---|---|
| `--v-bg` | fond de page | `#121214` | oui |
| `--v-surface` | fond des cartes et panneaux | `#202022` (dérivé : fond + 6 % de texte, `buildPalette`) | oui |
| `--v-fg` | texte | `#f4f4f5` | oui |
| `--v-accent` | couleur de marque, liens, boutons | `#e8a23b` | oui |
| `--v-accent2` | accent secondaire (= `--v-accent` si non choisi) | `var(--v-accent)` (la feuille écrit la couleur effective) | non |
| `--v-muted` | texte secondaire | `#9e9ea0` (dérivé, ≥ 4,5:1) | non (dérivé) |
| `--v-line` | filets et bordures | `#363638` (dérivé : `mix(bg, fg, 0.16)`) | non (dérivé) |
| `--v-accent-fg`, `--v-accent2-fg` | texte sur l'accent | noir `#111111` ou blanc, meilleur contraste | non (dérivé) |
| `--v-success`, `--v-warning`, `--v-danger` (+ `-fg`) | états | `#4ade80` / `#fbbf24` / `#f87171` (sombre) ; `#15803d` / `#b45309` / `#b91c1c` (clair) | non (dérivé) |
| `--v-gradient` | dégradé accent → accent2 | `linear-gradient(120deg, #e8a23b, #e8a23b)` ; si les deux accents diffèrent, la feuille l'écrit en sRGB puis l'améliore en OKLCH (`@supports`) | non |
| `--sk-color-focus` | anneau de focus | `var(--v-accent)` | non |
| `--sk-color-link` | liens dans le texte | `var(--v-accent)` | non |
| `--sk-color-veil` | voile sur image (blocs « panneau ») | `rgb(0 0 0 / .55)` | non |
| `--sk-color-selection` | sélection de texte | (navigateur : basic ne le fixe pas) | non |
| `--sk-color-heading` | titres (Q-C : facultatif ; défini, contrôlé à 3:1) | (non fixé par basic) | non |

Le cœur **n'impose pas** de calculer les couleurs dérivées : un skin peut les fixer toutes (`tokens.json` §5.4). S'il les laisse vides, `buildPalette()` les dérive des couleurs effectives (comportement actuel).

**Typographie**

| Jeton | Rôle | Basic |
|---|---|---|
| `--v-font` | police du texte (pile) | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--sk-font-heading` | police des titres | `var(--v-font)` |
| `--sk-font-mono` | police du code | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace` (relevée dans Tailwind 4.3.3) |
| `--sk-text-xs` / `-sm` / `-base` / `-lg` / `-xl` / `-2xl` / `-3xl` / `-4xl` / `-5xl` / `-6xl` | tailles | `.75rem` / `.875rem` / `1rem` / `1.125rem` / `1.25rem` / `1.5rem` / `1.875rem` / `2.25rem` / `3rem` / `3.75rem` |
| `--sk-leading-body` | interligne du texte courant | `1.75rem` (= `leading-7`) |
| `--sk-weight-normal` / `-medium` / `-semibold` / `-bold` / `-extrabold` | graisses | `400` / `500` / `600` / `700` / `800` |
| `--sk-tracking-tight` / `-wide` / `-wider` / `-widest` | espacement des lettres | `-.025em` / `.025em` / `.05em` / `.1em` |
| `--sk-heading-transform` | `none` ou `uppercase` pour les titres | `none` |
| `--sk-eyebrow-transform` | casse de la petite ligne au-dessus d'un titre | `uppercase` |

**Espaces, largeur**

| Jeton | Rôle | Basic |
|---|---|---|
| `--sk-space` | unité d'espacement (= `--spacing` de Tailwind : `p-4` = 4 unités) | `.25rem` |
| `--sk-page-width` | largeur maximale du contenu (`max-w-5xl`) | `64rem` |
| `--sk-page-pad-x` | marge horizontale de la page | `1rem` |
| `--sk-page-pad-y` | marge verticale de la page (`py-10`) | `2.5rem` |
| `--sk-stack-gap` | espace entre les blocs d'une page (`space-y-6`) | `1.5rem` |
| `--sk-prose-width` | largeur de lecture des textes courts (`max-w-2xl`, `max-w-3xl`) | `42rem` / `48rem` (deux jetons : `--sk-prose-width`, `--sk-prose-width-wide`) |
| `--sk-grid-gap` | espace entre cartes d'une grille | `1.25rem` |

**Rayons, bordures, ombres**

| Jeton | Basic |
|---|---|
| `--sk-radius-sm` / `-md` / `-lg` / `-xl` / `-2xl` / `-3xl` / `-full` | `.25rem` / `.375rem` / `.5rem` / `.75rem` / `1rem` / `1.5rem` / `9999px` |
| `--sk-radius-card` | `var(--sk-radius-xl)` |
| `--sk-radius-panel` | `var(--sk-radius-2xl)` |
| `--sk-radius-button` | `var(--sk-radius-full)` |
| `--sk-radius-field` | `var(--sk-radius-lg)` |
| `--sk-radius-chip` | `var(--sk-radius-full)` |
| `--sk-radius-media` | `var(--sk-radius-lg)` |
| `--sk-border-width` | `1px` |
| `--sk-border-width-strong` | `2px` |
| `--sk-border-style` | `solid` |
| `--sk-shadow-card` | `none` (avec `data-accent2`/`data-surface` : l'ombre actuelle, conservée) |
| `--sk-shadow-raised` | `0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a` (= `shadow-lg`, comme le CSS compilé) |
| `--sk-shadow-pop` | `var(--sk-shadow-raised)` (sous-menus, menu de l'en-tête sobre) |
| `--sk-glow` | `none` (lueur appliquée aux pièces qui l'acceptent : bouton, carte survolée, titre) |

**Mouvement et cibles**

| Jeton | Basic |
|---|---|
| `--sk-duration` | `150ms` |
| `--sk-ease` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--sk-target` | `2.75rem` (`min-h-11` : cible tactile minimale) |
| `--sk-focus-width` / `--sk-focus-offset` | `2px` / `2px` |

Sous `prefers-reduced-motion: reduce`, le cœur coupe **toutes** les animations et transitions (règle existante de `globals.css`) ; elle reste prioritaire sur un skin. Aucune animation ne peut être déclarée hors d'un `@media (prefers-reduced-motion: no-preference)` (le kit le vérifie).

**Mise en page**

| Jeton | Rôle | Basic |
|---|---|---|
| `--sk-shell-columns` | colonnes de la coquille | `minmax(0, 1fr)` |
| `--sk-shell-areas` | zones nommées de la coquille | `"banner" "header" "main" "footer"` |
| `--sk-header-width` | largeur de l'en-tête quand il devient colonne | `auto` |
| `--sk-cards-min` | largeur minimale d'une carte de grille | `15rem` |
| `--sk-flow-gap` | espace de l'accueil fluide | `2rem 1.5rem` |
| `--sk-vh-small-basis`, `--sk-vh-medium-basis`, `--sk-vh-large-basis` | tailles des morceaux d'accueil (`vh-small`…) | `14rem` / `22rem` / `34rem` |

**Points de rupture.** Les `@media` ne peuvent pas lire une variable CSS : un skin écrit donc ses `@media (min-width: 48rem)` en dur dans sa feuille (§6.2) et **déclare** ses points de rupture dans `skin.json` (`breakpoints`, §5.2) pour que le banc d'essai capture ces largeurs. Basic : bascule du menu mobile à `40rem` (`sm:` de Tailwind).

### 4.3 Dérivation et fixation

1. Le cœur prend les couleurs de base **effectives** (retouche, sinon skin, sinon basic).
2. Pour chaque couleur dérivée : si la personne a retouché une couleur dont elle dépend, on **recalcule** (comportement actuel) ; sinon, si le skin la fixe, on garde celle du skin ; sinon on la dérive.
3. Le contrôle de lisibilité (§7) s'applique au résultat.

### 4.4 Liaison avec Tailwind (comment les composants du cœur « passent par les jetons »)

Dans `globals.css`, `@theme inline` redéfinit les échelles de Tailwind **avec le repli de basic** :

```css
@theme inline {
  --radius-xl: var(--sk-radius-xl, 0.75rem);
  --radius-2xl: var(--sk-radius-2xl, 1rem);
  --text-sm: var(--sk-text-sm, 0.875rem);
  --spacing: var(--sk-space, 0.25rem);
  --shadow-lg: var(--sk-shadow-raised, 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1));
  --font-weight-semibold: var(--sk-weight-semibold, 600);
  /* … toutes les échelles utilisées par le site public … */
}
```

Comme `inline` écrit la valeur dans chaque utilitaire, et que l'administration ne définit pas `--sk-*`, **l'administration garde exactement ses valeurs d'origine** (le repli) : le même fichier `globals.css` sert les deux sans que l'administration ne soit restylée. Les valeurs « sémantiques » (`--sk-radius-card`…) sont posées dans les composants du site public (`rounded-(--sk-radius-card)` ou règle de la pièce dans la feuille du cœur, §9). Les points nécessitant un vrai changement de balisage sont en §9.

---

## 5. Le format d'un skin dans un dépôt git

### 5.1 Dépôt de skins (modèle : `curiosa-extras`)

```
curiosa-skins/
  catalogue/index.json               # l'index que les sites lisent (§5.5)
  skins/
    <id>/
      skin.json                      # manifeste (§5.2)
      tokens.json                    # jetons (§5.4)
      skin.css                       # feuille de style (facultative, §6)
      fonts/*.woff2                  # polices embarquées
      images/*                       # images embarquées (png, webp, avif, jpg, svg)
      previews/*.webp                # aperçus pour la page Apparence (jamais servis aux visiteurs)
      LICENSES/<fichier>.txt         # licence de chaque ressource
      README.md                      # description (fr)
  scripts/ , tests/                  # validation du dépôt (appelle le kit de test du cœur)
```

Un dépôt peut contenir plusieurs skins (comme `modules/` dans `curiosa-extras`) ou un seul à la racine (`subdir: ""`).

### 5.2 `skin.json`

```json
{
  "skinContract": 1,
  "id": "paper-ink",
  "name": { "fr": "Papier et encre", "en": "Paper and ink" },
  "description": {
    "fr": "Une page de livre : serif, filets fins, beaucoup d'espace.",
    "en": "A book page: serif type, hairlines, lots of space."
  },
  "version": "1.0.0",
  "minCore": "0.4.0",
  "author": { "name": "Nom de l'auteur", "url": "https://example.org" },
  "license": "MIT",
  "tags": ["light", "serif", "editorial"],
  "modes": ["light"],
  "tokens": "tokens.json",
  "stylesheet": "skin.css",
  "previews": [
    { "file": "previews/home-light.webp", "mode": "light", "width": 1280, "alt": { "fr": "Page d'accueil", "en": "Home page" } }
  ],
  "assets": [
    { "file": "fonts/body.woff2", "kind": "font", "license": "OFL-1.1", "licenseFile": "LICENSES/body-OFL.txt",
      "author": "Nom de la fonderie", "source": "https://example.org/font", "family": "Skin Body", "weight": "400 700", "style": "normal" }
  ],
  "defaults": { "headerLayout": "centered", "font": "skin", "glow": "none", "background": "none" },
  "options": [],
  "breakpoints": [640, 1024],
  "supports": { "reducedMotion": true }
}
```

| Clé | Règle |
|---|---|
| `skinContract` | **entier** : version du contrat du présent document (aujourd'hui `1`). Le cœur refuse un skin dont le contrat est supérieur à celui qu'il connaît (« Ce skin demande une version plus récente de Curiosa ») ; il accepte un contrat inférieur tant qu'il est supporté. Une évolution *additive* du contrat ne change pas le numéro ; une évolution cassante l'incrémente. |
| `id` | `^[a-z][a-z0-9-]{1,40}$`, **égal au nom du dossier** ; `basic` réservé. |
| `name`, `description` | objets `{ fr, en }`, **les deux obligatoires** (parité FR/EN) ; `name` ≤ 40 caractères, `description` ≤ 200. Les autres langues du site retombent sur `en`. |
| `version` | `x.y.z`, sert à détecter les mises à jour. |
| `minCore` | `"x.y.z"` comme pour les modules ; absent = aucune exigence (le kit avertit : un skin déclare toujours le sien). |
| `author`, `license` | `license` : identifiant SPDX de **tout le contenu du skin** ; liste autorisée : MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, CC-BY-4.0, CC-BY-SA-4.0, OFL-1.1 (pour les polices). |
| `tags` | vocabulaire contrôlé : `light`, `dark`, `serif`, `sans`, `mono`, `pixel`, `playful`, `minimal`, `bold`, `editorial`, `retro`, `glass`, `high-contrast`. 6 au plus. |
| `modes` | `["light"]`, `["dark"]` ou `["light","dark"]`. |
| `tokens`, `stylesheet` | chemins relatifs dans le dossier du skin. `stylesheet` est facultatif (un skin peut n'être que des jetons). |
| `previews` | 1 à 4 images `webp` ≤ 150 Ko, 1280 × 800 : montrées **seulement** dans l'administration (copiées et servies par le site, jamais chargées depuis GitHub chez un visiteur). `alt` obligatoire. |
| `assets` | **toute** police ou image embarquée est listée avec sa `license` (SPDX), son `licenseFile`, son `author` et sa `source`. Un fichier de `fonts/` ou `images/` non listé = refus. |
| `defaults` | valeurs de départ de ce que la personne peut retoucher : `headerLayout` (`classic`/`twoRows`/`centered`/`minimal`), `font` (`sans`/`serif`/`mono`/`skin` : `skin` = la police du skin), `glow` (`none`/`soft`/`strong`), `background` (`"none"`, `"dusk"`, `"grid"` ou un tableau de couches au format de `src/core/background.ts`). Ce sont les valeurs que les retouches remplacent. |
| `options` | §3.4. |
| `breakpoints` | largeurs (px) où la mise en page change : le banc d'essai les capture en plus de 390, 768, 1280, 1920. 4 au plus. |
| `supports.reducedMotion` | `true` obligatoire si la feuille contient des animations. |

### 5.3 Dossier du skin, plafonds

| Élément | Plafond |
|---|---|
| `skin.css` | 60 Ko, 600 règles, 12 `@keyframes` |
| `tokens.json` | 40 Ko |
| Polices | 4 fichiers, `.woff2` uniquement, 150 Ko chacun, 400 Ko au total |
| Images | 12 fichiers, 200 Ko chacun (raster : png/webp/avif/jpg ; SVG : 30 Ko), 1,2 Mo au total |
| Aperçus | 4 fichiers, 150 Ko chacun |
| Total du dossier | 2 Mo |
| Fichiers | pas de lien symbolique, pas de `..`, noms `^[a-z0-9][a-z0-9._-]{0,63}$`, 60 fichiers au plus |

### 5.4 `tokens.json`

```json
{
  "light": {
    "--v-bg": "#faf7f2",
    "--v-surface": "#fffdf9",
    "--v-fg": "#201a14",
    "--v-accent": "#8a2b14"
  },
  "dark": {},
  "common": {
    "--v-font": "\"Skin Body\", Georgia, serif",
    "--sk-radius-card": "0",
    "--sk-border-width": "1px",
    "--sk-page-width": "42rem",
    "--sk-space": "0.3125rem"
  },
  "modules": {
    "events": { "--sk-m-events-card-radius": "0" }
  }
}
```

- `light` / `dark` : jetons de couleur propres à un mode (seul le mode déclaré dans `modes` doit exister) ; `common` : valeurs communes aux deux modes ; `modules.<id>` : jetons d'un module (ignorés si le module n'est pas installé).
- Les 4 couleurs de base `--v-bg`, `--v-surface`, `--v-fg`, `--v-accent` sont **obligatoires dans chaque mode déclaré** (`--v-accent2` facultatif).
- Format plat et sans exécution : chaînes uniquement ; la validation de type est celle du §4.1.

### 5.5 Catalogue : `catalogue/index.json` du dépôt de skins

Même logique que le catalogue des modules (`catalogue/README.md` du cœur, `curiosa-extras/catalogue/index.json`) : le cœur lit le fichier **sur le réseau** (au plus toutes les 15 minutes), garde la dernière copie reçue, n'en embarque aucune ; ajouter un skin au dépôt ne demande **aucune** nouvelle version du cœur.

```json
{
  "version": 1,
  "skins": [
    {
      "id": "paper-ink",
      "name": { "fr": "Papier et encre", "en": "Paper and ink" },
      "description": { "fr": "…", "en": "…" },
      "repo": "https://github.com/helldog136/curiosa-skins",
      "subdir": "skins/paper-ink",
      "ref": "v1.0.0",
      "version": "1.0.0",
      "skinContract": 1,
      "author": "Nom de l'auteur",
      "icon": "📖",
      "tags": ["light", "serif", "editorial"],
      "modes": ["light"],
      "requires": { "core": "0.4.0" },
      "preview": "skins/paper-ink/previews/home-light.webp"
    }
  ]
}
```

`id` doit être celui du `skin.json` (sinon l'installation est refusée). `ref` : étiquette ou commit **épinglé** et relu (une branche mouvante n'est pas « vérifié »). `requires.core` est recopié de `minCore` par le script du dépôt, comme pour les modules. Variables d'environnement équivalentes à celles des modules : `CURIOSA_SKINS_REPO` (dépôt git du catalogue officiel, par défaut `https://github.com/helldog136/curiosa-skins`) et `SKINS_INDEX_URL` (index JSON supplémentaire ; il ne peut qu'**ajouter**). Un dépôt « personnel » se saisit dans Apparence → « Ajouter depuis une adresse » avec **confirmation explicite** (§10.5).

### 5.6 Installation et stockage

`DATA_DIR/skins/<id>/<version>/…` (à côté de `DATA_DIR/modules`). Servi par la route `GET /skins/<id>/<version>/<dossier>/<fichier>` (§21.7 ; polices et images **seulement**, types fixés par extension, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable` : l'URL change avec la version). La feuille et les jetons ne sont **pas** servis en fichiers : le cœur les assainit puis les écrit en `<style>` dans la page. Le chemin `skin:fonts/body.woff2` d'une feuille est réécrit en `/skins/<id>/<version>/fonts/body.woff2`.

---

## 6. La feuille de style : sécurité par liste blanche

**Aucune exécution de code** : pas de JavaScript, pas de composant React, pas d'expression CSS (`expression()`, `behavior`, `-moz-binding`), pas de `@import`. Le skin est de la **donnée** (JSON + CSS assaini). L'assainissement se fait avec un vrai analyseur CSS (PostCSS, **dépendance directe du cœur** : il n'était que transitif via Tailwind) **à l'installation et de nouveau à chaque rendu mis en cache** (la sortie assainie est ce qui est écrit dans la page ; le fichier source n'est jamais servi).

### 6.1 Portée et sélecteurs

Chaque sélecteur est réécrit en `:root[data-skin="<id>"] <sélecteur>` (spécificité plancher `(0,2,0)` : la feuille l'emporte sur les utilitaires Tailwind, rangés en `@layer`, et sur la plupart des règles `<style>` en ligne des modules). Sélecteurs **permis** :

- `[data-skin-region="…"]` et `[data-skin-part="…"]` (noms du §9 ; ou `<idDuModule>.<pièce>` d'un module installé) ;
- leurs descendants par combinateurs (` `, `>`, `+`, `~`), terminés ou précédés de : sélecteurs de type d'éléments de contenu (`a`, `p`, `h1`…`h6`, `ul`, `ol`, `li`, `img`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `blockquote`, `code`, `pre`, `hr`, `strong`, `em`, `button`, `input`, `select`, `textarea`, `label`, `figure`, `figcaption`, `svg`, `time`, `details`, `summary`) **uniquement derrière une région ou une pièce** (jamais seuls) ;
- attributs d'état stables : `[aria-current]`, `[aria-expanded]`, `[aria-selected]`, `[aria-pressed]`, `[aria-hidden]` (lecture seule), `[data-btn="primary"]`, `[data-open]`, `[data-kind="…"]`, `[data-on="…"]`, `[data-level="…"]`, `[data-tone="…"]`, `[data-state="…"]`, `[data-size="…"]`, `[data-variant="…"]`, `[data-header-layout="…"]` (les attributs d'état du §9.1-§9.2), `[role="…"]`, `[type="…"]`, `[target="_blank"]`, `[rel~="external"]`, `[lang]` / `[lang|="fr"]` ;
- pseudo-classes : `:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:disabled`, `:checked`, `:first-child`, `:last-child`, `:only-child`, `:nth-child()`, `:nth-of-type()`, `:empty`, `:not()`, `:is()`, `:where()`, `:has()` (précisions au §6.7 : `:has()` de 2 éléments au plus, sans `:has()` dedans ; 2 niveaux d'imbrication au plus) ;
- pseudo-éléments : `::before`, `::after`, `::marker`, `::placeholder`, `::selection`, `::first-letter`, `::first-line`.

**Interdits** : `html`, `body`, `:root` et `*` comme cible ; identifiants `#…` ; **toute classe `.…`** (les classes Tailwind et celles des modules ne sont pas un contrat stable) ; sélecteurs sur d'autres attributs ; `:host`, `::slotted`, `::part` ; `@scope`.

### 6.2 At-règles

| Permis | Contrainte |
|---|---|
| `@media` | conditions `min/max-width`, `min/max-height` (valeurs `px`, `em`, `rem`, de 20 à 160 em), `prefers-color-scheme`, `prefers-reduced-motion`, `prefers-contrast`, `hover`, `pointer`, `orientation`, `print` |
| `@supports` | `(property: valeur)` seulement |
| `@container` | `container-type` / `container-name` posés sur des pièces ou régions ; requêtes de taille |
| `@keyframes` | nom renommé automatiquement en `sk-<id>-<nom>` ; propriétés de la liste blanche (§6.3) ; à l'intérieur d'un `@media (prefers-reduced-motion: no-preference)` |
| `@font-face` | `src` = `url(skin:fonts/….woff2)` d'un fichier listé dans `assets` ; `font-display: swap` imposé ; famille = celle déclarée dans `assets[].family` |

Interdits : `@import`, `@charset`, `@namespace`, `@layer`, `@property`, `@page`, `@font-feature-values`, `@counter-style`, `@view-transition`, `@starting-style`, `@document`.

### 6.3 Propriétés et valeurs : liste blanche

Seules ces propriétés sont acceptées (les autres : règle rejetée, avec message). Valeurs : mots-clés CSS standards, longueurs, couleurs (`#rrggbb`, `rgb()`, `hsl()`, `oklch()`, `color-mix()`, `var(--v-…)`, `var(--sk-…)`), `calc()`, `clamp()`, `min()`, `max()`, dégradés.

| Famille | Propriétés |
|---|---|
| Couleur et fond | `color`, `background`, `background-color`, `background-image`, `background-size`, `background-position`, `background-repeat`, `background-attachment` (pas `fixed` sur plus de 2 règles), `background-clip`, `background-blend-mode`, `accent-color`, `caret-color`, `color-scheme`, `opacity` (≥ `0.6` sur toute pièce de contenu ou d'action ; < 0.6 permis seulement sur `backdrop` et pseudo-éléments), `mix-blend-mode`, `filter`, `backdrop-filter` (flou ≤ `24px`), `accent-color`, `fill`, `stroke` |
| Texte | `font`, `font-family` (piles de polices système, `var(--v-font)`, `var(--sk-font-*)` et familles déclarées dans `assets`), `font-size` (≥ `0.6875rem` sur le texte de contenu), `font-weight`, `font-style`, `font-variant*`, `font-feature-settings`, `line-height`, `letter-spacing`, `word-spacing`, `text-transform`, `text-decoration*`, `text-underline-offset`, `text-shadow`, `text-align`, `text-wrap`, `text-indent` (≥ `-0.5em` : pas de texte repoussé hors de l'écran), `white-space`, `hyphens`, `quotes`, `list-style` (types seulement), `tab-size` |
| Boîte | `margin*`, `padding*`, `gap`, `row-gap`, `column-gap`, `width`, `min-width`, `max-width`, `height`, `min-height`, `max-height` (jamais `0`/`0px` ni `max-height: 0` sur une pièce de contenu), `aspect-ratio`, `box-sizing`, `overflow` (`visible`/`auto`/`hidden` ; `hidden` interdit si la boîte est plus petite que 1 ligne), `overflow-x`, `overflow-y`, `object-fit`, `object-position` |
| Bordures et contours | `border*`, `border-radius*`, `outline*` (un `outline: none` doit être accompagné d'un indicateur de focus de remplacement : voir §7.4), `box-shadow`, `border-image` (dégradés seulement) |
| Mise en page | `display` (`block`, `inline`, `inline-block`, `flex`, `inline-flex`, `grid`, `inline-grid`, `contents`, `flow-root`, **jamais `none`** sauf §0.1), `flex*`, `grid*` (`grid-template-*`, `grid-area`, `grid-column`, `grid-row`, `grid-auto-*`), `place-*`, `align-*`, `justify-*`, `order` (-10 à 10), `columns`, `column-*`, `float` (`none` seulement), `container-type`, `container-name`, `position` (`static`, `relative`, `sticky` partout ; `absolute` dans une pièce `position:relative` ; `fixed` **seulement** sur `[data-skin-region="header"]` et `[data-skin-region="nav"]`), `top`, `right`, `bottom`, `left`, `inset*` (décalages ≥ `-1rem` : rien ne sort de l'écran), `z-index` (0 à 30 : les menus déroulants du cœur sont à 40, le saut au contenu à 50), `scroll-margin*`, `scroll-padding*`, `scroll-behavior` (`auto` si `prefers-reduced-motion`) |
| Mouvement | `transition*` (≤ `600ms`), `animation*` (≤ `20s`, `animation-iteration-count` ≤ `3` ou `infinite` seulement pour du décor ≤ `3 Hz`), `transform` (`translate` ≤ `4rem`, `rotate` ≤ `5deg` sur le texte de contenu, `scale` de `0.9` à `1.1`), `transform-origin`, `will-change` (interdit) |
| Contenu décoratif | `content` : `none`, `""`, ou une ponctuation de 1 à 3 caractères **sans lettre ni chiffre** (`"·"`, `"—"`, `"»"`, `"/"`, `"▪"`), uniquement sur `::before`/`::after`. Pas de `attr()`, `counter()`, `url()`, `open-quote` |
| Divers | `cursor` (`auto`, `default`, `pointer`, `text`, `not-allowed` : pas d'image), `pointer-events` (`auto` ou `none` sur du décor seulement), `user-select` (`auto` ou `none` sur du décor), `scrollbar-color`, `scrollbar-width`, `appearance`, `resize`, `clip-path` (`inset(0 round …)`, `circle(50%)`, `ellipse(50% 50%)` sur `card`, `panel`, `button`, `image`, `avatar`, `badge`), `mask-image` (dégradé ou `url(skin:…)` d'une image du skin ; décor) |
| Variables | `--sk-*` et `--v-*` (redéfinir un jeton à l'intérieur d'une pièce, pour une variante locale) ; tout autre nom de variable est refusé |

**Valeurs interdites partout** : `!important` (sauf, ajouté par le cœur, dans la règle `prefers-reduced-motion`), `url()` autre que `url(skin:…)` (donc aucune URL absolue, aucune `data:`), `image-set()`, `element()`, `paint()`, `env()` hors `safe-area-inset-*`, `attr()`, `expression()`.

### 6.4 Ressources : `url(skin:…)`

`url(skin:images/grid.svg)` ou `url(skin:fonts/body.woff2)` : chemin relatif listé dans `assets`. Le cœur le réécrit en `url("/skins/<id>/<version>/…")`. **Aucune URL de tiers n'est jamais acceptée** (§15).

Contrôles à l'installation, par fichier : extension et **signature** (octets magiques) cohérentes (`wOF2` pour `.woff2`, `\x89PNG`, `RIFF…WEBP`, `ftypavif`, `\xFF\xD8\xFF`) ; taille ; SVG passé par `sanitizeSvg` (`src/core/svg.ts`, existant : pas de script, pas de `foreignObject`, pas d'`href` externe) ; licence listée dans le manifeste et fichier de licence présent ; pas de métadonnées (EXIF) exploitables retirées au besoin.

### 6.5 Ordre de lecture et de tabulation

Le DOM est l'ordre de lecture et de tabulation (§9). `order`, `grid-area`, `position`, `flex-direction: *-reverse` et `direction` peuvent changer l'ordre **visuel**. Le kit (niveau navigateur, §13) calcule, sur le banc d'essai et à chaque largeur : l'ordre visuel des éléments focalisables (haut → bas puis gauche → droite, tolérance de rangée 8 px) comparé à l'ordre du DOM ; il compte les inversions de paires. **Erreur** si plus de 10 % des paires sont inversées, **avertissement** au-delà de 3 %. Il vérifie aussi que chaque élément focalisable est visible (boîte non vide, dans la fenêtre après défilement) et que l'indicateur de focus est visible (contraste ≥ 3:1, §7).

### 6.6 Ce que fait le cœur en plus

- Ajoute lui-même `@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}` après la feuille du skin.
- Limite la taille de la sortie et le nombre de règles ; au-delà, **rien n'est appliqué** (basic), avec un message.
- Met en cache la sortie assainie par `(id, version, hash des jetons effectifs, modules installés)`, expiration 10 min.

### 6.7 Précisions d'implémentation (bibliothèque `src/core/skins/`, lot S6)

L'assainisseur (`sanitize.ts`) et le contrôle de lisibilité (`readability.ts`) sont une bibliothèque **pure** (sans Next, sans base de données, sans réseau, sans minuteur), partagée par l'installation, le rendu et le kit `skin:check` (§13). La liste blanche lisible est dans `allowlist.ts`, les messages (FR/EN en parité, avec un code technique stable) dans `messages.ts`. Ce qui précise ou complète les §6.1-§6.6 :

- **Sortie** : la feuille est **réécrite** à partir de ce qui a été compris, jamais recopiée. Une erreur retire la déclaration fautive (ou la règle entière si un sélecteur de sa liste est refusé, comme le fait CSS) et met `ok: false` (le skin n'est pas installé). Un **plafond** dépassé (taille, règles, déclarations, keyframes, polices) est fatal : sortie vide, rien n'est appliqué (§6.6). Un avertissement (`menu-toggle` masqué) ne rend pas `ok` faux.
- **Sélecteurs** : le premier composé doit être une région ou une pièce (directement, ou par `:is()`/`:where()` dont chaque branche l'est) ; un préfixe écrit par l'auteur, exactement `:root[data-skin="<id>"]`, est accepté et jamais doublé ; `&` (imbrication CSS), `|`, `\`, caractères non ASCII refusés ; un pseudo-élément ne va qu'à la fin ; au plus 6 composés, 20 sélecteurs par règle, 300 caractères ; `:has()` accepte 2 éléments au plus et ne s'imbrique pas ; `:not/:is/:where/:has` s'imbriquent sur 2 niveaux au plus ; attributs : `=` seulement (plus `~=` pour `rel`, `|=` pour `lang`), valeur courte en minuscules ; un nom de région ou de pièce inconnu est une **erreur** (pas un avertissement) ; une pièce de module `mod.piece` est contrôlée si la liste des pièces des modules installés est fournie.
- **Valeurs** : alphabet ASCII ; un commentaire vaut une espace ; les échappements CSS (`\75 `) sont **refusés** partout sauf dans les chaînes de `content`, qui sont réécrites en `\HEX ` ; `!important` refuse la déclaration ; fonctions, unités et `url(skin:…)` sur liste (`ALLOWED_FUNCTIONS`) ; `var()` ne lit que `--v-*`/`--sk-*`, comme premier argument ; une valeur fait 500 caractères au plus (300 pour une variable, §4.1) ; les chaînes entre guillemets ne sont permises que dans `content`/`quotes` (ponctuation), `font-family` et le nom de police des variables `--v-font`/`--sk-font-*`, `font-feature-settings`, `grid-template-areas` ; `url()` seulement dans `background`, `background-image`, `mask-image` et les variables ; `calc()/min()/max()/clamp()` entièrement littéraux sont **évalués** avant les bornes (`font-size: calc(0px)` vaut zéro).
- **Variables** : un cycle (`--a → --b → --a`) retire les variables concernées (`var-cycle`) ; une variable dont le développement dépasse 20 000 caractères aussi (`var-expansion-too-large`) ; pour `display`, `opacity`, `width`… la valeur littérale que la feuille donne à chaque variable utilisée est essayée (`--x:none; display:var(--x)` est refusé). Les valeurs données aux jetons **hors** de la feuille (`tokens.json`) ne sont pas suivies : leur validation par type est celle du lot « jetons » (`sanitizeTokenValue()` applique les mêmes règles de valeur, 300 caractères).
- **Masquer** (§0.1, §9.3) : la règle s'applique au **sujet** (dernier composé). Est du décor : un pseudo-élément `::before`/`::after`, tout ce qui est dans la région `backdrop` ou la pièce `divider`. `display:none` n'est permis que sur le décor, sur `menu-toggle` (avertissement : le kit vérifie dans le navigateur que la liste du menu reste visible) et sur `nav-list`/`submenu` à l'état fermé (`[data-open="false"]` ou `:not([data-open="true"])`). `visibility`, `clip`, `content-visibility` sont refusés partout. Sur tout le reste : `opacity` ≥ 0,6 (aussi dans `@keyframes`), `font-size` ≥ 0,6875rem, `line-height` ≥ 0,8, `width`/`height`/`max-*` ≥ 0,25rem (4 px), marges négatives ≥ -4rem, `text-indent` entre -0,5em et 8rem, interlettrage ≤ 8 px, décalages (`top`, `left`, `inset`…) entre -1rem et 60rem (et 0 à 100 %), `color` d'opacité ≥ 0,5, `filter: blur` ≤ 2px (`backdrop-filter` ≤ 24px ; décor ≤ 100px), `brightness`/`contrast`/`opacity()` entre 0,5 et 2 / ≥ 0,6, `transform` : `translate` ≤ 4rem (≤ 50 %), `rotate` ≤ 5°, `scale` 0,9-1,1 ; **sur le décor** ces bornes tombent, sauf le flou. `mix-blend-mode` (autre que `normal`), `mask-image`, `pointer-events: none`, `user-select: none` : décor seulement ; `clip-path` : formes `inset(0 round …)`, `circle(50%)`, `ellipse(50% 50%)` sur `card`, `panel`, `button`, `image`, `avatar`, `badge` ; `position: fixed` : `header` et `nav` seulement ; `position: absolute` n'est **pas** vérifiable statiquement (« dans une pièce `relative` ») : seules les bornes de décalage s'appliquent, le kit navigateur fait le reste.
- **Mouvement** : `animation*` n'est permis que sous `@media (prefers-reduced-motion: no-preference)` (comme `@keyframes` et `scroll-behavior: smooth`) ; un nom d'animation doit être un `@keyframes` de la même feuille (renommé `sk-<id>-<nom>`, jamais ceux de Tailwind) ; au plus 20 s ; au plus 3 répétitions, ou `infinite` avec un tour ≥ 0,34 s (moins de 3 Hz) ; transitions ≤ 600 ms (délai compris) ; dans `@keyframes`, seules des propriétés d'apparence (couleurs, fond, ombres, `opacity`, `transform`, `filter`…) ; au plus 20 étapes.
- **At-règles** : `@media` : types `screen`/`all`/`print`, `and` (pas de `not`, `only`, `or`), 4 requêtes par liste, la syntaxe de plage `(width >= 40rem)` est permise, 20 à 160 em ; `@container` : 5 à 160 em, nom facultatif ; `@supports` : `(propriété: valeur)` reliées par un seul genre de `and`/`or`, 4 au plus, propriété de la liste blanche ; conditions imbriquées sur 3 niveaux au plus ; `@font-face` : tout en haut de la feuille, 4 au plus, descripteurs `font-family` (déclarée dans `assets`), `src` (`url(skin:fonts/….woff2)` + `format("woff2")` facultatif), `font-weight`, `font-style`, `unicode-range` ; `font-display: swap` est imposé.
- **Focus** (§7.4, partie statique) : un `outline: none/0` sans règle `:focus-visible` (ou `:focus`) qui pose `outline`, `box-shadow` ou `border-color` est refusé (`focus-indicator-missing`) ; la vérification par élément est celle du navigateur (kit `--visual`).
- **Propriétés ajoutées** à la liste du §6.3 (utiles à la mise en page, sans risque) : `overflow-wrap`, `word-break`, `vertical-align`, `table-layout`, `stroke-width`, `list-style-type`, `list-style-position`, `-webkit-backdrop-filter` (Safari). `background-clip: text` et `-webkit-text-fill-color` restent refusés (texte rendu invisible).

---

## 7. Le contrôle de lisibilité automatique

### 7.1 Les paires vérifiées (WCAG 2.x AA, formule de `contrast()` de `src/core/color.ts`)

Pour **chaque mode** déclaré, sur les valeurs **effectives** (skin + retouches + options) :

| # | Paire | Seuil | Sens |
|---|---|---|---|
| 1 | `--v-fg` / `--v-bg` | 4,5 | texte courant |
| 2 | `--v-fg` / `--v-surface` | 4,5 | texte dans les cartes |
| 3 | `--v-muted` / `--v-bg` et / `--v-surface` | 4,5 | texte secondaire |
| 4 | `--v-accent-fg` / `--v-accent` | 4,5 | texte des boutons pleins |
| 5 | `--v-accent2-fg` / `--v-accent2` | 4,5 | idem, accent secondaire |
| 6 | `--sk-color-link` (sinon `--v-accent`) / `--v-bg` et / `--v-surface` | 4,5 | liens dans le texte |
| 7 | `--v-accent` / `--v-bg` | 3 | bouton contour, pastille (élément d'interface) |
| 8 | `--sk-color-focus` / `--v-bg` et / `--v-surface` | 3 | anneau de focus |
| 9 | `--v-success`, `--v-warning`, `--v-danger` / `--v-bg` et `--v-surface` | 4,5 | messages d'état |
| 10 | chaque `*-fg` d'état / sa couleur d'état | 4,5 | texte sur bandeau d'état |
| 11 | pièces de module : toute paire de jetons `fg`/`bg` déclarée dans le `skin` d'un module (§8) | 4,5 | |
| 12 | **titres** (`--sk-text-2xl` et plus, ou graisse ≥ 700 à ≥ `1.125rem`) : jeton facultatif `--sk-color-heading` (proposé, voir Q-C) / `--v-bg` et / `--v-surface` | 3 | seuil « grand texte ». Le §7.1 n'avait pas de jeton de couleur de titre : sans lui, la paire 12 n'a rien à mesurer (les titres prennent `--v-fg`, déjà jugé aux paires 1 et 2 à 4,5) |

Contrôle **rendu** (niveau navigateur du kit, §13) en plus : pour chaque texte visible du banc d'essai, couleur calculée contre l'arrière-plan réellement derrière (capture avec le texte rendu transparent, échantillon des pixels sous la boîte du texte, en prenant le plus mauvais). Il trouve les cas que les jetons ne voient pas (un dégradé, une image de fond, un `backdrop-filter` qui ne s'applique pas). Les effets `backdrop-filter` sont testés **avec et sans** (repli sans flou).

basic est la référence ; il est exempté de ces contrôles (c'est l'apparence existante, y compris la paire `--v-line` / `--v-bg`, qui reste sous 3:1) mais le kit l'exécute sur lui pour le suivre.

### 7.2 Quand le contrôle se déclenche et ce qu'il fait

| Situation | Comportement |
|---|---|
| **Installation** ou **mise à jour** d'un skin (catalogue ou personnel) | Les valeurs **déclarées par l'auteur** doivent passer toutes les paires, dans chaque mode : **refus** avec un message simple, sans rien installer : « Ce skin n'est pas assez lisible : le texte serait trop pâle sur le fond (rapport 2,1 ; il faut au moins 4,5). Il n'a pas été installé. » Une mise à jour refusée laisse le skin comme il était. |
| **Activation** d'un skin installé avec les retouches existantes de la personne | Le calcul est fait avant d'appliquer ; s'il échoue à cause des retouches, voir ci-dessous. |
| **Retouche** de la personne qui rend une paire illisible | **On n'empêche pas d'enregistrer** (comportement actuel de `contrastIssues` : un avertissement sous le champ avec un exemple). Au rendu, le cœur applique l'échelle de correction ci-dessous. |
| Changement de réglage, **mise à jour d'un module** ou d'un skin qui fait échouer une paire après coup | Même échelle de correction au rendu ; la page Apparence affiche un encadré « Nous avons ajusté une couleur pour qu'on puisse la lire » avec un bouton « Revenir au skin » ; rien n'est supprimé. |

### 7.3 Échelle de correction (au rendu, jamais bloquante)

Pour une paire en échec, dans l'ordre : (1) recalculer les couleurs **dérivées** (`muted`, `*-fg`, états) à partir des couleurs effectives (`reach()` de `color.ts`) ; (2) rapprocher le texte (`--v-fg`, `--sk-color-link`) du noir/blanc jusqu'au seuil ; (3) si c'est un jeton de pièce de module qui échoue : retour à la valeur par défaut du module (couche 2) ; (4) si le fond lui-même rend toute correction impossible : **le mode concerné de ce skin est suspendu et basic s'applique** (pour ce mode), avec la notice dans Apparence. Mise en œuvre (`correctReadability()`, fonction pure) : l'étape 1 recalcule avec `buildPalette()` les seules couleurs dérivées en échec ; l'étape 2 cherche, pour `--v-fg`, `--sk-color-link`, `--sk-color-focus` (créés si absents, pour ne pas toucher à la couleur principale) et, pour la paire 7, `--v-accent`, la plus petite correction vers le noir ou le blanc qui convient à **tous** les fonds où la couleur est posée (puis les dérivées sont recalculées une dernière fois) ; l'étape 3 remet les deux jetons d'une paire de module à leur valeur par défaut (couche 2) ; au final, si une erreur reste, le résultat est `suspended: true` et les jetons sont rendus tels quels. Les transparences sont composées (fond de page sur blanc en clair / noir en sombre, surface sur le fond de page, texte sur son fond) avec des canaux entiers, comme un navigateur. **L'administration n'est jamais touchée** : un skin illisible ne peut pas enfermer la personne dehors.

### 7.4 Focus, mouvement, cible

Le kit vérifie aussi (statique + rendu) : un `outline: none` / `outline: 0` n'est permis que si `:focus-visible` définit un `outline`, un `box-shadow` ou un `border-color` d'au moins 2 px visible (≥ 3:1) ; tailles de cible : `min-height` des pièces `button`, `field`, `nav-link`, `chip` ≥ `--sk-target` (`2.75rem`) en dessous de 640 px ; interligne du texte courant ≥ 1,4 ; taille du texte courant ≥ `0.875rem` ; aucune animation en boucle > 3 Hz ni > 5 s hors `prefers-reduced-motion: no-preference`.

---

## 8. Les pièces des modules

### 8.1 Pourquoi dans le module

Le cœur et basic restent **neutres** (leçon de l'audit de généricité) : un nouveau module ne doit pas obliger à modifier le cœur ni basic. Basic ne connaît que le vocabulaire commun (carte, bouton, liste, étiquette…). C'est le **module** qui déclare ses pièces stylables et leurs valeurs par défaut, rattachées aux jetons communs.

### 8.2 Clé facultative `skin` du `module.json` (additive, `"minCore": "0.4.0"` = première version du cœur qui la lit)

```json
{
  "minCore": "0.4.0",
  "skin": {
    "since": 1,
    "parts": [
      {
        "id": "events.card",
        "kind": "card",
        "name": { "fr": "Fiche d'évènement", "en": "Event card" },
        "description": { "fr": "La fiche de chaque évènement dans la liste.", "en": "The card of each event in the list." },
        "tokens": [
          { "name": "--sk-m-events-card-radius", "type": "length", "default": "var(--sk-radius-card)" },
          { "name": "--sk-m-events-card-bg",     "type": "color",  "default": "var(--v-surface)" },
          { "name": "--sk-m-events-card-fg",     "type": "color",  "default": "var(--v-fg)", "on": "--sk-m-events-card-bg" }
        ]
      }
    ],
    "demo": "skin-demo.html"
  }
}
```

| Champ | Règle |
|---|---|
| `since` | version du contrat de pièces de modules (`1`) ; un cœur qui ne connaît pas la clé l'**ignore sans erreur** (le manifeste n'est pas strict ; `minCore` protège sinon). |
| `parts[].id` | `<idDuModule>.<pièce>`, `^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$`, **commence par l'id du module** ; c'est la valeur de `data-skin-part` que le module pose sur son HTML. 12 pièces au plus. |
| `parts[].kind` | facultatif, informatif : l'une des pièces **communes** du §9 (`card`, `button`, `badge`, `list`, `avatar`, `panel`…) ; le kit vérifie qu'elle existe. |
| `parts[].name`, `description` | **FR et EN obligatoires** (nom ≤ 120 caractères, description ≤ 300) : affichés par le banc d'essai et la page Apparence. |
| `parts[].tokens[]` | `name` : `--sk-m-<idDuModule>-<pièce>-<propriété>` (**préfixe obligatoire** `--sk-m-<module>-` ; ≤ 66 caractères) ; `type` : `color`, `length`, `shadow`, `number`, `font`, `duration`, `text-transform` (liste fermée) ; `default` : la **valeur d'aujourd'hui**, ou une référence à un jeton **commun** (`var(--sk-radius-card)`, `var(--v-surface)`) ou **du même module** : jamais un jeton d'un autre module, jamais d'URL ; `on` (couleur de texte) : le jeton de fond du même module sur lequel le texte est posé, pour le contrôle de lisibilité (§7, paire 11). **24 jetons au plus** par module, tous contrôlés avec les mêmes règles que les jetons d'un skin (`validateTokenValue` : sûreté, forme du type, bornes). |
| `demo` | fichier HTML facultatif (≤ 20 Ko) d'exemple des pièces, à la racine du module, pour le banc d'essai (§14) ; sans lui le banc génère un gabarit générique d'après `kind`. Aucun script, aucun style intégré, aucune adresse externe (le kit le vérifie). |

**Interdits (principe fondateur, §0)** : la déclaration est de la *donnée d'apparence*. Aucune clé n'y décrit du contenu (le schéma est strict : toute clé inconnue est refusée, `template`, `html`, `content`, `hidden`… comprises) ; les types de jetons sont une liste fermée de valeurs de style ; une valeur par défaut ne peut contenir ni `url()`, ni `attr()`, ni accolades, ni point-virgule, ni échappement ; le kit refuse un jeton de module lu dans `display`, `visibility`, `opacity`, `content`, `position`, `transform`, `font-size`, `width`… (propriétés qui masqueraient ou déplaceraient du contenu : pour une taille de texte, on utilise un jeton **commun**, que le cœur borne).

### 8.3 Ce que le module fait de son CSS

Le module garde son `<style>` en ligne (aucun changement d'architecture), mais ses valeurs deviennent `var(jeton-du-module, var(jeton-commun, valeur-actuelle))` :

```css
/* avant */  .ev-card{border:1px solid var(--v-line);border-radius:14px;background:var(--v-surface)}
/* après  */  .ev-card{border:var(--sk-border-width,1px) var(--sk-border-style,solid) var(--v-line);
                       border-radius:var(--sk-events-card-radius,var(--sk-radius-card,14px));
                       background:var(--sk-events-card-bg,var(--v-surface))}
```

- Le dernier repli est **la valeur d'aujourd'hui** : sur un cœur sans skins ou sous `basic`, le rendu est strictement le même (et le module reste compatible avec les cœurs plus anciens).
- Le module pose `data-skin-part="events.card"` (en plus de ses classes) sur chaque élément de la pièce. Ajouter un attribut n'est **pas** un changement de contenu.
- Un module ne déclare **jamais** de variante de contenu selon le skin, ne lit jamais `skin.active`, et son API (`ctx`) ne l'expose pas.

### 8.4 Composition (couche 2)

À chaque page, `getModuleSkinLayer()` (`src/core/skins/moduleParts.ts`) rend la **couche des pièces** des modules **installés** (installé = actif) : `{ tokens, pairs, parts, byModule, version }`. Elle en tire (a) la liste des jetons de module autorisés dans `tokens.json` (`modules.<id>`), (b) les paires de lisibilité (`on`), (c) les pièces ciblables dans les feuilles (`[data-skin-part="<module>.<pièce>"]`, option `moduleParts` de l'assainisseur), (d) les pièces du banc d'essai. Les valeurs par défaut des jetons de module sont émises dans `:root[data-skin]` **avant** celles du skin (donc le skin les surcharge) : le skin ne définit rien → c'est la valeur par défaut du module qui s'applique → qui retombe sur basic.

- **Source** : le seul `module.json` de chaque module (le code du module n'est pas chargé), validé par `parseManifest` puis `analyzeModuleSkin()` (`src/core/skins/moduleSkin.ts`, bibliothèque pure réutilisée par le kit de conformité). Un jeton refusé est **retiré** (jamais corrigé) et le module garde sa valeur de repli : son rendu ne change pas. Un module dont le manifeste est invalide n'a pas de pièces.
- **Cache sans minuteur** : la couche est gardée avec l'empreinte `(id, version, commit)` des modules installés (une ligne de base par page, aucun fichier lu) et recalculée quand cette empreinte change, ou quand `forgetModule` / `resetModuleRegistry` (installation, mise à jour, réinstallation, retrait) appellent `invalidateModuleSkinLayer()`. Un fichier illisible n'est pas gardé en mémoire. Sans aucune pièce : `EMPTY_MODULE_LAYER` (version `"0"`) et la composition est **identique** à celle d'avant (testé : mêmes jetons, même feuille).
- **Feuilles de skin** : `loadInstalledSkin(id, version, root, moduleParts)` assainit la feuille avec la liste des pièces installées et garde en cache selon l'empreinte de cette liste : une règle qui vise la pièce d'un module absent est **retirée au rendu** (sans erreur ; le skin installé n'est pas touché) et revient quand le module est réinstallé. À l'installation d'un skin (lot S5), la liste n'est pas connue : toute pièce `module.pièce` bien formée est acceptée.
- **Préfixes** : un jeton `--sk-m-a-b-x` appartient au module `a-b` s'il est installé, pas au module `a` ; deux modules ne peuvent pas déclarer le même jeton (le premier par ordre d'identifiant le garde).
- **Lisibilité** : les paires `on` sont la paire 11 du §7.1. Si un skin rend un texte de module illisible sur son fond, l'échelle de correction (§7.3) remet **les valeurs par défaut du module** (et non celles du skin) ; en dernier recours, le mode est suspendu.

### 8.5 Modules sans déclaration

Un module qui n'a pas de clé `skin` continue de fonctionner à l'identique : ses couleurs en `var(--v-…)` suivent le skin ; ses valeurs en dur (rayons, tailles…) restent celles du module. Un skin ne peut pas cibler ses classes (§6.1). Le kit des modules affiche un **conseil** (pas une exigence) : « Ce module a un affichage public mais ne déclare aucune pièce stylable ».

### 8.6 Numéro de version du module qui adopte les pièces

Règle (décision du propriétaire) : un module qui **ajoute la clé `skin`** et réécrit son CSS public avec les repli `var(jeton, var(commun, valeur-actuelle))` **sans changer son apparence par défaut** passe en version **mineure** (`1.22.0` → `1.23.0`, avec `minCore` = première version du cœur qui lit la clé). S'il **modifie son apparence par défaut** (une couleur, un rayon, une taille qui change vraiment sous basic), il passe en version **majeure**. Un simple correctif de valeur sans effet visible : correctif (`x.y.z`). Le harnais d'images (§12) tranche : image identique = mineure, image différente = majeure. **`minCore` vaut `0.4.0`** (le kit l'exige dès qu'il y a une clé `skin`, `compat.minCore`) : un cœur plus ancien refuse la mise à jour avec le message habituel « mettez d'abord le site à jour » au lieu de recevoir un module dont il ignore les pièces. Modèle : `thanks-wall` 1.0.1 → 1.1.0 (`curiosa-extras`, test `tests/thanks-wall-skin.test.mjs`).

---

## 9. Régions et pièces du cœur : le DOM stable

Aujourd'hui le cœur impose en dur dans `src/app/(site)/layout.tsx` : l'ordre bannière → en-tête → `main` → pied ; la largeur `max-w-5xl px-4 py-10` du `main` ; des classes Tailwind responsives (`sm:`, `max-sm:`) qui font basculer le menu ; des variantes d'en-tête (`data-header-layout`). Pour que les skins puissent *agencer* sans balisage propre à un skin, le cœur rend ce **DOM stable** (identique pour tous les skins). **Rien n'est ajouté ni retiré pour un skin ; seuls des attributs et un wrapper de coquille sont ajoutés pour tous**, et basic l'habille pour rester pixel-identique.

### 9.1 Les régions

```html
<html data-skin="basic" lang="fr" data-accent2? data-surface?>
<body data-skin-root>
  <div data-skin-region="backdrop" aria-hidden="true"> … </div>         <!-- fond (actuel .cbg) -->
  <a data-skin-part="skip-link" href="#content">…</a>
  <div data-skin-region="tray"> … </div>                                 <!-- bandeau de cookies (actuel CookieTray) -->
  <div data-skin-region="shell">                                         <!-- NOUVEAU : conteneur de grille, display:block dans basic -->
    <div data-skin-region="banner"> … </div>                             <!-- blocs du slot layout.banner -->
    <header data-skin-region="header" data-header-layout="classic">
      <a data-skin-part="brand"> logo / nom </a>                         <!-- l'en-tête est lui-même le conteneur centré (jetons --sk-page-*) -->
      <div data-skin-part="header-group">                                <!-- groupe d'en-tête : display:contents possible (variantes : §20.2) -->
        <nav data-skin-region="nav" data-site-nav>
          <button data-skin-part="menu-toggle"> … </button>
          <ul data-skin-part="nav-list" data-open="false"> <li><a data-skin-part="nav-link"> … <button data-skin-part="submenu-toggle"> <ul data-skin-part="submenu" data-open="false"> … </ul></li></ul>
        </nav>
        <div data-skin-region="tools"> secondary, socials, bouton, langue, <div data-skin-part="mode-switch" role="group" hidden>…</div> </div>
      </div>
    </header>
    <main id="content" data-skin-region="main">
      <div data-skin-region="content"> … la page (titre, blocs, liste, fiche…) … </div>  <!-- largeur et marges latérales : --sk-page-width / --sk-page-pad-x -->
    </main>
    <footer data-skin-region="footer"> … </footer>
  </div>
</body>
```

| Région | Contenu | Pilotage par jetons (basic) |
|---|---|---|
| `backdrop` | fond décoratif (halo, motif) | `--sk-*` des couches (déjà un format JSON) |
| `tray` | bandeau de cookies, `position: fixed` (comportement du cœur) | ne peut pas être masqué |
| `shell` | conteneur de mise en page | `display`, `grid-template-columns: var(--sk-shell-columns)`, `grid-template-areas: var(--sk-shell-areas)` ; **basic : `display:block`** |
| `banner` | bandeau(x) de module (`layout.banner`) | zone `banner` |
| `header` | marque, menu, outils ; **lui-même le conteneur centré** (`padding-inline` lu dans `--sk-page-width` / `--sk-page-pad-x`), `width: var(--sk-header-width, auto)` | zone `header` ; peut devenir colonne latérale |
| `nav` | navigation principale | peut être verticale |
| `tools` | lien secondaire, réseaux, bouton, sélecteur de langue, **bascule clair/sombre** (si le skin a les deux modes, §3.8) ; `display:contents` ou rangée selon la variante d'en-tête (§20.2) | |
| `main` | zone de contenu (`<main id="content">`, cible du lien d'évitement) | zone `main` ; `padding-block: var(--sk-page-pad-y)` |
| `content` | la page elle-même (titre, blocs, liste, fiche), dans `main` | colonne centrée : `max-width: var(--sk-page-width)`, `padding-inline: var(--sk-page-pad-x)` ; un skin peut en faire une grille |
| `footer` | pied (blocs `layout.footer`, texte, confidentialité, crédit) ; lui aussi le conteneur centré | zone `footer` |

**Pas de région `aside` en V1** : une colonne latérale se fait en plaçant `header` (marque + menu + outils) dans une colonne de la grille de `shell`. Ajouter une barre latérale de contenu supposerait un emplacement de contenu, que seul le cœur peut définir (§16).

> **Réalisé au lot S2** : §20.2 donne l'écart exact entre ce schéma et le DOM livré.

Contraintes de rendu du cœur, pour que ces régions soient pilotables : (1) les classes responsives du menu (`max-sm:absolute …`, `sm:hidden`) sont **déplacées dans la feuille du cœur** sous forme de règles sur `nav-list` / `menu-toggle` / `submenu` (avec `@media (min-width: 40rem)`), pour qu'un skin les ré-exprime ; l'ouverture/fermeture reste du JS du cœur et s'exprime par `data-open="true|false"` et `aria-expanded` (plus par ajout de classes `hidden`/`flex`) ; (2) `main` ne porte plus `mx-auto max-w-5xl px-4 py-10` mais lit les jetons ; (3) les variantes d'en-tête (`classic`, `twoRows`, `centered`, `minimal`) gardent leur balisage mais portent les mêmes régions/pièces ; (4) l'ordre DOM reste celui d'aujourd'hui (bannière, en-tête, contenu, pied), qui est l'ordre de lecture logique.

### 9.2 Les pièces communes (attributs et correspondance avec l'existant)

`data-skin-part` est **ajouté** à côté des repères existants (`data-card`, `data-btn`, `data-chip`, `data-marker`, `data-stat`, `data-testid`) qui **restent** (les tests et les règles `data-accent2` actuelles s'en servent).

| Pièce `data-skin-part` | Où (aujourd'hui) | Repère existant |
|---|---|---|
| `card` | cartes d'entrées (`EntryList`), téléchargements, pastilles de couleur, bloc `copy`, `netHealth` | `data-card` |
| `button` | boutons d'action (`HeroButton`, bouton d'en-tête, téléchargement, `ModuleForm`) ; `data-btn="primary"` pour le principal | `data-btn` |
| `chip` | liens-pastilles (`links`, `EntryList` en pastilles) | `data-chip` |
| `badge` | petites étiquettes (« expiré », langue, pastille de nouveauté) | |
| `news-dot` | pastille « nouveau » du menu | `data-testid="news-dot"` |
| `field`, `input`, `textarea`, `label`, `field-error` | formulaires (`ModuleForm`) ; pas de pièce `select` : le site public n'a aucun menu déroulant de formulaire | |
| `list`, `list-item` | `EntryList` en liste, `links` | |
| `table`, `table-head`, `table-row`, `table-cell` | bloc `table`, tables Markdown | |
| `heading` (`data-level="1…6"`), `eyebrow`, `lead` | titres de page, petite ligne, chapeau | `data-marker` |
| `prose` | texte Markdown (`Markdown.tsx`) | |
| `quote` | citation (`blockquote`) | |
| `code`, `code-block`, `copy-code` | code en ligne / en bloc / copier | |
| `image` (`media`), `avatar`, `cover` | images de contenu, logo rond du héros, couvertures (`CoverImage`) | |
| `divider` | filets (`hr`, `divide-y`, séparateurs) — **décor**, masquable | |
| `link` | liens dans le texte | |
| `notice` (`data-tone="info\|success\|warning\|danger"`) | bloc `banner`, message d'état | |
| `panel` (`data-kind="media\|tabs\|stats\|cta\|video"`, `data-on`) | blocs de page du cœur | `data-testid="panel"` |
| `hero` (`data-variant="plain\|video"`) | bloc héros | |
| `stat` | chiffres clés | `data-stat` |
| `tabs`, `tab` | `PanelTabs` | `role="tab"` |
| `pagination`, `pagination-link` | `Pagination` | `data-pagination` |
| `mode-switch` (`data-state`), `mode-option` (`aria-pressed`) | bascule clair / sombre (§3.8) | |
| `brand`, `menu-toggle`, `nav-list`, `nav-link`, `submenu`, `submenu-toggle`, `header-group`, `lang-switcher`, `socials` | en-tête | `data-site-nav`, `data-testid="header-socials"` |
| `entries`, `module-html` | bloc « entrées » ; HTML écrit par un module (un skin n'agit que sur la boîte, pas sur ses classes) | |
| `home-flow`, `home-cell` (`data-size="small\|medium\|large\|full"`) | accueil fluide (`vh-flow`, `vh-cell`) | classes `vh-*` |
| `cookie-tray` | bandeau de cookies | `.cookie-tray` |
| `footer-text`, `footer-link`, `credit` | pied | `data-testid="credit"`, `"privacy-link"` |
| `skip-link` | lien « aller au contenu » | |

Les pièces ci-dessus et leurs attributs d'état forment **la liste des noms stables** du contrat (`skinContract` 1). Ajouter une pièce est additif ; en renommer ou en retirer une est cassant (nouveau `skinContract`).

### 9.3 Éléments non masquables (liste d'interdits pour la feuille)

Le kit refuse tout `display:none`, `visibility:hidden`, `opacity < 0.6`, `clip`, `height/width: 0`, `font-size: 0`, `position` hors écran, sur : `brand`, `nav-link`, `nav-list` et `submenu` (sauf `display:none` à l'état fermé, `[data-open="false"]` : c'est la règle du menu mobile que le skin ré-exprime, §9.1), `tools` et ses enfants, `lang-switcher`, `heading`, `prose`, `link`, `button`, `field*`, `card`, `list-item`, `image`/`cover`/`avatar`, `notice`, `stat`, `tab`, `pagination*`, `cookie-tray`, `footer-link`, `credit`, `skip-link`, **`mode-switch`**, `mode-option`, et les deux variantes de logo. Le crédit « Propulsé par » et le lien « Confidentialité » sont des **constantes du cœur** : un skin ne peut ni les masquer, ni en changer le texte, le lien ou le contenu (`content`, `font-size`, `color` identique au fond refusés par le contrôle de contraste rendu). **Exception unique** : `menu-toggle` peut être `display:none` **si** `nav-list` est alors affiché en permanence (le kit le vérifie dans le navigateur aux quatre largeurs : tous les liens du menu ont une boîte visible sans interaction).

---

## 10. Administration (page « Apparence »)

Archétype : Emma, créatrice non technique (**pas** une personne réelle). Mots simples, mobile d'abord, FR + EN en parité exacte, erreurs sous le champ avec un exemple, options avancées repliées.

### 10.1 Où

Une page **Apparence** (`/admin/appearance`, rubrique *Administration* du menu) qui reprend l'onglet « Apparence » de Réglages (palette, police, halo, fond, en-tête) et ajoute les skins. L'onglet de Réglages garde un lien « Aller dans Apparence ». L'administration elle-même n'est jamais restylée (son thème reste `adminThemeCss`).

### 10.2 Écran (mobile d'abord)

1. **Le skin actuel** : une carte avec son aperçu, son nom, « Skin de base » ou l'auteur, boutons [Changer de skin] (et [Mettre à jour] s'il y a une version plus récente).
2. **Choisir un skin** : une grille de cartes à une colonne sur mobile (aperçu, nom, une phrase, pastilles « Clair »/« Sombre »). Toucher une carte ouvre un **aperçu en plein écran** (la vraie page d'accueil du site avec ce skin, bouton « Essayer » / « Annuler »). Aucun enregistrement avant « Utiliser ce look ».
3. **Ajouter un skin** : le catalogue officiel (même mécanique que *Extensions → Ajouter* : recherche, fiche, installation en un clic). Dessous, replié : « Ajouter depuis une adresse (avancé) ».
4. **Mes retouches** : couleurs (un seul mode ou clair et sombre, §3.7), police, halo, fond, en-tête (existant). À côté de chaque réglage retouché, « ↺ Valeur du skin ». Bouton général **« Revenir au skin »** (avec confirmation courte).
5. **Options du skin** (si le skin en déclare) : densité, etc. en choix simples.
6. **Mises à jour** et **Retirer** (replié) ; crédits des polices et images du skin (« Voir les licences »).

Mots à utiliser (FR / EN, clés `skins.*` du dictionnaire) : le mot **« skin »** partout, côté personne comme côté technique (décision du propriétaire : « un skin parle à tout le monde »). La page s'appelle « Apparence » / *Appearance* ; l'objet choisi est un « skin » / *skin*. Exemples : « Choisir un skin » / *Choose a skin* ; « Revenir au skin » / *Reset to the skin's values* ; « Ce skin n'est pas assez lisible, il n'a pas été installé. » / *This skin isn't readable enough, so it wasn't installed.* ; « Ce skin ne vient pas de la liste vérifiée. » / *This skin isn't from the verified list.*

### 10.3 Aperçu de l'éditeur

L'éditeur de contenu (page, entrée, accueil) montre le skin actif sur son aperçu. L'aperçu d'un skin **non activé** (écran 2) est une page `/admin/appearance/preview/<id>` rendue par le même code que le site public avec `data-skin="<id>"` forcé, réservée aux administrateurs connectés, `noindex`, jamais mise en cache partagée.

### 10.4 Messages

Toujours en mots simples, sous le champ concerné, avec un exemple : « Le texte serait trop pâle sur ce fond. Essayez un fond plus sombre, par exemple `#1d1d21`. » Les rapports de contraste en chiffres sont dans « Détails » (replié).

### 10.5 Dépôt personnel

« Ajouter depuis une adresse » : champ + [Vérifier]. Le cœur clone, valide, et montre un résumé : nom, auteur, **licences des polices et images**, taille, résultat du contrôle de lisibilité. Confirmation explicite (case + bouton) : « Ce skin ne vient pas de la liste vérifiée. Il ne peut pas faire tourner de programme : il ne peut changer que l'apparence. Je l'ajoute. » Le dépôt est mémorisé avec `source: "personal"` ; il n'est pas ajouté au catalogue.

### 10.6 Assistant IA / MCP

Même philosophie que les outils `maintenance_*` existants : **lecture** (`appearance_status` : skin actif, retouches, avertissements de lisibilité ; `appearance_skins` : installés et du catalogue) et **demande** (`appearance_request_skin` : « changer pour le skin X » crée une demande en attente que la personne confirme dans l'administration, comme `maintenance_request_status`). Aucun outil n'installe ni n'active sans validation humaine ; aucun ne lit ou n'écrit de contenu.

### 10.7 Mises à jour, retour arrière, sauvegarde, retrait

- **Mises à jour** : comme pour les modules (version du catalogue ≠ installée → encart « Mise à jour disponible » ; aussi un onglet dans *Mises à jour*). Mettre à jour installe `DATA_DIR/skins/<id>/<nouvelle version>/` **à côté** de l'ancienne, valide (dont lisibilité), puis bascule le pointeur ; échec = rien ne change.
- **Retour arrière** : la version précédente reste installée (`skin.installed[].previous`) ; bouton « Revenir à la version d'avant » tant qu'on n'a pas installé la suivante.
- **Sauvegarde / restauration** (`src/core/backup`, `docs/BACKUP.md`) : la sauvegarde contient `skin.active`, `skin.installed` (dépôt, `ref`, version), `skin.options`, `skin.snapshot` et les retouches (clés `theme.*`…), **pas** les fichiers des skins : ils sont **réinstallés depuis leur dépôt à la restauration**, comme les modules (`ref` épinglé). Si le dépôt est injoignable, ou `minCore`/contrat non satisfait : basic s'applique, les retouches sont gardées, le bilan de restauration dit « Le skin X sera réinstallé dès que possible », et il se réactive à l'installation réussie.
- **Retirer** : retire les fichiers ; si c'était le skin actif, `skin.active` redevient `"basic"` ; les retouches restent ; `skin.options` est nettoyé.

---

## 11. Pages concernées et exclues

| | Skinné ? |
|---|---|
| Accueil, pages, listes, entrées, pages de modules (`src/app/(site)/**`), `/privacy`, 404 du site | **oui** |
| En-tête, menu, pied, bandeau, bandeau de cookies | **oui** |
| Administration (`/admin/**`), connexion | **non, jamais** |
| Overlays OBS (`/overlays/[key]`) | **non** (reçoivent seulement les couleurs `--v-*` effectives) |
| Pages autonomes de modules (`<!doctype html>` propres : pairage, télécommande, raids, histoire de stream, liens de plateformes) | non en V1 (elles portent leurs propres styles ; elles lisent les `--v-*` effectifs si elles le font déjà) |
| Flux RSS, `llms.txt`, plan du site, images générées | sans objet |

---

## 12. Migration des sites existants

**Exigence : AUCUNE action manuelle, AUCUN changement visuel, AUCUNE perte.**

1. **Données** : aucune migration. `skin.active` absent = `basic` ; les clés `theme.*` et `header.layout` gardent leur sens de « valeur choisie », basic fournit les défauts qui étaient codés en dur. Les clés d'identifiants de palettes anciennes (`rosaliax` → `ember`) et les palettes (`THEME_PRESETS`) ne sont pas touchées.
2. **Rendu** : basic = `globals.css` actuel + jetons de §4.2 + règles du cœur sur les régions/pièces, construits de façon que chaque utilitaire résolve à **la même valeur calculée** qu'aujourd'hui. Les règles `data-accent2` / `data-surface` du cœur sont conservées telles quelles (elles font partie de basic).
3. **Modules** : les modules existants (sans clé `skin`) sont intacts. Les modules convertis (lot dédié) gardent la valeur actuelle comme dernier repli.
4. **Preuve (obligatoire avant toute publication)** : harnais de **comparaison d'images avant/après** : `scripts/skin-visual-diff.mjs`. Capturer d'abord le site *avant* tout refactor (cœur v0.2.14 + modules v1.22.0 de référence), puis après chaque lot. Matrice : **toutes les pages publiques** (accueil avec chaque type de bloc/panneau/héros, page, liste d'entrées en liste/cartes/pastilles, entrée, privacy, 404, recherche, pagination, menu ouvert/fermé et sous-menu ouvert, bandeau de cookies ouvert, quatre `header.layout`) × **toutes les pages publiques des modules** (une page avec données de test par module avec affichage public) × **sombre et clair** (palettes `night` et `daylight`, plus `data-accent2` et `data-surface`, plus fonds et halos) × **390, 768, 1280, 1920 px** × focus visible sur le premier élément. Chromium fixe (`/opt/pw-browsers/chromium`), animations coupées, horloge figée, polices système fixées. **Tolérance : 0 pixel différent** sur basic ; toute différence est expliquée ou corrigée avant d'avancer.
5. **Le test d'architecture** : un test vérifie que basic redéfinit chaque jeton du vocabulaire, que chaque `@theme inline` a le repli de basic, et qu'aucune classe `rounded-*`, `text-*`… sans passage par la liaison n'a été ajoutée dans `src/components/site` (étend `tests/core/components-colors.test.mjs`).

---

## 13. Le kit de test des skins

Commande : `npm run skin:check -- <dossier-du-skin>` (équivalent : `node testsupport/skins/check.mjs <dossier>`), même esprit que `npm run module:check` (`docs/TESTSUPPORT.md`) : rapport ✅ / ❌ / ⚠️ avec « ce qui ne va pas, pourquoi, comment corriger » ; `--json`, `--strict`, `--visual` (niveau navigateur, Chromium), `--seulement id1,id2`. Code de sortie ≠ 0 si une exigence obligatoire échoue. Le dépôt `curiosa-skins` l'exécute sur chaque skin avant fusion, et le cœur **réutilise la même bibliothèque** (`validateSkin()`, `sanitizeSkinCss()`, `checkReadability()`) à l'installation : ce qui passe le kit passe l'installation.

| Niveau | Exigences (obligatoires sauf mention) |
|---|---|
| **Manifeste** | `skin.json` valide ; `id` = dossier ; FR + EN pour `name`/`description` ; `version`, `skinContract`, `minCore` ; licence SPDX autorisée ; tags du vocabulaire ; `modes` ; `previews` avec `alt` |
| **Ressources** | chaque fichier de `fonts/` / `images/` listé dans `assets` avec licence + fichier de licence ; signatures ; plafonds §5.3 ; SVG assaini ; aucune URL absolue ni `data:` nulle part |
| **Jetons** | couleurs de base présentes par mode ; types valides ; jetons inconnus ⚠️ ; jetons de modules sans module ⚠️ |
| **Feuille** | analyse PostCSS : sélecteurs §6.1, at-règles §6.2, propriétés/valeurs §6.3, plafonds ; `!important` ; `content` ; `animation` hors `prefers-reduced-motion: no-preference` |
| **Principe fondateur (§0)** | aucune règle de masquage ou d'injection (§6.3, §9.3) ; sélecteurs uniquement sur régions/pièces connues ; aucune option qui ne soit pas un jeton |
| **Lisibilité** | les 12 paires du §7.1, par mode ; focus ; cibles ; interligne |
| **Navigateur (`--visual`)** | rendu du banc d'essai (§14) en clair/sombre à 390 / 768 / 1280 / 1920 + les `breakpoints` du skin ; contraste **rendu**, ordre de lecture/tabulation (§6.5), tous les liens du menu visibles et atteignables au clavier (Tab parcourt tous les liens, Échap ferme les sous-menus), pas de défilement horizontal de la page, pas de texte coupé (`scrollWidth` > `clientWidth` sur les pièces de contenu), focus visible |
| **Bascule clair/sombre** | skin à deux modes : la pièce `mode-switch` existe, est visible et opérable au clavier aux quatre largeurs, ses trois états sont distincts et lisibles ; basculer ne change **aucun** texte ni élément (seuls les jetons changent) ; contrôle de lisibilité refait dans chaque mode après bascule ; skin à un mode : pas de pièce |
| **Régression de basic** | exécuté sur basic : captures identiques à la référence (§12) |
| **Neutralité** | aucun nom de site/association/ville dans les textes et exemples du skin (`.neutrality-terms`) |

Tests du cœur (en plus du kit) : `tests/core/skins-*.test.mjs` : assainisseur (corpus d'attaques : `@import`, `url(https://…)`, `expression`, `</style>`, séquences d'échappement CSS, `\0`, sélecteurs hors portée, classes, `content: attr()`, `display:none` sur chaque pièce de §9.3, propriétés hors liste, plafonds) ; composition (repli valeur par valeur, ordre des couches, options, retouches, mode imposé) ; contrôle de lisibilité (échelle de correction) ; installation (refus, mise à jour atomique, retour arrière, sauvegarde/restauration, dépôt personnel) ; migration (aucune clé écrite pour un site existant) ; neutralité (les 4 skins + basic).

---

## 14. Le banc d'essai

But : un auteur teste son skin **sans installer un site entier**.

- `npm run skin:bench -- <dossier-du-skin> [--port 4600] [--shots <dossier>]` démarre un petit serveur Node (sans base de données ni Next) qui sert une page `/` : la **coquille réelle** du site (mêmes régions et pièces que §9) remplie de **fragments HTML de démonstration**, avec la même fonction `composeSkin()` que le site réel (donc le même assainissement et le même repli). Les fragments sont **générés à partir des vrais composants du cœur** (rendu statique avec des données de test fixes) par `npm run skin:bench:refresh` dans le cœur et versionnés dans `testsupport/skins/bench/fragments/` (un test vérifie qu'ils sont à jour). Les modules apportent leur fragment via `skin.demo` (§8.2) ; sans lui, un gabarit générique selon `kind`.
- La page liste **toutes** les pièces du §9.2 (avec leur nom en légende, dans un bandeau de la page de démonstration qui n'est pas dans le DOM mesuré), dans tous leurs états (normal, survol simulé par une classe de démonstration, focus, désactivé, erreur), plus les quatre `header.layout`, une accueil fluide avec les quatre tailles de morceaux, un menu à sous-menus ouvert, le bandeau de cookies, et les pièces des modules installés **dans le dépôt de skins** (`--modules <dossier>` pour lire leurs `module.json`).
- Un bouton « Clair / Sombre / Appareil » (le banc seul, pas le site réel) et un sélecteur de largeur (390, 768, 1280, 1920 + les `breakpoints`).
- `--shots` produit les captures PNG de toutes les combinaisons (clair/sombre × largeurs) avec Chromium et lance le contrôle `--visual`. Ce sont les captures que le propriétaire verra avant publication.
- Un mode « page réelle » : `npm run skin:bench -- <dossier> --site http://localhost:3000` applique le skin en mémoire à un site local de développement (en lecture seule, sans toucher à ses réglages) pour voir ses vraies pages.

---

## 15. Sécurité et vie privée (récapitulatif)

- **Aucune exécution de code** (§6) : pas de JS, pas de React, pas d'`@import`, pas d'expression. Un skin est de la donnée assainie.
- **Portée** : toutes les règles préfixées `:root[data-skin="<id>"]` ; jamais l'administration, les overlays, les routes `/m`.
- **Liste blanche** de sélecteurs, d'at-règles, de propriétés, de valeurs (§6) ; plafonds de taille et de nombre de règles ; sortie assainie recalculée côté serveur (le fichier source n'est jamais servi).
- **Aucune ressource tierce** : toute URL non `skin:` est refusée. Polices (`.woff2`) et images **servies par le site lui-même** depuis `/skins/<id>/<version>/…` (même origine) ; aucune requête vers Google Fonts, un CDN ou GitHub chez le visiteur. Les aperçus ne sont chargés que par l'administration, depuis le site (copie locale). Aucune ressource de skin n'est conditionnée par un cookie ; aucun suivi.
- **Licences** : toute ressource a sa licence listée et affichée dans « Voir les licences » ; liste d'identifiants SPDX autorisés ; `THIRD-PARTY-NOTICES.md` n'embarque pas les skins (ils sont installés, pas livrés).
- **Préférence clair/sombre** : `localStorage` du navigateur uniquement, jamais envoyée, déclarée dans `privacy` et la page de confidentialité (§3.8) ; aucun cookie ajouté ; bandeau de cookies inchangé.
- **Pas de minuteur de fond** : composition calculée à la demande avec cache expirant (10 min) ; rien ne tourne en arrière-plan ; vérification de mises à jour des skins avec celle des modules (déjà planifiée par le cœur).
- **Catalogue relu** (`ref` épinglé) ; dépôt personnel avec confirmation explicite (§10.5).
- **Écritures** : l'installation d'un skin exige le droit propriétaire (comme les modules) ; audit (`src/core/audit.ts`) : installation, activation, mise à jour, retrait.
- **Accessibilité** : contrôles §7 ; `prefers-reduced-motion` toujours respecté ; ordre de lecture (§6.5).
- **L'administration n'est jamais prise au piège** : un skin ne la touche pas ; un skin illisible est corrigé ou suspendu (§7.3).

---

## 16. Limites assumées

**Ce qu'un skin ne peut PAS faire en V1 (et ne pourra pas, §0) :**

- Changer le HTML : pas de wrapper, pas de balisage propre à un skin, pas de réordonnancement du DOM (seulement l'ordre visuel, borné).
- Ajouter, retirer, renommer, masquer un élément de contenu ou d'action ; injecter du texte ; fournir une image porteuse d'information.
- Définir un bloc, une section, un champ, un emplacement ou un réglage de contenu.
- Exécuter du code (JS, composants), charger une ressource d'un tiers, ouvrir une connexion.
- Restyler l'administration, les overlays OBS, les pages autonomes des modules.
- Styler des classes Tailwind ou de module (seules les régions et les pièces déclarées sont stables).
- Changer le comportement du menu (ouverture, clavier : JS du cœur ; le skin n'en change que l'apparence, y compris les points de rupture).

**Évolutions possibles (aucune n'est engagée) :**

- Nouvelles pièces et nouveaux jetons (additif, sans changer `skinContract`).
- Agencement supplémentaire **des mêmes éléments** dans des pièces que le cœur définit (par exemple d'autres dispositions d'en-tête fournies par le cœur et choisies par jeton). Les « gabarits déclaratifs » avec éléments propres au skin sont **écartés**.
- Pièces des modules pour les pages autonomes.
- Overlays qui lisent aussi les jetons non couleur.

---

## 17. Exemple complet d'un skin minimal

Dépôt `curiosa-skins`, dossier `skins/plain-light/` (un seul mode clair, aucune ressource embarquée).

**`skins/plain-light/skin.json`**

```json
{
  "skinContract": 1,
  "id": "plain-light",
  "name": { "fr": "Clair simple", "en": "Plain light" },
  "description": {
    "fr": "Un fond clair, un texte sombre, des angles légèrement arrondis. Sert d'exemple.",
    "en": "A light background, dark text, gently rounded corners. Serves as an example."
  },
  "version": "1.0.0",
  "minCore": "0.4.0",
  "author": { "name": "Équipe Curiosa" },
  "license": "MIT",
  "tags": ["light", "sans", "minimal"],
  "modes": ["light"],
  "tokens": "tokens.json",
  "stylesheet": "skin.css",
  "previews": [
    { "file": "previews/home.webp", "mode": "light", "width": 1280, "alt": { "fr": "Page d'accueil", "en": "Home page" } }
  ],
  "assets": [],
  "defaults": { "headerLayout": "classic", "font": "sans", "glow": "none", "background": "none" },
  "options": [],
  "breakpoints": [640],
  "supports": { "reducedMotion": true }
}
```

**`skins/plain-light/tokens.json`**

```json
{
  "light": {
    "--v-bg": "#fafaf7",
    "--v-surface": "#ffffff",
    "--v-fg": "#1b1b1f",
    "--v-accent": "#1d4ed8"
  },
  "dark": {},
  "common": {
    "--sk-radius-card": "0.5rem",
    "--sk-radius-button": "0.5rem",
    "--sk-radius-field": "0.5rem",
    "--sk-page-width": "46rem",
    "--sk-shadow-card": "0 1px 2px rgb(0 0 0 / 0.08)"
  },
  "modules": {}
}
```

**`skins/plain-light/skin.css`** (le cœur préfixera chaque sélecteur par `:root[data-skin="plain-light"]`)

```css
/* Les cartes ont une ombre légère et se soulèvent au survol. */
[data-skin-part="card"] {
  box-shadow: var(--sk-shadow-card);
  transition: transform var(--sk-duration) var(--sk-ease), box-shadow var(--sk-duration) var(--sk-ease);
}
@media (prefers-reduced-motion: no-preference) {
  [data-skin-part="card"]:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgb(0 0 0 / 0.12); }
}

/* Un filet d'accent sous l'en-tête. */
[data-skin-region="header"] { border-bottom: 2px solid var(--v-accent); }

/* Boutons pleins : texte gras, majuscule initiale conservée. */
[data-skin-part="button"][data-btn="primary"] { font-weight: var(--sk-weight-bold); }

/* Mise en page : contenu centré et menu à droite sur grand écran. */
@media (min-width: 40rem) {
  [data-skin-region="header"] { display: flex; justify-content: space-between; align-items: center; }
}
```

Ce skin est valide : jetons connus, sélecteurs sur pièces et régions, aucune ressource, contraste `#1b1b1f` / `#fafaf7` ≈ 16:1, `#1d4ed8` / `#fafaf7` ≈ 6,5:1, `#ffffff` sur `#1d4ed8` ≈ 6,7:1.

---

## 18. Plan de mise en œuvre (voir `docs/ideas/skins-effort.md`)

Ordre recommandé : harnais d'images **d'abord** (sinon aucune preuve) → jetons + basic + composition → DOM stable/régions → conversion des composants → pièces des modules → installation depuis un dépôt → assainisseur + lisibilité → page Apparence → kit + banc → conversion module par module → les quatre skins.

---

## 19. Décisions du propriétaire et questions encore ouvertes

**Tranchées par le propriétaire (reportées dans le document)** :

| Sujet | Décision | Où |
|---|---|---|
| Vocabulaire | « **skin** » partout, côté personne et technique ; la page s'appelle « Apparence » | §10 |
| Retouche des couleurs d'un skin à deux modes | la personne choisit **un seul mode OU les deux** (clair et sombre), avertissement de lisibilité en direct, jamais bloquant ; clés `theme.light.*` / `theme.dark.*` | §3.7 |
| Bascule clair/sombre par le visiteur | **oui** : Automatique / Clair / Sombre, `localStorage` seul, script externe du cœur, pièce non masquable ; le bandeau de cookies ne change pas | §3.8 |
| Crédit « Propulsé par » et lien Confidentialité | constantes, non masquables, non modifiables par un skin | §9.3 |
| Lisibilité | AA obligatoire, AAA en conseil, basic exempté | §7 |
| Catalogue officiel | relu par le propriétaire, kit en CI du dépôt de skins, `ref` épinglé | §5.5, §13 |
| Version du cœur | **nouvelle version majeure** ; espace réservé `0.4.0` (voir Q-A) | partout (`minCore`) |
| Modules | un module qui ajoute la clé `skin` et **change son apparence publique par défaut** passe en **version majeure** ; sinon **mineure** (repli = valeur actuelle, rendu identique) ; un module qui ne change rien d'autre : correctif | §8.6 |
| Pages autonomes de modules | plus tard, seulement si elles déclarent des pièces | §11 |
| Palettes prêtes à l'emploi (`THEME_PRESETS`) | gardées comme retouches (en mode « un seul mode » ; en « clair et sombre », proposées par mode) | §3.7 |
| `data-skin` | réservé, aucun conflit | §3.6 |
| Polices de titres, `clip-path: polygon()` | pas en V1 | §6.3, §16 |
| `header.layout` | la retouche de la personne gagne ; le skin donne la valeur de départ et reste correct avec les 4 variantes | §3.2, §9.1 |

**Encore ouverte (courte)** :

- **Q-A** Version du cœur qui livre les skins : `0.4.0` retenu comme espace réservé ; **ou `1.0.0`** ? À confirmer par le propriétaire (tous les `minCore` d'exemple changent en conséquence).
- **Q-B** (tranchée, implémentée au lot S1) : la feuille d'un skin PEUT cibler le choix du visiteur : `[data-mode="light"]` / `[data-mode="dark"]` est permis **en tête de sélecteur seulement**, seul ou après le préfixe `:root[data-skin="<id>"]` ; la sortie est `:root[data-skin="<id>"][data-mode="dark"] …`. Ailleurs, `data-mode` reste refusé. `data-mode` est absent en « Automatique » : pour le mode de l'appareil, un skin utilise ses jetons `light`/`dark`.
- **Q-C** (tranchée) : `--sk-color-heading` est un jeton **facultatif** ; défini, la paire « titres » est contrôlée à 3:1, sinon ignorée.

---

## 20. Notes de mise en œuvre du lot S1 (jetons, basic, composition, bascule)

| Sujet | Où | Précisions |
|---|---|---|
| Vocabulaire des jetons | `src/core/skins/tokens.ts` | 87 jetons (§4.2), un type et une propriété CSS « représentative » chacun ; `validateTokenValue()` = sûreté de la feuille + forme du type + **mêmes bornes que l'assainisseur** (texte ≥ 0,6875 rem, durée ≤ 600 ms, cible ≥ 2,75 rem…). Jeton inconnu : ignoré sans erreur ; valeur refusée : repli sur basic + avertissement ; les `var()` sont suivis (`literalOf`) et la valeur finale contrôlée. Ajouts : `--sk-text-6xl`, `--sk-weight-normal`, `--sk-tracking-wider/-widest`, `--sk-radius-3xl`, `--sk-color-heading`. `--sk-shell-areas` accepte des chaînes. |
| Basic | `src/core/skins/basic/` | `skin.json`, `tokens.json`, `skin.css` (vide). Un seul mode (sombre), pas de `color-scheme`, `deriveFromBackground` : retoucher fond/accent/texte/cartes donne `buildPalette(…)` comme avant les skins (400 combinaisons testées). |
| Liaison Tailwind | `src/app/globals.css` | `@theme inline` : 30 échelles avec pour repli la valeur de Tailwind ; focus et accueil fluide aussi. L'administration n'a pas de `--sk-*`. Seul écart compilé : `shadow-lg` n'injecte plus `--tw-shadow-color` (aucune ombre colorée utilisée). |
| Composition | `compose.ts` (pure), `sheet.ts`, `render.ts`, `folder.ts` | basic < pièces des modules (`moduleParts.ts`) < skin actif < retouches. Cache borné dont la clé contient tout (dont un numéro de génération) ; aucun minuteur. Le skin actif est celui du **registre du lot S5** (`service.loadInstalledSkin` : contrôle complet, empreinte du contenu relue, mémoire de 10 min) ; `folder.ts` ne fait que le mettre sous la forme `SkinDefinition`. `invalidateSkinCache()` (`invalidate.ts`) est appelée après chaque écriture du registre (installation, mise à jour, retour arrière, retrait, restauration) et après l'installation ou le retrait d'un module. |
| Retouches | `retouch.ts` | `theme.*` inchangés ; `theme.palette` et `theme.light.*` / `theme.dark.*` lus et composés (écran de saisie : S7). En « un seul mode », un fond retouché rend le site mono-mode (luminance) ; sans fond retouché, les autres couleurs vont aux deux modes. |
| Lisibilité | `compose.ts` | `correctReadability()` par mode d'un skin (jamais basic) ; irrécupérable = couleurs de basic pour ce mode, notice dans `Composed.notices` (affichage : S7). |
| Bascule | `modeScript.ts`, `src/app/skins/mode.js/route.ts`, `ModeSwitch.tsx`, `Header.tsx` | §3.8. `/skins` est un chemin réservé. Pièce posée à côté du sélecteur de langue, dans la région `tools` (lot S2). Logos : deux `<img data-for>` par rôle si les deux variantes existent. |
| Confidentialité | `privacy.ts`, `docs/PRIVACY.md` | La ligne « Clair ou sombre » n'est ajoutée à `/privacy` que si la bascule existe : basic ne change pas la page. |
| Sauvegarde | réglages génériques | `skin.active`, `skin.installed`, `skin.options`, `theme.*` sont des réglages : déjà sauvegardés/restaurés (testé). Absents = basic. Les fichiers des skins ne sont pas sauvegardés (S5 les réinstalle). |

## 20.2 Notes de mise en œuvre du lot S2 (DOM stable, coquille, menu)

**Résultat vérifié** : 1 168 captures du site (6 profils, 4 largeurs, clair et sombre, états : menu ouvert, sous-menu, cookies, focus, formulaire en erreur) **identiques à la référence v0.3.1 au pixel près** après S2 puis après S3 ; contrôle du DOM dans un navigateur (`npm run visual:dom`, 3 952 contrôles, 0 écart) ; `tests/core/skins-dom.test.mjs` (cohérence DOM ↔ liste blanche).

| Sujet | Réalisé | Écart avec le schéma du §9.1 |
|---|---|---|
| Coquille | `<div data-skin-region="shell">` (display:block) contient `banner`, `header`, `main` (> `content`), `footer` ; `backdrop`, le lien d'évitement et `tray` sont avant ; `data-skin-root` sur `<body>` ; zones nommées (`grid-area`) posées sur les quatre régions, jetons `--sk-shell-columns` / `--sk-shell-areas` | `content` est un élément à part dans `main` (il porte la largeur) et non la pile de `Blocks` (qui sert aussi au bandeau et au pied, avec un autre espacement) |
| En-tête, pied | l'en-tête et le pied sont **eux-mêmes** le conteneur centré : `padding-inline: max(--sk-page-pad-x, (100% − --sk-page-width)/2 + --sk-page-pad-x)` (même géométrie qu'avant : `max-w-5xl mx-auto px-4`) ; `width: var(--sk-header-width, auto)` | pas de `div` intérieur propre à un skin |
| Variantes d'en-tête | les quatre gardent leur balisage, avec les mêmes pièces ; deux pièces ajoutées pour les agencer : `header-group` (groupes, `display:contents` possible) et `submenu-toggle` ; `tools` est un groupe sans boîte (`contents`) en `classic` et `minimal`, une rangée en `centered` et `twoRows` (où il apparaît **deux fois** : liens/réseaux/bouton, puis langue/bascule) | l'ordre du DOM de `twoRows` est marque, outils, menu, langue (celui des deux rangées d'avant) |
| Menu responsive | les classes `sm:` / `max-sm:` de SiteNav, MenuToggle, BrandLogos sont dans `globals.css` (règles sur `nav-list`, `menu-toggle`, `submenu`, `submenu-toggle`, logos `data-logo`/`data-paired`) ; état = `data-open="true/false"` et `aria-expanded` ; points de rupture 40 rem | menu sobre (`minimal`) : le panneau n'est dans le DOM que **ouvert** (sa région `nav` n'existe pas fermé) |
| Pièces ajoutées | `header-group`, `submenu-toggle`, `entries` (bloc d'entrées), `module-html` (boîte du HTML d'un module) ; pièce **retirée** : `select` (aucun menu déroulant de formulaire sur le site public) | les 4 + 1 sont dans `allowlist.ts` ; `mode-switch` est dans `tools` |
| Cohérence | `tests/core/skins-dom.test.mjs` : chaque région/pièce émise est dans l'allowlist ET chaque région/pièce de l'allowlist est émise ; l'assainisseur accepte un sélecteur sur chacune ; plus de classe responsive dans le menu | |
| Navigateur | `scripts/visual/dom-check.mjs` : régions, ordre du DOM, ordre de tabulation = ordre du DOM sur 4 profils × 2 largeurs × 9 pages, menu mobile (ouvrir, Échap, clic ailleurs), menu large (survol, ↓, Échap) | |
| Skin d'essai | `docs/ideas/skins-s2-run/skin-side-column/` : colonne latérale à gauche pour la marque, le menu et les outils (à partir de 40 rem), contenu étroit centré (40 rem), cartes en blocs à ombre dure, accueil en grille. `scripts/visual/skin-proof.mjs` : sur 36 pages (4 largeurs), **mêmes textes, liens, images, titres, éléments focalisables, ordre de tabulation, aucun élément visible masqué, aucun défilement horizontal**, avec et sans le skin | |

**Ce qu'un skin peut maintenant faire** : colonne latérale (gauche ou droite) pour l'en-tête, en-tête en bandeau, menu en colonne / rangée / grille (`nav-list`, `nav-link`), outils déplacés (bas de colonne, coin), largeur et alignement du contenu, grille ou liste ou maçonnerie pour les entrées (`list[data-kind]`) et les morceaux de l'accueil (`home-flow`, `home-cell[data-size]`), cadres, ombres, formes.

**Ce qui reste impossible à un skin avec ce DOM** (honnêtement) : placer du contenu **entre** la marque et le menu ; une barre latérale de contenu (pas de région `aside`) ; réordonner le DOM (seulement l'ordre visuel) ; un en-tête sobre dont le menu serait toujours visible (en `minimal`, le panneau n'existe pas fermé) ; choisir la mise en page par page (le DOM est le même partout) ; cibler les classes d'un module ; changer le comportement du menu (ouverture, clavier : JS du cœur) ; et la hauteur d'une colonne `position: sticky` suit la fenêtre, pas la page (donc rien de « plein écran » sur les captures pleine page).

## 20.3 Notes de mise en œuvre du lot S3 (composants par les jetons)

| Sujet | Réalisé |
|---|---|
| Rayons | `rounded-card`, `-panel`, `-button`, `-field`, `-chip`, `-media`, `-avatar` (liaisons `@theme inline` : jeton de pièce, puis échelle, puis la valeur d'avant) ; plus aucun `rounded-xl/2xl/full` dans `src/components/site` ni `src/app/(site)` |
| Bordures | utilitaires `border-token`, `border-token-strong`, `border-t/b/y-token` (jetons `--sk-border-width(-strong)` et `--sk-border-style`) |
| Cibles, largeurs, rythme | `min-h-target` / `min-w-target` / `h-target` (`--sk-target`), `max-w-[var(--sk-prose-width…)]`, `space-y-[var(--sk-stack-gap…)]` (pile des blocs), grille des cartes (`--sk-cards-min`, `--sk-grid-gap`), interligne (`--sk-leading-body`) |
| Noirs et blancs | `--sk-color-scrim`, `-on-veil`, `-veil-ink` (nouveaux), `--sk-color-veil`, `--sk-color-link` (texte des liens), `--sk-shadow-tray`, `--sk-shadow-pop` ; textes du bandeau de cookies (`--sk-text-tray`, `--sk-text-tray-title`) ; `--sk-radius-avatar` |
| Typographie des pièces | `heading` (police `--sk-font-heading`, casse `--sk-heading-transform`), `eyebrow` (`--sk-eyebrow-transform`) ; lueur `--sk-glow` sur les boutons ; ombre `--sk-shadow-card` sur les cartes |
| Jetons facultatifs | `--sk-color-selection` et `--sk-color-heading` : **appliqués par le cœur seulement quand un skin les définit** (rien sous basic) |
| Test d'architecture | `tests/core/skins-components.test.mjs` : aucune valeur d'apparence en dur dans les classes, repli = valeur de basic pour chaque liaison, **chaque jeton du vocabulaire est lu quelque part**, jetons facultatifs |
| Toujours en dur (assumé) | tailles qui sont des contraintes de mise en page et non du style (`max-w-[14rem]` du logo, `max-h-[min(32rem,75vh)]` de la couverture, `90vh`/`70vh`, grille `minmax(10rem,14rem)` des onglets) ; `text-[0.9em]`, `[1em]`, `[1.15em]` (rapports relatifs au texte voisin) ; les modules (lot S9) |
| Harnais | une seule fenêtre de capture à la fois (`--jobs 1`) : en parallèle, le rééchantillonnage des photos varie d'une exécution à l'autre (cause des 3 écarts de galerie du lot S1) ; reprise automatique de Chromium si le système le tue |

Laissé aux lots suivants : saisie des deux modes et encadré de lisibilité (S7), installation (S5 : écrit `skin.installed`), DOM stable / région `tools` (S2), jetons non encore consommés par les composants (S3), registre des pièces de modules (S4).

---

## 21. Installation depuis un dépôt git : ce qui est implémenté (lot S5)

> Le mécanisme existe, **sans interface** (la page Apparence est le lot S7) et **sans toucher au rendu** (le lot S1 écrit les jetons, basic, la composition et la bascule). Rien n'est appliqué au site : on récupère, on contrôle, on pose des fichiers et on note le skin.

### 21.1 Où est le code

| Fichier (`src/core/skins/`) | Rôle | Pur ? |
|---|---|---|
| `manifest.ts` | schéma zod de `skin.json` (§5.2) | oui |
| `validate.ts` | **LA** validation d'un dossier local (manifeste, fichiers, ressources, licences, jetons, feuille, lisibilité) ; partagée par l'installation, l'aperçu, la mise à jour et `skin:check` | lit un dossier, rien d'autre |
| `constants.ts`, `semver.ts` | plafonds (§5.3), licences permises, vocabulaire d'étiquettes, comparaison de versions | oui |
| `source.ts` | récupération git (hôtes autorisés, clone superficiel, sous-dossier) en réutilisant `modules/installer.ts` | réseau |
| `catalogue.ts` | `catalogue/index.json` du dépôt de skins, copie reçue, index supplémentaire | réseau |
| `registry.ts` | registre `skin.installed`, verrou, rangement | base |
| `service.ts` | **l'API interne** (§21.2) | base + réseau |
| `restore.ts` | sauvegarde et restauration (§21.8) | base |
| `serve.ts` + `src/app/skins/[id]/[version]/[dir]/[file]/route.ts` | service HTTP des ressources (§21.7) | fichiers |
| `scripts/skin-check.mjs` | `npm run skin:check -- <dossier>` (§21.9) | lit un dossier |

L'adresse du dépôt officiel de skins est écrite **une seule fois**, dans `core/config.ts` (`DEFAULT_SKINS_REPO`) ; `CURIOSA_SKINS_REPO` la remplace, `CURIOSA_SKINS_REF` choisit l'étiquette lue, `SKINS_INDEX_URL` ajoute un index https supplémentaire.

### 21.2 L'API interne (pour la page Apparence et l'assistant)

Toutes les fonctions rendent `{ ok: true, … }` ou `{ ok: false, error: "skins.error.…", issues?, … }` ; jamais d'exception pour un cas prévu. `issues` sont des problèmes à message simple FR/EN (`SkinIssue`, §6.7).

| Fonction | Rôle |
|---|---|
| `listCatalogue({ fresh?, fetchImpl? })` | skins installables (officiel + index supplémentaire) avec `installed`, `installedVersion`, `updateAvailable` ; catalogue injoignable : `unreachable: true` + `message` FR/EN, les skins installés continuent |
| `inspect(url)` | README (sans HTML ni image), licence, aperçus (en données locales), licences des polices et images, options, taille, résultat complet du contrôle, **sans rien installer** ; un dépôt de plusieurs skins rend la liste `candidates` |
| `install(url, { confirmPersonal?, actor? })` | installe ; dépôt hors catalogue officiel (personnel ou index supplémentaire) : refusé sans `confirmPersonal: true` |
| `installFromCatalogue(id, { confirmExtra?, actor? })` | installe un skin listé (version épinglée par le catalogue) |
| `checkUpdate(id)` | `{ available, target?, level?, needsCore? }` sans rien changer |
| `update(id, { acceptMajor?, actor? })` | étiquette stable la plus haute (dépôt personnel) ou version épinglée du catalogue ; majeure : seulement avec `acceptMajor: true` |
| `revert(id)` · `reinstall(id)` · `remove(id)` | version d'avant · réinstallation depuis le dépôt noté · retrait |
| `installed()` | skins installés + `status` (`ok` · `missing` · `modified` · `invalid`) + `problems` |
| `activeSkinId()` | `skin.active` si les fichiers sont là, sinon `"basic"` |
| `loadInstalledSkin(id)` | manifeste + feuille et jetons **assainis de nouveau** (cache 10 min) pour la composition du rendu |
| `readInstalledPreview(id, version, file)` | octets d'un aperçu, pour l'administration seulement |

### 21.3 Stockage : le réglage `skin.installed` (pas de table)

Décision : la liste vit dans le réglage `skin.installed` (§3.2), les fichiers sous `data/skins/<id>/<version>/`. Pourquoi : la conception le prévoit ; la sauvegarde contient déjà tous les réglages et les remet d'un bloc (aucune migration de base, aucun nouveau format) ; un seul propriétaire par donnée. Une ligne : `id`, `version`, `repo`, `ref` (étiquette ou commit), `subdir`, `source` (`catalogue` ou `personal`), `commit`, `tree` (empreinte git du dossier du skin, sert à voir si une mise à jour existe), `fingerprint` (SHA-256 du contenu installé, relue pour détecter une altération), `installedAt`, `previous` (la version d'avant, gardée sur le disque). Les lectures passent par la base (pas par le cache de requête) et les écritures sont sérialisées.

### 21.4 Garde-fous des modules, réutilisés

Adresse `https://hôte/propriétaire/dépôt[.git][#étiquette-ou-commit[:dossier]]` ; hôtes de `MODULES_ALLOWED_HOSTS` (**le même réglage** : c'est la liste des hébergeurs git de confiance de l'installation) ; dépôts locaux seulement avec `CURIOSA_ALLOW_LOCAL_MODULES=1` ; récupération superficielle, aucun crochet git, protocole `ext` fermé, délai de 90 s ; dossier du skin jamais hors du dépôt ; **adresse du registre revérifiée à chaque usage** (une ligne venue d'une sauvegarde trafiquée ne fait jamais contacter un hôte interdit) ; installation atomique (dossier temporaire puis renommage) ; audit `skin.install`, `skin.update`, `skin.remove`, `skin.refused` (le refus ne note que l'id et le code du premier problème, jamais un extrait du skin).

### 21.5 Ce que la validation refuse (`validateSkinFolder`)

Dans l'ordre : dossier (aucun lien symbolique, un seul niveau `fonts/ images/ previews/ LICENSES/`, noms simples, 60 fichiers, 2 Mo) → manifeste (zod ; id = nom du dossier, `basic` réservé, contrat et `minCore` pas trop récents, licence SPDX permise) → fichiers prévus (tout fichier hors liste est refusé) → plafonds (§5.3) → ressources (extension **et** octets magiques ; SVG réécrit par `sanitizeSvg` ou refusé ; licence, fichier de licence, auteur et source pour chaque police et image) → `tokens.json` (forme, noms, chaque valeur par `sanitizeTokenValue`, plus un contrôle typé des jetons de nature connue, ex. `--sk-text-*` comme `font-size`) → feuille (`sanitizeSkinCss`, `assetBase = /skins/<id>/<version>/`) → lisibilité (`checkReadability`, **chaque mode déclaré**, refus sous AA) → animations sans `supports.reducedMotion`. Un skin refusé n'installe rien (`installFiles` est vide).

### 21.6 Mise à jour, retour arrière, retrait, repli

La nouvelle version est posée **à côté** de l'ancienne, contrôlée comme à l'installation, puis seulement alors le registre bascule ; la moindre erreur laisse tout comme avant (`kept`). Une version qui n'augmente pas est refusée (les adresses de ressources sont éternelles, une version ne change jamais de contenu). La version d'avant reste (`revert`). Retirer : fichiers et ligne partent ; si le skin était actif, `skin.active` redevient `basic` et `skin.options` est nettoyé, les retouches (`theme.*`, `header.layout`) restent. Un skin dont les fichiers manquent ou ont changé n'est pas appliqué : `activeSkinId()` rend `basic` et `skin.active` est gardé ; il se réactive dès que `reinstall` réussit.

### 21.7 La route des ressources

`GET|HEAD /skins/<id>/<version>/fonts/<fichier>.woff2` et `…/images/<fichier>.<png|jpg|webp|avif|svg>` : type fixé par l'extension, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, SVG avec une politique `sandbox`. Les segments sont validés un à un (aucun `..`, aucun nom caché, version `x.y.z`), jamais de lien symbolique, **jamais** la feuille, les jetons, le manifeste ni les aperçus. `/skins/mode.js` (lot S1) n'est pas servi ici. `skins` est un premier segment réservé (`RESERVED_PATHS`).

### 21.8 Sauvegarde et restauration

Les réglages `skin.*` et `theme.*` font déjà partie de `data/settings.json` ; `backup.json` reçoit en plus `skins` (id, version, dépôt, étiquette, commit, source, nom) et `counts.skins`, **seulement s'il y a des skins** (une sauvegarde sans skin est inchangée ; un cœur plus ancien ignore la clé, une sauvegarde plus ancienne n'en a pas). Les fichiers ne sont pas sauvegardés : après le remplacement des données, chaque skin dont les fichiers manquent est réinstallé depuis son dépôt, à l'étiquette notée. Un dépôt **personnel** n'est réinstallé que si la restauration le confirme (`"skin:<id>"` dans la liste de confirmations). Dépôt injoignable, cœur trop ancien ou non confirmé : le bilan le dit (`skins` dans le rapport), `basic` s'applique en attendant, rien n'est perdu. Les skins installés ici et absents de la sauvegarde restent installés ; les dossiers que plus rien ne réclame sont rangés.

### 21.9 `skin:check`

`npm run skin:check -- <dossier> [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z]` : mêmes fonctions que l'installation, messages simples avec « comment corriger », code de sortie 0/1/2. Un dépôt de skins (`skins/<id>/skin.json`) est contrôlé en entier (CI de `curiosa-skins`).

### 21.10 Écarts avec la conception

1. **Registre** : la ligne de `skin.installed` gagne `commit`, `tree`, `fingerprint` (le §3.2 ne les prévoyait pas ; nécessaires pour la mise à jour et la détection d'altération).
2. **Mise à jour majeure** : demande `acceptMajor: true` (le §10.7 disait seulement « signalée »).
3. **Aperçus** : leur absence est un avertissement, pas un refus (§5.2 disait 1 à 4) ; `skin:check --strict` la fait échouer.
4. **Étiquettes** hors vocabulaire et clés inconnues de `skin.json` : avertissement et ignorées (un contrat qui s'enrichit ne casse pas les skins écrits avant).
5. **Fichiers permis à la racine** : `README.md` (ou `README.xx.md`), `LICENSE[.md|.txt]`, en plus de `skin.json`, des jetons et de la feuille.
6. **Jetons** : `sanitizeTokenValue` + un contrôle typé pour quelques noms (`--sk-text-*`, `--sk-leading-*`, `--sk-radius-*`…) ; la validation par type de **tout** le vocabulaire reste au lot « jetons » (S1), de même que l'avertissement « jeton inconnu ».
7. **Commande** : `scripts/skin-check.mjs` (pas `testsupport/skins/check.mjs`) ; les niveaux navigateur (`--visual`), le banc d'essai et le test de neutralité des textes d'un skin restent à faire. À l'installation, les pièces des modules ne sont pas fournies (toute pièce `module.piece` bien formée passe : on ne sait pas quels modules viendront). Au rendu, `loadInstalledSkin` fournit les pièces des modules installés : la règle visant la pièce d'un module absent est retirée avec un avertissement (jamais une erreur), le reste du skin s'applique. Les paires de couleurs des modules ne sont pas fournies à la validation : c'est la composition qui les corrige (paire 11).
8. **Constante officielle** : dans `core/config.ts` et non sous `core/skins/` (le test de neutralité de la bibliothèque interdit un nom de dépôt réel dans ses sources).

---

## 22. Notes de mise en œuvre du lot S4 (pièces des modules)

| Sujet | Où | Précisions |
|---|---|---|
| Manifeste | `src/core/modules/skinDecl.ts`, `manifest.ts` | Clé `skin` (zod strict, additive, sans dépendance lourde : le manifeste est lu par le garde de `permissionsPolicy`). Règles liées à l'id du module dans `moduleSkinIssues()` (préfixes, doublons, `on`, 24 jetons). `kind` facultatif ; noms et descriptions FR **et** EN. |
| Validation des valeurs | `src/core/skins/moduleSkin.ts` | `analyzeModuleSkin(id, skin)` : chaque défaut passe `validateTokenValue` (= `sanitizeTokenValue` + forme du type + bornes de la propriété représentative) ; références limitées aux jetons communs et à ceux du module ; messages FR/EN en parité (`module-*` dans `messages.ts`). `buildModuleSkinLayer(modules)` : couche 2 (ordre d'identifiant, préfixes, doublons). |
| Lecture et cache | `src/core/skins/moduleParts.ts` | `getModuleSkinLayer()`, `invalidateModuleSkinLayer()` (appelée par `forgetModule` et `resetModuleRegistry`), `createLayerCache(source)` (injectable pour les tests). Aucun minuteur (test sur le texte). |
| Composition | `compose.ts` | Inchangée sauf un correctif : les défauts passés à l'échelle de correction de la paire 11 sont ceux du MODULE (`moduleBase`), pas ceux du skin. |
| Feuilles de skin | `service.ts`, `render.ts` | `loadInstalledSkin(id, { moduleParts })` : la feuille est assainie avec les pièces installées (mémoire selon l'empreinte de la liste, `partsSignature`) ; `activeSkin(moduleParts)`. |
| Kit des modules | `testsupport/requirements/skin.mjs` | `skin.valid`, `skin.parts`, `skin.fallback`, `skin.noMasking`, `skin.demo` (obligatoires si la clé existe) ; `skin.tokensUsed`, `skin.textPair`, `skin.declare` (conseils) ; `compat.minCore` exige `0.4.0` avec la clé. Détail : `docs/TESTSUPPORT.md`. |
| Recensement | `scripts/skin-module-census.mjs` | Valeurs en dur du CSS public des 19 modules, par catégorie, et estimation de conversion (lot S9) : `docs/ideas/skins-effort.md`. |

Laissé aux lots suivants : le banc d'essai lit `layer.parts` et `demo` (S8) ; la page Apparence affiche les pièces et le message « le module X propose N pièces » (S7) ; la conversion des 18 autres modules (S9).

---

## 23. La page Apparence : ce qui est implémenté (lot S7)

> Emma, créatrice non technique (pas une personne réelle) : mots simples, zéro configuration, avertissements sous le champ avec un exemple, téléphone d'abord (390 px), français et anglais en parité exacte, clavier et lecteur d'écran, cibles d'au moins 44 px, options avancées repliées. Le titre reste « Apparence » ; le mot « skin » désigne l'objet choisi, partout.

### 23.1 Où est le code

| Fichier | Rôle |
|---|---|
| `src/app/admin/(panel)/appearance/` | la page (`page.tsx`), ses actions (`actions.ts`), la fenêtre d'aperçu (`PreviewDialog.tsx`), les cartes (`SkinCards.tsx`), le catalogue (`CatalogueCard.tsx`), l'ajout par adresse (`PersonalRepo.tsx`, `InspectPanel.tsx`), la gestion (`ManageSkin.tsx`), les couleurs (`ColorSection.tsx`) |
| `src/core/skins/appearance.ts` | **tout ce que la page écrit** : `chooseSkin`, `resetToSkin`, `undoLastChange`, `saveSkinOptions`, `saveRetouches` (+ `parseRetouchForm`, `checkRetouchInput`), `readSnapshot` ; aucun accès à Next |
| `src/core/skins/appearanceView.ts` | le modèle de la page (`loadAppearanceView`), composé avec les mêmes fonctions que le rendu du site ; `activePreviewTokens` pour l'éditeur d'entrée |
| `src/core/skins/previewToken.ts`, `render.ts` (`resolveLook(…, { previewSkinId })`), `src/proxy.ts`, `src/app/(site)/layout.tsx` | l'aperçu d'un skin avant de l'utiliser |
| `src/core/maintenance/skins.ts` | l'assistant IA (§23.6) |
| `src/components/admin/EntryPreview.tsx`, `EntryPreviewBox.tsx` | l'aperçu dans l'éditeur d'entrée |
| `src/components/admin/ThemePicker.tsx` | le sélecteur de couleurs d'avant, étendu (préfixe de champs, avertissements « illisibilité probable », « ↺ Valeur du skin ») |

Droits : choisir, retoucher, revenir au skin, annuler, aperçu = « administrateur » (comme les réglages) ; ajouter (catalogue ou adresse), lire un dépôt, mettre à jour, revenir à la version d'avant, retirer = « propriétaire » (comme les modules : cela récupère des fichiers d'un dépôt git). Menu : *Mon site › Apparence*, à côté de *Réglages*.

### 23.2 L'écran, de haut en bas (une colonne sur téléphone)

1. Encadrés : skin choisi inutilisable (basic s'applique, rien n'est perdu) ; « Nous avons ajusté une couleur pour qu'on puisse la lire » (`Composed.notices`) ; bandeau **Annuler** tant que le dernier changement n'a pas été suivi d'une autre retouche.
2. **Le skin de votre site** : aperçu (image du skin, sinon vignette de ses couleurs), nom, auteur, licence, modes, [Changer de skin], [Aperçu].
3. **Choisir un skin** : cartes (basic toujours présent) ; [Aperçu] ouvre une fenêtre (`<dialog>` : focus piégé, Échap) avec la **vraie page du site** habillée du skin (page, téléphone / ordinateur, Automatique / Clair / Sombre) et [Utiliser ce skin] dedans.
4. **Ajouter un skin** : le catalogue (lu à part, en flux : la page s'affiche même si le dépôt est lent ; message simple s'il est injoignable) avec [Voir les détails] (lit le dépôt SANS rien installer : README, licences, aperçus, lisibilité), [Installer et utiliser] (un clic) et [Installer] ; dessous, **replié**, « Ajouter depuis une adresse (avancé) » : [Vérifier] → résumé → avertissement « Ce skin ne vient pas de la liste vérifiée… » + case **« Je comprends, je l'ajoute »** obligatoire (message sous la case sinon).
5. **Mes retouches** (un seul formulaire, barre flottante « Enregistrer / Annuler » comme Réglages) : en-tête (4 dispositions), **couleurs** (§23.3), police (avancé), halo, fond et image, fond avancé ; en dessous « **Revenir au skin** » (avec confirmation) ; **options du skin** (si le skin en déclare).
6. **Clair / sombre pour vos visiteurs** : dit si le bouton existe et pourquoi (§3.8), avec une maquette du bouton.
7. **Mises à jour et retrait** (replié, par skin installé) : « Chercher une mise à jour » → version → [Mettre à jour] ; une montée **majeure** demande « Je comprends » ; [Revenir à la version d'avant] ; **Retirer** avec l'explication « votre contenu ne change pas » et confirmation. Crédits et licences du skin actuel (replié).

### 23.3 Couleurs : un seul mode ou clair et sombre

- Deux grandes cases (`<input type=radio>`) quand le skin a les deux modes : « Un seul mode » / « Clair et sombre » ; basic et les skins à un mode n'ont pas le choix (aucun changement pour un site existant : mêmes champs `background`, `accent`, `accent2`, `surface`, `text`).
- « Clair et sombre » : onglets Clair / Sombre (`role=tablist`, flèches du clavier), les champs de chaque mode portent les préfixes `light_` / `dark_` ; les deux jeux sont toujours envoyés (panneau caché mais dans le formulaire).
- **Avertissements en direct** (`probableIllegibility`) : sous le champ concerné, une phrase avec un exemple (« Dans le mode sombre, le texte serait difficile à lire sur ce fond. Essayez un texte plus clair, par exemple #f4f4f5. »), les chiffres dans « Détails » (replié) ; **jamais bloquant** (la retouche s'enregistre, le rendu la corrige : §7.3). Sur basic, les avertissements d'avant (`contrastIssues`) restent tels quels.
- Maquette : un mode, ou les deux côte à côte (empilés sur téléphone), calculée par `buildPalette` ; le texte dit en direct si le bouton Clair / Sombre restera.
- « ↺ Valeur du skin » apparaît à côté d'un champ qui diffère de la valeur du skin.

### 23.4 Ce qui est écrit, exactement

| Action | Réglages touchés |
|---|---|
| Choisir un skin | `skin.snapshot` ← copie des retouches et des options ; `skin.active` ; **supprimés** : `skin.options` et toutes les retouches (`theme.*` sauf `theme.admin`, `header.layout`). Le même skin deux fois : rien. Un skin absent ou altéré est refusé (rien ne change). |
| Revenir au skin | comme ci-dessus, sans changer `skin.active` (`skin.snapshot.kind = "reset"`) ; rien à faire s'il n'y a aucune retouche |
| Annuler | remet les retouches et le skin d'avant (basic si celui-ci a été retiré), puis efface le snapshot |
| Enregistrer les retouches | **sur basic : exactement les écritures d'avant les skins** (fond et accent toujours écrits, casse conservée ; vide = clé supprimée ; police seulement en avancé) ; **sur un autre skin : seulement ce qui diffère du skin** (une valeur remise à celle du skin supprime la clé) ; `theme.palette = both` et `theme.light.*` / `theme.dark.*` en « clair et sombre » (les clés `theme.*` d'avant sont gardées) ; halo, fond, police : « Celui du skin » ne retouche rien ; une vraie modification efface le snapshot |
| Options | `skin.options` ne garde que les valeurs déclarées par le skin et différentes du défaut |

Réglages → Apparence ne contient plus les couleurs, la police, le halo, le fond ni la disposition de l'en-tête (`saveSettings` n'y touche plus) : l'onglet garde un lien vers Apparence et le lien / bouton de l'en-tête.

### 23.5 L'aperçu, sans rien enregistrer

`/admin/appearance/preview/<id>` (§10.3) a été remplacé par une adresse de la **vraie page** du site : `<page>?curiosa_skin_preview=<jeton>`. Le jeton (`<skin>.<fin>.<signature>`, HMAC du secret du site, **quinze minutes**) est fabriqué par une action d'administrateur ; le proxy ne fait que le recopier dans l'en-tête interne `x-curiosa-skin-preview` (après avoir effacé celui du visiteur) ; le gabarit du site le vérifie puis compose le skin demandé **sans les retouches ni les options de la personne** (c'est ce que donnerait « Utiliser ce skin ») et ajoute `noindex`. Rien n'est écrit, aucun cookie, aucun état serveur ; un jeton ne donne accès à rien de privé (le site est public) : il choisit seulement quel skin habille la page. Un skin absent ou altéré s'affiche en basic.

**Éditeur d'entrée** : un bloc replié « Voir avec mon skin » montre le titre et le texte en cours d'écriture avec le composant `Markdown` du site, les **jetons effectifs** du skin posés comme variables CSS sur ce seul conteneur (jamais sur la page : l'administration n'est jamais restylée ; pas de feuille de skin, donc ni mise en page ni polices embarquées : pour cela, l'aperçu d'Apparence).

### 23.6 L'assistant IA (maintenance)

Outils `maintenance_skin_status`, `maintenance_skin_list` (niveau 1, lecture) ; `maintenance_skin_install`, `maintenance_skin_activate`, `maintenance_skin_remove` (niveau 3 : des **demandes** que la propriétaire approuve dans *Assistants IA › Demandes à valider*, 24 heures, plan figé et revérifié à l'exécution). Jamais : un dépôt personnel ou une adresse (l'IA ne donne qu'un identifiant du **catalogue officiel**), une installation sans accord (même en « exécution directe » : comme `module_install`), toucher au contenu. Activer met les retouches de côté (annulables). Détail : `docs/MAINTENANCE-IA.md`. (Les noms `appearance_*` du §10.6 ont été remplacés par `maintenance_skin_*` pour rester dans la famille `maintenance_`, ses niveaux, ses jetons et son audit.)

### 23.7 Écarts avec la conception

1. **Aperçu** : une adresse de la vraie page avec jeton signé, pas une route `/admin/appearance/preview/<id>` (une route d'administration ne peut pas porter le `<html>` du site).
2. **Noms des outils IA** : `maintenance_skin_*` (§23.6).
3. **Retrait d'un skin** : le message « Votre contenu ne change pas » est dans la zone repliée de chaque skin installé, avec confirmation.
4. **Mise à jour** : la page propose « Chercher une mise à jour » par skin (réseau à la demande) et signale « Mise à jour disponible » sur les cartes du catalogue ; pas d'onglet dans *Mises à jour*.
5. **Éditeur d'entrée** : aperçu par variables CSS locales (§23.5), pas la feuille entière du skin.
6. **Textes** : clés `appearance.*` (page, actions, aperçu) et `skins.error.*` ; ajoutées avant les clés de thème (convention de `tests/core/theme-colors.test.mjs`).
