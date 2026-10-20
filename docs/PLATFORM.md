# Le cœur offre, les modules apportent

Curiosa sépare nettement deux choses :

| | **Services du cœur** (helpers) | **Fonctionnalités** (modules) |
|---|---|---|
| Nature | Des mécanismes génériques : « générer un QR code », « exposer un serveur MCP », « stocker des données privées »… | Ce qu'on *fait* avec : un overlay qui affiche un QR, des actions MCP pour suivre des partenaires, un blog… |
| Où | `src/core/services/` | le dépôt `curiosa-extras` (aucun module dans le cœur) |
| Connaît les modules ? | **Non** (sauf `topics`, dont c'est l'objet). Jamais un module en particulier. | Connaît uniquement `ctx.api` — rien d'autre du cœur. |
| Contient du contenu éditorial ? | Non | Oui |

Règle d'or : **si ça a un sens pour n'importe quel site, c'est un service ; si ça a un sens pour un usage, c'est un module.**
Ces frontières sont vérifiées par `tests/architecture.test.mjs`.

## Les trois couches

```
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ FONCTIONNALITÉS   curiosa-extras  ·  modules git (Catalogue ou dépôt perso)    │
 │ blog, sponsors, partenariats, overlays, formulaire de contact, RSS, kit presse…           │
 │ N'ont accès qu'à  ctx.api  (et déclarent leurs besoins dans module.json)      │
 └──────────────▲────────────────────────────────────────────────────────────────┘
                │ ctx.api  (src/core/modules/api.ts)
 ┌──────────────┴────────────────────────────────────────────────────────────────┐
 │ RUNTIME DES MODULES   src/core/modules/   registre · installateur · contexte  │
 │ + MOTEUR DE CONTENU   src/core/content/   entrées, éditeur, traductions       │
 └──────────────▲────────────────────────────────────────────────────────────────┘
                │ composés dans  src/core/platform.ts  (racine de composition)
 ┌──────────────┴────────────────────────────────────────────────────────────────┐
 │ SERVICES (helpers)   src/core/services/                                       │
 │ qr · store · topics · mail · rawg · mcp · uploads génériques, indépendants      │
 └───────────────────────────────────────────────────────────────────────────────┘
```

## Les services (`src/core/services/`)

Catalogue source : `src/core/services/index.ts`.

| Service | Fichier | Côté module | Rôle |
|---|---|---|---|
| `qr` | `services/qr.ts` | `ctx.api.qr(texte)` | QR code en SVG, fond transparent. Aucune dépendance côté module. |
| `store` | `services/store.ts` | `ctx.api.store` | Stockage privé par instance (collections de documents JSON) ; une instance ne voit jamais celui d'une autre. |
| `topics` | `services/topics.ts` | `ctx.api.topics.collect(sujet)` | Échange d'informations typées entre modules : un consommateur déclare ce qu'il digère, des fournisseurs l'exposent, l'admin règle les abonnements, le cœur valide. |
| `rawg` | `services/rawg.ts` | `ctx.api.rawg.configured()` / `ctx.api.rawg.cover(title)` (permission `rawg`) | Jaquettes de jeux. La clé d'API RAWG est un réglage du cœur (*Réglages › Services externes*, secret, sauvegardé, jamais transmis aux modules). `cover` renvoie `{ status: "found" \| "none" \| "no-key" \| "refused" \| "unreachable", url }`, jamais d'exception ; https seulement, 5 s, cache (24 h / 1 h), 2 requêtes simultanées au plus, dernier état de la clé mémorisé. |
| `mail` | `services/mail.ts` | `ctx.api.mail.send({ to, subject, text })` (permission `mail`) | Envoi d'e-mails au nom du site. Le SMTP est réglé dans *Réglages* (jamais visible des modules). Expéditeur fixé par le cœur, un seul destinataire (`"owner"` = contact du site, ou une adresse), texte brut, débit limité (10/h par instance, 40/h au total), audit sans contenu, jamais d'exception : `{ ok, reason }`. |
| `png` | `services/render.ts` | `ctx.api.png({ width, height, tree })` | Rend une image PNG depuis une arborescence de boîtes (Satori via `next/og`), sans navigateur. Dimensions et taille de l'arbre bornées ; une image distante n'est chargée que depuis un chemin du site ou une adresse https vers un nom d'hôte public. |
| `mcp` | `services/mcp/` | *rien à appeler* : le module déclare `mcp` dans son manifeste | Serveur MCP : jetons hachés, plafond lecture/écriture, **accès action par action modifiables en direct**, validation des arguments, limitation de débit, audit, interrupteur. |
| `scheduler` | `services/scheduler.ts` | *rien à appeler* : le module déclare `tasks` | Tâches planifiées : un passage par minute, pour chaque instance active ; jamais deux fois la même en parallèle, erreurs isolées, dernier résultat mémorisé (`instance.<id>.__task.<nom>`). |
| `uploads` | `services/uploads.ts` | réglage de type `image`, champ `image` des formulaires d'admin | Envoi d'images (signature vérifiée, SVG refusé, taille bornée) et recadrage non destructif : la valeur d'un champ image est l'original + son cadrage (`/uploads/x.png?c=…`), la version cadrée est fabriquée par le serveur (`core/imageDerive.ts`, `sharp`) et mise en cache. Voir CREATE-A-MODULE.md. |

