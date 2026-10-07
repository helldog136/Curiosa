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
  "instances": "multiple",               // ou "single"
  "permissions": ["slots", "sections", "routes", "storage", "filters", "pages"], // affiché à l'admin

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
