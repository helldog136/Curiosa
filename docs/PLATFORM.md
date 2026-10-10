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
| `uploads` | `services/uploads.ts` | réglage de type `image`, champ `image` des formulaires d'admin | Envoi d'images (signature vérifiée, SVG refusé, taille bornée). |

Un service **ne dépend pas** d'une fonctionnalité. Les imports autorisés de chacun sont listés dans le test d'architecture
(par exemple le mécanisme MCP n'importe que la base, les réglages et les *types* de modules).

### MCP : le mécanisme et ses sources d'outils

Le service MCP sait *servir* des outils, pas *d'où ils viennent*. Il reçoit une liste de **fournisseurs d'outils**
(`McpToolProvider`) que la racine de composition `src/core/platform.ts` lui donne :

| Fournisseur | Fichier | Apporte |
|---|---|---|
| `site` | `platform.ts` | `site_info` : s'orienter sur le site |
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
- **Catalogue** (`core/modules/catalogue.ts`) : la liste des modules vérifiés — livrés avec le framework (`extras/`, instantané du dépôt `curiosa-extras`) ou publiés par des dépôts reconnus, listés dans `catalogue/index.json` du dépôt `curiosa-extras` — un fichier **relu à l'exécution**, qui ne suit pas le rythme des versions (copie livrée en secours hors ligne ; `MODULES_INDEX_URL` pour un index supplémentaire). Un dépôt git **personnel** reste
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

`robots.txt` bloque par défaut les robots de collecte et d'entraînement IA (GPTBot, ClaudeBot…, jamais un moteur de recherche) ; réglage avancé *Bloquer les robots d'entraînement IA*. Chaque page porte un JSON-LD `WebSite` + éditeur construit **uniquement** à partir des réglages du site (nom, slogan, logo). Un module qui veut ajouter ses propres données structurées (profils sociaux, `sameAs`…) le fait par le slot `layout.head`. Code : `src/core/seo.ts`.

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
