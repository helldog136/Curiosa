# Écrire un module

Un module = un dépôt git avec, à la racine :

```
module.json      manifeste (obligatoire)
index.mjs        code (si le module fait plus que déclarer des réglages)
locales/fr.json  textes du module par langue (facultatif)
```

Pas de `npm install`, pas de build : le fichier est chargé tel quel par Node. Si vous avez
besoin de dépendances, livrez un fichier unique déjà empaqueté. Un exemple complet et
minimal : [`modules-examples/announcement-banner`](../modules-examples/announcement-banner).

## Installer / publier

Admin → **Modules → Installer un module** → adresse du dépôt :

```
https://github.com/<vous>/<depot>          # dernière version
https://github.com/<vous>/<depot>#v1.2.0   # tag ou branche épinglé
```

Le module est installé **désactivé** ; on l'active après l'avoir relu. Chaque module activé
a sa propre entrée dans le menu d'admin, qui affiche son formulaire de réglages et son
éventuel panneau. « Chercher une mise à jour » compare avec le dépôt distant.

**Catalogue (façon HACS)** : définissez `MODULES_INDEX_URL` vers un JSON public
(`docs/modules-index.example.json`) pour proposer une liste de modules installables en un clic.

## `module.json`

```jsonc
{
  "apiVersion": 1,                       // contrat avec le cœur
  "id": "announcement-banner",           // a-z, 0-9, tirets ; unique
  "name": { "en": "…", "fr": "…" },      // texte ou { langue: texte }
  "version": "1.0.0",
  "description": { "en": "…" },
  "author": "…", "license": "MIT", "homepage": "https://…",
  "icon": "📣",
  "main": "index.mjs",                   // absent = module sans code
  "permissions": ["slots", "routes", "storage", "collections", "filters"], // affiché à l'admin
  "settings": [                          // l'admin génère le formulaire
    { "key": "text", "type": "text", "translatable": true, "label": { "en": "…" } },
    { "key": "tone", "type": "select", "default": "info",
      "options": [{ "value": "info", "label": { "en": "Accent" } }] }
  ]
}
```

Types de réglages : `text`, `textarea`, `url`, `number`, `boolean`, `select`, `color`,
`secret` (jamais réaffiché). `translatable: true` = une valeur par langue du site.

## `index.mjs`

```js
export default {
  slots:   { "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }] },
  routes:  { send: async (request, ctx) => Response.json({ ok: true }) },   // /m/<id>/send
  filters: { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") },
  adminPanel: async (ctx) => [{ type: "heading", text: "…" }],
  collections: [{ key: "faq", basePath: "faq", names: { en: "FAQ", fr: "FAQ" } }],
  hooks: { onEnable: async (ctx) => {}, onDisable: async (ctx) => {} },
};
```

### Emplacements (slots)

`layout.head` · `layout.banner` · `layout.footer` · `nav.items` (bloc `links`) ·
`home.top` · `home.bottom` · `collection.top` · `collection.bottom` · `entry.top` ·
`entry.bottom`. Les slots `collection.*` reçoivent `ctx.collection`, les `entry.*`
reçoivent aussi `ctx.entry`. L'admin peut aussi placer un slot comme section de l'accueil.

### Blocs

| `type` | Champs |
|---|---|
| `markdown` | `text` (sans HTML brut) |
| `html` | `html` — brut, sous la responsabilité du module |
| `heading` | `text` |
| `banner` | `text`, `href?`, `tone?` (`info` · `success` · `warning`) |
| `links` | `items: [{ label, href, icon? }]` |
| `entries` | `collection`, `limit?`, `title?` — liste d'entrées, rendue par le cœur |
| `embed` | `src` (https), `title`, `ratio?` |
| `form` | `action` (`<module>/<route>`), `fields`, `submitLabel`, `successText` |
| `table` | `columns`, `rows` |
| `head` | `tags`: `meta` / `link` / `script` (uniquement dans `layout.head`) |

### Contexte (`ctx`)

- `ctx.locale`, `ctx.defaultLocale`, `ctx.locales`
- `ctx.setting("clé")` — valeur du réglage pour la langue courante (avec sa valeur par défaut)
- `ctx.t("clé", { vars })` — textes de `locales/<langue>.json`
- `ctx.api.entries.list({ collection, locale?, limit? })`, `ctx.api.collections.list()`
- `ctx.api.store.add / list / remove / count` — stockage privé du module
- `ctx.api.siteUrl`

Un module n'importe rien du cœur : tout passe par `ctx`. C'est ce qui garantit qu'il
continuera de fonctionner quand le cœur évolue (tant que `apiVersion` est inchangé).

## Sécurité : à lire avant d'installer

Un module s'exécute dans le serveur avec les mêmes droits que le site. Installez seulement
des modules dont vous faites confiance à l'auteur, épinglez une version (`#tag`), et relisez le
code avant d'activer. L'installation et la mise à jour sont réservées au propriétaire.
