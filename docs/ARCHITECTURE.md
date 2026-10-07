# Architecture

## Principe : un cœur agnostique, tout le reste en données

Le dépôt ne contient **aucun** texte, lien, couleur ou identité d'un site particulier.
Tout ce qui est visible vit en base (SQLite via Prisma) et se règle dans l'admin.
Les rares valeurs d'infrastructure (URL publique, chemin de la base) sont des variables
d'environnement (`.env.example`). Conséquence : sauvegarder `data/` et la base suffit à
sauvegarder un site entier.

## Modèle de données (`prisma/schema.prisma`)

- **Collection** (+ `CollectionTranslation`) : `key` stable, `basePath` public (vide =
  entrées à la racine, pour des pages libres), `display` (cards/list/links/codes),
  `clickAction` (page de l'entrée ou lien externe), champs activés (`features`), champs
  personnalisés (`fieldSchema`), menu, repli de langue.
- **Entry** : partie commune à toutes les langues (statut, dates, image, icône, lien,
  code, champs libres). **EntryTranslation** : `locale`, `slug`, `title`, `summary`, `body`.
  Un slug est unique *par collection et par langue*.
- **Redirect** : `path` → `targetUrl`, ou → lien d'une entrée (`entryId`).
- **Setting** : clé/valeur JSON, avec une valeur par langue pour les réglages traduisibles.
- **Module** / **ModuleRecord** : modules installés et leur stockage privé.
- **User**, **AuditLog**.

Pourquoi « tout est une entrée » : un code promo est un article avec un code et un lien,
un réseau social est un article avec un lien et une icône. Il n'y a donc qu'un seul
éditeur, une seule logique de langues, un seul sitemap, et un module qui sait lire des
entrées marche pour toutes les collections.

## Résolution d'une URL (`src/app/(site)/[...path]/page.tsx`)

1. `/go/<collection>/<entrée>` — redirection courte (si la collection l'autorise).
2. `/<basePath>` → liste ; `/<basePath>/<slug>` → entrée.
3. Une redirection externe enregistrée pour ce chemin.
4. `/<slug>` — page de la collection « racine » (`basePath` vide).
5. Sinon 404.

Les chemins réservés (`admin`, `api`, `m`, `go`, `uploads`…) et les codes de langue ne
peuvent être ni une collection ni une redirection (validé à la création).

## Langues

Trois notions indépendantes :

| | Où se règle | Détail |
|---|---|---|
| Langue **du site** (par défaut) | Réglages | Pas de préfixe d'URL. |
| Langues **proposées aux visiteurs** | Réglages | Préfixe `/en`, `/nl`… posé par `src/proxy.ts` qui réécrit vers la route sans préfixe et transmet la langue par en-tête (jamais cru s'il vient du client). Une langue non activée donne un 404. |
| Langue de l'**admin** | Réglage du site + compte de chaque utilisateur | Texte de l'interface depuis `src/locales/<code>.json`, repli sur l'anglais. |

Contenu : chaque entrée n'exige qu'**une** traduction. Dans l'éditeur, les autres langues
s'ajoutent via un bouton. Un visiteur dans une langue sans version voit la langue par
défaut (désactivable par collection) avec un bandeau. Changer de langue conserve la page :
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

## Modules

Détails dans [MODULES.md](MODULES.md). En bref : un module est un dépôt git avec un
`module.json` (manifeste + formulaire de réglages) et un `index.mjs` (ES module sans
dépendance ni build). Il contribue des **blocs déclaratifs** à des **emplacements** (slots)
du site, expose des routes `/m/<id>/…`, filtre le corps des entrées, ajoute un panneau
d'admin, crée des collections. Le cœur s'occupe du rendu, du thème et des langues.

Les modules sont **du code de confiance** : ils tournent dans le processus du serveur. Les
garde-fous sont organisationnels et explicites : installation réservée au propriétaire,
hébergeurs autorisés (`MODULES_ALLOWED_HOSTS`), clone sans hooks ni protocoles exotiques,
module installé **désactivé**, manifeste validé, taille et liens symboliques contrôlés,
version épinglable (`#tag`), mises à jour manuelles. Un module qui plante est isolé (log
+ ignoré), il ne casse pas le site.
