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

## Panneau d'admin riche : formulaires et boutons pilotés par le module

Un module dont l'administration dépasse les réglages (suivi de partenaires, liste de contacts…) construit
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

Champs : `text`, `textarea`, `email`, `url`, `number`, `date`, `select` (`options`), `image`, `hidden`. Les blocs
`adminForm` ne s'affichent que dans l'admin (jamais sur le site public). `ctx.api.store` offre `add`, `get`,
`update`, `list`, `remove`, `count` (stockage privé de l'instance).

## Références entre modules

Un champ personnalisé d'un module à contenu peut être une **référence** vers un élément d'un autre module :
dans `content.fieldSchema`, `{ "key": "partner", "label": "Partenaire", "type": "ref", "topic": "partnership.partner" }`
(dans l'admin : `partner | Partenaire | ref:partnership.partner`). Le module déclare le sujet dans `consumes`
(avec un schéma contenant au moins `id` et `title`), l'éditeur affiche une liste déroulante alimentée par les
fournisseurs, et la valeur stockée est l'`id`. Le module résout la référence dans son code
(`ctx.api.topics.collect(...)`) ; elle n'est jamais affichée sur le site public.

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

Types de réglages : `text`, `textarea`, `url`, `number`, `boolean`, `select`, `color`, `image`
(envoi de fichier ou URL), `secret` (jamais réaffiché). `translatable: true` = une valeur par langue
du site.

**Simple et avancé.** L'admin existe en deux versions (bascule dans la barre latérale, préférence de
chaque utilisateur). Marquez `"advanced": true` les réglages techniques de votre module : ils sont
masqués en version simplifiée, et **leur valeur par défaut s'applique** — donnez-en toujours une.
Gardez dans la version simple l'essentiel : ce qu'une personne sans connaissances web peut comprendre
(un nom, une couleur, une image, un nombre de secondes). Les réglages avancés déjà enregistrés ne sont
jamais effacés quand quelqu'un édite en version simple.

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
| `swatches` | `items: [{ name, hex, role? }]` — pastilles de couleur avec code copiable |
| `downloads` | `items: [{ src, label, detail? }]` — images à télécharger, avec aperçu |
| `copy` | `text`, `label?` — texte à copier d'un clic |
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
- `ctx.api.instances.list({ module?, locale? })`, `ctx.api.site(locale)` (nom, accroche, logo), `ctx.api.brand(locale)` (identité visuelle complète : présentation, couleurs nommées, police, contact — lecture seule, jamais copiée)
- `ctx.api.store.add / list / remove / count` — stockage privé de l'instance
- **Services du cœur** (voir [PLATFORM.md](PLATFORM.md)) : `ctx.api.qr(texte)` (QR code en SVG), `ctx.api.store` (stockage privé), `ctx.api.topics` (échanges entre modules) ; le MCP se déclare dans le manifeste
- `ctx.api.siteUrl`

Un module n'importe rien du cœur : tout passe par `ctx`. C'est ce qui garantit qu'il continuera
de fonctionner quand le cœur évolue (tant que `apiVersion` est inchangé).

## Modules livrés avec le cœur, modules communautaires

Seuls les modules de base vivent dans `src/modules-builtin/` : blog, réseaux sociaux, codes promo,
pages, collection vierge, bandeau d'accueil, flux RSS, formulaire de contact, statut live, overlay
défilant et **kit presse** (une pure vitrine : il lit l'identité réglée dans le cœur via `ctx.api.brand()` et ne stocke rien). Tout le reste s'installe depuis git. `modules-community/` contient des modules complets qui
**ne font pas partie du cœur** (un test le vérifie) et qui rejoindront chacun leur dépôt : le premier est
[`maze-overlay`](../modules-community/maze-overlay), le labyrinthe 3D de helldog136.be porté en module
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

## Sécurité : à lire avant d'installer

Un module s'exécute dans le serveur avec les mêmes droits que le site. Installez seulement des
modules dont vous faites confiance à l'auteur, épinglez une version (`#tag`), et relisez le code
avant d'activer. L'installation et la mise à jour sont réservées au propriétaire.
