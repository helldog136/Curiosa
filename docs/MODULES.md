# Référence des modules

> **Première fois ?** Lisez d'abord le tutoriel pas à pas : [CREATE-A-MODULE.md](CREATE-A-MODULE.md).
> Cette page en est la **référence exhaustive** : chaque champ du manifeste, chaque clé du code, chaque bloc, chaque
> service. L'exemple complet et fonctionnel, qui utilise toutes les capacités, est
> [`modules-examples/guestbook`](../modules-examples/guestbook) (un livre d'or modéré) ; le plus petit module utile est
> [`modules-examples/announcement-banner`](../modules-examples/announcement-banner). Un test
> (`tests/docs-coverage.test.mjs`) vérifie que cette page cite chaque capacité présente dans le code.

Sommaire : [anatomie](#anatomie-dun-module) · [manifeste `module.json`](#le-manifeste-modulejson) · [code `index.mjs`](#le-code-indexmjs) ·
[contexte `ctx`](#le-contexte-ctx) · [blocs](#blocs) · [sujets](#échanger-des-informations-entre-modules-les-sujets) ·
[admin](#panneau-dadmin-riche-formulaires-et-boutons-pilotés-par-le-module) · [MCP](#api-mcp-exposer-des-actions-aux-assistants) ·
[thème](#thème-du-site-et-apparence-dun-module) · [e-mail](#envoyer-un-e-mail) · [RSS](#alimenter-le-flux-rss) ·
[overlay](#overlay-type-overlay) · [sauvegarde](#sauvegarde-lisible-sans-le-framework) · [installer et publier](#installer-publier-catalogue) ·
[sécurité](#sécurité-à-lire-avant-dinstaller)

## Anatomie d'un module

Un module = un dépôt git avec, **à la racine** :

```
module.json      manifeste (obligatoire)
index.mjs        code (si le module fait plus que déclarer des réglages et du contenu)
locales/fr.json  textes du module par langue (facultatif) : { "clé": "texte avec {variable}" }
```

Pas de `npm install`, pas de build : le fichier est chargé tel quel par Node (ES module). Si vous avez
besoin de dépendances, livrez un fichier unique déjà empaqueté. Un module n'importe **rien** du cœur : tout passe par
l'objet `ctx` (voir plus bas). Les modules livrés (`src/modules-builtin/`) sont bâtis exactement de la même façon.

Limites à connaître : le dépôt ne doit pas dépasser 10 Mo (le dossier `.git` ne compte pas), aucun lien symbolique n'y est
toléré, `main` doit pointer un fichier `.mjs` ou `.js` **à l'intérieur** du module. Un module dont le manifeste ou le code ne se
charge pas est ignoré (journalisé) sans jamais empêcher le site de fonctionner. Un module ne peut pas porter l'identifiant d'un
module livré avec le cœur.

### Module et instances

Le module est le **type** ; l'admin en crée des **instances** (Modules → « Ajouter une
instance »). Votre code tourne **une fois par instance** : `ctx.setting()` renvoie les réglages de
l'instance courante et `ctx.instance.key` l'identifie. N'écrivez jamais comme s'il n'y avait qu'un
exemplaire : un site peut en avoir plusieurs (deux blogs, deux formulaires de contact…). Si votre
module n'a de sens qu'une fois, déclarez `"instances": "single"`. Le stockage (`ctx.api.store`) est propre à chaque instance.

#### Trois noms, trois publics

| Nom | Pour qui | Détail |
|---|---|---|
| **Surnom** | l'administrateur | Distingue deux instances du même module dans l'admin (« Actus », « Chaîne 2 »). **Superflu — donc jamais demandé ni affiché — tant qu'il n'y a qu'une instance** : le libellé est alors le nom du module. Demandé à la création de la 2e instance (et pour la 1re, si elle n'en a pas). Unique parmi les instances du même module. |
| **Nom public** | les visiteurs | Traduit par langue, affiché sur le site (menu, titre de page). Démarre à la valeur du surnom. |
| **Identifiant technique** | le code, les URL, les agents | Dérivé du surnom à la création (« Chaîne 2 » → `chaine-2`) : lisible dans `/overlays/<id>`, `/m/<id>/…`, les outils MCP (`chaine-2__list_entries`). Ne change jamais quand on renomme le surnom, pour que les liens continuent de marcher. **Visible en mode avancé seulement.** |

Votre module reçoit `ctx.instance.key` (l'identifiant) et `ctx.instance.name` (le nom public) ; il n'a pas à connaître le surnom.

### Type d'un module

Chaque module a un **type** (`"type"` dans `module.json`) qui décide où il apparaît dans l'admin
et comment ses instances sont exposées :

| Type | Pour | Particularité |
|---|---|---|
| `content` | blog, liens, codes promo, pages… | déduit de `content` ; éditeur d'entrées fourni par le cœur |
| `overlay` | sources navigateur OBS | chaque instance est servie sur `/overlays/<clé>` (page nue, fond transparent) via `overlay()` |
| `widget` | morceaux de pages (bandeau, formulaire…) | défaut quand il n'y a pas de `content` |
| `integration` | services externes (Twitch, Discord…) | — |
| `utility` | outils divers (RSS…) | — |

L'admin est **une seule interface** : la barre latérale regroupe, par type, une entrée pour
chaque instance configurée (nommée comme l'utilisateur l'a nommée : trois blogs = trois entrées),
plus la page **Modules** (installés, activation, mises à jour) et la **Catalogue** (installer). La page d'une instance
est une sous-page de cet admin, avec ses réglages (générés depuis `settings`), ses abonnements
(voir « sujets ») et le panneau `adminPanel` du module.

## Le manifeste `module.json`

Validé à l'installation et au chargement (zod, `src/core/modules/manifest.ts`). Une erreur donne un message du type
`module.json: settings.2.key — Invalid string`.

```jsonc
{
  "apiVersion": 2,                       // contrat avec le cœur : doit être celui du cœur, sinon le module est refusé
  "id": "announcement-banner",           // a-z, 0-9, tirets ; 2 à 40 caractères, commence par une lettre ; unique
  "name": { "en": "…", "fr": "…" },      // texte ou { langue: texte }
  "version": "1.0.0",                    // semver : x.y.z (suffixe -beta.1 permis)
  "description": { "en": "…" },
  "author": "…", "license": "MIT", "homepage": "https://…",
  "icon": "📣",                          // un emoji (8 caractères au plus)
  "main": "index.mjs",                   // absent = module sans code
  "type": "widget",                      // content | overlay | widget | integration | utility
  "instances": "multiple",               // ou "single"
  "page": true, "basePath": "guestbook", // l'instance a une page publique, sur ce chemin proposé
  "permissions": ["slots", "sections", "routes", "storage", "filters", "pages", "topics", "overlay", "mcp", "admin", "mail"],
  "settings": [ /* … */ ], "sections": [ /* … */ ], "consumes": [ /* … */ ], "provides": [ /* … */ ], "mcp": [ /* … */ ],
  "content": { /* … */ }, "starter": true, "onboarding": { /* … */ }, "defaultEnabled": true
}
```

| Champ | Rôle |
|---|---|
| `apiVersion` | Version de l'API des modules (aujourd'hui `2`). Un module d'une autre version est refusé à l'installation ; dans l'index du catalogue, il est listé mais marqué incompatible. |
| `id` | Identifiant du module, stable à jamais (les instances et les sauvegardes s'y réfèrent). |
| `name`, `description` | Texte ou `{ langue: texte }` (500 caractères au plus). Langue absente : langue par défaut du site, puis `en`. |
| `version` | `x.y.z`. Sert à détecter les mises à jour des modules livrés avec le framework. |
| `author`, `license`, `homepage` | Informatifs (`homepage` : URL valide). |
| `icon` | Emoji affiché dans l'admin. |
| `main` | Fichier ES module du code, relatif à la racine. Absent : module « sans code » (réglages, contenu). |
| `type` | Catégorie (voir ci-dessus). Défaut : `content` si `content` est déclaré, sinon `widget`. |
| `instances` | `"multiple"` (défaut) ou `"single"`. |
| `page` | L'instance a une page publique. Défaut : oui si `content` (sauf type `overlay`). Le code la fournit avec `page()`. |
| `basePath` | Chemin public proposé à la création d'une instance à page (défaut : la clé de l'instance). Lettres minuscules, chiffres, tirets. |
| `settings` | Réglages **par instance** ; l'admin génère le formulaire (voir ci-dessous). 60 au plus. |
| `sections` | Morceaux plaçables sur la page d'accueil (voir ci-dessous). 20 au plus. |
| `offers` / `requires` | **Dépendances** : services que le module offre aux autres / dont il a besoin (voir « dépendances entre modules »). 10 au plus chacun. |
| `consumes` / `provides` | Sujets que le module digère / expose (voir « sujets »). 10 au plus chacun. |
| `mcp` | Actions proposées à l'API MCP (voir « API MCP »). 60 au plus. |
| `content` | Module à contenu : le cœur fournit l'éditeur d'entrées et les pages (voir ci-dessous). |
| `starter` | Proposé dans l'assistant de première installation (modules à contenu livrés avec le cœur). |
| `onboarding` | Comment le module participe à la première installation (voir ci-dessous). |
| `dataVersion` | Version de la **structure de vos données** (entier ≥ 1, défaut 1). À augmenter quand elle change, avec la migration correspondante (`migrations`). |
| `defaultEnabled` | Modules livrés avec le cœur : activés dès le départ (défaut : oui). Sans effet pour un module installé, toujours installé désactivé. |
| `permissions` | Les capacités utilisées (voir ci-dessous). |

### Permissions

Déclaratives : elles disent à l'administrateur ce que le module fait. **Le cœur ne bloque pas** un module qui utilise une
capacité qu'il n'a pas déclarée — et la version actuelle de l'admin ne les affiche pas encore : déclarez-les quand même,
fidèlement (le test de l'exemple vérifie qu'elles correspondent au code), elles sont le contrat de confiance du module.

| Permission | Quand la déclarer |
|---|---|
| `slots` | le code définit `slots` (blocs dans le site) |
| `sections` | le code définit `sections` (morceaux d'accueil) |
| `pages` | le code définit `page` (page publique) |
| `routes` | le code définit `routes` (`/m/<clé>/<route>`) |
| `storage` | le module lit ou écrit `ctx.api.store` |
| `filters` | le code définit `filters` (transformation du corps des entrées) |
| `topics` | le module fournit (`exports`) ou consomme (`ctx.api.topics.collect`) des sujets |
| `overlay` | le code définit `overlay` (source navigateur OBS) |
| `mcp` | le module déclare des actions `mcp` |
| `admin` | le code définit `adminPanel` / `adminActions` |
| `mail` | le module appelle `ctx.api.mail.send` |

### Réglages (`settings`)

Chaque réglage est un objet (`SettingField`) :

| Clé | Rôle |
|---|---|
| `key` | Identifiant (lettre puis lettres, chiffres, `_` ; 41 caractères au plus). C'est ce que lit `ctx.setting("clé")`. |
| `label` | Libellé affiché dans l'admin (texte ou `{ langue: texte }`). |
| `type` | L'un des types ci-dessous. |
| `help` | Aide sous le champ. |
| `default` | Valeur par défaut (texte, nombre ou booléen). `ctx.setting` la renvoie tant que rien n'est réglé. |
| `options` | Pour `select` : `[{ "value": "info", "label": { "en": "…" } }]` (50 au plus). |
| `translatable` | `true` : une valeur par langue du site (sinon une seule valeur globale). `ctx.setting` renvoie celle de la langue courante. |
| `advanced` | `true` : réglage technique, masqué dans la version simplifiée de l'admin ; **sa valeur par défaut s'applique** — donnez-en toujours une. |
| `group` | `"appearance"` : réglage d'apparence, regroupé sous « Apparence de ce module ». |

Types : `text`, `textarea`, `url`, `number`, `boolean`, `select`, `color`, `image` (envoi de fichier ou URL), `video` (envoi d'une vidéo MP4 ou WebM de 50 Mo au plus, réservée aux fichiers du site : `/uploads/…`), `secret`
(jamais réaffiché une fois enregistré ; ne l'écrivez jamais dans un journal).

- **Valeurs** : `ctx.setting` renvoie ce que l'admin a saisi, **sans garantie de type** (un nombre peut arriver en texte, une
  adresse peut être n'importe quoi) : convertissez, bornez et validez avant d'utiliser. Un réglage inconnu du manifeste vaut `undefined`.
- **Couleur qui suit le thème** : `{ "key": "accent", "type": "color", "default": "theme:accent" }`. Jetons : `accent`, `accentFg`,
  `bg`, `surface`, `fg`, `muted`, `line`. Seul un réglage `color` peut avoir un défaut `theme:…`, et le jeton doit exister (sinon le
  manifeste est refusé). Tant que l'administrateur n'a pas choisi sa couleur (case « Suivre le thème du site »), `ctx.setting`
  renvoie la valeur du thème courant.
- **Simple et avancé.** L'admin existe en deux versions (bascule dans la barre latérale). Gardez dans la version simple l'essentiel :
  ce qu'une personne sans connaissances web comprend (un nom, une couleur, une image, un nombre). Les réglages avancés déjà
  enregistrés ne sont jamais effacés quand quelqu'un édite en version simple.

### Sections d'accueil (`sections`)

```jsonc
"sections": [
  { "id": "next", "label": { "en": "Next stream" }, "size": "small" },
  { "id": "days", "label": { "en": "The next days" }, "size": "medium",
    "options": [{ "key": "count", "type": "number", "default": 3, "label": { "en": "How many days" } }] }
]
```

| Clé | Rôle |
|---|---|
| `id` | Identifiant (minuscules, chiffres, tirets ; 31 caractères au plus) : la clé de `sections.<id>` dans le code. |
| `label` | Nom montré à l'administrateur qui place la section. |
| `options` | Réglages du **placement** (mêmes champs qu'un réglage ; 10 au plus). Reçus dans `options` par la fonction de rendu. |
| `size` | Taille naturelle **recommandée** : `small`, `medium`, `large` ou `full` (absent = `full`). L'administrateur peut la changer. |

La page d'accueil appartient au cœur : elle n'a pas de contenu propre, c'est un **flux** de morceaux proposés par les modules
actifs. Dans *Accueil*, l'administrateur ajoute, ordonne et choisit la **taille naturelle** de chacun : `small` (petit encart :
un code, le prochain stream), `medium` (une carte), `large` (un morceau qui aime la place) ou `full` (toute la largeur).
Il n'y a ni colonnes ni lignes à régler : les morceaux s'écoulent dans l'ordre, **à la ligne quand la place manque, comme du texte**.
Plusieurs petits morceaux se rangent côte à côte et s'étirent pour remplir la ligne ; sur un téléphone tout s'empile ; la hauteur est
toujours celle du contenu. Un morceau sans rien à montrer (la fonction renvoie `null` ou `[]`) disparaît et les autres s'écoulent à sa place.
L'administrateur peut aussi **isoler** un morceau : retour à la ligne avant, centré seul sur sa ligne (à sa taille naturelle), retour à la ligne après.

Le rendu d'une section doit rester lisible quelle que soit la place qu'on lui laisse : titre court, peu de texte, pas de largeur fixe.
Chaque placement est `(instance, section)` + options + taille : plusieurs instances = plusieurs sections indépendantes.
Le cœur fournit déjà deux sections aux modules à contenu : `latest` (les dernières entrées, option `count`) et, pour ceux dont les
entrées portent un code (codes promo…), `random` (un code au hasard, `small`).

### Sujets (`consumes`, `provides`)

```jsonc
"provides": [{ "topic": "feed.item", "label": { "en": "Messages in the RSS feed" } }]
"consumes": [{ "topic": "overlay.item", "label": { "en": "Items" }, "tags": true,
               "schema": [{ "key": "title", "type": "string", "required": true }] }]
```

| Clé | Rôle |
|---|---|
| `topic` | Identifiant du sujet : minuscules, `domaine.objet` (jusqu'à 4 niveaux séparés par des points). |
| `label` | Nom montré à l'administrateur (`consumes` : obligatoire ; `provides` : facultatif). |
| `schema` | `consumes` seulement : le format que le consommateur sait digérer, une liste de `{ key, type, required? }`. Types : `string`, `url`, `number`, `boolean`, `string[]`. Absent pour les sujets du cœur (`core.entry`). |
| `tags` | `consumes` seulement : l'administrateur peut restreindre les sources par étiquette. |

### Actions MCP (`mcp`)

| Clé | Rôle |
|---|---|
| `name` | Identifiant de l'action (minuscules, chiffres, `_` ; 2 à 40 caractères). Clé de `mcp.<name>` dans le code. |
| `description` | Ce que fait l'action, **écrit pour l'assistant qui la lit** (1000 caractères au plus). |
| `readOnly` | Lecture seule (défaut : non). Les jetons « lecture » n'ont accès qu'aux actions en lecture seule. |
| `default` | Accordée d'office aux jetons ? Défaut : oui pour une lecture seule, non pour une action qui écrit. |
| `destructive` | Irréversible (suppression…). Jamais `default: true`, jamais `readOnly` : le manifeste est refusé sinon. |
| `input` | Schéma des arguments (sous-ensemble de JSON Schema, voir « API MCP »). |

### Module à contenu (`content`) : zéro code

```jsonc
"content": {
  "display": "cards",                  // cards | list | links | codes
  "clickAction": "detail",             // detail | external
  "features": ["cover", "summary", "body"],   // cover icon summary body url code expiresAt featured tags
  "basePath": "blog", "showInNav": true,
  "allowGoLinks": false, "fallbackToDefault": true,
  "fieldSchema": [{ "key": "price", "label": "Price", "type": "number" }]
}
```

| Clé | Rôle |
|---|---|
| `display` | Présentation de la liste publique : `cards`, `list`, `links`, `codes`. |
| `clickAction` | `detail` (page de l'entrée) ou `external` (lien sortant). |
| `features` | Champs proposés par l'éditeur : `cover`, `icon`, `summary`, `body`, `url`, `code`, `expiresAt`, `featured`, `tags`. |
| `fieldSchema` | Champs personnalisés (20 au plus) : `{ key, label, type, topic? }`, `type` ∈ `text`, `url`, `number`, `boolean`, `ref` (référence vers un sujet, voir plus bas). |
| `allowGoLinks` | Active les liens courts `/go/<instance>/<entrée>`. |
| `fallbackToDefault` | Retomber sur la langue par défaut quand une entrée n'est pas traduite. |
| `basePath` | Chemin public proposé à la création d'une instance. |
| `showInNav` | Ajoute l'instance au menu du site. |

Avec `content`, le cœur fournit gratuitement l'éditeur d'entrées (multilingue, brouillons, dates, image), les pages publiques (liste +
entrée), le sitemap, le flux RSS, les liens `/go/…`, la section d'accueil `latest`, le sujet `core.entry` et quatre actions MCP
(`list_entries`, `get_entry`, `create_draft`, `update_draft`). Un module « galerie », « FAQ » ou « événements » peut n'être qu'un `module.json`.

### Première installation (`starter`, `onboarding`)

Le cœur ne connaît aucun module par son nom : l'assistant de première installation lit les manifestes. `starter: true` propose le
module (cases à cocher « que voulez-vous publier ? ») ; `onboarding` règle sa participation :

| Clé | Rôle |
|---|---|
| `always` | Créé d'office, sans question (ex. le bandeau d'accueil). |
| `preselected` | Coché par défaut dans l'assistant. |
| `home` | `{ section, count? }` : section placée sur l'accueil à la création (`count` = nombre d'entrées pour `latest`). |
| `sample` | `{ title, summary?, body? }` : entrée d'exemple créée pour que le site ne soit pas vide. |
| `collectsLinks` | L'assistant demande à l'utilisateur ses liens (Twitch, YouTube…) et les range dans ce module. |

## Le code `index.mjs`

```js
export default {
  slots:    { "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }] },
  sections: { note: (ctx, options) => [{ type: "markdown", text: ctx.setting("homeText") }] },
  page:     (ctx, { segments }) => ({ title: "…", blocks: [/* … */] }),     // page publique sur le chemin de l'instance
  overlay:  (ctx, { query }) => ({ html, css, script }),                    // modules de type overlay
  exports:  { "mon.sujet": (ctx, query) => [/* éléments au format du sujet */] },
  routes:   { send: async (request, ctx) => Response.json({ ok: true }) },  // /m/<clé de l'instance>/send
  filters:  { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") },
  adminPanel:   async (ctx, { query }) => [{ type: "heading", text: "…" }],
  adminActions: { save: async (ctx, values) => ({ ok: "Enregistré." }) },
  mcp:      { my_action: async (ctx, args, actor) => ({ done: true }) },
  migrations: { 2: async (ctx) => { /* données v1 → v2 */ } },
  backup:   { readable: async (ctx) => [{ path: "data.csv", content: "…" }] },
  services: { "contact.store": { add: async (ctx, args) => ({ id: "…" }) } },
  tasks:    { sync: { everyMinutes: 15, run: async (ctx) => { /* travail de fond */ } } },
  hooks:    { onInstanceCreate: async (ctx) => {}, onInstanceDelete: async (ctx) => {} },
};
```

Toutes les clés sont facultatives. Une fonction qui lève une exception est journalisée et **n'affecte jamais le reste du site** :
un slot en échec disparaît, une section en échec donne `[]`, une page en échec donne une 404, une route en échec répond 500.

| Clé | Appelée quand | Reçoit | Doit renvoyer |
|---|---|---|---|
| `slots.<emplacement>` | on rend l'emplacement, pour chaque instance active | `SlotContext` | blocs, `null` ou `undefined` |
| `sections.<id>` | on rend un placement d'accueil | `ctx`, `options` du placement | blocs, `null` ou `undefined` |
| `adminBadge` | le cœur construit le menu de l'admin | `ctx` | un nombre : éléments qui attendent l'équipe (pastille sur le lien du menu et carte « À traiter » du tableau de bord) ; 0 = rien |
| `news` | le cœur construit le menu du site | `ctx` (avec `ctx.visit.lastVisit`) | `true` s'il y a du nouveau pour ce visiteur (pastille sur le lien du menu) |
| `page` | on visite le chemin de l'instance | `ctx`, `{ segments }` | `PageResult` ou `null` |
| `overlay` | on visite `/overlays/<clé>` | `ctx`, `{ query }` (`URLSearchParams`) | `OverlayResult` |
| `exports.<sujet>` | un consommateur (ou le cœur) collecte | `ctx`, `{ locale, limit, tags }` | liste d'objets au format du sujet |
| `routes.<nom>` | requête GET ou POST sur `/m/<clé>/<nom>` | `Request`, `ctx` | `Response` |
| `filters.entryBody` | on rend le corps d'une entrée | `body` (markdown), `SlotContext` | le corps transformé (texte) |
| `adminPanel` | on ouvre la page d'admin de l'instance | `ctx`, `{ query }` | blocs |
| `adminActions.<nom>` | un bloc `adminForm` ou un bouton de ligne | `ctx`, `values` (texte) | `{ ok?, error?, redirect? }` |
| `mcp.<action>` | un assistant appelle l'action | `ctx`, `args` validés, `actor` | une valeur JSON |
| `migrations.<N>` | après une mise à jour du module ou une restauration, pour chaque instance dont les données sont en retard | `ctx` | rien (lever une erreur annule tout) |
| `backup.readable` | on exporte une sauvegarde | `ctx` | liste de `{ path, content }` |
| `services.<service>.<méthode>` | un module qui `requires` ce service l'appelle | `ctx` (celui du fournisseur), `args` | une valeur (objet JSON de préférence) |
| `tasks.<nom>` | toutes les `everyMinutes` minutes, pour chaque instance active (jamais deux fois en même temps) | `ctx` | rien (une erreur est mémorisée, rien d'autre ne s'arrête) |
| `hooks.onInstanceCreate` / `hooks.onInstanceDelete` | cycle de vie d'une instance | `ctx` | rien |

### `slots` : emplacements

| Emplacement | Où | Notes |
|---|---|---|
| `layout.head` | `<head>` de chaque page | uniquement des blocs `head` |
| `layout.banner` | tout en haut, avant l'en-tête | typiquement un bloc `banner` |
| `layout.footer` | pied de page | |
| `nav.items` | menu du site | un bloc `links` |
| `page.top` / `page.bottom` | autour de la page d'une instance (liste ou page de module) | `ctx.page` = l'instance dont on affiche la page — pas forcément la vôtre |
| `entry.top` / `entry.bottom` | autour d'une entrée | `ctx.page` et `ctx.entry` (`{ id, title, slug }`) |

Plusieurs modules peuvent contribuer au même emplacement : les blocs sont mis bout à bout.

### `sections` : morceaux d'accueil

`sections.<id>(ctx, options)` : `options` = les options du placement (valeurs saisies par l'administrateur, **à convertir et borner** :
`Math.min(10, Math.max(1, Number(options.count) || 3))`). Voir « Sections d'accueil » pour la taille.

### `page` : page publique

Montée sur le chemin (`basePath`) de l'instance. `segments` = ce qui suit ce chemin, en minuscules et décodé : `/guestbook/page/2`
→ `["page", "2"]`. Il n'y a pas de paramètres de requête (`?x=y`) : faites passer ce que vous voulez par le chemin. `PageResult` :

| Clé | Rôle |
|---|---|
| `title` | Titre de la page (affiché en `<h1>` et dans l'onglet) |
| `description` | Description (méta) |
| `blocks` | Contenu |
| `notFound` | `true` : affiche la page d'erreur 404 (ou renvoyer `null`) |

Les slots `page.top` et `page.bottom` entourent le contenu. Une instance n'a de page que si son chemin public est défini
(`ctx.instance.basePath` n'est pas `null` ; `""` = racine du site).

### `overlay` : source navigateur OBS

Voir « Overlay (type `overlay`) ». `OverlayResult` : `html`, `css?`, `script?`, `title?`.

### `exports` : fournir un sujet

`exports["mon.sujet"](ctx, { locale, limit, tags })`, pour chaque instance fournisseuse. Le sujet doit être déclaré dans `provides`.
Le cœur ne garde que les champs du schéma du consommateur et écarte les éléments invalides ; voir « sujets ».

### `routes` : endpoints HTTP

`routes.<nom>(request, ctx)` est servie sur `/m/<clé de l'instance>/<nom>` pour **GET et POST** (un nom peut contenir `/`).
`?lang=fr` choisit la langue du contexte. Le cœur refuse les écritures venues d'un autre site (en-tête `Origin` différent de l'hôte : 403) :
vous n'avez pas à gérer le CSRF, mais **vous restez responsable de la validation des données, de l'anti-abus (limiteur de débit, piège à
robots) et de la méthode** (répondre 405 aux méthodes que vous n'attendez pas). Le bloc `form` poste en `fetch` en `multipart/form-data`,
ajoute un champ piège `website` et ne lit que le code HTTP de la réponse (2xx = succès affiche `successText`, autre = message d'erreur générique).

### `filters` : transformer le corps des entrées

`filters.entryBody(body, ctx)` reçoit le markdown d'une entrée avant son rendu et renvoie le texte transformé (ex. des shortcodes). Les
filtres de toutes les instances actives s'appliquent en chaîne. `ctx.entry` indique l'entrée.

### `adminPanel`, `adminActions` : administration

Voir « Panneau d'admin riche ».

### `mcp` : actions pour les assistants

Voir « API MCP ». Les clés de `mcp` doivent être déclarées dans le manifeste : une action déclarée mais non implémentée (ou l'inverse) n'est pas exposée.

### `migrations` : faire évoluer ses données

Votre stockage (`ctx.api.store`) est du JSON libre : quand une nouvelle version de votre module change la **forme** de ses données (champ renommé, champ ajouté,
collection coupée en deux), **c'est à vous de les convertir** — le cœur ne peut pas deviner. Vous déclarez :

```json
"dataVersion": 3
```
```js
export default {
  migrations: {
    // N = la version vers laquelle on va : migrations[2] fait passer de la v1 à la v2.
    2: async (ctx) => { for (const r of await ctx.api.store.list("notes")) { const { name, ...rest } = r.data; await ctx.api.store.update(r.id, { ...rest, author: name }); } },
    3: async (ctx) => { /* … */ },
  },
};
```

Le cœur retient la version des données **de chaque instance** (absente = 1) et, après une **mise à jour du module** ou une **restauration de sauvegarde**, exécute pour
chaque instance en retard les migrations manquantes, **dans l'ordre** (si l'utilisateur a sauté des versions, le cœur rejoue chaque étiquette intermédiaire `vX.Y.Z` avec son propre code, l'une après l'autre, puis installe la dernière ; s'il y a un échec il s'arrête sur la version fautive) (une version sans fonction avance simplement le numéro). Une instance **créée** après coup
naît directement à la version courante. Garanties :

- une **copie de la base** est gardée avant (`data/backups/pre-migration-*.db`) ;
- si une migration **lève une erreur**, l'instance est **remise exactement dans son état d'avant** (stockage et réglages, rien à moitié converti), **mise à l'écart** (elle ne
  tourne pas) et l'admin affiche l'erreur avec un bouton « Réessayer » ; les autres instances ne sont pas touchées. Publiez une version corrigée : la mise à jour relance la migration ;
- des données **plus récentes** que votre code (sauvegarde restaurée dans un module plus ancien) sont aussi mises à l'écart, jamais modifiées.

Écrivez des migrations **idempotentes** quand c'est possible (elles peuvent être rejouées après un échec) et **testez-les** sur des données réelles de l'ancienne version.
Ne supprimez jamais une migration déjà publiée : un site peut sauter plusieurs versions d'un coup.

### `backup` : sauvegarde lisible

Voir « Sauvegarde lisible sans le framework ». `backup.readable(ctx)` renvoie des fichiers `{ path, content }`.

### Dépendances entre modules : `offers` / `requires` / `services`

Un module peut avoir **besoin** d'un autre (un formulaire de contact a besoin d'un carnet où ranger les contacts). On dépend d'un **service** (un nom : `contact.store`), jamais d'un module précis : n'importe quel module qui l'offre convient.

```jsonc
// module.json du FOURNISSEUR                       // module.json du CONSOMMATEUR
"offers":   [{ "service": "contact.store" }]        "requires": [{ "service": "contact.store" }]
```

```js
// fournisseur : les méthodes du service                // consommateur
services: { "contact.store": {                           const r = await ctx.api.services.call("contact.store", "add", { name, email });
  add: async (ctx, args) => ({ id: await ctx.api.store.add("contacts", args) }),   // r = { ok: true, value } | { ok: false, reason }
} },
```

Ce que fait le cœur :

- **Activer** un module qui `requires` un service qu'aucun module actif n'offre : si un module **livré avec le framework** l'offre, il est installé et activé d'office ; sinon l'activation est refusée en nommant ce qui manque.
- **Désactiver ou désinstaller** un module que d'autres modules actifs requièrent (parce que lui seul offre le service) est refusé, avec la liste de ces modules.
- `ctx.api.services.call` n'accepte que les services déclarés dans `requires` (sinon `undeclared`), prend le premier fournisseur actif (par clé d'instance), ne lève jamais : à vous de gérer `unavailable` (par exemple après une restauration) en dégradant proprement.
- **Plusieurs fournisseurs du même service** (un doublon, ou un changement de fournisseur) : dès qu'un deuxième module qui offre le service est activé (ou qu'une de ses instances est créée), l'admin est invité (page *Modules* → *Services offerts par plusieurs modules*) à choisir un **maître** — il reçoit les appels et c'est sa réponse que voit l'appelant — et des **répliques**, qui reçoivent aussi les appels qui **écrivent**, au mieux (la panne d'une réplique ne fait jamais échouer l'appel ; celle du maître, si). Le fournisseur peut déclarer ses méthodes de lecture dans `offers` (`"readOnly": ["count"]`) : elles ne sont jamais répliquées. Tant que rien n'est choisi, le premier fournisseur (par clé d'instance) est le maître, sans réplique ; un choix périmé (maître retiré) retombe sur le premier. **Une réplique reçoit les appels futurs** : les données déjà reçues par l'ancien fournisseur ne sont pas copiées (aucun conflit à fusionner, mais un historique réparti : pour une bascule propre, mettez le nouveau en maître, gardez l'ancien en réplique le temps voulu, puis retirez-le).
- Le `ctx` reçu par la méthode est celui de l'instance **fournisseur** : elle écrit dans **son** stockage, jamais dans celui de l'appelant.

### `adminBadge` : ce qui attend l'équipe

`adminBadge: async (ctx) => (await ctx.api.store.list("messages", { limit: 500 })).filter((m) => !m.data.read).length` fait apparaître ce nombre dans une pastille sur le lien de l'instance dans le menu de l'admin, et la liste sur le tableau de bord (« À traiter »). Rendez-la rapide (elle s'exécute à chaque page d'admin) ; une erreur n'affiche simplement pas de pastille. Le cœur ajoute lui-même une pastille « Mises à jour » pour le propriétaire quand une version est disponible.

### `news` : y a-t-il du nouveau depuis la dernière visite ?

Le cœur retient, dans le navigateur du visiteur, la date de son passage précédent (deux cookies qui ne contiennent que des dates) et affiche une **pastille** sur le lien du menu des instances où il y a du nouveau. Sans `news`, la règle du cœur s'applique : des entrées **publiées** (ni brouillon ni expirées) depuis cette date. Un module qui compte autre chose (un message, un résultat…) fournit sa propre règle :

```js
news: async (ctx) => (await ctx.api.store.get("lastPostAt") ?? 0) > ctx.visit.lastVisit.getTime(),
```

`ctx.visit.lastVisit` vaut le 1er janvier 1970 pour un visiteur inconnu ; le cœur n'affiche alors aucune pastille (il n'a rien « manqué »). La date est figée pour toute la durée d'une visite : la pastille ne disparaît pas dès la deuxième page ouverte. Une erreur dans `news` n'affiche simplement pas de pastille.

### `tasks` : travail en arrière-plan

Pour surveiller un service externe, publier à l'heure, envoyer une annonce : déclarez des tâches, le cœur les exécute (pas de cron à installer).

```js
tasks: {
  // nom en minuscules/chiffres/tirets ; everyMinutes ≥ 1
  announce: { everyMinutes: 5, run: async (ctx) => { /* ctx.api.store, ctx.api.mail, ctx.api.topics… comme partout */ } },
},
```

Le cœur passe **une fois par minute** : une tâche jamais exécutée l'est au premier passage, puis pas avant `everyMinutes` minutes. Elle ne tourne que pour les instances **actives**, **jamais deux fois en même temps** (une tâche encore en cours est
ignorée au passage suivant), est interrompue du point de vue du suivi après 5 minutes, et son dernier résultat (date, durée, erreur) est mémorisé et affiché sur la page de l'instance dans l'admin. Une tâche qui plante n'arrête ni les autres ni
le serveur. Rendez-la **idempotente** : le serveur peut redémarrer ou manquer un passage. Retenez ce que vous avez déjà traité dans `ctx.api.store` plutôt que de supposer.

### `hooks` : cycle de vie

- `hooks.onInstanceDelete(ctx)` : appelé **avant** la suppression d'une instance, pour nettoyer ce que seul le module connaît (mémoire,
  service externe). Le cœur supprime ensuite lui-même les réglages et le stockage de l'instance. Une erreur est journalisée et la
  suppression continue.
- `hooks.onInstanceCreate(ctx)` : appelé une fois l'instance créée (depuis l'admin ou l'assistant de première installation), quand son
  stockage est utilisable. Une erreur du module est journalisée, jamais bloquante. Restez **idempotent** : l'instance peut aussi naître d'une
  restauration de sauvegarde, qui ne rappelle pas ce crochet — initialisez aussi paresseusement, au premier usage.

## Le contexte `ctx`

Chaque fonction du module reçoit un `ctx` (`ModuleContext`) ; les slots reçoivent un `SlotContext`, qui y ajoute `ctx.page` et `ctx.entry`.

| Membre | Contenu |
|---|---|
| `ctx.moduleId` | identifiant du module (celui du manifeste) |
| `ctx.instance` | `{ id, key, basePath, name }` de l'instance courante (`name` = nom public dans la langue courante ; `basePath` : `null` = pas de page, `""` = racine) |
| `ctx.locale` | langue du visiteur (ou de l'admin, dans le panneau d'admin) |
| `ctx.defaultLocale` | langue par défaut du site |
| `ctx.locales` | toutes les langues du site |
| `ctx.setting("clé")` | réglage de l'instance pour la langue courante, avec sa valeur par défaut (voir « Réglages ») |
| `ctx.t("clé", { vars })` | texte de `locales/<langue>.json` du module, `{variable}` remplacée. Repli : langue par défaut, puis `en`, puis les textes du cœur, puis la clé elle-même. |
| `ctx.theme` | thème du site : `{ accent, accentFg, bg, surface, fg, muted, line, font, fontKey }` (couleurs `#RRGGBB`, `font` = pile CSS, `fontKey` = `sans`, `serif` ou `mono`) |
| `ctx.visit` | `{ lastVisit: Date }` : le passage précédent du visiteur (cookie tenu par le cœur, rien de personnel) ; **1er janvier 1970** s'il est inconnu |
| `ctx.page` | (slots `page.*` et `entry.*`) `{ key, basePath }` de l'instance dont on affiche la page |
| `ctx.entry` | (slots `entry.*`) `{ id, title, slug }` de l'entrée affichée |
| `ctx.api` | tout ce que le cœur met à disposition (ci-dessous) |

### `ctx.api`

Deux familles : les **services** du cœur (génériques, voir [PLATFORM.md](PLATFORM.md)) et la **lecture du site** (lecture seule).

| Appel | Famille | Rôle |
|---|---|---|
| `ctx.api.services.call(service, méthode, args)` / `.available(service)` | dépendance | Appelle un service offert par un autre module (déclaré dans `requires`) ; renvoie `{ ok: true, value }` ou `{ ok: false, reason }` (`undeclared`, `unavailable`, `no_method`, `failed`), ne lève jamais. |
| `ctx.api.qr(texte)` | service | QR code en SVG (fond transparent) pour un texte ou une URL |
| `ctx.api.png({ width, height, tree })` | service | Image PNG (une `Response`) à partir d'une arborescence de boîtes `{ type: "div"\|"span"\|"p"\|"b"\|"img", props: { style, children, src } }` (flexbox, styles en ligne, 16 à 2000 px). Une `img` n'accepte qu'un chemin du site ou une adresse https publique. Exemple : l'image de la semaine du module *planning* (`/m/<clé>/image`). |
| `ctx.api.store.add(collection, data)` | service | ajoute un document JSON, renvoie son `id` |
| `ctx.api.store.get(id)` | service | `{ id, createdAt, data }` ou `null` (aussi `null` pour un document d'une autre instance) |
| `ctx.api.store.update(id, data)` | service | **remplace** le document ; renvoie `false` s'il n'existe pas. Pour modifier un champ, relisez, fusionnez, réécrivez. |
| `ctx.api.store.list(collection, { limit? })` | service | les plus récents d'abord ; 100 par défaut |
| `ctx.api.store.remove(id)` | service | supprime (sans erreur si absent) |
| `ctx.api.store.count(collection)` | service | nombre de documents |
| `ctx.api.topics.collect(sujet, { limit? })` | service | éléments des sources auxquelles l'instance est abonnée (le sujet doit figurer dans `consumes`, sinon erreur) |
| `ctx.api.mail.configured()` | service | un serveur d'e-mail est-il réglé ? |
| `ctx.api.mail.send({ to, subject, text, replyTo? })` | service | e-mail au nom du site (permission `mail`, voir « Envoyer un e-mail ») |
| `ctx.api.site(locale?)` | lecture | `{ name, tagline, logo }` du site |
| `ctx.api.brand(locale?)` | lecture | identité visuelle complète (`ModuleBrand`, ci-dessous) |
| `ctx.api.instances.list({ module?, locale? })` | lecture | `[{ key, module, basePath, name }]` des instances actives |
| `ctx.api.entries.list({ instance?, locale?, limit? })` | lecture | entrées publiées (`EntrySummary`) ; par défaut celles de l'instance courante |
| `ctx.api.siteUrl` | lecture | adresse publique du site, sans `/` final |

**Stockage** : privé à l'instance (une instance ne voit jamais celui d'une autre), en collections libres de documents JSON, sans
requête (filtrez en code, d'où le `limit`). Il est sauvegardé par le cœur (JSON) et supprimé avec l'instance ou la désinstallation du module.

`ModuleBrand` : `name`, `tagline`, `about`, `logo`, `contactEmail`, `colors` (`[{ key, name, hex, role }]`), `font` (`{ key, name, stack }`),
`defaultLocale`, `locales`. Lecture seule : un module qui *montre* l'identité (kit presse) la lit au lieu de la copier.

`EntrySummary` : `id`, `title`, `cover`, `icon`, `tags`, `fields` (valeurs des champs personnalisés ; les champs `ref` contiennent
l'identifiant référencé), `slug`, `summary`, `url`, `code`, `path` (chemin public), `publishedAt`.

## Blocs

Un module renvoie des **blocs déclaratifs** ; le cœur se charge du rendu, des thèmes et des langues. Le module ne manipule jamais React.

| `type` | Champs |
|---|---|
| `markdown` | `text` — **sans HTML brut** (les liens et images Markdown fonctionnent : ne mettez pas de texte de visiteur ici) |
| `html` | `html` — **brut**, sous la responsabilité du module : échappez tout ce qui vient d'un visiteur |
| `heading` | `text` |
| `swatches` | `items: [{ name, hex, role? }]` — pastilles de couleur avec code copiable |
| `downloads` | `items: [{ src, label, detail? }]` — images à télécharger, avec aperçu |
| `copy` | `text`, `label?` — texte à copier d'un clic |
| `hero` | `title`, `text?`, `image?`, `video?` (fichier envoyé sur le site), `videoPoster?`, `videoSound?` |
| `panel` | `kind` (`media`, `tabs`, `stats`, `cta`, `video`), `eyebrow?`, `title?`, `text?` (Markdown), `button?` (`label`, `href`), `images?` (jusqu'à 3), `imageSide?`, `tone?` (`plain`, `surface`, `accent`), `bg?` (`src`, `size`, `position`, `veil`), `items?` (`title`, `heading?`, `text?`, `image?`), `video?` — un morceau de page ; voir le module livré « Blocs de page » |
| `banner` | `text`, `href?`, `tone?` (`info` · `success` · `warning`) |
| `links` | `items: [{ label, href, icon? }]` — les adresses non sûres deviennent `#` |
| `entries` | `instance` (clé), `limit?`, `title?`, `link?`, `pick?` (`"random"`) — entrées d'une instance, rendues par le cœur |
| `embed` | `src` (https uniquement), `title`, `ratio?` |
| `form` | `action` (`<clé d'instance>/<route>`), `fields: [{ name, label, kind?, required? }]` (`kind` : `text`, `email`, `textarea`), `submitLabel`, `successText` |
| `table` | `columns`, `rows` (tableaux de texte), `rowIds?`, `rowActions?` (admin seulement, voir plus bas) |
| `adminForm` | `action`, `fields`, `submitLabel`, `title?`, `cancelHref?` — panneau d'admin uniquement |
| `gridEditor` | éditeur de **grille** (panneau d'admin uniquement) : `action`, `width`, `height`, `cells` (un caractère par case, ligne après ligne), `palette` (`[{ value, label, color }]`, une `value` = un caractère), `submitLabel`, `title?`, `minSize?`, `maxSize?`, `cancelHref?`, `labels?` (`width`, `height`, `fillAll`, `border`, `reset`, `hint`). L'utilisateur choisit un pinceau et peint à la souris ou au doigt, redimensionne, et enregistre : l'action reçoit `width`, `height` et `cells` en texte (à valider !). Exemple : le tracé du module *maze-overlay*. |
| `head` | `tags`: `meta` / `link` / `script` (uniquement dans `layout.head`) |

Une valeur de cellule de `table`, un `text` de `heading`, de `banner`… sont du **texte** : le cœur les échappe. Seul `html` est brut.

Balises de `head` : `{ tag: "meta", name?, property?, content }`, `{ tag: "link", rel, href, type?, title? }`, `{ tag: "script", src?, inline?, defer? }`.

Champs d'un `adminForm` (`AdminField`) : `{ name, label, kind?, value?, required?, help?, options? }`. `kind` : `text`, `textarea`, `email`,
`url`, `number`, `date`, `select` (avec `options: [{ value, label }]`), `hidden`, `image` (téléversement).

## Échanger des informations entre modules : les sujets

Un overlay « labyrinthe » affiche des affiches tirées d'articles, un overlay « sponsors » affiche
les offres de partenaires… sans que le module d'overlay connaisse le blog ou les codes promo. Le
principe : **le consommateur déclare ce qu'il sait digérer, les fournisseurs exposent des
informations dans ce format.**

**Convention de nommage : les identifiants de sujets et de rubriques sont en anglais**, en minuscules, `domaine.objet` pour
un sujet (`sponsor.card`, `planning.slot`, `feed.item`) et un mot ou des mots reliés par des tirets pour une rubrique
(`announcement`, `behind-the-scenes`). C'est le standard de notre propre code et de nos exemples, pour que des modules écrits
par des personnes différentes se retrouvent sur les mêmes noms ; rien ne l'impose (un module peut publier sur `annonce`),
mais deux modules ne partagent un sujet ou une rubrique que s'ils s'écrivent pareil. Les **libellés** montrés aux humains,
eux, sont traduits comme le reste.

Sujets connus (tous fournis par des modules livrés ou communautaires, ou par le cœur) :

| Sujet | Fourni par | Rôle |
|---|---|---|
| `core.entry` | le cœur | entrées publiées de toute instance à contenu |
| `feed.item` | tout module | éléments proposés au flux RSS (voir plus bas) |
| `overlay.item` | tout module | éléments simples (titre, texte, image, lien) pour les overlays |
| `guestbook.message` | `guestbook` (exemple) | message validé d'un livre d'or (`id`, `name`, `text`, `publishedAt`) |
| `sponsor.card` | `sponsors` | carte de sponsor (nom, code, logo, lien) |
| `partnership.partner` | `partnerships` | fiche de partenaire (nom, logo) |
| `planning.slot` | `planning` | créneau de stream |
| `maze.poster` | tout module (`youtube-channel`, `twitch-channel`…) | affiche pour le labyrinthe |
| `stream.live` | `twitch-channel` | live en cours (`id`, `title`, `url`, `startedAt`, `game`) ; vide hors ligne |

```jsonc
// module.json du CONSOMMATEUR (un overlay)
"consumes": [
  { "topic": "core.entry", "label": { "en": "Entries…" }, "tags": true },
  { "topic": "overlay.item", "label": { "en": "Items offered by other modules" },
    "schema": [
      { "key": "title", "type": "string", "required": true },
      { "key": "text",  "type": "string" },
      { "key": "image", "type": "url" }
    ] }
]

// module.json d'un FOURNISSEUR
"provides": [{ "topic": "overlay.item" }]
```

```js
// index.mjs du FOURNISSEUR : exécuté pour chacune de ses instances
export default {
  exports: {
    "overlay.item": (ctx, { locale, limit, tags }) => [{ title: ctx.setting("text") }],
  },
};

// index.mjs du CONSOMMATEUR
const items = await ctx.api.topics.collect("overlay.item", { limit: 20 }); // [{ title, text, image, source }]
```

- **Le cœur est l'entremetteur** : il valide chaque élément selon le `schema` du consommateur
  (champs inconnus supprimés, éléments invalides écartés) et ajoute sa provenance (`source` : `{ instance, module, name }`).
  Un fournisseur qui plante est ignoré. Un fournisseur n'est interrogé que si son manifeste déclare `provides` **et** que son code définit `exports.<sujet>`.
- **Abonnements dans l'admin** : sur la page d'une instance consommatrice, section « Sources de
  données » : on coche quelles instances fournisseuses l'alimentent (tout coché = toutes, y compris
  celles ajoutées plus tard) et, si le consommateur a déclaré `"tags": true`, on filtre par étiquette (`tags` est alors transmis à `exports`).
- **`core.entry`** est fourni d'office par toute instance à contenu (sauf si l'option « Proposer ses
  entrées aux autres modules » est décochée) : titre, résumé, chemin, lien, image, icône, code,
  étiquettes, date. Un blog, une liste de codes promo ou de liens alimentent donc n'importe quel
  consommateur **sans écrire une ligne de code**. Les entrées ont des **étiquettes** (`tags`) pour
  que le consommateur ne prenne que ce qui l'intéresse (« sponsor », « mur »…).
- **Pull à la consommation** : rien n'est copié ni synchronisé ; le consommateur lit l'état courant
  à chaque appel. Un overlay rafraîchit ses données depuis sa propre route (`routes.items`), ce qui
  garde le cœur sans état. Un push (SSE) pourra s'ajouter plus tard sans changer ce contrat.
- Formats de champs : `string`, `url` (http(s) ou chemin `/…`), `number`, `boolean`, `string[]`.
  Choisissez un identifiant de sujet préfixé par votre domaine (`monmodule.truc`) ; `core.*` est réservé.
- `limit` : 50 par défaut, 200 au plus.

Pour qu'un module tiers alimente un consommateur existant, il lui suffit de déclarer
`provides: [{ "topic": "…" }]` et d'implémenter `exports` — sans rien savoir du consommateur.

### Références entre modules

Un champ personnalisé d'un module à contenu peut être une **référence** vers un élément d'un autre module :
dans `content.fieldSchema`, `{ "key": "partner", "label": "Partenaire", "type": "ref", "topic": "partnership.partner" }`
(dans l'admin : `partner | Partenaire | ref:partnership.partner`). Le module déclare le sujet dans `consumes`
(avec un schéma contenant au moins `id` et `title`), l'éditeur affiche une liste déroulante alimentée par les
fournisseurs, et la valeur stockée est l'`id`. Le module résout la référence dans son code
(`ctx.api.topics.collect(...)`) ; elle n'est jamais affichée sur le site public.

## Panneau d'admin riche : formulaires et boutons pilotés par le module

Un module dont l'administration dépasse les réglages (suivi de partenaires, modération, liste de contacts…) construit
son panneau avec des blocs et reçoit les actions correspondantes — sans jamais écrire de React ni gérer les
droits (réservé aux administrateurs, vérifié par le cœur) :

```js
export default {
  async adminPanel(ctx, { query }) {            // query = paramètres de l'URL d'admin (?edit=…)
    const rows = await ctx.api.store.list("things");
    return [
      { type: "table", columns: ["Nom"], rows: rows.map((r) => [r.data.name]), rowIds: rows.map((r) => r.id),
        rowActions: [{ label: "Modifier", href: "?edit={id}" }, { label: "Supprimer", action: "remove", confirm: "Sûr ?", danger: true }] },
      { type: "adminForm", action: "save", submitLabel: "Enregistrer",
        fields: [{ name: "name", label: "Nom", required: true }, { name: "logo", label: "Logo", kind: "image" }] },
    ];
  },
  adminActions: {
    async save(ctx, values) { await ctx.api.store.add("things", { name: values.name }); return { ok: "Enregistré." /* , redirect: "?x" */ }; },
    async remove(ctx, values) { await ctx.api.store.remove(values.id); return { ok: "Supprimé." }; },
  },
};
```

- **Champs** d'un `adminForm` : `text`, `textarea`, `email`, `url`, `number`, `date`, `select` (`options`), `image`, `hidden`. Les blocs
  `adminForm` ne s'affichent que dans l'admin (jamais sur le site public).
- **Boutons de ligne** d'une `table` (`rowActions`, admin seulement) : `{ label, action?, href?, confirm?, danger? }`. `action` exécute une
  `adminAction` en lui envoyant `values.id` (pris dans `rowIds`, même ordre que `rows`) ; `href` navigue (`{id}` est remplacé par l'identifiant) ;
  `confirm` demande confirmation ; `danger` colore le bouton en rouge.
- **Valeurs** : `adminActions.<nom>(ctx, values)` reçoit les champs du formulaire **en texte** (20 000 caractères au plus par champ) ; **validez-les**.
- **Résultat** (`AdminActionResult`) : `ok` (message vert), `error` (message rouge), `redirect` — par exemple `{ ok: "Enregistré." }`. `redirect: "?"` reste sur la page de l'instance
  (`"?edit=abc"` y ajoute des paramètres, lus par `adminPanel` dans `query`) ; `"/admin/…"` va ailleurs dans l'admin ; toute autre cible est ignorée.
  Une exception donne un message d'erreur générique (détail dans les journaux).
- Chaque action est consignée dans le journal d'audit (`module.<clé>.<action>`), sans son contenu.
- `ctx.locale` est la langue de l'administrateur ; `ctx.api.store` offre `add`, `get`, `update`, `list`, `remove`, `count`.

## API MCP : exposer des actions aux assistants

Le cœur héberge un serveur MCP (`/api/mcp`, désactivable depuis l'admin → *API & MCP*) **sans aucun outil codé
en dur** : il collecte les actions déclarées par tous les modules actifs.

```jsonc
// module.json
"mcp": [
  { "name": "partners_list", "readOnly": true, "description": "List partnerships…",
    "input": { "type": "object", "properties": { "status": { "type": "string", "enum": ["envoye", "discussion"] } } } },
  { "name": "partner_create", "description": "Create a partnership file…",
    "input": { "type": "object", "required": ["brand"], "properties": { "brand": { "type": "string", "maxLength": 120 } } } }
]
```
```js
// index.mjs : (ctx, args, actor) — `args` est déjà validé selon `input` ; `actor.name` = nom du jeton
export default { mcp: {
  async partners_list(ctx, args) { return [...]; },
  async partner_create(ctx, args, actor) {
    if (!args.brand) throw Object.assign(new Error("brand is required"), { expose: true }); // message visible de l'agent
    …
  },
} };
```

- Chaque action devient l'outil `<clé de l'instance>__<action>` (autant d'outils que d'instances).
- **Toute instance à contenu** reçoit aussi `list_entries`, `get_entry`, `create_draft` et `update_draft`.
- **Schéma des arguments** (`input`) : un objet plat. `type` doit valoir `"object"` ; `properties` : chaque propriété a un `type`
  (`string`, `number`, `integer`, `boolean`, `array`) et, selon le cas, `description`, `enum` (texte), `maxLength` (texte, 20 000 au plus),
  `minimum` / `maximum` (nombres), `items` (`{ "type": "string" }`, pour `array` : 100 textes courts au plus) ; `required` : liste des
  propriétés obligatoires. Les propriétés inconnues sont **refusées** (l'agent doit savoir que son argument n'a pas été pris en compte).
  Votre fonction reçoit des arguments conformes — mais vérifiez quand même ce qui touche vos données (un identifiant existe-t-il ?).
- Une valeur renvoyée est sérialisée en JSON pour l'agent (200 000 caractères au plus). Une erreur n'est visible de l'agent que si elle porte `expose: true` ; les
  autres sont masquées (l'agent lit seulement « The action failed. ») et journalisées.

### Qui a accès à quoi : un module implémente plus qu'il n'active

Un jeton n'a pas « tout » : l'administrateur règle, **jeton par jeton et action par action** (admin → API & MCP →
*Accès* du jeton), ce qu'il peut faire. Les changements sont **immédiats** : le serveur relit les accès à chaque requête,
inutile de regénérer le jeton.

Le module décide de ses **défauts** — l'ensemble d'actions accordé d'office aux jetons — et peut implémenter bien plus :

```jsonc
{ "name": "partner_list",   "readOnly": true },                          // lecture : accordée par défaut
{ "name": "partner_create", "default": true },                           // écriture accordée d'office (choix du module)
{ "name": "partner_update" },                                            // écriture sans « default » : désactivée par défaut
{ "name": "partner_delete", "destructive": true, "default": false }      // implémentée, JAMAIS accordée d'office
```

| Champ | Effet |
|---|---|
| `readOnly` | lecture seule ; défaut `default: true` |
| `default` | accordée aux jetons sans réglage explicite (défaut : `true` si `readOnly`, sinon `false`) |
| `destructive` | irréversible (suppression…) : signalée comme telle (`destructiveHint`), **jamais** `default: true` (le manifeste est refusé sinon), confirmation à l'octroi |

Droit effectif d'un jeton = **plafond du jeton** (un jeton « lecture » n'écrit jamais, quoi qu'on lui accorde) **ET**
(accès accordé à ce jeton **OU** défaut du module). Un jeton ne découvre pas ce qu'on ne lui a pas accordé : l'appel renvoie
« outil inconnu », comme si l'action n'existait pas. Voir `src/core/services/mcp/access.ts`.

- **Garde-fous du cœur** : un jeton « lecture » n'écrit jamais ; une action destructrice n'est jamais active par défaut ; les
  arguments inconnus sont refusés ; les erreurs internes sont masquées (seules celles avec `expose: true` sont renvoyées) ;
  toute écriture et tout changement d'accès sont consignés dans le journal d'audit ; l'éditeur de contenu du cœur ne propose
  à un assistant que de créer ou modifier des **brouillons**.
- Les jetons sont créés par le propriétaire (affichés une fois, seul leur hash est conservé), révocables, limités à
  120 requêtes/minute. L'option avancée « Proposer ses actions à l'API MCP » retire une instance du MCP.

## Thème du site et apparence d'un module

Le thème réglé dans l'admin (*Réglages › Apparence*) atteint les modules de trois façons, sans rien demander :

- **`ctx.theme`** : `{ accent, accentFg, bg, surface, fg, muted, line, font, fontKey }` — exactement les valeurs que le site utilise (même calcul). Un module qui génère du HTML ou du CSS (overlay, bloc `html`) s'en sert au lieu de couleurs en dur.
- **Variables CSS** : sur le site comme dans les overlays, `:root` porte `--v-accent`, `--v-bg`, `--v-fg`, `--v-surface`, `--v-muted`, `--v-line`, `--v-accent-fg` et `--v-font`. Un bloc `html` ou un overlay peut écrire `color: var(--v-accent)`.
- **Couleurs par défaut qui suivent le thème** : `{ "key": "accent", "type": "color", "default": "theme:accent" }` (jetons : `accent`, `accentFg`, `bg`, `surface`, `fg`, `muted`, `line`). Tant que l'administrateur n'a pas choisi sa propre couleur — case « Suivre le thème du site », cochée par défaut — la valeur change avec le thème.

Un module peut en plus déclarer **ses propres réglages d'apparence** (la texture des murs du labyrinthe, la couleur du sol, le style d'un bandeau…) avec `"group": "appearance"` : ils sont regroupés sous « Apparence de ce module » dans son panneau d'admin, séparés de ses réglages de comportement. Types utiles : `color`, `image` (téléversement), `select`.

## Envoyer un e-mail

Un module qui déclare la permission `mail` peut appeler `ctx.api.mail.send({ to: "owner", subject, text, replyTo? })` (`to` : `"owner"` = contact du site, ou une adresse). Le serveur d'envoi (SMTP) est réglé une fois par le propriétaire dans *Réglages › E-mail* ; le module n'a ni identifiants ni choix de l'expéditeur. L'appel ne lève jamais : il renvoie `{ ok: true }` ou `{ ok: false, reason }` (`not_configured`, `no_recipient`, `invalid`, `rate_limited`, `failed`). Prévoyez que l'e-mail est un plus : conservez l'information (`ctx.api.store`) avant de l'envoyer. `ctx.api.mail.configured()` dit si un serveur est réglé.

Garde-fous du cœur : texte brut uniquement (20 000 caractères au plus), objet nettoyé (une ligne, 150 caractères), un seul destinataire,
`replyTo` doit être une adresse valide, 10 envois par heure et par instance et 40 par heure pour tout le site (`rate_limited` au-delà),
chaque envoi consigné dans le journal d'audit (sans contenu).

## Alimenter le flux RSS

Le flux RSS est une fonctionnalité du cœur (`/feed.xml`). Les modules à contenu y sont déjà. Un autre module y ajoute ses éléments en fournissant le sujet `feed.item` : `"provides": [{ "topic": "feed.item" }]` et `exports["feed.item"] = (ctx, { locale, limit }) => [{ title, url, summary?, publishedAt?, id?, topics? }]`. `title` et `url` sont obligatoires (`url` : chemin du site `/…` ou adresse http(s) ; les autres schémas sont écartés), `publishedAt` est une date ISO **en texte**. `topics` : les rubriques **partagées** sur lesquelles publier (`["announcement", "concert"]`). Elles sont communes à tous les modules : si le blog et votre agenda publient tous deux sur `announcement`, un lecteur abonné à `announcement` reçoit les deux. Le cœur ajoute lui-même `@<instance>` ; un module ne peut pas le déclarer. Ne mettez que des éléments **publics** (jamais un message en attente de modération) : le flux est lisible par tous. Le cœur échappe le XML : donnez du texte brut.

## Overlay (type `overlay`)

```js
export default {
  routes: { items: async (_req, ctx) => Response.json(await ctx.api.topics.collect("core.entry")) },
  overlay: (ctx, { query }) => ({
    html: '<div id="card"></div>',
    css: "body{background:transparent}",
    script: "fetch('/m/" + ctx.instance.key + "/items').then(…)",   // rafraîchissement côté navigateur
  }),
};
```

L'instance est servie sur `/overlays/<clé>` (`?lang=fr` pour la langue) : la page admin de l'instance
affiche l'URL à coller dans OBS. L'overlay livré, `ticker-overlay`, est un exemple complet : il ne sait
rien des blogs ni des codes promo, il digère `core.entry` et `overlay.item`.

## Sauvegarde lisible sans le framework

Le cœur sauvegarde déjà, pour tout module, ses réglages, son stockage (`ctx.api.store`, en JSON) et les entrées de ses instances.
`backup.readable(ctx)` ajoute des fichiers **lisibles sans le framework** (CSV, Markdown, texte…) pour les données que le module juge
importantes : si le framework disparaît, l'utilisateur les relit avec n'importe quel éditeur ou tableur.

```js
export default {
  backup: { readable: async (ctx) => [{ path: "messages.csv", content: '"id","name"\r\n"1","Ada"\r\n' }] },
};
```

`path` est relatif au dossier de l'instance : le fichier atterrit dans `readable/modules/<clé de l'instance>/<path>`. Règles : texte
uniquement, 50 fichiers et 5 Mo par fichier au plus, chemin relatif sans `..`, un chemin déjà pris est ignoré, une erreur est journalisée
et n'empêche pas la sauvegarde. Le contexte est celui de la langue par défaut. Pour un CSV : mettez chaque cellule entre guillemets (doublez
les guillemets internes) et neutralisez les cellules qui commencent par `=`, `+`, `-` ou `@` (injection de formule dans un tableur) — voir `cell()` dans l'exemple.

## Installer, publier, catalogue

**Le Catalogue est gratuit** : aucun module ne s'y vend, tous sont sous licence ouverte. Un auteur qui accepte des dons volontaires l'indique dans le **README.md** de son dépôt, que l'admin affiche avant toute installation ; jamais une condition d'installation.

**Avant d'installer**, l'admin affiche pour chaque module (du catalogue comme d'un dépôt personnel) son **README.md**, ses permissions, les services qu'il offre ou requiert et sa licence, lus **sans l'installer** (module livré : dans son dossier ; dépôt git : clonage superficiel temporaire, mêmes garde-fous que l'installation). Le README est du texte d'un tiers : rendu Markdown sans HTML brut, aucune image distante chargée, liens relatifs inertes. Écrivez donc un vrai README (à quoi sert le module, réglages, permissions).

**Installer** (propriétaire seulement). Admin → **Catalogue** :

- **Modules livrés avec le framework** (dossiers `modules-community/` et `modules-examples/` du serveur) : installés depuis les fichiers du serveur, sans réseau ; leur version suit celle du framework.
- **Modules reconnus** : dépôts git listés dans un index public (voir ci-dessous) : celui qui publie l'index se porte garant des dépôts qu'il liste.
- **Installer un dépôt personnel (non vérifié)** : n'importe quelle adresse de dépôt, avec un avertissement et une case « je comprends » à cocher :

```
https://github.com/<vous>/<depot>          # dernière version de la branche par défaut
https://github.com/<vous>/<depot>#v1.2.0   # étiquette, commit ou branche épinglé
```

Hôtes autorisés : `MODULES_ALLOWED_HOSTS` (défaut `github.com,gitlab.com,codeberg.org,bitbucket.org` ; `*` = tous). Seul `https://` est
accepté, sans identifiant ni paramètres. Le module est installé **désactivé** (dans `data/modules/<id>`) ; on l'active après l'avoir relu,
puis on lui ajoute des instances. Chaque instance active a sa propre entrée dans le menu d'admin.
Les modules installés se gèrent dans **Modules** : activer, désactiver, « Chercher une mise à jour » (compare avec le dépôt distant),
mettre à jour, désinstaller (**supprime aussi ses instances et leurs données**). 
**Mise à jour d'un module — sans perdre aucune donnée** : seuls les fichiers du module changent ; ses instances, réglages, données (stockage, entrées) restent
tels quels. Le sens de « mise à jour » dépend de l'installation :

| Installé avec | « Chercher une mise à jour » propose |
|---|---|
| une **étiquette** (`#v1.2.0`, recommandé) | la plus haute version stable du dépôt (`v1.3.0`) ; le module passe d'étiquette en étiquette. Un changement **majeur** (`v2.0.0`) est signalé : lisez ses notes avant |
| un **commit** (`#a1b2c3d`) | jamais : c'est le but de l'épinglage |
| une **branche**, ou rien | le dernier commit de la branche |
| livré avec le framework | la version qu'apporte le framework |

Si la nouvelle version est **invalide** (manifeste illisible, autre identifiant, API incompatible, fichier principal absent, trop volumineuse), l'ancienne est
rétablie automatiquement : un module ne reste jamais à moitié mis à jour.

**Développer en local** : avec `CURIOSA_ALLOW_LOCAL_MODULES=1` dans l'environnement du serveur, une adresse `file:///chemin/absolu/vers/depot`
est acceptée par « Installer un dépôt personnel ». Le dépôt doit avoir au moins un commit ; pour voir une modification, validez-la
(`git commit`) puis *Chercher une mise à jour* → *Mettre à jour*. À ne jamais activer sur un serveur public.

**Index des modules reconnus** : un fichier [`catalogue/index.json`](../catalogue/index.json) **dans le dépôt du framework**, relu **à l'exécution**
depuis le dépôt d'origine de l'installation (au plus toutes les 15 minutes) : **il ne suit pas le rythme des versions du framework**. Ajouter un module =
une demande de fusion sur ce fichier, visible par toutes les installations dès qu'elle est fusionnée (voir [`catalogue/README.md`](../catalogue/README.md)).

```json
{ "version": 1, "modules": [
  { "id": "my-module", "name": "My module", "description": "…", "repo": "https://github.com/<vous>/<depot>",
    "ref": "v1.0.0", "version": "1.0.0", "apiVersion": 2, "author": "…", "icon": "📖" } ] }
```

`id`, `name`, `description`, `repo` sont les champs de base ; `ref` (**étiquette ou commit relus** — c'est ce qui rend « vérifié » vrai), `version`, `apiVersion`,
`author`, `icon` sont facultatifs. Chaque entrée est revalidée (identifiant, dépôt `https` sur un hôte autorisé ; 300 au plus). Un module dont `apiVersion`
diffère de celle du framework est listé mais **non installable**. Rien n'est installé automatiquement ; le dépôt installé doit servir le module annoncé
(`id` identique à celui de son `module.json`). Un module livré avec le framework l'emporte sur un module reconnu de même identifiant.

D'où vient la liste, dans l'ordre : (1) le dépôt du framework (le remote `origin` de l'installation, ou `CURIOSA_UPDATE_REMOTE` ; pour une installation par archive, le dépôt de `release.json` ; `CURIOSA_CATALOGUE_REPO` pour en choisir un autre, `CURIOSA_CATALOGUE_REF` pour une autre
branche ou étiquette que `HEAD`) ; (2) à défaut, la **dernière copie reçue** (`data/cache/`), puis la **copie livrée avec cette version** : le Catalogue
fonctionne hors ligne ; (3) **en plus**, un index JSON `https://` (`MODULES_INDEX_URL`, modèle : [`modules-index.example.json`](modules-index.example.json))
dont les entrées ne peuvent qu'**ajouter** des modules, jamais remplacer ceux du dépôt. `CURIOSA_CATALOGUE_RUNTIME=0` coupe la lecture à l'exécution
(copie livrée seulement). La page Catalogue indique d'où vient la liste affichée.

Pour qu'un module rejoigne les modules livrés : un dossier dans `modules-community/` (modules complets) ou `modules-examples/` (exemples), avec son `module.json` à sa racine.

## Modules livrés avec le cœur, communautaires, exemples

Seuls les modules de base vivent dans `src/modules-builtin/` : blog, réseaux sociaux, codes promo,
pages, collection vierge, bandeau d'accueil, formulaire de contact, statut live, overlay
défilant et **kit presse** (une pure curiosa : il lit l'identité réglée dans le cœur via `ctx.api.brand()` et ne stocke rien). Tout le reste s'installe depuis git.

- **`modules-examples/`** : exemples pour apprendre. [`guestbook`](../modules-examples/guestbook) (livre d'or modéré : réglages de tous types,
  sections avec taille, page, formulaire, stockage, e-mail, sujets dont `feed.item`, admin, MCP, sauvegarde lisible, thème, i18n, crochets) et
  [`announcement-banner`](../modules-examples/announcement-banner) (le plus petit module utile : un slot, une section, un sujet).
- **`modules-community/`** : modules complets qui **ne font pas partie du cœur** (un test le vérifie) et qui rejoindront chacun leur dépôt : le premier est
  [`maze-overlay`](../modules-community/maze-overlay), un labyrinthe 3D existant porté en module
  (moteur en JavaScript natif servi par ses propres routes, alimenté par les sujets `core.entry` et
  `maze.poster`). Il montre qu'un module riche — moteur de rendu, assets, réglages, abonnements — tient
  dans le contrat sans rien ajouter au cœur.

### Le trio sponsors

Trois modules communautaires qui coopèrent sans se connaître, uniquement par sujets :

```
 Partenariats ──partnership.partner──▶ Sponsors ──sponsor.card──▶ Overlay sponsors (OBS)
 (interne, sans page publique)         (pages publiques,          (bandeau + QR code)
  + actions MCP                         mention de partenariat)
```

- [`partnerships`](../modules-community/partnerships) : suivi privé (fiches, journal, contacts, relances) — aucune page publique, panneau d'admin complet, actions MCP.
- [`sponsors`](../modules-community/sponsors) : module à contenu ; chaque sponsor peut référencer un partenaire ; affiche la mention de partenariat ; fournit `sponsor.card`.
- [`sponsor-ticker`](../modules-community/sponsor-ticker) : l'overlay, qui ne connaît que `sponsor.card` (ou `core.entry`).

### Présence en ligne : annonces, live, vidéos, alertes

Des modules communautaires qui coopèrent aussi uniquement par sujets (aucun ne connaît les autres) :

```
 Chaîne Twitch ──stream.live──────────▶ Annonces Discord ◀──feed.item / core.entry── tout module qui publie
 (live, clips)  ──maze.poster────────▶ Overlay labyrinthe        (blog, vidéos YouTube, agenda…)
 Chaîne YouTube ──feed.item (vidéos)──▶ Annonces Discord · flux RSS
                ──maze.poster────────▶ Overlay labyrinthe
```

- [`discord-announcer`](../modules-community/discord-announcer) : webhook Discord, anti-doublon, journal, test ; utilise le service `tasks`.
- [`youtube-channel`](../modules-community/youtube-channel) : vidéo mise en avant (sans lecteur intégré), vidéos proposées au flux RSS et aux affiches.
- [`twitch-channel`](../modules-community/twitch-channel) : le live en cours (`stream.live`) et les derniers clips.
- [`alerts-overlay`](../modules-community/alerts-overlay) : alertes OBS en direct (SSE), alimentées par une requête authentifiée par jeton.
- [`game-suggestions`](../modules-community/game-suggestions) : suggestions de jeux avec statuts, votes « rejoue-le », jaquettes RAWG.

### Contacts et formulaire de contact : une dépendance

[`contacts`](../modules-community/contacts) est un carnet d'adresses privé (admin, MCP, sauvegarde lisible) qui **offre** le service `contact.store`. Le formulaire de contact intégré le **requiert** : il ne garde aucun message lui-même, il les range dans le carnet comme contacts « à vérifier » (même e-mail → note ajoutée, pas de doublon). Activer le formulaire installe et active `contacts` d'office ; tant que le formulaire est actif, `contacts` ne peut être ni désactivé ni désinstallé. Un assistant MCP complète ensuite la fiche et la passe « active », ou la supprime si c'est du spam.

### Planning

[`planning`](../modules-community/planning) lit un calendrier au format iCal (l'« adresse secrète » de
Google Agenda) et affiche les prochains streams : section d'accueil, page `/planning`, sujet `planning.slot`
et action MCP `planning_upcoming` (lecture seule). Il comprend les répétitions (`RRULE`, `EXDATE`),
les exceptions et les fuseaux horaires. L'adresse du calendrier est un réglage secret, n'accepte que
du https public (aucune adresse interne, redirections revérifiées) et n'est jamais réaffichée.

## Tests

`npm test` lance toute la batterie (Node, sans dépendance de test) : cœur, services, gestion des modules
(installation depuis un vrai dépôt git local, registre, exécution, sujets, MCP) et chaque module. Les outils
sont dans `tests/helpers/` : un chargeur qui résout l'alias `@/` et les modules `next/*`, une base SQLite
temporaire (`useTestDb`), des dépôts git jetables (`makeRepo`) et un contexte de module factice (`fakeCtx`)
pour tester le code d'un module sans serveur (voir `tests/modules/example-guestbook.test.mjs`, qui sert de modèle). `tests/docs-coverage.test.mjs` garde cette
documentation alignée sur le code.

## Sécurité : à lire avant d'installer

Un module s'exécute dans le serveur avec les mêmes droits que le site. Installez seulement des
modules dont vous faites confiance à l'auteur, épinglez une version (`#tag`), et relisez le code
avant d'activer. L'installation et la mise à jour sont réservées au propriétaire.

Pour l'auteur d'un module : tout ce qui vient d'un visiteur (formulaire, requête, `segments`, `query`) est une donnée non fiable — validez à
l'entrée, échappez à la sortie (surtout dans un bloc `html`), n'utilisez jamais `eval` ni `new Function`, ne journalisez ni secret ni contenu
privé, n'acceptez dans un lien que `https:`, `http:`, `mailto:` ou un chemin du site. Voir la checklist du tutoriel : [CREATE-A-MODULE.md](CREATE-A-MODULE.md#checklist-avant-de-publier).