Un service **ne dépend pas** d'une fonctionnalité. Les imports autorisés de chacun sont listés dans le test d'architecture
(par exemple le mécanisme MCP n'importe que la base, les réglages et les *types* de modules).

### MCP : le mécanisme et ses sources d'outils

Le service MCP sait *servir* des outils, pas *d'où ils viennent*. Il reçoit une liste de **fournisseurs d'outils**
(`McpToolProvider`) que la racine de composition `src/core/platform.ts` lui donne :

| Fournisseur | Fichier | Apporte |
|---|---|---|
| `site` | `platform.ts` | `site_info` : s'orienter sur le site |
| `maintenance` | `core/maintenance/tools.ts` | les outils `maintenance_…` du cœur (diagnostic, sauvegarde, mises à jour) : voir [MAINTENANCE-IA.md](MAINTENANCE-IA.md) ; désactivés pour un jeton ordinaire, niveau 3 `destructive` avec validation humaine |
| `modules` | `core/modules/mcpProvider.ts` | les actions déclarées par les modules (`mcp` du manifeste + du code) |
| `content` | `core/content/mcp.ts` | actions éditoriales (lister, lire, brouillons) de toute instance à contenu |

Ajouter une source d'outils = écrire un fournisseur et l'ajouter à `mcpProviders` dans `platform.ts`. Le service n'est jamais modifié.
Les invariants (plafond lecture seule, accès action par action relus à chaque requête, erreurs internes masquées, audit des écritures)
sont dans le service (`mcp/access.ts`, `mcp/server.ts`) : aucun fournisseur ne peut les contourner. Chaque fournisseur ne fait que
*déclarer* ses outils, avec leur défaut (`default`) et leur caractère irréversible (`destructive`) ; **l'octroi est l'affaire de l'admin**.

### Sujets : le mécanisme et le sujet du cœur

`services/topics.ts` implémente le mécanisme (sources, abonnements, validation, filtrage par étiquette). Le sujet `core.entry`
(les entrées publiées de toute instance à contenu) est fourni par le **moteur de contenu** (`core/content/topics.ts`) via un
`TopicAdapter` : le service n'a aucune idée de ce qu'est une entrée.

## Appeler le service d'un autre module

`ctx.api.services.available(service)`, `.providers(service)`, `.call(service, method, args, { provider? })` et `.callAll(service, method, args)` (module `requires` le service, un autre l'`offers`) : le cœur ne connaît que des **noms** de services. `call` s'adresse au maître (service classique) ou à la première instance (service `each`), ou à l'instance `provider` choisie parmi `providers` (cœur 0.2.0 ; un fournisseur disparu → `unavailable`) ; `callAll` interroge toutes les instances d'un service `each` (`offers: [{ service, each: true }]`, une réponse par instance, une panne n'en gêne pas une autre). Un besoin `optional` n'est jamais installé d'office et ne retient pas son fournisseur. Le bloc `suggestInstall` propose au propriétaire d'installer un module qui offre un service (jamais d'office). Voir [MODULES.md › Dépendances](MODULES.md).

## Le temps imparti au code des modules (une page ne reste jamais bloquée)

Règle du cœur : **une section ou un module qui se bloque ne peut jamais bloquer toute une page publique, et le journal nomme le fautif.** Tout le code de module qui fabrique un morceau de page publique passe par `core/modules/budget.ts` :

| Ce que le module fabrique | Délai | Si le délai est dépassé |
|---|---|---|
| une **section d'accueil**, un **emplacement** (`slots`), le **filtre** de texte, la **page** du module, la **pastille de nouveauté**, un **overlay** | **8 s** | l'élément est omis (page de module et overlay : 404 sobre) ; la page se termine normalement |
| un **service** d'un autre module (`ctx.api.services.call` / `callAll`) ou un **sujet** collecté (`ctx.api.topics.collect`), appelé PENDANT une page publique | **6 s** (un quart de moins que la section qui le contient) | l'appel rend `{ ok: false, reason: "failed" }` (`callAll` : `error: "failed"`) ; la section peut afficher son repli. C'est le **fournisseur** qui est nommé dans le journal |
| les boutons de l'en-tête (`social.link`), le flux RSS (`feed.item`) : le cœur collecte lui-même | **8 s** par fournisseur | ce fournisseur est ignoré, les autres comptent |

**Ce qui n'est PAS limité** : l'administration, les tâches planifiées (5 minutes), les routes `/m/<instance>/…`, MCP. Un service appelé hors d'une page publique peut durer.
**Ce qui n'est pas masqué** : une exception levée par un module est journalisée comme avant (`[modules] … failed on section …`), le délai n'y change rien.

Le journal (`journalctl`) : **une ligne par épisode**, jamais une par visite.
- `[modules] La section « Nouveautés » du module exemple (instance exemple) n'a pas répondu en 8 s ; elle est ignorée pour cette page.` (rappel au plus toutes les heures si cela dure) ;
- `… est lente : 3,4 s pour répondre (seuil : 3 s) ; passé 8 s, elle est ignorée pour cette page.` (au plus une fois par heure et par élément : le coupable est nommé AVANT qu'il ne bloque) ;
- `… répond de nouveau.` à la fin de l'épisode.

Tant qu'un élément est bloqué, les visites suivantes ne l'attendent plus (il est omis aussitôt) ; une seule visite à la fois le retente, après une pause de 16 s. Sans cela chaque visiteur attendrait 8 s et chaque visite laisserait une attente de plus en mémoire.
**Réinitialisation automatique** : un même élément qui dépasse le délai **3 épisodes de suite** (une tentative qui échoue = un épisode) fait **recharger le code du module** (même mécanisme que « Réinstaller » : `forgetModule` + `bumpImportStamp`), au plus **une fois par heure et par module**. Instances, réglages, données et entrées ne sont pas touchés ; seul l'état gardé en mémoire par le module (caches, promesses « en cours ») repart de zéro. Ligne : `[modules] Le module X est resté sans réponse 3 fois de suite : il est réinitialisé (…)`.

Pour les développeurs : variable d'environnement facultative `CURIOSA_SECTION_TIMEOUT_MS` (100 à 120000, 8000 par défaut ; le seuil « lent », l'appel interne et la pause en découlent). La créatrice n'a rien à régler. Fichiers : `core/deadline.ts` (course contre l'horloge), `core/modules/budget.ts` (la borne, le périmètre « page publique »), `stallTracker.ts` (une ligne par épisode, pause, réinitialisation ; pure, testée avec une horloge factice), `stallMessages.ts` (les phrases).

## Ce que le cœur lit pour les modules (hors services)

`ctx.api.site()`, `ctx.api.brand()`, `ctx.api.instances.list()`, `ctx.api.entries.list()` : lecture seule, pour que les modules
s'articulent avec le reste du site. Ce ne sont pas des services (ils exposent le site, pas un mécanisme).

**`ctx.api.brand()`** — l'identité visuelle : nom, accroche, présentation, logo, email de contact, palette (couleurs nommées et leur
rôle, traduits), police. C'est **la même source** (`src/core/brand.ts`, même `buildPalette`) que celle du rendu réel du site : ce que
l'administrateur règle dans *Réglages* (Identité, Apparence) est stocké une seule fois dans le cœur. Un module qui *montre* l'identité
(le **kit presse**) ne la copie ni ne la stocke : il la lit. Changer le thème du site change donc le kit presse, sans rien refaire.

## Sauvegarde et catalogue : des fonctionnalités du cœur

- **Sauvegarde** (`core/backup/`, [BACKUP.md](BACKUP.md)) : un fichier chiffré (format OpenSSL, mot de passe choisi à chaque sauvegarde)
  contenant tout ce qui est à l'utilisateur, **lisible sans le framework**. Elle collecte les données des modules installés
  (stockage, réglages, fichiers lisibles via `backup.readable`) et, à la restauration, réinstalle les modules depuis le catalogue.
- **Catalogue** (`core/modules/catalogue.ts`) : la liste des modules vérifiés — publiés par les dépôts reconnus, listés dans `catalogue/index.json` du dépôt `curiosa-extras` (le seul que le cœur connaît par défaut) — un fichier **lu sur le réseau à l'exécution**, qui ne suit pas le rythme des versions (le cœur n'embarque ni module ni copie de la liste ; `MODULES_INDEX_URL` pour un index supplémentaire). Un dépôt git **personnel** reste
  installable, mais signalé « non vérifié » et soumis à confirmation explicite.

## Le flux RSS : une fonctionnalité du cœur

`/feed.xml` (tout le site) et `/feed/<instance>.xml` (une instance), `?lang=` pour la langue. Le cœur (`core/feeds.ts`) lit les données
des modules sans les connaître : le sujet `core.entry` (entrées publiées de toute instance à contenu qui propose ses entrées) et le
sujet `feed.item` (tout module peut en fournir : `provides: [{ "topic": "feed.item" }]` et `exports["feed.item"]` renvoyant
`{ title, url, summary?, publishedAt?, id? }`). Le résultat est **déterministe** : tri par date décroissante puis par adresse, date de
construction = élément le plus récent (jamais l'heure courante), adresses `javascript:` écartées. Les pages du site annoncent le flux
dans `<head>` ; aucun module n'est nécessaire.

**S'abonner à une partie seulement.** Chaque élément porte des *rubriques* :
- des rubriques **partagées** (`announcement`, `concert`…) : ce sont les étiquettes des entrées et les `topics` que les modules proposent via `feed.item`. **Plusieurs modules peuvent publier sur la même rubrique** : s'abonner à `announcement` rassemble les annonces du blog, de l'agenda, etc. ;
- `@<instance>` (`@blog`) : tout ce qu'une instance publie. Le `@` est réservé au cœur, un module ne peut pas l'usurper.

`/feed.xml?topics=announcement,@videos` renvoie les éléments de l'une OU l'autre ; `/feed/<instance>.xml?topics=announcement` limite une rubrique à une instance.
Le catalogue de ce qu'on peut suivre (nom lisible, nombre d'éléments, instances qui l'alimentent) est sur `/feed/topics.json`.
Une rubrique inconnue est ignorée ; si toutes le sont, la réponse est 404 (une faute de frappe ne donne pas un flux vide en silence).

## Faire évoluer la base (migrations du cœur)

La base évolue par migrations Prisma (`prisma/migrations/`), appliquées automatiquement par la mise à jour (`prisma migrate deploy`, après une copie de sécurité de la base ; retour arrière complet en cas d'échec).

Règles, **à partir de la première version publiée** :

- **Une migration livrée ne se modifie jamais.** `npm run migrations:freeze` (à lancer à chaque sortie, avant d'étiqueter `vX.Y.Z`) enregistre leur empreinte dans `prisma/migrations/frozen.json` ; un test échoue si l'une d'elles change.
- **Préférer les changements additifs** (nouvelle table, nouvelle colonne avec valeur par défaut). Pour renommer ou transformer, écrire la transformation des données **dans le SQL de la migration** (`INSERT … SELECT`, `UPDATE`) : elle s'exécute chez chacun, sur ses données.
- **Les sauvegardes suivent** : chacune note la version du schéma (`schemaVersion` dans `backup.json`). Restaurer une sauvegarde plus ancienne ignore les colonnes disparues et laisse les nouvelles à leur défaut ; si une migration change le *sens* d'une donnée, ajouter en même temps une étape dans `schemaUpgrades` (`src/core/backup/schema.ts`). Une sauvegarde plus récente que la base est refusée (« mettez d'abord le framework à jour »).
- Les données **des modules** ont leur propre mécanisme (`dataVersion` + `migrations`, voir `MODULES.md`).

## Référencement : une fonctionnalité du cœur

Voir aussi [GEO.md](GEO.md) (être cité par les IA, expliqué pour le propriétaire du site).

- **`robots.txt`** distingue deux familles de robots IA, deux réglages (Réglages › Confidentialité) : les robots d'**entraînement** (GPTBot, ClaudeBot, CCBot, Google-Extended…, bloqués par défaut) et les robots de **réponse** (OAI-SearchBot, ChatGPT-User, Claude-User, PerplexityBot…, autorisés par défaut : ils lisent une page pour répondre à une question et la citent). Jamais un moteur de recherche classique. Les listes sont dans `src/core/seo.ts` (`AI_TRAINING_BOTS`, `AI_ANSWER_BOTS`), à revoir à chaque version.
  **Règle de compatibilité** (`resolveAiBlocking`) : un réglage propre à une famille (`seo.blockAiTraining`, `seo.blockAiAnswers`), s'il est enregistré, l'emporte ; sinon l'ancien réglage unique `seo.blockAiBots`, **s'il a été enregistré**, s'applique aux deux familles (vrai : les deux bloquées ; faux : aucune) ; sinon (jamais touché) : entraînement bloqué, réponse autorisée. Enregistrer le formulaire des réglages écrit les deux nouveaux choix et retire l'ancien. Seuls les vrais booléens comptent.
- **`/llms.txt`** (`seo.llmsTxt`, activé par défaut) : titre, citation, puis des sections de liens (Pages, Dernières publications, Ailleurs, Optional), par langue (`/llms.txt` = langue principale, `/<langue>/llms.txt` pour les autres). Construit uniquement à partir de données publiques : réglages d'identité, pages et entrées publiées, éléments du sujet `feed.item`, liens `social.link` ; jamais d'e-mail ni de brouillon. 40 Ko, 120 liens au plus ; mis en cache 5 minutes. Code : `src/core/llms.ts`.
- **Données structurées** : chaque page porte un JSON-LD (`Organization` ou `Person` selon le réglage *Ce site est celui d'…*, `WebSite`, `sameAs` = liens `social.link` en https, dédoublonnés, 10 au plus) ; les pages à chemin ajoutent un `BreadcrumbList`. Un module ajoute les siennes par le slot `layout.head` avec `ctx.api.seo.jsonLd(…)` (voir [CREATE-A-MODULE.md](CREATE-A-MODULE.md)).
- **Métadonnées** : `canonical`, `hreflang` (dont `x-default`), Open Graph et carte Twitter cohérents, `lastmod` du plan du site quand une date de publication existe, flux RSS annoncé, `lang` de la page.
- **Page d'admin « Visibilité dans les réponses des IA »** (`/admin/ai-visibility`, `src/core/aiVisibility.ts`) : une liste de contrôles « fait / à faire » avec un bouton *Corriger* ; elle appelle en interne les fonctions de `robots.txt`, du plan du site et de `llms.txt` (aucun réseau) et n'affiche aucune note chiffrée.

## Ce que le cœur ne fait pas

- Il ne cite **aucun module par son identifiant**. L'assistant de première installation propose les modules que suggère
  le Catalogue (`catalogue/suggested.json`, tenu par le dépôt de modules) et lit leurs manifestes (`onboarding.home`, `onboarding.sample`,
  `onboarding.collectsLinks`) au lieu de connaître « blog » ou « hero ».
- Il ne contient aucune fonctionnalité de sponsor, de partenaire, d'overlay… Les cartes de sponsors, les fiches de partenaires, le
  labyrinthe sont des modules ; le cœur ne fournit que de quoi les faire (QR, stockage, sujets, MCP, formulaires d'admin).

## Ajouter un service

1. Créer `src/core/services/<nom>.ts` (ou un dossier), générique, sans import de module ni de contenu.
2. L'ajouter au catalogue `src/core/services/index.ts` et à la table ci-dessus.
3. L'exposer dans `ctx.api` (`src/core/modules/api.ts`), section « SERVICES », et dans le type `ModuleApi` (`modules/types.ts`).
4. Déclarer ses imports autorisés dans `tests/architecture.test.mjs`.

## Ajouter une fonctionnalité

Écrire un module (voir [MODULES.md](MODULES.md)). Si une fonctionnalité semble réclamer une modification du cœur, c'est souvent qu'il
manque un *service* générique : on ajoute le service, pas la fonctionnalité.
