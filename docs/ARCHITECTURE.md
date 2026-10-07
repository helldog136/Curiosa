# Architecture

## Principe : un cœur agnostique, tout le reste en données

Le dépôt ne contient **aucun** texte, lien, couleur ou identité d'un site particulier.
Tout ce qui est visible vit en base (SQLite via Prisma) et se règle dans l'admin.
Les rares valeurs d'infrastructure (URL publique, chemin de la base) sont des variables
d'environnement (`.env.example`). Conséquence : sauvegarder `data/` et la base suffit à
sauvegarder un site entier.

## Modules, instances, sections

Le cœur ne connaît **que** des modules. Il fournit : l'authentification, les langues, les
réglages, le stockage des entrées et leur éditeur, les redirections, le rendu de blocs et
l'exécution des modules. Rien de plus.

- Un **module** est un type (code + manifeste) : `blog`, `links`, `codes`, `pages`, `collection`
  (vierge), `hero`, `feeds`, `contact-form`, `live-status`… livrés ou installés depuis git.
- Une **instance** (`ModuleInstance`) est un exemplaire configuré. Le manifeste dit si le module
  est `single` (une seule instance : RSS, statut live) ou `multiple` (autant qu'on veut : blogs,
  listes de liens, formulaires). Chaque instance a une clé stable, des noms par langue, un chemin
  public (`basePath`, null = pas de page), sa place dans le menu, ses réglages
  (`instance.<id>.<clé>`) et son stockage privé.
- Un module s'exécute **une fois par instance** : `ctx.setting()` renvoie les réglages de
  l'instance courante, `ctx.instance` l'identifie. Deux instances du module « bannière » =
  deux bannières aux textes différents.
- Les modules **à contenu** (`content` dans le manifeste) n'ont pas besoin de code : ils
  déclarent affichage, comportement au clic et champs, et le cœur fournit l'éditeur
  multilingue, les pages publiques (liste + entrée), le sitemap, les liens `/go/…` et la
  section d'accueil « dernières entrées ». Un blog, une liste de réseaux sociaux et une liste de
  codes promo ne diffèrent que par ces réglages.
- Une **section** est un morceau qu'une instance offre à la page d'accueil (déclaré dans le
  manifeste, rendu par `sections.<id>(ctx, options)`). L'accueil est la liste ordonnée des
  sections placées dans l'admin ; le bandeau d'accueil lui-même est la section du module `hero`.

Pourquoi « tout est une entrée » pour le contenu : un code promo est un article avec un code et
un lien, un réseau social est un article avec un lien et une icône. Un seul éditeur, une seule
logique de langues, un seul sitemap — et un module qui sait lire des entrées marche pour toutes.

## Une seule admin

