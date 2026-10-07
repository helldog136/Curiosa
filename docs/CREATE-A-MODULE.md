# Créer un module, pas à pas

Ce tutoriel s'adresse à quelqu'un qui n'a **jamais vu le framework**. À la fin, vous saurez tout ce qu'un module peut faire et comment le
faire, vous aurez testé le vôtre sur votre machine et vous saurez le publier. Il s'appuie sur un module d'exemple complet et fonctionnel,
[`modules-examples/guestbook`](../modules-examples/guestbook) (un livre d'or modéré), dont chaque partie est expliquée par des
commentaires dans [`index.mjs`](../modules-examples/guestbook/index.mjs). La **référence exhaustive** de chaque champ est
[MODULES.md](MODULES.md) ; quand ce tutoriel dit « voir la référence », c'est là.

**Sommaire** : [1. Les idées](#1-les-idées-à-connaître) · [2. Prérequis](#2-prérequis) · [3. Un premier module](#3-un-premier-module-hello) ·
[4. Réglages](#4-réglages-et-apparence) · [5. Accueil](#5-sections-de-la-page-daccueil-et-tailles) · [6. Pages](#6-une-page-publique) ·
[7. Routes et formulaires](#7-routes-et-formulaires) · [8. Stockage](#8-stocker-des-données) · [9. E-mail](#9-envoyer-un-e-mail) ·
[10. Sujets et RSS](#10-échanger-avec-les-autres-modules-sujets-et-flux-rss) · [11. Admin](#11-panneau-et-actions-dadmin) ·
[12. MCP](#12-actions-mcp-pour-les-assistants) · [13. Sauvegarde](#13-sauvegarde-lisible) · [14. Thème et langues](#14-thème-et-langues) ·
[15. Overlays, hooks, slots, filtres](#15-overlays-crochets-emplacements-filtres) · [16. Zéro code](#16-modules-à-contenu-zéro-code) ·
[17. Tester](#17-tester-son-module) · [18. Versions et marketplace](#18-versions-et-publication) · [19. Sécurité](#19-règles-de-sécurité) ·
[Checklist](#checklist-avant-de-publier)

## 1. Les idées à connaître

- **Le cœur offre, les modules apportent.** Le framework (le « cœur ») gère le site, l'admin, les langues, le stockage, l'e-mail…
  Un module est une fonctionnalité qui s'y branche : un blog, un livre d'or, un planning, un overlay pour OBS.
- **Le cœur ne sait rien de votre métier.** Il ne connaît aucun module par son nom ; tout ce qu'il doit savoir est **déclaré** dans le
  manifeste `module.json`. Réciproquement, **votre module n'importe jamais rien du cœur** : il n'a que l'objet `ctx` qu'on lui passe.
- **Un module = un dépôt git** (ou un dossier), avec `module.json` à la racine et, si besoin, `index.mjs` (le code) et `locales/` (les textes).
  Pas de `npm install`, pas de build : le fichier est chargé tel quel par Node.
- **Le module est un type, l'administrateur crée des instances.** Votre code tourne **une fois par instance** : deux livres d'or sur le
  même site ont chacun leurs réglages et leurs données. N'écrivez jamais comme s'il n'y en avait qu'un.
- **Des blocs, pas du React.** Votre code renvoie des *blocs* (`markdown`, `form`, `table`…) ; le cœur les affiche avec le thème et la langue du site.
- **Du code de confiance.** Un module s'exécute dans le serveur avec les mêmes droits que le site. Voir [la sécurité](#19-règles-de-sécurité).

## 2. Prérequis

- **Node 20 ou plus** et **git**.
- Une copie du framework qui tourne en local (voir [INSTALL.md](INSTALL.md)) pour essayer votre module. Pour le seul développement et les tests
  unitaires, un simple Node suffit.
- Les conventions du projet : **textes montrés aux humains traduits** (fichiers `locales/`), **identifiants en anglais** (sujets, rubriques,
  clés d'action : `domaine.objet`, minuscules), **aucune donnée métier réelle dans le code** (utilisez des exemples neutres : `example.org`, « Demo »).

## 3. Un premier module : « hello »

Créez un dépôt avec deux fichiers **à la racine** (pas dans un sous-dossier : l'installateur cherche `module.json` à la racine).

`module.json` :

```json
{
  "apiVersion": 2,
  "id": "hello",
  "name": { "en": "Hello", "fr": "Bonjour" },
  "version": "1.0.0",
  "main": "index.mjs",
  "instances": "multiple",
  "permissions": ["slots"],
  "settings": [
    { "key": "text", "type": "text", "default": "Hello!", "translatable": true, "label": { "en": "Banner text", "fr": "Texte de la bannière" } }
  ]
}
```

`index.mjs` :

```js
export default {
  slots: {
    // Une bannière tout en haut de chaque page du site.
    "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }],
  },
};
```

C'est tout : un module complet. Le manifeste dit **ce que le module est** (identité, réglages, ce qu'il utilise) ; le code dit **ce qu'il fait**.
Les champs importants : `apiVersion` (toujours `2` aujourd'hui : le contrat avec le cœur), `id` (minuscules, chiffres, tirets, stable à jamais),
`version` (`x.y.z`), `main` (le fichier de code ; sans lui, module « sans code »), `instances` (`"multiple"` ou `"single"`), `permissions` (ce que vous utilisez).

Les **permissions** sont déclaratives : elles disent à l'administrateur ce que fait le module. Une par capacité utilisée : `slots`, `sections`, `pages`,
`routes`, `storage`, `filters`, `topics`, `overlay`, `mcp`, `admin`, `mail`. Le cœur ne bloque pas une capacité non déclarée — déclarez-les fidèlement.

L'exemple minimal « de production » est [`announcement-banner`](../modules-examples/announcement-banner) ; essayez le vôtre tout de suite :
[section 17](#17-tester-son-module). Toutes les clés possibles de `index.mjs` sont des **clés optionnelles** de l'objet exporté :
`slots`, `sections`, `page`, `overlay`, `exports`, `routes`, `filters`, `adminPanel`, `adminActions`, `mcp`, `backup`, `hooks`. On les découvre une à une.

## 4. Réglages et apparence

Les réglages sont **par instance** ; l'admin génère le formulaire à partir de `settings`. Dans le code : `ctx.setting("clé")`, qui renvoie la valeur de
la langue courante, ou la valeur par défaut.

```json
{ "key": "autoApprove", "type": "boolean", "default": false, "label": { "en": "Publish without moderation", "fr": "Publier sans modération" } },
{ "key": "style", "type": "select", "default": "cards", "label": { "en": "Style" },
  "options": [{ "value": "cards", "label": { "en": "Cards" } }, { "value": "plain", "label": { "en": "Plain" } }] },
{ "key": "accent", "type": "color", "default": "theme:accent", "group": "appearance", "label": { "en": "Accent color" } },
{ "key": "maxLength", "type": "number", "default": 500, "advanced": true, "label": { "en": "Maximum length" } },
{ "key": "accessCode", "type": "secret", "advanced": true, "label": { "en": "Invitation code" } }
```

| Type | Pour |
|---|---|
| `text`, `textarea`, `url` | texte court, long, adresse |
| `number`, `boolean`, `select` | nombre, case à cocher, liste (`options`) |
| `color` | couleur `#RRGGBB` ; avec `"default": "theme:accent"` elle **suit le thème du site** tant que l'administrateur n'en choisit pas |
| `image` | téléversement ou adresse |
| `secret` | jamais réaffiché après enregistrement (clé d'API, code…) |

Attributs : `translatable: true` (une valeur par langue du site), `advanced: true` (masqué en admin simplifié — **donnez toujours une valeur par défaut**),
`group: "appearance"` (rangé sous « Apparence de ce module »). Les jetons de thème permis pour `theme:` sont `accent`, `accentFg`, `bg`, `surface`, `fg`, `muted`, `line`.

**Piège classique** : la valeur d'un réglage n'est **pas garantie** (un nombre peut arriver en texte, une couleur ou une adresse peut être n'importe quoi). Convertissez,
bornez, validez avant d'utiliser. L'exemple a des petits outils pour cela (`num()`, `safeColor()`, `safeSrc()` dans [`index.mjs`](../modules-examples/guestbook/index.mjs)).

Voir la référence : « Réglages (`settings`) ».

## 5. Sections de la page d'accueil et tailles

La page d'accueil est un **flux** de morceaux (sections) proposés par les modules ; l'administrateur les ordonne. Vous **déclarez** la section et sa taille
recommandée dans `module.json`, et vous la **rendez** dans `sections` :

```json
"sections": [
  { "id": "latest", "size": "small", "label": { "en": "Latest message" } },
  { "id": "recent", "size": "medium", "label": { "en": "Recent messages" },
    "options": [{ "key": "count", "type": "number", "default": 3, "label": { "en": "How many" } }] }
]
```

```js
export default {
  sections: {
    async recent(ctx, options) {
      const count = Math.min(10, Math.max(1, Number(options.count) || 3)); // options = réglages du placement : à borner
      const list = (await ctx.api.store.list("messages", { limit: count }));
      if (!list.length) return null;            // rien à montrer : la section disparaît et les voisines prennent sa place
      return [{ type: "heading", text: ctx.t("recentTitle") }, /* … blocs … */];
    },
  },
};
```

Tailles : `small` (petit encart : un code, un dernier message), `medium` (une carte), `large` (un morceau qui aime la place), `full` (toute la largeur ;
c'est le défaut sans `size`). Les morceaux s'écoulent comme du texte, à la ligne quand la place manque ; l'administrateur peut changer la taille et
**isoler** un morceau (seul sur sa ligne). Écrivez donc un rendu **qui s'adapte** : titre court, peu de texte, pas de largeur fixe. Permission : `sections`.
Exemple : sections `latest` et `recent` du guestbook.

## 6. Une page publique

Un module peut avoir une page à lui, montée sur un chemin (`/guestbook`). Dans le manifeste : `"page": true` et `"basePath": "guestbook"` (le chemin proposé
à la création de l'instance). Dans le code, la fonction `page` :

```js
export default {
  async page(ctx, { segments }) {
    // /guestbook → []   ·   /guestbook/page/2 → ["page", "2"]
    if (segments.length) return { notFound: true, blocks: [] };         // 404 pour tout chemin inconnu
    return { title: ctx.t("pageTitle"), blocks: [{ type: "markdown", text: ctx.setting("intro") ?? "" }] };
  },
};
```

`segments` est ce qui suit le chemin de l'instance (en minuscules). Il n'y a pas de `?paramètre` : faites passer la pagination par le chemin
(`/guestbook/page/2`), comme le fait l'exemple. Le résultat : `title`, `description`, `blocks`, `notFound`. Permission : `pages`.

Les **blocs** les plus utiles (liste complète dans la référence, « Blocs ») : `markdown` (sans HTML brut), `html` (brut — **vous échappez**), `heading`, `banner`, `links`,
`hero`, `entries`, `embed`, `form`, `table`, `copy`, `swatches`, `downloads`, `head`, `adminForm`. Pour afficher du texte de visiteur avec une mise en forme, le plus sûr est un
bloc `html` dont vous échappez chaque valeur (`esc()` dans l'exemple) ; **jamais** de texte de visiteur dans un bloc `markdown` (les liens et images Markdown fonctionnent).

## 7. Routes et formulaires

Une **route** est un endpoint HTTP que votre module expose : `/m/<clé de l'instance>/<nom>`, en GET et POST. C'est ce qui reçoit un formulaire.

```js
export default {
  routes: {
    async sign(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const form = await request.formData();
      if (String(form.get("website") ?? "")) return Response.json({ ok: true });   // piège à robots : on fait semblant
      const name = String(form.get("name") ?? "").trim().slice(0, 60);
      if (!name) return Response.json({ ok: false }, { status: 400 });
      /* … conserver, prévenir … */
      return Response.json({ ok: true });
    },
  },
};
```

Le formulaire public est un bloc `form` dont l'`action` est `<clé de l'instance>/<nom de la route>` :

```js
{ type: "form", action: `${ctx.instance.key}/sign`, submitLabel: "Sign", successText: "Thank you!",
  fields: [{ name: "name", label: "Your name", required: true }, { name: "message", label: "Message", kind: "textarea", required: true }] }
```

À savoir : le bloc poste en `fetch`, ajoute un champ piège invisible `website`, et ne regarde que le **code HTTP** (2xx = affiche `successText`, sinon une erreur
générique). Le cœur refuse déjà les POST venus d'un autre site (CSRF). **Le reste est à vous** : méthode, validation (tailles, caractères de contrôle, nombre de liens),
anti-abus (limiteur de débit en mémoire dans l'exemple), code d'invitation. Permission : `routes`. Voir `routes.sign` dans l'exemple.

## 8. Stocker des données

`ctx.api.store` est un stockage privé **à l'instance** : des collections libres de documents JSON.

```js
const id = await ctx.api.store.add("messages", { name, message, status: "pending" });   // crée
const row = await ctx.api.store.get(id);                                                 // { id, createdAt, data } ou null
await ctx.api.store.update(id, { ...row.data, status: "approved" });                     // REMPLACE le document : réécrivez tout
const recent = await ctx.api.store.list("messages", { limit: 50 });                      // les plus récents d'abord (100 par défaut)
const n = await ctx.api.store.count("messages");
await ctx.api.store.remove(id);
```

Pas de requête : lisez une page raisonnable et filtrez en code (l'exemple lit au plus 1000 messages et filtre `approved`). Le stockage est sauvegardé par le cœur
et supprimé avec l'instance. Permission : `storage`. Le workflow de modération de l'exemple (`pending` → `approved`) est le modèle à suivre pour tout contenu venant de visiteurs.

## 9. Envoyer un e-mail

```js
const result = await ctx.api.mail.send({ to: "owner", subject: "New message", text: "Ada wrote: …" });
// → { ok: true } ou { ok: false, reason: "not_configured" | "no_recipient" | "invalid" | "rate_limited" | "failed" }
```

`to: "owner"` = le contact du site (ou une adresse). Le serveur d'e-mail est réglé une fois par le propriétaire du site ; vous n'avez ni identifiants ni choix de l'expéditeur.
`send` **ne lève jamais** ; `ctx.api.mail.configured()` dit si un serveur est réglé. **Règle d'or** : l'e-mail est un plus. **Conservez d'abord** (`store.add`), **prévenez ensuite**, et ne faites
jamais échouer la requête si l'e-mail échoue — c'est exactement l'ordre de `routes.sign` dans l'exemple. Permission : `mail`.

## 10. Échanger avec les autres modules : sujets et flux RSS

Les modules ne se connaissent pas : ils s'échangent des informations par **sujets**. Un fournisseur **déclare** (`provides`) et **expose** (`exports`) ;
un consommateur **déclare** (`consumes`, avec le format qu'il sait digérer) et **collecte** ; le cœur valide et fait l'entremetteur ; l'administrateur règle les abonnements.

**Fournir** (module.json puis index.mjs) :

```json
"provides": [{ "topic": "feed.item", "label": { "en": "Approved messages in the RSS feed" } }]
```

```js
exports: {
  "feed.item": async (ctx, { locale, limit, tags }) =>
    (await approved(ctx)).slice(0, limit).map((m) => ({
      id: `guestbook:${ctx.instance.key}:${m.id}`,
      title: `Message from ${m.name}`,
      url: "/guestbook",                         // un chemin du site ou une adresse http(s)
      summary: m.message.slice(0, 280),
      publishedAt: new Date(m.at).toISOString(), // une date ISO, en texte
      topics: ["guestbook"],                     // rubrique PARTAGÉE du flux RSS
    })),
},
```

`feed.item` est le sujet **du cœur** pour le flux RSS (`/feed.xml`) : tout module qui le fournit y apparaît. `topics` sont des **rubriques partagées** : si deux modules publient sur
`announcement`, un lecteur abonné à `announcement` reçoit les deux. Ne publiez que ce qui est **public** (jamais un message en attente de modération). Vous pouvez aussi définir
**votre propre sujet** (`guestbook.message`, format `{ id, name, text, publishedAt }`) : voir `exports` dans l'exemple.

**Consommer** (module.json puis index.mjs) :

```json
"consumes": [{ "topic": "overlay.item", "label": { "en": "Items" }, "tags": true,
  "schema": [{ "key": "title", "type": "string", "required": true }, { "key": "text", "type": "string" }, { "key": "image", "type": "url" }] }]
```

```js
const items = await ctx.api.topics.collect("overlay.item", { limit: 20 });   // [{ title, text, image, source }]
```

Le sujet du cœur `core.entry` donne les entrées publiées de tout module à contenu (blog, liens…) : pas besoin de `schema`. Le guestbook ne **consomme** rien (un livre d'or n'a pas besoin des données des autres) ;
pour un exemple de consommateur, lisez [`sponsor-ticker`](../modules-community/sponsor-ticker). Formats de champs : `string`, `url`, `number`, `boolean`, `string[]`.
Nommez vos sujets `domaine.objet` en anglais. Permission : `topics`. Voir la référence : « sujets ».

## 11. Panneau et actions d'admin

Sous les réglages de chaque instance, votre module peut afficher son propre panneau : tableau, boutons, formulaires — toujours réservé aux administrateurs (le cœur vérifie).

```js
export default {
  async adminPanel(ctx, { query }) {                       // query = paramètres de l'URL d'admin (?edit=…)
    const rows = await ctx.api.store.list("messages");
    return [
      { type: "table", columns: ["Name", "Message"], rows: rows.map((r) => [r.data.name, r.data.message]), rowIds: rows.map((r) => r.id),
        rowActions: [
          { label: "Approve", action: "approve" },
          { label: "Edit", href: "?edit={id}" },
          { label: "Delete", action: "remove", confirm: "Delete for good?", danger: true },
        ] },
    ];
  },
  adminActions: {
    async approve(ctx, values) {                           // values.id vient du bouton de ligne ; tout est du texte : validez
      const row = await ctx.api.store.get(values.id);
      if (!row) return { error: "Not found." };
      await ctx.api.store.update(row.id, { ...row.data, status: "approved" });
      return { ok: "Approved." /* , redirect: "?" */ };
    },
  },
};
```

Une action renvoie `{ ok }` (message vert), `{ error }` (message rouge) et/ou `{ redirect: "?" }` (retour à la page de l'instance ; `"?edit=…"` ajoute des paramètres). Un bloc `adminForm`
(champs `text`, `textarea`, `email`, `url`, `number`, `date`, `select`, `hidden`, `image`) poste sur une action ; les `adminForm` ne s'affichent jamais sur le site public. Permission : `admin`.
Voir `adminPanel` et `adminActions` dans l'exemple (modifier un message : `?edit=<id>` ouvre un `adminForm`).

## 12. Actions MCP pour les assistants

Le cœur héberge un serveur MCP : un assistant IA (avec un **jeton** créé par le propriétaire) peut appeler les actions que vos modules déclarent. Rien n'est codé en dur dans le cœur.

```json
"mcp": [
  { "name": "guestbook_list", "readOnly": true, "description": "List the guestbook messages, newest first.",
    "input": { "type": "object", "properties": { "status": { "type": "string", "enum": ["pending", "approved", "all"] }, "limit": { "type": "integer", "minimum": 1, "maximum": 100 } } } },
  { "name": "guestbook_approve", "default": false, "description": "Approve a pending message.",
    "input": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string", "maxLength": 100 } } } },
  { "name": "guestbook_delete", "destructive": true, "default": false, "description": "Permanently delete a message." }
]
```

```js
mcp: {
  async guestbook_approve(ctx, args, actor) {          // args est DÉJÀ validé selon `input` ; actor.name = nom du jeton
    const row = await ctx.api.store.get(args.id);
    if (!row) throw Object.assign(new Error("message not found"), { expose: true });   // seules les erreurs `expose` sont lisibles par l'agent
    await ctx.api.store.update(row.id, { ...row.data, status: "approved", moderatedBy: actor.name });
    return { id: row.id, status: "approved" };
  },
},
```

**Règles des défauts** :

| Champ | Effet |
|---|---|
| `readOnly: true` | lecture seule ; accordée par défaut ; la seule catégorie permise aux jetons « lecture » |
| `default: true/false` | accordée d'office aux nouveaux jetons ? Défaut : oui pour une lecture seule, **non** pour une action qui écrit |
| `destructive: true` | irréversible (suppression…) : signalée comme telle, confirmation à l'octroi, **jamais** `default: true` ni `readOnly` (sinon le manifeste est refusé) |

Un module peut donc **implémenter plus d'actions qu'il n'en active d'office** : l'administrateur accorde le reste, jeton par jeton. Chaque action devient l'outil `<clé de l'instance>__<action>`.
Les arguments inconnus sont refusés ; le schéma `input` accepte `type`, `properties` (`string`, `number`, `integer`, `boolean`, `array`), `enum`, `maxLength`, `minimum`, `maximum`, `items`, `required`. Écrivez la `description`
**pour l'assistant** qui la lira. Permission : `mcp`. Voir la référence : « API MCP ».

## 13. Sauvegarde lisible

Le cœur sauvegarde déjà tout ce que vous mettez dans `ctx.api.store` (en JSON). Pour que les données importantes restent **lisibles sans le framework**, ajoutez des fichiers à la sauvegarde :

```js
backup: {
  async readable(ctx) {
    const rows = await ctx.api.store.list("messages", { limit: 1000 });
    const cell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    return [{ path: "messages.csv", content: rows.map((r) => [r.id, r.data.name, r.data.message].map(cell).join(",")).join("\r\n") }];
  },
},
```

Le fichier atterrit dans `readable/modules/<clé de l'instance>/messages.csv` de l'archive. Deux règles pour un CSV : toutes les cellules entre guillemets (guillemets internes doublés) et une cellule qui commence par
`=`, `+`, `-` ou `@` est préfixée (sinon un tableur l'exécuterait comme une formule). Texte seulement, 50 fichiers et 5 Mo par fichier au plus.

## 14. Thème et langues

**Thème.** Le site a un thème réglé dans l'admin ; votre module le suit **sans rien demander** :

- dans un bloc `html` ou un overlay, utilisez les variables CSS `--v-accent`, `--v-bg`, `--v-fg`, `--v-surface`, `--v-muted`, `--v-line`, `--v-accent-fg`, `--v-font` ;
- dans le code, `ctx.theme` donne les mêmes valeurs (`accent`, `accentFg`, `bg`, `surface`, `fg`, `muted`, `line`, `font`, `fontKey`) ;
- un réglage `color` avec `"default": "theme:accent"` suit le thème tant que l'administrateur ne choisit pas (l'exemple en fait la couleur du liseré des cartes, avec `ctx.theme.accent` en repli).

**Langues.** Mettez vos textes dans `locales/en.json` et `locales/fr.json` (mêmes clés), lisez-les avec `ctx.t("clé", { variable: valeur })` :

```json
{ "mailSubject": "New guestbook message from {name}" }
```

```js
ctx.t("mailSubject", { name })   // repli : langue par défaut, puis « en », puis la clé elle-même
```

Les libellés de `module.json` (`name`, `label`, `help`, `description`…) sont du texte ou `{ "en": "…", "fr": "…" }`. Les réglages `translatable` donnent une valeur par langue.
Le contexte porte `ctx.locale`, `ctx.defaultLocale`, `ctx.locales`. Quand vous construisez un lien interne, préfixez la langue si elle n'est pas la langue par défaut (`/fr/guestbook`) — voir `pageHref()` dans l'exemple.

## 15. Overlays, crochets, emplacements, filtres

Ce que le guestbook n'utilise pas, mais que vous pouvez utiliser.

**Overlay** (type `overlay`, pour OBS) : une source navigateur à fond transparent servie sur `/overlays/<clé>`.

```js
export default {
  routes: { items: async (_req, ctx) => Response.json(await ctx.api.topics.collect("core.entry")) },
  overlay: (ctx, { query }) => ({
    html: '<div id="card"></div>', css: "body{background:transparent;color:var(--v-fg)}",
    script: "fetch('/m/" + ctx.instance.key + "/items').then(r => r.json()).then(/* … */)",   // se rafraîchit depuis sa propre route
  }),
};
```

Déclarez `"type": "overlay"` et la permission `overlay` ; l'admin affiche l'URL à coller dans OBS. Un overlay lit des **sujets** : il ne connaît pas les fournisseurs.

**Crochets** (`hooks`) : `hooks.onInstanceDelete(ctx)` est appelé quand une instance est supprimée, pour nettoyer ce que seul le module connaît (mémoire, service externe) ; le cœur supprime lui-même réglages et
stockage. `hooks.onInstanceCreate(ctx)` est prévu par le contrat mais la version actuelle du cœur **ne l'appelle pas encore** : ne construisez rien qui en dépende.

**Emplacements** (`slots`) : des blocs ajoutés au site. `layout.head` (balises `head`), `layout.banner` (tout en haut), `layout.footer` (pied de page), `nav.items` (menu : un bloc `links`),
`page.top` / `page.bottom` (autour de la page d'une instance ; `ctx.page` dit laquelle), `entry.top` / `entry.bottom` (autour d'une entrée ; `ctx.entry`). L'exemple met un lien dans `layout.footer`.
Plusieurs modules peuvent contribuer au même emplacement : les blocs sont mis bout à bout. Un slot qui renvoie `null` ne montre rien.

**Filtres** (`filters`) : transformer le corps markdown des entrées avant l'affichage.

```js
export default { filters: { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") } };
```

Permission : `filters`. Le filtre s'applique en chaîne avec ceux des autres modules. **Lecture du site** : `ctx.api.site()` (nom, accroche, logo), `ctx.api.brand()` (identité visuelle complète),
`ctx.api.instances.list()`, `ctx.api.entries.list()` (entrées publiées d'un module à contenu), `ctx.api.siteUrl`, et `ctx.api.qr(texte)` (QR code en SVG).

## 16. Modules à contenu : zéro code

Un module de contenu (blog, FAQ, galerie, événements, liens) peut n'être qu'un `module.json`. Avec `content`, le cœur fournit gratuitement l'éditeur d'entrées (multilingue, brouillons, image, dates),
les pages publiques, le sitemap, le flux RSS et la section d'accueil « dernières entrées ».

```json
{
  "apiVersion": 2, "id": "faq", "name": { "en": "FAQ" }, "version": "1.0.0", "instances": "multiple",
  "content": { "display": "list", "clickAction": "detail", "features": ["summary", "body", "tags"], "basePath": "faq", "showInNav": true }
}
```

`display` : `cards`, `list`, `links`, `codes` ; `clickAction` : `detail` ou `external` ; `features` : `cover`, `icon`, `summary`, `body`, `url`, `code`, `expiresAt`, `featured`, `tags` ; `fieldSchema` ajoute des champs
personnalisés. Les entrées alimentent le sujet `core.entry` : n'importe quel overlay ou module peut les lire sans une ligne de code. Voir la référence : « Module à contenu ».

## 17. Tester son module

### Sur votre machine, dans le vrai framework

1. Lancez le framework en local (voir [INSTALL.md](INSTALL.md)) avec la variable d'environnement **`VITRINE_ALLOW_LOCAL_MODULES=1`** (elle autorise les dépôts locaux ; **jamais** sur un serveur public).
2. Votre module est un dépôt git **avec au moins un commit** : `git init && git add . && git commit -m "first version"`.
3. Admin → **Marketplace** → **Installer un dépôt personnel (non vérifié)** → saisissez `file:///chemin/absolu/vers/votre/depot`, cochez la case de confiance. Le module est installé **désactivé**.
4. **Modules** → activez-le, ajoutez une instance, ouvrez-la : réglages, panneau d'admin, page publique, section sur l'accueil (admin → Accueil).
5. Vous avez modifié le code ? **Validez** (`git commit`), puis **Modules → Chercher une mise à jour → Mettre à jour**. Le module est rechargé depuis le dernier commit.

Si l'installation est refusée, le message vous dit pourquoi : manifeste invalide (`module.json: settings.2.key — …`), `apiVersion` différente, `main` introuvable, lien symbolique, plus de 10 Mo…
Le serveur journalise aussi les erreurs d'exécution de votre module (un module en erreur ne casse jamais le site).

Pour un module **livré avec le framework** (comme l'exemple), il suffit de poser son dossier dans `modules-examples/` (ou `modules-community/`) : il apparaît dans la Marketplace.

### Tests unitaires, sans serveur

Votre code ne dépend que de `ctx` : on le teste avec un faux `ctx`. Copiez [`tests/helpers/fakeCtx.mjs`](../tests/helpers/fakeCtx.mjs) (stockage en mémoire, e-mail enregistré dans `ctx.calls.mail`, thème, `t()`, réglages…).

```js
import test from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./fakeCtx.mjs";
import def from "../index.mjs";

test("la bannière affiche le texte réglé", () => {
  const ctx = fakeCtx({ settings: { text: "Hi!" } });
  assert.deepEqual(def.slots["layout.banner"](ctx), [{ type: "banner", text: "Hi!" }]);
});

test("signer conserve le message en attente et prévient le propriétaire", async () => {
  const ctx = fakeCtx({ settings: {}, mailConfigured: true });
  const body = new FormData(); body.set("name", "Ada"); body.set("message", "Bravo");
  const res = await def.routes.sign(new Request("https://example.org/m/x/sign", { method: "POST", body }), ctx);
  assert.equal(res.status, 200);
  assert.equal((await ctx.api.store.list("messages"))[0].data.status, "pending");
  assert.equal(ctx.calls.mail[0].to, "owner");
});
```

Lancez : `node --test`. Dans ce dépôt, les tests des modules vont plus loin (ils valident aussi le manifeste avec `parseManifest`, la parité des langues, les permissions, le XSS…) : prenez
[`tests/modules/example-guestbook.test.mjs`](../tests/modules/example-guestbook.test.mjs) pour modèle et lancez
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/helpers/register.mjs --test tests/modules/example-guestbook.test.mjs`.
Testez au minimum : le manifeste est valide, chaque section/action/sujet déclaré est implémenté, un visiteur malveillant ne peut rien injecter, un échec d'e-mail ne perd rien.

## 18. Versions et publication

- **Versionnez** : `version` dans `module.json` suit `x.y.z`. Marquez chaque version publiée d'un **tag git** : `git tag v1.2.0 && git push --tags`.
- **Installer une version précise** : l'adresse du dépôt accepte `#tag` ou `#branche` : `https://github.com/<vous>/<depot>#v1.2.0`. Sans `#`, c'est la dernière version de la branche par défaut,
  et « Chercher une mise à jour » détecte les nouveaux commits. Un tag ne bouge pas : une installation épinglée à un tag reste à cette version.
- **Compatibilité** : tant que `apiVersion` est celle du cœur (`2`), votre module continue de fonctionner quand le cœur évolue ; si l'API change, un module d'une autre version est refusé plutôt que cassé.
- **Hôtes** : l'administrateur d'un site n'accepte que les dépôts `https://` des hôtes autorisés (`MODULES_ALLOWED_HOSTS`, par défaut GitHub, GitLab, Codeberg, Bitbucket). Gardez le dépôt public.

**Être listé dans la Marketplace** : deux voies.

1. **Livré avec le framework** : un dossier de module dans `modules-community/` (modules complets) ou `modules-examples/` (exemples) du dépôt du framework, `module.json` à sa racine. Il est installé depuis les fichiers du serveur, sans réseau.
2. **Dépôt reconnu** : celui qui publie un **index** JSON public s'en porte garant. L'administrateur d'un site règle `MODULES_INDEX_URL` (adresse `https://`) vers cet index :

```json
[
  { "id": "guestbook", "name": "Guestbook", "description": "A moderated guestbook.", "repo": "https://github.com/<vous>/<depot>",
    "ref": "v1.0.0", "version": "1.0.0", "apiVersion": 2, "author": "Vitrine", "icon": "📖" }
]
```

`id`, `name`, `description` et `repo` suffisent ; `ref` (tag), `version`, `apiVersion`, `author`, `icon` sont facultatifs. Le dépôt cité doit servir **le module annoncé** (`id` identique à celui de son `module.json`),
sur un hôte autorisé ; rien n'est installé automatiquement. Un modèle est fourni : [`modules-index.example.json`](modules-index.example.json). Tout autre dépôt reste un module **personnel** : il s'installe avec un avertissement.

## 19. Règles de sécurité

Un module est **du code de confiance** : il tourne sur le serveur avec les droits du site, et le propriétaire l'installe en connaissance de cause. Cela ne dispense pas d'être irréprochable :

- **Tout ce qui vient d'un visiteur est hostile** (formulaire, `segments`, en-têtes, `query`). Validez à l'entrée : types, tailles, caractères de contrôle, nombre de liens. Bornez les réglages numériques.
- **Échappez à la sortie.** Un bloc `html` est brut : passez chaque valeur de visiteur par un échappement (`& < > " '`). Les blocs `markdown`, `heading`, `table`, `banner`… échappent le HTML,
  mais le Markdown rend liens et images : ne l'utilisez que pour du texte que vous ou l'administrateur écrivez. Jamais de texte de visiteur dans un attribut ou un `style` sans validation (une couleur doit être `#RRGGBB`).
- **Liens sûrs.** N'acceptez que `https:`, `http:`, `mailto:` ou un chemin du site (`/…` mais pas `//…`). Jamais `javascript:` ni `data:`.
- **Pas de `eval`**, de `new Function`, ni d'exécution de commandes ; pas d'`import` de code téléchargé à l'exécution.
- **Pas de secret dans les journaux.** Ne journalisez ni réglage `secret`, ni contenu privé, ni message complet : un message d'erreur court suffit.
- **Modération.** Tout contenu public soumis par des visiteurs attend une validation par défaut ; ne le publiez (page, flux RSS, sujets) qu'une fois approuvé.
- **Anti-abus.** Limiteur de débit, piège à robots, plafond de stockage sur toute route publique qui écrit.
- **Moindre privilège.** N'activez `default` que pour des actions MCP sans danger ; marquez `destructive` ce qui est irréversible ; ne demandez que les permissions que vous utilisez.
- **Réponses d'erreur muettes.** Ne renvoyez jamais de détail interne (chemin, requête, identifiant technique) à un visiteur.
- **Sorties de tableur.** Neutralisez `=`, `+`, `-`, `@` en tête de cellule d'un CSV (injection de formule).

## Checklist avant de publier

- [ ] `module.json` est à la **racine** du dépôt ; `apiVersion` vaut `2` ; `id` stable ; `version` à jour ; `main` pointe un fichier existant.
- [ ] Le manifeste passe `parseManifest` (installation locale réussie, ou test de manifeste).
- [ ] `permissions` correspond exactement à ce que le code utilise (slots, routes, storage, sections, pages, topics, mcp, admin, mail…).
- [ ] Aucun `import` du cœur dans `index.mjs` ; aucune dépendance à installer (ou un fichier unique empaqueté).
- [ ] Chaque section, action MCP, sujet, action d'admin **déclaré** est **implémenté** (et inversement).
- [ ] Tous les textes montrés aux humains sont dans `locales/` (`en` **et** `fr`, mêmes clés) ; tous les identifiants (sujets, rubriques, actions) sont en anglais.
- [ ] Chaque réglage `advanced` a une valeur par défaut ; les réglages numériques et les couleurs sont validés avant usage.
- [ ] Les actions MCP : lecture seule marquée `readOnly`, écritures sans `default: true` sauf choix assumé, irréversibles `destructive` (jamais `default: true`), `input` complet.
- [ ] Le texte des visiteurs est validé à l'entrée et échappé à la sortie ; liens limités à `https:`/`http:`/`mailto:`/chemins du site ; aucun `eval`.
- [ ] Les messages de visiteurs sont modérés (ou le contraire est un choix explicite de l'administrateur) ; le flux RSS et les sujets n'exposent que le public.
- [ ] Les routes publiques ont limiteur de débit, piège à robots, plafond ; l'e-mail est **après** la conservation et ne fait jamais échouer la requête.
- [ ] Aucun secret, ni donnée privée, ni identifiant réel dans le code, les exemples ou les journaux ; exemples neutres (`example.org`, « Demo »).
- [ ] Le module a des tests (manifeste, parité des langues, comportement, XSS) et ils passent.
- [ ] Essayé en vrai : installation locale, activation, instance, page, formulaire, admin, désinstallation propre.
- [ ] Un `README.md` explique ce que fait le module, ses réglages et ses limites ; la version est **taguée** (`git tag v1.0.0`).
- [ ] Pour la Marketplace : dépôt public sur un hôte autorisé, ajouté à un index (`MODULES_INDEX_URL`) ou proposé dans `modules-community/` / `modules-examples/`.
