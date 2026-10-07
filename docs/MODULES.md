# Écrire un module

Un module = un dépôt git avec, à la racine :

```
module.json      manifeste (obligatoire)
index.mjs        code (si le module fait plus que déclarer des réglages et du contenu)
locales/fr.json  textes du module par langue (facultatif)
```

Pas de `npm install`, pas de build : le fichier est chargé tel quel par Node. Si vous avez
besoin de dépendances, livrez un fichier unique déjà empaqueté. Exemple complet et minimal :
[`modules-examples/announcement-banner`](../modules-examples/announcement-banner). Les modules
livrés (`src/modules-builtin/`) sont bâtis exactement de la même façon.

## Module et instances

Le module est le **type** ; l'admin en crée des **instances** (Modules → « Ajouter une
instance »). Votre code tourne **une fois par instance** : `ctx.setting()` renvoie les réglages de
l'instance courante et `ctx.instance.key` l'identifie. N'écrivez jamais comme s'il n'y avait qu'un
exemplaire : un site peut en avoir plusieurs (deux blogs, deux formulaires de contact…). Si votre
module n'a de sens qu'une fois, déclarez `"instances": "single"`.

## Type d'un module

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
plus la page **Modules** (installés, marketplace, installation depuis git). La page d'une instance
est une sous-page de cet admin, avec ses réglages (générés depuis `settings`), ses abonnements
(voir ci-dessous) et le panneau `adminPanel` du module.

## Échanger des informations entre modules : les sujets

Un overlay « labyrinthe » affiche des affiches tirées d'articles, un overlay « sponsors » affiche
les offres de partenaires… sans que le module d'overlay connaisse le blog ou les codes promo. Le
principe : **le consommateur déclare ce qu'il sait digérer, les fournisseurs exposent des
informations dans ce format.**

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
  (champs inconnus supprimés, éléments invalides écartés) et ajoute sa provenance (`source`).
  Un fournisseur qui plante est ignoré.
- **Abonnements dans l'admin** : sur la page d'une instance consommatrice, section « Sources de
  données » : on coche quelles instances fournisseuses l'alimentent (tout coché = toutes, y compris
  celles ajoutées plus tard) et, si le consommateur a déclaré `"tags": true`, on filtre par étiquette.
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

Pour qu'un module tiers alimente un consommateur existant, il lui suffit de déclarer
`provides: [{ "topic": "…" }]` et d'implémenter `exports` — sans rien savoir du consommateur.

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

## Installer / publier

Admin → **Modules → Installer un module** → adresse du dépôt :

```
https://github.com/<vous>/<depot>          # dernière version
https://github.com/<vous>/<depot>#v1.2.0   # tag ou branche épinglé
```

Le module est installé **désactivé** ; on l'active après l'avoir relu, puis on lui ajoute des
instances. Chaque instance active a sa propre entrée dans le menu d'admin. « Chercher une mise à
jour » compare avec le dépôt distant.

**Catalogue (façon HACS)** : définissez `MODULES_INDEX_URL` vers un JSON public
(`docs/modules-index.example.json`) pour proposer une liste de modules installables en un clic.

## `module.json`

```jsonc
{
  "apiVersion": 2,                       // contrat avec le cœur
  "id": "announcement-banner",           // a-z, 0-9, tirets ; unique
  "name": { "en": "…", "fr": "…" },      // texte ou { langue: texte }
  "version": "1.0.0",
  "description": { "en": "…" },
  "author": "…", "license": "MIT", "homepage": "https://…",
  "icon": "📣",
  "main": "index.mjs",                   // absent = module sans code
  "type": "widget",                      // content | overlay | widget | integration | utility
  "instances": "multiple",               // ou "single"
  "permissions": ["slots", "sections", "routes", "storage", "filters", "pages", "topics", "overlay"], // affiché à l'admin

  "settings": [                          // réglages PAR INSTANCE ; l'admin génère le formulaire
    { "key": "text", "type": "text", "translatable": true, "label": { "en": "…" } },
    { "key": "tone", "type": "select", "default": "info",
      "options": [{ "value": "info", "label": { "en": "Accent" } }] }
  ],

  "sections": [                          // morceaux plaçables sur la page d'accueil
    { "id": "note", "label": { "en": "Note" },
      "options": [{ "key": "count", "type": "number", "label": { "en": "How many" }, "default": 3 }] }
  ],

  "content": {                           // OPTIONNEL : module à contenu (blog, liens, codes…)
    "display": "cards",                  // cards | list | links | codes
    "clickAction": "detail",             // detail | external
    "features": ["cover", "summary", "body"],   // cover icon summary body url code expiresAt featured
    "basePath": "blog", "showInNav": true,
    "allowGoLinks": false, "fallbackToDefault": true,
    "fieldSchema": [{ "key": "price", "label": "Price", "type": "number" }]
  },
  "page": true                           // OPTIONNEL : l'instance a une page publique (défaut : oui si "content")
}
```

