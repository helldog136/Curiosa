# Créer un module, pas à pas

Ce tutoriel s'adresse à quelqu'un qui n'a **jamais vu le framework**. À la fin, vous saurez tout ce qu'un module peut faire et comment le
faire, vous aurez testé le vôtre sur votre machine et vous saurez le publier. Il s'appuie sur un module d'exemple complet et fonctionnel,
`examples/guestbook` (`curiosa-extras/examples/guestbook`) (un livre d'or modéré), dont chaque partie est expliquée par des
commentaires dans `index.mjs` (`curiosa-extras/examples/guestbook/index.mjs`). La **référence exhaustive** de chaque champ est
[MODULES.md](MODULES.md) ; quand ce tutoriel dit « voir la référence », c'est là. **Vous voulez seulement publier votre module dans votre propre dépôt, sans rien nous demander ?** Lisez d'abord le guide court [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md).

**Sommaire** : [1. Les idées](#1-les-idées-à-connaître) · [2. Prérequis](#2-prérequis) · [3. Un premier module](#3-un-premier-module-hello) ·
[4. Réglages](#4-réglages-et-apparence) · [5. Accueil](#5-sections-de-la-page-daccueil-et-tailles) · [6. Pages](#6-une-page-publique) ·
[7. Routes et formulaires](#7-routes-et-formulaires) · [8. Stockage](#8-stocker-des-données) · [9. E-mail](#9-envoyer-un-e-mail) ·
[10. Sujets et RSS](#10-échanger-avec-les-autres-modules-sujets-et-flux-rss) · [11. Admin](#11-panneau-et-actions-dadmin) ·
[12. MCP](#12-actions-mcp-pour-les-assistants) · [13. Sauvegarde](#13-sauvegarde-lisible) · [14. Thème et langues](#14-thème-et-langues) ·
[15. Overlays, hooks, slots, filtres](#15-overlays-crochets-emplacements-filtres) · [16. Zéro code](#16-modules-à-contenu-zéro-code) ·
[17. Tester](#17-tester-son-module) (le kit `module:check`) · [18. Versions et catalogue](#18-versions-et-publication) · [19. Sécurité](#19-règles-de-sécurité) · [20. Vie privée et licence](#20-vie-privée-cookies-et-licence) ·
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
`version` (`x.y.z`), `main` (le fichier de code ; sans lui, module « sans code »), `instances` (`"multiple"` ou `"single"`), `permissions` (ce que vous utilisez). Si votre module a besoin d'une fonction récente du cœur, ajoutez `"minCore": "0.1.10"` (la version minimale du cœur, trois nombres) : un site plus ancien refusera de l'installer ou de monter de version, avec un message qui lui dit de se mettre à jour d'abord. Si votre module concerne une plateforme (Twitch, Discord, YouTube…), ajoutez `"platform": "twitch"` (minuscules, chiffres et tirets) : l'admin regroupe sous la même plateforme les modules qui la partagent. Purement visuel, facultatif. Un module de type `overlay` (ou avec la permission `overlay` et sans `page` ni `sections`) est rangé dans la page Overlays, avec son adresse OBS ; s'il a une page ou des sections, il est rangé comme les autres modules (cœur 0.2.6). Détails : [`MODULES.md`](MODULES.md).

Les **permissions** sont déclaratives : elles disent à l'administrateur ce que fait le module. Une par capacité utilisée : `slots`, `sections`, `pages`,
`routes`, `storage`, `filters`, `topics`, `overlay`, `mcp`, `admin`, `mail`, `rawg`, `privacy` (lire les déclarations de vie privée des autres modules, cœur 0.2.6), `files` (garder et supprimer les fichiers envoyés, cœur 0.2.13), `visitor.geolocation` (demander la position de la personne qui visite après un clic, cœur 0.2.12). Le cœur ne bloque pas une capacité non déclarée — déclarez-les fidèlement. **Seule exception : `visitor.geolocation`.** Le site ferme la position de la personne qui visite (`Permissions-Policy: geolocation=()`) tant qu'aucun module installé ne la déclare ; sans elle, `navigator.geolocation` est refusé par le navigateur. Si votre module la déclare, ajoutez `"minCore": "0.2.12"` et n'appelez la position qu'après un clic. Détails : [MODULES.md](MODULES.md).

L'exemple minimal « de production » est `announcement-banner` (`curiosa-extras/examples/announcement-banner`) ; essayez le vôtre tout de suite :
[section 17](#17-tester-son-module). Toutes les clés possibles de `index.mjs` sont des **clés optionnelles** de l'objet exporté :
`slots`, `sections`, `page`, `news`, `adminBadge`, `overlay`, `exports`, `routes`, `filters`, `adminPanel`, `adminActions`, `mcp`, `backup`, `tasks`, `services`, `hooks`. On les découvre une à une.

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
| `image` | téléversement ou adresse ; l'administrateur peut **recadrer** les images téléversées (voir « Images recadrées » plus bas) |
| `video` | téléversement d'une vidéo MP4 ou WebM (50 Mo au plus), **réservée aux fichiers du site** (`/uploads/…`) ; vérifiez la valeur avant de l'utiliser, comme le fait le module « Bandeau d'accueil » |
| `secret` | jamais réaffiché après enregistrement (clé d'API, code…) |

**Images recadrées.** Un réglage `image` (ou un champ `image` d'un formulaire d'admin, ou la couverture d'une entrée) se recadre depuis l'admin (bouton « Recadrer » : ratio, zoom, position) **sans que votre module ait quoi que ce soit à faire**. L'original n'est jamais modifié ; la valeur reste **une simple chaîne** :

- `/uploads/<id>.png` : l'image telle quelle (c'est aussi toute valeur enregistrée avant ce système) ;
- `/uploads/<id>.png?c=1.7778_1.25_0.5_0.5_ffffff` : l'original + son cadrage (`ratio_zoom_x_y_remplissage`).

**Le contrat** : mettez la valeur **telle quelle** dans un `src` (`<img src>`, `background-image`, bloc `image`, `og:image`…). Le serveur répond alors avec la **version cadrée** (WebP, 1 600 px au plus), fabriquée à la demande et gardée en cache ; si elle ne peut pas l'être, il répond avec l'original, donc l'image s'affiche toujours. Ne **découpez pas** la valeur, ne retirez pas le `?c=…` (ce serait perdre le cadrage de l'administrateur) et ne la comparez pas à une expression `^/uploads/[0-9a-f-]{36}\.png$` : acceptez un éventuel `?c=…`. Si vous **validez** la valeur, utilisez le même motif que le cœur (`UPLOADED_RASTER` de `core/imageCrop.ts`, ou `ctx.api.site()` pour les logos). Pour **réserver la place** avant le chargement, le ratio d'un cadrage est le premier nombre de `c` (`1.7778` = 16:9) ; `o` veut dire « le ratio de l'image d'origine » (inconnu d'avance). Ne supposez plus 16:9 : une image peut être carrée, verticale, panoramique. Pour une image de partage (Open Graph), le cœur sait déjà en fabriquer une 1,91:1 (`&s=1` ajouté à la valeur) ; vous n'avez rien à faire si vous passez par `socialMeta`. Les images distantes (https), les GIF et les SVG ne se cadrent pas : leur valeur ne change jamais.

Attributs : `translatable: true` (une valeur par langue du site), `advanced: true` (masqué en admin simplifié — **donnez toujours une valeur par défaut**),
`optional: true` (réglage facultatif : vide, il ne met pas l'extension « À configurer » — sans cela, un texte, une adresse, un lien ou un secret vide et sans valeur par défaut est signalé à l'administrateur comme « à remplir », avec son libellé), `group: "appearance"` (rangé sous « Apparence de ce module »). Les jetons de thème permis pour `theme:` sont `accent`, `accentFg`, `bg`, `surface`, `fg`, `muted`, `line`.

**Piège classique** : la valeur d'un réglage n'est **pas garantie** (un nombre peut arriver en texte, une couleur ou une adresse peut être n'importe quoi). Convertissez,
bornez, validez avant d'utiliser. L'exemple a des petits outils pour cela (`num()`, `safeColor()`, `safeSrc()` dans `index.mjs` (`curiosa-extras/examples/guestbook/index.mjs`)).

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
à la création de l'instance). **Page facultative** (cœur 0.2.12, `"minCore": "0.2.12"`) : ajoutez un réglage `boolean` (par exemple `publicPage`, `default: false`) et `"pageSetting": "publicPage"`. Tant que la case est décochée, la page répond 404 et n'apparaît ni dans le plan du site, ni dans `llms.txt`, ni dans le menu : n'écrivez pas ce test vous-même. Dans le code, la fonction `page` :

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
(`/guestbook/page/2`), comme le fait l'exemple. (Les listes d'entrées du cœur, elles, utilisent `?page=N` ; ne reprenez pas ce schéma pour une page de module.) Le résultat : `title`, `description`, `blocks`, `notFound`. Permission : `pages`.

**Page d'attente, mentions : ne pas être indexée, être dans le plan du site (cœur 0.2.14, `"minCore": "0.2.14"`).** Une page qui n'a rien à faire dans un moteur de recherche (avertissement avant un lien, confirmation…) répond `robots: "noindex"` : le cœur pose lui-même la balise. Une page qui a des sous-pages (`/legal/cookies`) les liste dans `sitemap` (chemins complets, sous l'adresse de l'instance, 50 au plus) et déclare `"sitemapFromPage": true` dans `module.json` : le plan du site et `llms.txt` les reprennent. Un seul segment variable pour une route, par exemple un lien `/m/<clé>/go/<nom>` : la clé `"go/:slug"` dans `routes`, le segment arrive dans `ctx.params.slug` (déjà limité à lettres, chiffres, `-` et `_`).

```js
export default {
  async page(ctx, { segments, for: purpose }) {
    const base = "/" + ctx.instance.basePath;                     // "/legal"
    if (segments[0] === "merci") return { title: "Merci", blocks: [], robots: "noindex" };
    if (segments.length) return { notFound: true, blocks: [] };
    return { title: "Mentions", blocks: [], sitemap: [base + "/cookies", base + "/conditions"] };   // purpose === "sitemap" : le cœur prépare le plan du site
  },
  routes: {
    async "go/:slug"(request, ctx) {
      const row = (await ctx.api.store.list("links", { limit: 200 })).find((r) => r.data.slug === ctx.params.slug);   // jamais d'adresse construite avec le segment
      return row && /^https:\/\//.test(String(row.data.url)) ? Response.redirect(String(row.data.url), 302) : new Response("Not found", { status: 404 });
    },
  },
};
```

Les **blocs** les plus utiles (liste complète dans la référence, « Blocs ») : `markdown` (sans HTML brut), `html` (brut — **vous échappez**), `heading`, `banner`, `links`,
`hero`, `panel`, `entries`, `embed`, `form`, `table`, `copy`, `swatches`, `downloads`, `head`, `adminForm`. Pour afficher du texte saisi par le public avec une mise en forme, le plus sûr est un
bloc `html` dont vous échappez chaque valeur (`esc()` dans l'exemple) ; **jamais** de texte saisi par le public dans un bloc `markdown` (les liens et images Markdown fonctionnent).

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
et supprimé avec l'instance. Permission : `storage`. Le workflow de modération de l'exemple (`pending` → `approved`) est le modèle à suivre pour tout contenu venant de personnes.

## 9. Envoyer un e-mail

```js
const result = await ctx.api.mail.send({ to: "owner", subject: "New message", text: "Ada wrote: …" });
// → { ok: true } ou { ok: false, reason: "not_configured" | "no_recipient" | "invalid" | "rate_limited" | "failed" }
```

`to: "owner"` = le contact du site (ou une adresse). Le serveur d'e-mail est réglé une fois par la personne propriétaire du site ; vous n'avez ni identifiants ni choix de l'expéditeur.
`send` **ne lève jamais** ; `ctx.api.mail.configured()` dit si un serveur est réglé. **Règle d'or** : l'e-mail est un plus. **Conservez d'abord** (`store.add`), **prévenez ensuite**, et ne faites
jamais échouer la requête si l'e-mail échoue — c'est exactement l'ordre de `routes.sign` dans l'exemple. Permission : `mail`.

**Appeler une API externe.** Préférez `await ctx.api.net.request({ url: "https://api.example.org/v1/items" })` à `fetch` : le cœur fixe un délai (8 s, ou le temps restant de la page), fait une pause après un « 429 trop de demandes » ou un quota épuisé (sans rappeler le service d'ici là), coupe un hôte en panne (disjoncteur), regroupe les appels identiques et refuse tout de suite quand la file est pleine. L'appel ne lève jamais : testez `r.ok`, puis `r.status` et `r.json`. En cas d'échec, affichez les dernières données connues avec leur date. `api.net.health()` donne l'état des services, et le bloc d'admin `netHealth` l'explique à l'administrateur. Voir « Appeler une API externe » dans [MODULES.md](MODULES.md).

**Limiter les envois par personne.** Ne lisez jamais `X-Forwarded-For` vous-même (son début est écrit par la personne qui visite) : `const who = ctx.api.visitor.fingerprint(request, "envoi")` donne une empreinte salée et non réversible de la personne qui visite (jamais son adresse), à compter dans une table bornée. Cœur 0.2.6 (`minCore`), aucune permission. Détails : [MODULES.md](MODULES.md).

**Reprendre ce que les autres modules déclarent récolter.** `await ctx.api.privacy.declarations()` renvoie, par module actif, sa déclaration `privacy` par langue (permission `privacy`, cœur 0.2.6) : utile à un module « Mentions légales » pour ne pas recopier la liste à la main. Un script pour votre seule page : `scripts: ["mon-script.js"]` dans le résultat de `page()` (fichier du dossier `scripts/`). Détails : [MODULES.md](MODULES.md).

**Supprimer vraiment un fichier envoyé.** Retirer une photo de vos données ne la supprime pas du disque : le fichier appartient au cœur. Déclarez la permission `files` (`"minCore": "0.2.13"`), puis dans l'action d'administration qui enregistre la photo : `const c = await ctx.api.files.claim(values.photo)` (échoue avec un motif : `expired`, `taken`, `not-uploader`, `quota`…), et quand on la retire : `await ctx.api.files.remove(url)` (original et versions cadrées ; sans effet si déjà supprimé). Seuls les fichiers que votre instance a revendiqués se suppriment. Détails, motifs et garanties : [MODULES.md](MODULES.md#fichiers-envoyés-garder-et-supprimer-ctxapifiles). Test : `fakeCtx({ permissions: ["files"], uploads: [url] })`.

**Jaquettes de jeux.** Déclarez `"requires": [{ "service": "game.cover", "optional": true }]` et appelez `await ctx.api.services.call("game.cover", "cover", { title: "Hades" })` : le module officiel « Jaquettes de jeux » détient la clé et répond (voir [MODULES.md](MODULES.md#jaquettes-de-jeux-rawg)). La réponse est `{ ok, value }` (`value` : `{ status, url }` avec `found`, `none`, `no-key`, `refused`, `unreachable`, plus `name`, `id` et `ambiguous` facultatifs) ; `ok` est faux si le module n'est pas là : affichez alors le jeu sans image. `candidates` donne les jeux proposés (6 au plus), `status` dit si une clé est réglée. **L'ancienne interface `ctx.api.rawg` (permission `rawg`) est dépréciée depuis le cœur 0.3.0** : elle reste acceptée (aucune erreur pour un module existant) mais n'est plus qu'un relais vers ce service, sans clé ni repli propres ; ne l'utilisez plus dans un nouveau module (le kit de test le signale par le conseil `perm.rawgDeprecated`).
La clé RAWG se règle une fois par la personne propriétaire (dans le module « Jaquettes de jeux ») : ne la demandez jamais dans les réglages de votre module. Aucune permission à déclarer (la permission `rawg` est dépréciée). Détails : [MODULES.md](MODULES.md#jaquettes-de-jeux-rawg).

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
`announcement`, tout abonnement à `announcement` reçoit les deux. Ne publiez que ce qui est **public** (jamais un message en attente de modération). Le cœur écarte lui-même les éléments dont `publishedAt` est dans le futur, ceux sans adresse valide (chemin du site ou http(s)) et les identifiants en double ; il ne peut pas connaître vos règles de modération, c'est à vous de ne renvoyer que du public.

Vous n'avez **rien à fournir** pour un module à contenu (blog, pages, sponsoring…) : ses entrées publiées, non expirées et datées d'avant maintenant alimentent le flux par `core.entry`, sauf si l'instance n'est pas « proposée au public ». Les flux sont : `/feed.xml?lang=fr` (tout), `/feed.xml?topics=a,b` (rubriques), `/feed/<clé-d'instance>.xml` (une instance), `/feed/topics.json` (catalogue). Au plus 50 éléments, du plus récent au plus ancien ; ETag et Last-Modified permettent aux applications de lecture un 304. La personne propriétaire retrouve ces adresses dans l'admin, bloc « Flux RSS » de la page *Visibilité dans les réponses des IA* ; l'icône du pied de page apparaît dès qu'une instance à contenu ou un module `feed.item` existe (et se masque dans ce bloc). Vous pouvez aussi définir
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
pour un exemple de consommateur, lisez `sponsor-ticker` (`curiosa-extras/modules/sponsor-ticker`). Formats de champs : `string`, `url`, `number`, `boolean`, `string[]`.
Nommez vos sujets `domaine.objet` en anglais. Permission : `topics`. Voir la référence : « sujets ».

### Le registre des sujets de votre dépôt

Le cœur ne tient **aucun registre** des sujets échangés entre modules : il ne documente que les trois qu'il lit lui-même (`core.entry`, `social.link`, `feed.item`). Chaque dépôt de modules tient donc le sien : le catalogue officiel dans `docs/TOPICS.md` de `curiosa-extras`, un dépôt tiers dans le même fichier de son propre dépôt.

- Format : un tableau Markdown, **une ligne par sujet** : `` `sujet` | fournisseurs | consommateurs | champs | depuis `` (les champs facultatifs suivis de `?`, les valeurs fermées et les bornes entre parenthèses).
- Un test de votre dépôt lit ce fichier et échoue si un module utilise un sujet absent (modèle : `tests/repo-rules.test.mjs` de `curiosa-extras`, test « sujets »). Rien ne passe par le cœur : créer un sujet ne demande pas de nouvelle version du cœur.
- Si vous fournissez un sujet que le cœur lit (`social.link`, `feed.item`), suivez la règle d'évolution de `docs/MODULES.md` : champs nouveaux facultatifs, listes fermées, un champ = sa version.

### Un bouton de réseau social : choisir `rel`, `referrerPolicy`, `target`

Un module qui fournit `social.link` renvoie `[{ label, url, icon? }]` et peut ajouter, par bouton, `rel` (`"nofollow sponsored"` ou une liste), `referrerPolicy` (`"strict-origin-when-cross-origin"`…) et `target` (`"_self"` ou `"_blank"`). Le cœur ne retient que les valeurs de listes fermées (voir [MODULES.md](MODULES.md#réseaux-sociaux)) : une valeur inconnue est ignorée et le bouton garde `noopener noreferrer` + `_blank`. Rien d'autre n'est copié dans le HTML. Testez avec `fakeCtx` que votre export renvoie ces champs, et sur un site jetable que le HTML de l'en-tête est celui attendu.

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

### Un export à télécharger, un fichier à envoyer (`adminDownloads`, champ `file`)

(Cœur 0.2.0, `minCore` 0.2.0.) Un export contient des données personnelles : ne le mettez **jamais** dans une route (les routes sont publiques). Déclarez-le dans `adminDownloads` avec un générateur
qui lit le stockage par pages et produit le texte ligne par ligne, puis ajoutez un bloc `{ type: "download", name: "contacts", label: "Télécharger (CSV)" }` : le cœur vérifie le droit (`right`, déclaré dans `rights`), l'écrit
dans le journal d'audit et borne la taille et la durée. À l'inverse, un champ `kind: "file"` dans un `adminForm` laisse choisir un fichier texte (CSV…) de 5 Mo au plus ; l'action le reçoit en texte dans `values`.
Détails et limites dans [MODULES.md](MODULES.md) (« `adminDownloads` »).

### Ajouter une section à la fiche d'un autre module (`entryPanels`)

Votre module peut aussi ajouter **une section à la fiche d'une entrée d'un autre module** — par exemple une commande de chat dans la fiche d'un sponsor — sans que ce module le sache. Vous déclarez la section
dans `module.json` (`"entryPanels": [{ "id": "ma-section", "for": { "topic": "un.sujet" }, "title": { "en": "…", "fr": "…" } }]` : `for` désigne les entrées par un sujet que leur module fournit, ou à défaut par `module`)
et vous la décrivez dans le code :

```js
export default {
  entryPanels: {
    "ma-section": {
      render: async (ctx, entry) => [{ type: "adminForm", action: "save", submitLabel: "Save", fields: [{ name: "note", label: "Note" }] }],  // entry.id = la clé de VOS données
      actions: { save: async (ctx, entry, values) => ({ ok: "Saved." }) },    // enregistre sans recharger la page
    },
  },
};
```

La donnée reste chez vous ; la section n'apparaît que si votre module est installé et actif et que l'entrée correspond ; elle s'enregistre sans quitter la page (aucune redirection). Droits : ceux d'un éditeur d'entrée.
Permission : `admin`. Le détail est dans [MODULES.md](MODULES.md) (« Ajouter une section à l'éditeur d'un autre module »).

## 12. Actions MCP pour les assistants

Le cœur héberge un serveur MCP : un assistant IA (avec un **jeton** créé par la personne propriétaire) peut appeler les actions que vos modules déclarent. Rien n'est codé en dur dans le cœur.

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

## 12 bis. Faire évoluer ses données (migrations)

Quand une version de votre module change la **forme** des données qu'il stocke, déclarez `"dataVersion": N` dans `module.json` et écrivez la fonction `migrations[N]` (elle reçoit `ctx`) qui convertit les données
d'**une** instance de la version N-1 à N (voir [MODULES.md › `migrations`](MODULES.md)). Le cœur les exécute dans l'ordre après une mise à jour du module ou une restauration de sauvegarde, garde
une copie de la base avant, et si l'une échoue **remet l'instance dans son état d'avant** et la met à l'écart avec un bouton « Réessayer ». Gardez-les idempotentes, testez-les sur des données de
l'ancienne version. Si la personne **saute des versions** (1.2 → 1.6), le framework récupère chaque étiquette intermédiaire (1.3, 1.4, 1.5) et exécute la migration **de cette version, avec son code**, avant de passer à la suivante : votre dernière version n'a donc pas besoin de garder les anciennes migrations. Pour que cela marche, publiez chaque version sous une étiquette `vX.Y.Z` et ne supprimez pas les étiquettes.

**Reprendre vos réglages dans un autre module.** Si, dans la nouvelle version, un module dont vous dépendez prend en charge une donnée que vous gardiez vous-même (une adresse de calendrier, une clé), déclarez-le dans `seeds`
(avec le `requires` correspondant, ou le `consumes` du sujet que la cible fournit si votre module doit marcher sans elle) et, dans votre migration, appelez `ctx.seedInstance(cible, { nickname, settings, seedKey })` puis `ctx.clearSetting(clé)` : le cœur crée l'instance **une seule fois**, sans jamais écraser
l'existante, défait tout si la migration échoue, et n'écrit jamais les valeurs dans le journal. Détails et séquence d'installation de la cible : [MODULES.md › `migrations`](MODULES.md). Les sujets, eux, acceptent une période
(`collect(sujet, { from, to })`) et le type `datetime` : voir « sujets ».

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
- `ctx.visit.lastVisit` donne la date du passage précédent de la personne qui visite (1er janvier 1970 s'il est inconnu) ; une fonction `news(ctx)` qui renvoie `true` fait apparaître une pastille « nouveau » sur le lien du menu de l'instance (par défaut : des entrées publiées depuis cette date) ;
- `adminBadge(ctx)` renvoie le nombre d'éléments qui attendent l'équipe (messages à lire, fiches à vérifier…) : une pastille s'affiche sur le lien de votre instance dans le menu de l'admin ;
- un réglage `color` avec `"default": "theme:accent"` suit le thème tant que l'administrateur ne choisit pas (l'exemple en fait la couleur du liseré des cartes, avec `ctx.theme.accent` en repli).

**Langues.** Mettez vos textes dans `locales/en.json` et `locales/fr.json` (mêmes clés), lisez-les avec `ctx.t("clé", { variable: valeur })` :

```json
{ "mailSubject": "New guestbook message from {name}" }
```

```js
ctx.t("mailSubject", { name })   // repli : langue par défaut, puis « en », puis la clé elle-même
```

**Règle pour la `description`** (affichée dans le catalogue) : dites ce que fait **votre** module, pour la personne qui l'installe, en une ou deux phrases. Ne citez jamais un autre module (ni ce qui vous consomme, ni ce qui vous alimente) : ces liens se déclarent dans `offers` / `requires` / `provides` / `consumes`, et l'admin les affiche à part. Pas de jargon technique non plus (noms de sujets, d'API…).

Les libellés de `module.json` (`name`, `label`, `help`, `description`…) sont du texte ou `{ "en": "…", "fr": "…" }`. Les réglages `translatable` donnent une valeur par langue.
Le contexte porte `ctx.locale`, `ctx.defaultLocale`, `ctx.locales`. Quand vous construisez un lien interne, préfixez la langue si elle n'est pas la langue par défaut (`/fr/guestbook`) — voir `pageHref()` dans l'exemple.

### Rendre son module stylable par les skins (cœur 0.4.0)

Un skin change l'apparence du site sans toucher au contenu. Pour que votre page publique suive un skin (arrondis, bordures, ombres, surfaces), déclarez ses **pièces** dans `module.json` (clé `skin`) et lisez des jetons `--sk-m-<votre-module>-…` avec, à chaque fois, la **valeur d'aujourd'hui** en dernier repli : `border-radius:var(--sk-m-hello-card-radius,var(--sk-radius-panel,1rem))`. Posez `data-skin-part="hello.card"` sur l'élément. Votre module garde son `<style>` en ligne et son rendu par défaut ne change pas d'un pixel : c'est une version **mineure** avec `"minCore": "0.4.0"`. Le kit (`npm run module:check`) vérifie les jetons, les pièces, la chaîne de repli et l'absence de masquage. Guide complet, pièges et exemple réel : `docs/MODULES.md`, « Rendre un module stylable par les skins ».

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

**Dépendre d'un autre module** (principe : *un module fait une chose* ; ce qui appartient à un autre module s'obtient **par service, jamais par copie** ; une donnée n'a qu'un propriétaire) : `"requires": [{ "service": "contact.store" }]` dans votre `module.json`, puis `await ctx.api.services.call("contact.store", "add", args)` ; l'autre module `offers` ce service et l'implémente dans `services`. Vous n'avez rien d'autre à faire : **le cœur installe le fournisseur** (livré, ou du catalogue reconnu) avec une instance prête à l'emploi quand on installe ou active votre module, vérifie après chaque mise à jour et chaque restauration, et refuse de désactiver un module dont d'autres dépendent. Exemple : Contacts `offers` `contact.store` ; votre formulaire le `requires` et n'a aucune table de contacts à lui. Exigez une capacité récente avec `"min": 2` (le fournisseur annonce `"version": 2` dans `offers` ; sans version, c'est 1) ; gérez toujours `unavailable` en dégradant proprement. **Une instance par chaîne, un compte… ?** Si chaque instance de votre module parle de **sa propre chose** (deux chaînes Twitch), offrez le service avec `"each": true` : pas de maître à choisir, et le consommateur appelle `await ctx.api.services.callAll("twitch.live", "status")` pour obtenir une réponse **par instance** (`[{ instance, name, ok, value | error }]`) ; `call` répond avec la première instance. Pour une donnée à un seul propriétaire (contacts), gardez le service classique. Détails (résolution, cascade, versions, nettoyage, index du catalogue) dans [MODULES.md › Dépendances](MODULES.md).

**Tâches planifiées** (`tasks`) : `tasks: { nom: { everyMinutes: 5, run: async (ctx) => {…} } }` ; le cœur les exécute pour chaque instance active (une fois par minute au plus, jamais en parallèle d'elles-mêmes, erreurs
isolées et visibles dans l'admin). Rendez-les idempotentes et mémorisez ce qui est déjà traité dans `ctx.api.store` ; détails dans [MODULES.md › `tasks`](MODULES.md).

**Crochets** (`hooks`) : `hooks.onInstanceDelete(ctx)` est appelé quand une instance est supprimée, pour nettoyer ce que seul le module connaît (mémoire, service externe) ; le cœur supprime lui-même réglages et
stockage. `hooks.onInstanceCreate(ctx)` est appelé une fois l'instance créée (depuis l'admin ou l'assistant de première installation) ; une restauration de sauvegarde ne le rappelle pas : soyez idempotent et initialisez aussi paresseusement.

**Emplacements** (`slots`) : des blocs ajoutés au site. `layout.head` (balises `head`), `layout.banner` (tout en haut), `layout.footer` (pied de page), `nav.items` (menu : un bloc `links`),
`page.top` / `page.bottom` (autour de la page d'une instance ; `ctx.page` dit laquelle), `entry.top` / `entry.bottom` (autour d'une entrée ; `ctx.entry`). L'exemple met un lien dans `layout.footer`.
Plusieurs modules peuvent contribuer au même emplacement : les blocs sont mis bout à bout. Un slot qui renvoie `null` ne montre rien.

**Filtres** (`filters`) : transformer le corps markdown des entrées avant l'affichage.

```js
export default { filters: { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") } };
```

Permission : `filters`. Le filtre s'applique en chaîne avec ceux des autres modules. **Lecture du site** : `ctx.api.site()` (nom, accroche, logo), `ctx.api.brand()` (identité visuelle complète),
`ctx.api.instances.list()`, `ctx.api.entries.list()` (entrées publiées d'un module à contenu), `ctx.api.siteUrl`, et `ctx.api.qr(texte)` (QR code en SVG) et `ctx.api.png({ width, height, tree })` (image PNG à partir d'une arborescence de boîtes : voir la route `image` du module *planning*), `ctx.api.seo.jsonLd(données)` (données structurées pour `layout.head`, voir la section suivante).

### Le temps que le site vous laisse (8 secondes)

Le site refuse qu'un module bloque une page entière. Quand votre code fabrique un morceau de page publique, il a **8 secondes** : une **section**, un **emplacement**, un **filtre**, votre **page**, la pastille de nouveauté, un **overlay**. Passé ce délai, votre morceau est **omis** (votre page : 404 sobre) et le journal dit, une fois : « La section « … » du module … (instance …) n'a pas répondu en 8 s ; elle est ignorée pour cette page. » Dès **3 secondes**, il écrit aussi « est lente », pour que l'alerte arrive avant. Un morceau qui échoue 3 fois de suite fait **recharger votre module** (une fois par heure au plus ; vos données ne bougent pas).

Pour ne pas être ignoré :
- **Bornez chaque attente.** Un `fetch` s'écrit `fetch(url, { signal: AbortSignal.timeout(5000) })`, jamais sans. Lisez le corps (`res.json()`) sous le même signal.
- **Ne partagez jamais une promesse sans la nettoyer.** Si vous gardez une demande « en cours » dans une `Map` pour que deux personnes la partagent, retirez-la dans un `finally` ET donnez-lui un délai : une entrée dont la promesse ne se termine jamais bloque toutes les personnes qui visitent ensuite, jusqu'au redémarrage.
- **Pas de boucle d'appels en série sans plafond** : 15 appels de 5 s l'un après l'autre font 75 s. Faites-les en parallèle, mettez le résultat en cache, ou limitez leur nombre.
- **Les appels de service et de sujet** (`ctx.api.services.call`, `callAll`, `ctx.api.topics.collect`) faits pendant la page ont **6 secondes** : au-delà, vous recevez `{ ok: false, reason: "failed" }` (ou `error: "failed"` dans `callAll`). Gérez ce cas en affichant un repli (ou rien), comme pour `unavailable`.
- Les tâches planifiées, les routes `/m/…` et l'administration ne sont pas concernées par ce délai.
- Pour essayer en local avec un délai plus court : `CURIOSA_SECTION_TIMEOUT_MS=1000`.

### Données structurées (JSON-LD) : être compris par les moteurs et les IA

Un module qui publie quelque chose de précis (un article, un événement, une vidéo…) peut le décrire aux moteurs de recherche et aux assistants IA avec des **données structurées** schema.org. Le cœur en met déjà sur chaque page (le site, son éditeur, ses profils, le fil d'Ariane) ; vous ajoutez les vôtres par l'emplacement `layout.head`, avec `ctx.api.seo.jsonLd(…)` :

```js
export default { slots: { "layout.head": async (ctx) => {
  const next = (await ctx.api.store.list("streams", { limit: 1 }))[0];
  if (!next) return [];
  const tag = ctx.api.seo.jsonLd({
    "@type": "BroadcastEvent", name: next.data.title, startDate: next.data.startsAt,   // ISO 8601, avec fuseau
    isLiveBroadcast: true, url: `${ctx.api.siteUrl}/planning`,
  });
  return tag ? [{ type: "head", tags: [tag] }] : [];
} } };
```

Le cœur ajoute `@context`, **échappe** `</script>` (jamais de code exécuté) et **borne** la taille (texte de 5 000 caractères, 100 éléments par liste, 8 niveaux, 20 000 caractères au total) ; une donnée sans `@type` est refusée (`null`). Trois règles : ne décrivez que ce qui est **visible** sur la page, ne mettez **aucune donnée privée** (e-mail, brouillon), et donnez des dates en ISO 8601.

Types recommandés :

| Votre module | Type schema.org | Champs utiles |
|---|---|---|
| un blog | `Article` / `BlogPosting` | `headline`, `datePublished`, `author`, `image` |
| un planning de streams | `Event` / `BroadcastEvent` | `name`, `startDate`, `endDate`, `isLiveBroadcast`, `url` |
| des vidéos | `VideoObject` | `name`, `description`, `thumbnailUrl`, `uploadDate`, `embedUrl` |
| une page de présentation | `Person` | `name`, `description`, `image`, `sameAs` |
| une foire aux questions | `FAQPage` | `mainEntity` : liste de `Question` avec `acceptedAnswer` |
| un produit ou une offre | `Product` | `name`, `description`, `image`, `offers` |

Voir aussi [GEO.md](GEO.md).

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
personnalisés. Les entrées alimentent le sujet `core.entry` : n'importe quel overlay ou module peut les lire sans une ligne de code. `showInNav` (ou `suggestInMenu` pour un module sans `content`) **suggère** que la page soit au menu du site : la personne décide, le cœur n'ajoute rien tout seul. Voir la référence : « Module à contenu ».

## 17. Tester son module

### Sur votre machine, dans le vrai framework

1. Lancez le framework en local (voir [INSTALL.md](INSTALL.md)) avec la variable d'environnement **`CURIOSA_ALLOW_LOCAL_MODULES=1`** (elle autorise les dépôts locaux ; **jamais** sur un serveur public).
2. Votre module est un dépôt git **avec au moins un commit** : `git init && git add . && git commit -m "first version"`.
3. Admin → passez en **mode avancé** (menu de gauche : « Afficher les réglages avancés » ; en mode simple, l'installation depuis un dépôt est cachée) → **Extensions** → **Catalogue** → **Installer un dépôt personnel (non vérifié)** → saisissez `file:///chemin/absolu/vers/votre/depot`, cochez la case de confiance. Le module est installé **actif** (l'accord se donne par cette case, avant).
4. **Extensions** → « Réglages » (une fenêtre) : ajoutez une instance, ouvrez-la : réglages, panneau d'admin, page publique, section sur l'accueil (admin → Accueil).
5. Vous avez modifié le code ? **Validez** (`git commit`), puis **Extensions → Réglages → Chercher une mise à jour → Mettre à jour**. Le module est rechargé depuis le dernier commit.

Si l'installation est refusée, le message vous dit pourquoi : manifeste invalide (`module.json: settings.2.key — …`), `apiVersion` différente, `main` introuvable, lien symbolique, plus de 10 Mo…
Le serveur journalise aussi les erreurs d'exécution de votre module (un module en erreur ne casse jamais le site).

Pour un module **du dépôt `curiosa-extras`** (comme l'exemple), il suffit de proposer son dossier dans `examples/` (ou `modules/`) de ce dépôt et de l'ajouter à son `catalogue/index.json` : il apparaît dans le Catalogue.

### Suis-je conforme ? Lancez une commande

Le cœur fournit une suite de vérifications prête à l'emploi, le **kit de test** (`testsupport/`, détaillé dans [TESTSUPPORT.md](TESTSUPPORT.md)). Elle répond à la question « mon module respecte-t-il les exigences ? » sans serveur, sans réseau et sans base de données. Depuis le dossier du cœur :

```
npm run module:check -- /chemin/vers/votre-module
```

**Depuis votre propre dépôt, sans toucher au cœur** : clonez le cœur à côté (`git clone --branch vX.Y.Z --depth 1 https://github.com/helldog136/Curiosa ../Curiosa`), préparez-le une fois (`npm ci --omit=dev --ignore-scripts && npx prisma generate` dans `../Curiosa` : ne lance pas le site), puis `node ../Curiosa/testsupport/check.mjs .` depuis votre dépôt. Le guide [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md) donne le pas à pas et le workflow GitHub Actions.

**Lisez le rapport de haut en bas : tout ce qui est ❌ est à corriger.** Pour chaque ❌, il vous dit *ce qui ne va pas*, *pourquoi c'est exigé* et *comment corriger*, avec un lien vers la fiche de l'exigence. Corrigez, relancez la même commande, recommencez jusqu'à ce que tout soit ✅. Deux niveaux :

- **obligatoire** (❌) : la condition pour être proposé dans le catalogue ; la commande répond alors avec un code d'erreur ;
- **conseil** (⚠️) : un avertissement, utile mais non bloquant.

Si vous faites coder le module par une IA (Claude…), donnez-lui la même commande avec `--json` : `npm run module:check -- <dossier> --json`. Le rapport est lisible par une machine (chaque échec porte `problems` et `fix`), et l'IA corrige jusqu'à ce que `summary.ok` vaille `true`. Pour partir de zéro, copiez le modèle [`testsupport/template/`](../testsupport/template) : un module minimal qui réussit déjà tout.

### Vos propres tests, sans serveur

La suite de conformité vérifie ce que **tout** module doit respecter ; elle ne connaît pas ce que fait **le vôtre**. Pour cela, votre code ne dépend que de `ctx` : on le teste avec un faux `ctx`, [`fakeCtx`](../testsupport/fakeCtx.mjs) (stockage en mémoire, e-mail enregistré dans `ctx.calls.mail`, thème, `t()`, réglages…). Copiez [`testsupport/template/my-module.test.mjs`](../testsupport/template/my-module.test.mjs) : il appelle d'abord la suite de conformité (une exigence = un test nommé), puis montre trois tests spécifiques.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { registerConformanceTests, fakeCtx, loadModuleDir } from "<dossier du cœur>/testsupport/index.mjs";

registerConformanceTests(new URL(".", import.meta.url).pathname, { test }); // tout module doit réussir ceci

const { definition: def } = await loadModuleDir(new URL(".", import.meta.url).pathname);

test("la bannière affiche le texte réglé", async () => {
  const ctx = fakeCtx({ settings: { text: "Hi!" } });
  assert.deepEqual(await def.slots["layout.banner"](ctx), [{ type: "banner", text: "Hi!" }]);
});

test("signer conserve le message en attente et prévient la personne propriétaire", async () => {
  const ctx = fakeCtx({ settings: {}, mailConfigured: true });
  const body = new FormData(); body.set("name", "Ada"); body.set("message", "Bravo");
  const res = await def.routes.sign(new Request("https://example.org/m/x/sign", { method: "POST", body }), ctx);
  assert.equal(res.status, 200);
  assert.equal((await ctx.api.store.list("messages"))[0].data.status, "pending");
  assert.equal(ctx.calls.mail[0].to, "owner");
});
```

Lancez : `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test mon-module.test.mjs`. Pour tester un module qui appelle un service sur Internet sans réseau, le kit offre `fakeFetch` (faux `fetch`) et `startLocalServer` (un petit serveur local) ; avec l'option `permissions`, `fakeCtx` refuse tout ce que votre module n'a pas déclaré. Dans le dépôt `curiosa-extras`, un seul fichier appelle la suite sur chaque dossier de `modules/` et `examples/`.

## 18. Versions et publication

- **Versionnez** : `version` dans `module.json` suit `x.y.z`. Marquez chaque version publiée d'un **tag git** : `git tag v1.2.0 && git push --tags`.
- **Installer une version précise** : l'adresse du dépôt accepte `#tag` ou `#branche` : `https://github.com/<vous>/<depot>#v1.2.0`. Sans `#`, c'est la dernière version de la branche par défaut,
  et « Chercher une mise à jour » détecte les nouveaux commits. Une installation épinglée à une **étiquette** voit, elle, les nouvelles étiquettes stables (`vX.Y.Z`) de votre dépôt : publier `v1.3.0` suffit pour qu'elle propose « mettre à jour », **sans perte de données** (une version majeure est signalée) ; si votre nouvelle version est invalide, l'ancienne est rétablie. Une installation épinglée à un commit ne bouge pas.
- **Compatibilité** : tant que `apiVersion` est celle du cœur (`2`), votre module continue de fonctionner quand le cœur évolue ; si l'API change, un module d'une autre version est refusé plutôt que cassé.
- **Hôtes** : l'administrateur d'un site n'accepte que les dépôts `https://` des hôtes autorisés (`MODULES_ALLOWED_HOSTS`, par défaut GitHub, GitLab, Codeberg, Bitbucket). Gardez le dépôt public.

**Être listé dans le Catalogue** : deux voies.

1. **Dans le dépôt `curiosa-extras`** : un dossier de module dans `modules/` (modules complets) ou `examples/` (exemples), `module.json` à sa racine, et une entrée dans son `catalogue/index.json` (étiquette épinglée). Le cœur n'embarque aucun module : il est installé depuis ce dépôt, lu sur le réseau. Un dépôt peut aussi regrouper plusieurs modules : `https://hôte/propriétaire/dépôt#ref:dossier` installe le seul module de ce dossier.
2. **Votre propre dépôt de modules** : un dépôt (par exemple `jeanmi/mes-modules-curiosa`) qui regroupe vos modules, un dossier chacun (200 modules au plus par dépôt : au-delà, la liste est coupée et le dit), ou **un seul module à la racine**. La personne propriétaire d'un site l’ajoute dans Extensions → Catalogue → *Mes dépôts de modules* (mode avancé) — ou colle l'adresse dans *Installer un dépôt personnel (non vérifié)* pour un module à la racine — et installe ceux qu'il veut ; rien à faire de votre côté que de publier le dépôt. Pas à pas : [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md).
3. **Dépôt reconnu** : une entrée dans [`catalogue/index.json`](../catalogue/README.md), le fichier du dépôt de modules que **chaque installation relit à l'exécution sur le réseau** — il ne suit pas le rythme des versions du framework (`CURIOSA_CATALOGUE_REPO` et `CURIOSA_CATALOGUE_REF` règlent cette lecture ; `MODULES_INDEX_URL` ajoute un index `https://` supplémentaire). Dans `curiosa-extras`, ce fichier est **généré** à partir des dossiers `modules/` et `examples/` (`node scripts/build-index.mjs`, vérifié par la CI) : on ne l'édite pas à la main ; on demande l'inscription (voir [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md#demander-linscription-au-catalogue-officiel-facultatif)). Format d'une entrée :

```json
{ "id": "guestbook", "name": "Guestbook", "description": "A moderated guestbook.", "repo": "https://github.com/<vous>/<depot>",
  "ref": "v1.0.0", "version": "1.0.0", "apiVersion": 2, "author": "Your name", "icon": "📖" }
```

`id`, `name`, `description` et `repo` suffisent ; `ref` (**étiquette ou commit que les relecteurs ont relus** : c'est ce qui rend « vérifié » vrai), `version`, `apiVersion`, `author`, `icon` sont facultatifs. Le dépôt cité doit servir **le module annoncé** (`id` identique à celui de son `module.json`),
sur un hôte autorisé ; rien n'est installé automatiquement. Critères et format : [`catalogue/README.md`](../catalogue/README.md). Un modèle d'index supplémentaire : [`modules-index.example.json`](modules-index.example.json). Tout autre dépôt reste un module **personnel** : il s'installe avec un avertissement.

## 19. Règles de sécurité

Un module est **du code de confiance** : il tourne sur le serveur avec les droits du site, et la personne propriétaire l'installe en connaissance de cause. Cela ne dispense pas d'être irréprochable :

- **Tout ce qui vient d'une personne qui visite est hostile** (formulaire, `segments`, en-têtes, `query`). Validez à l'entrée : types, tailles, caractères de contrôle, nombre de liens. Bornez les réglages numériques.
- **Échappez à la sortie.** Un bloc `html` est brut : passez chaque valeur saisie par le public par un échappement (`& < > " '`). Les blocs `markdown`, `heading`, `table`, `banner`… échappent le HTML,
  mais le Markdown rend liens et images : ne l'utilisez que pour du texte que vous ou l'administrateur écrivez. Jamais de texte saisi par le public dans un attribut ou un `style` sans validation (une couleur doit être `#RRGGBB`).
- **Liens sûrs.** N'acceptez que `https:`, `http:`, `mailto:` ou un chemin du site (`/…` mais pas `//…`). Jamais `javascript:` ni `data:`.
- **Pas de `eval`**, de `new Function`, ni d'exécution de commandes ; pas d'`import` de code téléchargé à l'exécution.
- **Pas de secret dans les journaux.** Ne journalisez ni réglage `secret`, ni contenu privé, ni message complet : un message d'erreur court suffit.
- **Modération.** Tout contenu public soumis par des personnes qui visitent attend une validation par défaut ; ne le publiez (page, flux RSS, sujets) qu'une fois approuvé.
- **Anti-abus.** Limiteur de débit, piège à robots, plafond de stockage sur toute route publique qui écrit.
- **Moindre privilège.** N'activez `default` que pour des actions MCP sans danger ; marquez `destructive` ce qui est irréversible ; ne demandez que les permissions que vous utilisez.
- **Réponses d'erreur muettes.** Ne renvoyez jamais de détail interne (chemin, requête, identifiant technique) à une personne qui visite.
- **Sorties de tableur.** Neutralisez `=`, `+`, `-`, `@` en tête de cellule d'un CSV (injection de formule).

## 20. Vie privée, cookies et licence

**Vie privée.** Le cœur fournit à chaque site une page « Politique de confidentialité » (`/privacy`, liée dans le pied de page) qu'il écrit lui-même d'après ce que le site fait. Pour qu'elle soit **vraie**, un module qui collecte des données des personnes qui visitent doit le **déclarer** dans son manifeste, en une ou deux phrases (quoi, pourquoi, comment les faire effacer) :

```json
"privacy": {
  "en": "If you sign the guestbook, your name and message are shown publicly once approved. To have them removed, write to the site's contact.",
  "fr": "Si vous signez le livre d'or, votre nom et votre message sont affichés publiquement une fois validés. Pour les faire retirer, écrivez au contact du site."
}
```

Le cœur reprend ce texte tel quel, sous le nom de l'instance. Un module qui ne collecte **rien** n'a rien à écrire. Voir [PRIVACY.md](PRIVACY.md).

**Images et ressources d'un autre site.** Le site n'envoie aucune politique de sécurité de contenu : un `<img src="https://autre-site/…">` s'affiche, et le navigateur de la personne qui visite contacte alors ce tiers (adresse IP, page visitée). Rien ne vous en empêche : **c'est à vous**. Pour les images d'un service externe, faites-les passer par une route de votre module (`/m/<clé>/img?c=<numéro>`) : le site télécharge l'image avec `fetch` et `AbortSignal.timeout`, vérifie son type (PNG, JPEG ou WebP, jamais SVG) et sa taille, la garde en mémoire pour un temps et un nombre bornés, et la sert depuis sa propre adresse ; la personne qui visite ne donne qu'un numéro, jamais l'adresse. `ctx.api.net.request` rend du texte (`json` ou `text`), pas des octets : il ne convient pas aux images. L'affichage direct depuis le tiers ne doit être qu'un choix avancé de l'administrateur, dit dans `privacy`. Modèle complet : le guide [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md#vie-privée).

**Cookies et stockage.** Le framework ne demande aucun consentement parce qu'il ne dépose rien d'inutile. **Ne rompez pas cela** : un module qui dépose un cookie, utilise le stockage du navigateur ou charge un service tiers (lecteur vidéo, widget, statistiques) pour autre chose que ce que la personne qui visite vient de demander impose un consentement préalable, et c'est à vous de le prévoir et de le déclarer dans `privacy`. En cas de doute : n'en déposez pas.

**Licence.** Votre module est **à vous** : `license` dans `module.json` est votre choix (MIT, propriétaire, payant…), vous en gardez tout le mérite, et vous pouvez le vendre. La licence du framework (Curiosa License) ne s'applique pas à un module qui l'utilise seulement par son interface publique (`module.json` et l'API des modules) sans copier de code du cœur. Elle s'applique, en revanche, au cœur et aux modules livrés dans `src/modules-builtin/` ; voir [LICENSE](../LICENSE).

## Checklist avant de publier

- [ ] `module.json` est à la **racine** du dépôt ; `apiVersion` vaut `2` ; `id` stable ; `version` à jour ; `main` pointe un fichier existant.
- [ ] Le manifeste passe `parseManifest` (installation locale réussie, ou test de manifeste).
- [ ] `permissions` correspond exactement à ce que le code utilise (slots, routes, storage, sections, pages, topics, mcp, admin, mail…).
- [ ] Aucun `import` du cœur dans `index.mjs` ; aucune dépendance à installer (ou un fichier unique empaqueté).
- [ ] Chaque section, action MCP, sujet, action d'admin **déclaré** est **implémenté** (et inversement).
- [ ] Tous les textes montrés aux humains sont dans `locales/` (`en` **et** `fr`, mêmes clés) ; tous les identifiants (sujets, rubriques, actions) sont en anglais.
- [ ] Chaque réglage `advanced` a une valeur par défaut ; les réglages numériques et les couleurs sont validés avant usage.
- [ ] Les actions MCP : lecture seule marquée `readOnly`, écritures sans `default: true` sauf choix assumé, irréversibles `destructive` (jamais `default: true`), `input` complet.
- [ ] Le texte des personnes qui visitent est validé à l'entrée et échappé à la sortie ; liens limités à `https:`/`http:`/`mailto:`/chemins du site ; aucun `eval`.
- [ ] Les messages de personnes sont modérés (ou le contraire est un choix explicite de l'administrateur) ; le flux RSS et les sujets n'exposent que le public.
- [ ] Les routes publiques ont limiteur de débit, piège à robots, plafond ; l'e-mail est **après** la conservation et ne fait jamais échouer la requête.
- [ ] Aucun secret, ni donnée privée, ni identifiant réel dans le code, les exemples ou les journaux ; exemples neutres (`example.org`, « Demo »).
- [ ] `npm run module:check -- <dossier>` ne montre aucun ❌ (le kit vérifie le manifeste, les langues, les droits, l'échappement, les routes, le MCP, les tâches, la vie privée…) ; le module a ses propres tests de comportement et ils passent.
- [ ] Si la forme de mes données a changé : `dataVersion` augmenté et migration écrite et testée sur des données de l'ancienne version.
- [ ] Si le module collecte des données des personnes qui visitent : champ `privacy` renseigné (en **et** fr) ; aucun cookie, stockage navigateur ni service tiers non essentiel sans consentement.
- [ ] Un module qui met en forme une page publique déclare ses pièces de skin (`skin`, `minCore` 0.4.0) avec la **chaîne de repli complète** (`var(jeton-du-module, var(jeton-commun, valeur-actuelle))`) : rendu par défaut inchangé, jamais de jeton dans `display`, `opacity`, `content`…
- [ ] `license` choisie dans `module.json` (elle n'a pas à être celle du framework).
- [ ] Essayé en vrai : installation locale, instance, page, formulaire, admin, désinstallation en gardant les données puis réinstallation (tout revient), désinstallation en effaçant tout.
- [ ] Rien ne suppose un état « éteint » : un module installé tourne ; `hooks.onInstanceDelete` n'est appelé que quand les données sont effacées (en « garder », elles sont rangées, pas détruites).
- [ ] Un `README.md` explique ce que fait le module, ses réglages et ses limites ; la version est **taguée** (`git tag v1.0.0`).
- [ ] **Pensez à deux profils.** Une personne sans bagage technique : tout réglage à remplir porte un libellé simple (« Adresse de votre salon Discord », pas « webhookUrl ») et une aide en une phrase ; un réglage technique (délai, mode de test, format) porte `"advanced": true` : il n'apparaît que dans le mode avancé, pour une personne à l'aise avec la technique, avec une valeur par défaut raisonnable. Vos textes d'admin (`adminPanel`) disent ce qu'on peut faire, pas comment ça marche.
- [ ] Un **README.md** à la racine du dépôt : il est affiché dans le Catalogue avant l'installation (à quoi sert le module, réglages, permissions, et si vous le souhaitez un lien pour un don volontaire : le Catalogue est gratuit, rien ne s'y vend).
- [ ] Pour le Catalogue : dépôt public sur un hôte autorisé, ajouté à `catalogue/index.json` de `curiosa-extras` (demande de fusion), ou proposé dans son `modules/` / `examples/`.