`/admin` est l'unique interface. Sa barre latérale regroupe par **type de module** une entrée par
instance configurée (nommée par l'utilisateur) ; chaque instance est une sous-page de cet admin
(`/admin/entries?c=<clé>` pour ses entrées, `/admin/instances/<id>` pour ses réglages). Les
sections « Site » (accueil, navigation, réglages, redirections) et « Modules » (liste, marketplace,
installation depuis git) complètent l'ensemble. Aucun module n'a son propre back-office.

## Communication entre modules : les sujets

Un module *consommateur* (type `overlay`, par exemple) déclare dans son manifeste les sujets qu'il
digère et leur format ; les modules *fournisseurs* exposent des éléments à ce format
(`provides` + `exports`). Le cœur (`src/core/modules/topics.ts`) valide, filtre par étiquette,
applique les abonnements choisis dans l'admin et ajoute la provenance. Les modules ne se
connaissent pas entre eux. `core.entry` (les entrées publiées de toute instance à contenu) est
fourni d'office : un blog nourrit un overlay sans code. Voir [MODULES.md](MODULES.md#échanger-des-informations-entre-modules--les-sujets).

## Modèle de données (`prisma/schema.prisma`)

- **ModuleInstance** (+ `InstanceTranslation`) : `moduleId`, `key`, `basePath`, `enabled`, menu,
  et les réglages de présentation des modules à contenu (`display`, `clickAction`, `features`,
  `fieldSchema`, repli de langue, liens `/go`).
- **Entry** : partie commune à toutes les langues. **EntryTranslation** : `locale`, `slug`,
  `title`, `summary`, `body` — un slug est unique *par instance et par langue*.
- **Module** : modules installés (builtin ou git) et leur état. **ModuleRecord** : stockage privé
  d'une instance.
- **Redirect** : `path` → `targetUrl`, ou → lien d'une entrée (`entryId`).
- **Setting** : clé/valeur JSON, avec une valeur par langue pour les réglages traduisibles.
- **User**, **AuditLog**.

## Résolution d'une URL (`src/app/(site)/[...path]/page.tsx`)

1. `/go/<instance>/<entrée>` — redirection courte (si l'instance l'autorise).
2. L'instance montée sur `/<basePath>` : la `page()` du module si elle en définit une, sinon
   liste (`/<basePath>`) ou entrée (`/<basePath>/<slug>`) rendues par le cœur.
3. Une redirection externe enregistrée pour ce chemin.
4. L'instance montée à la racine (`basePath` vide, ex. le module `pages`) : `/<slug>`.
5. Sinon 404.

Les chemins réservés (`admin`, `api`, `m`, `go`, `uploads`…) et les codes de langue ne peuvent
être ni un chemin d'instance ni une redirection (validé à la création).

## Langues

Trois notions indépendantes :

| | Où se règle | Détail |
|---|---|---|
| Langue **du site** (par défaut) | Réglages | Pas de préfixe d'URL. |
| Langues **proposées aux visiteurs** | Réglages | Préfixe `/en`, `/nl`… posé par `src/proxy.ts` qui réécrit vers la route sans préfixe et transmet la langue par en-tête (jamais cru s'il vient du client). Une langue non activée donne un 404. |
| Langue de l'**admin** | Réglage du site + compte de chaque utilisateur | Texte de l'interface depuis `src/locales/<code>.json`, repli sur l'anglais. |

Contenu : chaque entrée n'exige qu'**une** traduction. Dans l'éditeur, les autres langues
s'ajoutent via un bouton. Un visiteur dans une langue sans version voit la langue par
défaut (désactivable par instance) avec un bandeau. Changer de langue conserve la page :
comme les slugs diffèrent selon la langue, un slug « étranger » redirige vers la bonne
traduction (`findEntryBySlug`). Les liens `hreflang` sont générés pour les entrées traduites.

## Sécurité

- Redirections : seules les URLs saisies (ou le lien d'une entrée) sont atteignables ;
  schémas limités à `http(s)`/`mailto`.
- Markdown rendu **sans HTML brut** ; liens sortants `noopener`.
- Envois d'images : détection par signature, SVG refusé, 5 Mo max, nom aléatoire.
- Admin : session JWT (Auth.js), droits revérifiés en base à chaque page/action, limitation
  des tentatives de connexion, première installation protégeable par `SETUP_TOKEN`.
- Modules : voir ci-dessous.

## Exécution des modules

Détails dans [MODULES.md](MODULES.md). Un module est un dépôt git avec un `module.json`
(manifeste + formulaire de réglages) et un `index.mjs` (ES module sans dépendance ni build). Il
contribue des **blocs déclaratifs** à des **emplacements** (slots) et des **sections**, expose des
routes `/m/<clé d'instance>/…`, filtre le corps des entrées, définit sa propre page publique, ajoute
un panneau d'admin. Le cœur s'occupe du rendu, du thème et des langues.

Les modules sont **du code de confiance** : ils tournent dans le processus du serveur. Les
garde-fous sont organisationnels et explicites : installation réservée au propriétaire,
hébergeurs autorisés (`MODULES_ALLOWED_HOSTS`), clone sans hooks ni protocoles exotiques,
module installé **désactivé**, manifeste validé, taille et liens symboliques contrôlés,
version épinglable (`#tag`), mises à jour manuelles. Un module qui plante est isolé (log
+ ignoré), il ne casse pas le site.