Types de réglages : `text`, `textarea`, `url`, `number`, `boolean`, `select`, `color`,
`secret` (jamais réaffiché). `translatable: true` = une valeur par langue du site.

### Module à contenu : zéro code

Avec `content`, le cœur fournit gratuitement l'éditeur d'entrées (multilingue, brouillons,
dates, image), les pages publiques (liste + entrée), le sitemap, les liens `/go/<instance>/<entrée>`
et la section d'accueil **« dernières entrées »** (`latest`). Un module « galerie », « FAQ » ou
« événements » peut n'être qu'un `module.json`.

## `index.mjs`

```js
export default {
  slots:    { "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }] },
  sections: { note: (ctx, options) => [{ type: "markdown", text: ctx.setting("homeText") }] },
  page:     (ctx, { segments }) => ({ title: "…", blocks: [/* … */] }),     // page publique sur le chemin de l'instance
  routes:   { send: async (request, ctx) => Response.json({ ok: true }) },  // /m/<clé de l'instance>/send
  filters:  { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") },
  adminPanel: async (ctx) => [{ type: "heading", text: "…" }],
  exports:  { "mon.sujet": (ctx, query) => [/* éléments au format du sujet */] },
  overlay:  (ctx, { query }) => ({ html, css, script }),   // modules de type overlay
  hooks:    { onInstanceCreate: async (ctx) => {}, onInstanceDelete: async (ctx) => {} },
};
```

### Sections (page d'accueil)

L'accueil n'a pas de contenu propre : c'est la liste ordonnée des sections que l'admin place
(Page d'accueil). Chaque section est `(instance, section)` + options. Déclarez-la dans
`module.json` (`sections`) et implémentez `sections.<id>(ctx, options)` qui renvoie des blocs.
Plusieurs instances = plusieurs sections : « dernières entrées du blog 2 » et « liens de la
chaîne 1 » sont deux placements indépendants.

### Emplacements (slots)

`layout.head` · `layout.banner` · `layout.footer` · `nav.items` (bloc `links`) · `page.top` ·
`page.bottom` (autour de la page d'une instance) · `entry.top` · `entry.bottom`. Les slots
`page.*` et `entry.*` reçoivent `ctx.page` (l'instance dont on affiche la page — pas forcément
la vôtre) et, pour `entry.*`, `ctx.entry`.

### Blocs

| `type` | Champs |
|---|---|
| `markdown` | `text` (sans HTML brut) |
| `html` | `html` — brut, sous la responsabilité du module |
| `heading` | `text` |
| `hero` | `title`, `text?`, `image?` |
| `banner` | `text`, `href?`, `tone?` (`info` · `success` · `warning`) |
| `links` | `items: [{ label, href, icon? }]` |
| `entries` | `instance` (clé), `limit?`, `title?`, `link?` — entrées d'une instance, rendues par le cœur |
| `embed` | `src` (https), `title`, `ratio?` |
| `form` | `action` (`<clé d'instance>/<route>`), `fields`, `submitLabel`, `successText` |
| `table` | `columns`, `rows` |
| `head` | `tags`: `meta` / `link` / `script` (uniquement dans `layout.head`) |

### Contexte (`ctx`)

- `ctx.instance` — `{ id, key, basePath, name }` de l'instance courante
- `ctx.locale`, `ctx.defaultLocale`, `ctx.locales`
- `ctx.setting("clé")` — réglage de l'instance pour la langue courante (avec sa valeur par défaut)
- `ctx.t("clé", { vars })` — textes de `locales/<langue>.json`
- `ctx.api.topics.collect(sujet, { limit? })` — informations des sources de l'instance (sujet déclaré dans `consumes`)
- `ctx.api.entries.list({ instance?, locale?, limit? })` — entrées publiées (par défaut, de l'instance courante)
- `ctx.api.instances.list({ module?, locale? })`, `ctx.api.site(locale)` (nom, accroche, logo)
- `ctx.api.store.add / list / remove / count` — stockage privé de l'instance
- `ctx.api.siteUrl`

Un module n'importe rien du cœur : tout passe par `ctx`. C'est ce qui garantit qu'il continuera
de fonctionner quand le cœur évolue (tant que `apiVersion` est inchangé).

## Sécurité : à lire avant d'installer

Un module s'exécute dans le serveur avec les mêmes droits que le site. Installez seulement des
modules dont vous faites confiance à l'auteur, épinglez une version (`#tag`), et relisez le code
avant d'activer. L'installation et la mise à jour sont réservées au propriétaire.
