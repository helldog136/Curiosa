# Tableau de bord : ce que les extensions existantes pourraient proposer

Proposition pour le dépôt des extensions (curiosa-extras), à traiter **après** la fusion de l'API `dashboard` du cœur (`docs/MODULES.md`, « Tableau de bord » ; tutoriel : `docs/CREATE-A-MODULE.md`, 12 quater). Rien n'est à faire dans le cœur pour cela.

Principes à garder pour chaque ligne ci-dessous :

- Une **tâche** demande un geste (« 3 messages à vérifier »), jamais une statistique. Elle vaut 0 quand il n'y a rien à faire, et disparaît alors.
- Une **action rapide** commence par un verbe et mène à l'écran qui crée la chose (`/admin/entries/new?c={key}` pour une extension à contenu).
- Une **carte** donne un chiffre ou cinq lignes qui aident à décider. Elle lit une donnée **déjà prête** (stockage de l'extension, réglage), jamais un service externe : le cœur coupe à 1,5 seconde.
- Le **droit** est un droit déjà déclaré par l'extension (`rights`), sinon `open` (valeur par défaut : ouvrir la page de l'extension, donc Administration et au-dessus). Pour qu'une rédaction voie une tâche ou une action, l'extension doit déclarer un droit avec `default: { editor: true }`.
- Les extensions qui ont déjà une pastille de menu (`adminBadge`) n'ont **rien à changer** pour qu'elle apparaisse sous « À faire », mais sans phrase claire : la déclaration `tasks` la remplace par un vrai libellé. Une fois la tâche déclarée, retirer l'`adminBadge` pour ne pas afficher deux lignes.
- Chaque ligne demande les fichiers `module.json` (clé `dashboard`) et le code (`dashboard: { tasks, cards }` dans `index.mjs`), des libellés fr/en, des tests (`fakeCtx`) et l'exigence du kit `dashboard.valid`. Aucun `minCore` : un cœur plus ancien ignore la clé.

La colonne « source » dit où lire la donnée dans le code actuel de chaque extension ; elle est à confirmer par la personne qui fera la modification.

## Tâches (`tasks`)

| Extension | Tâche (libellé fr) | Lien | Source de la donnée | Droit |
|---|---|---|---|---|
| `contacts` | `{n} messages à vérifier` | `?tab=…` de la liste, filtre « à vérifier » | Même calcul que son `adminBadge` : contacts dont `data.status === "to_review"` | `open` (ou un droit `review` avec `editor: true` si la rédaction doit les voir) |
| `contact-form` | `{n} messages reçus à lire` | liste du carnet de contacts (`/admin/instances/<contacts>`) | Les messages arrivent dans `contacts` (service `contact.store`) : à **déclarer côté `contacts`** (une seule source de vérité), pas dans `contact-form` | idem `contacts` |
| `game-suggestions` | `{n} suggestions de jeux à trier` | tableau des suggestions, filtre « Proposée » | Rangées du stockage dont `data.status === "proposed"` (`STATUSES` dans `index.mjs`) | `open` |
| `community-stats` | `{n} chiffres saisis à la main à remettre à jour` | page de l'extension | Même calcul que son `adminBadge` : `staleManual(await loadStats(ctx), Date.now()).length` | `open` |
| `twitch-bot` | `Le bot ne répond plus (reconnexion à faire)` (nombre 1) | page du bot, état de la connexion | Même calcul que son `adminBadge` : `readState(ctx).sub.code` hors `listening` et `pending` | `open` |
| `partnerships` | `{n} partenaires à relancer` | liste des partenaires, filtre « à relancer » | Partenaires dont l'échéance de suivi est passée (champ à confirmer dans `data.mjs`) ; sinon **ne pas déclarer** | `open` |
| `calendar-manual` / `planning` | `{n} streams à compléter` (sans titre ni jeu) | planning | Créneaux à venir (7 jours) sans titre : à confirmer dans `slots.mjs` | `open` |
| `alerts-overlay`, `ticker-overlay`, `sponsor-ticker`, `maze-overlay` | `Un overlay n'a plus de source` (rare) | page de l'overlay | Seulement si l'extension sait déjà détecter un réglage manquant ; sinon rien : le cœur affiche déjà « à régler » pour les extensions incomplètes | `open` |

Les réseaux sociaux (`instagram`, `youtube-channel`, `bluesky`, …) n'ont **aucune tâche** : ils n'attendent rien de la personne.

## Actions rapides (`quickActions`)

| Extension | Libellé fr | Lien | Droit |
|---|---|---|---|
| `blog` | `Écrire un article` | `/admin/entries/new?c={key}` | `open` ; avec un droit `write` (`editor: true`) pour la rédaction |
| `pages` | `Ajouter une page` | `/admin/entries/new?c={key}` | idem |
| `links` | `Ajouter un lien` | `/admin/entries/new?c={key}` | idem |
| `sponsors` | `Ajouter un partenaire` | `/admin/entries/new?c={key}` | idem |
| `planning` | `Programmer un stream` | écran de création d'un créneau (`?tab=…`) | `open` |
| `twitch-bot` | `Ajouter une commande` | formulaire de création de commande | `open` |
| `game-suggestions` | `Suggérer un jeu` | formulaire d'ajout | `open` |
| `contacts` | `Ajouter un contact` | formulaire d'ajout | `open` |
| `partnerships` | `Ajouter un partenaire` | formulaire d'ajout | `open` |
| `stream-story` | `Préparer le récit du prochain stream` | outil de préparation (`story_prepare`) | `open` |

Sans déclaration, le cœur propose lui-même « Ajouter dans <nom de l'instance> » pour chaque extension à contenu : les libellés ci-dessus sont les mots plus naturels qui le remplacent.

## Cartes (`cards`)

| Extension | Carte | Type | Source | Droit |
|---|---|---|---|---|
| `planning` | **Prochain stream** : date et heure, titre ou jeu | `counter` (`value` : « Ven. 20:00 », `detail` : titre) | Le prochain créneau à venir du stockage de l'extension (même lecture que l'outil `planning_upcoming`) | `open` |
| `live-status` | **En direct maintenant** : « En direct » ou « Hors ligne », avec le jeu | `counter` | L'état déjà gardé par l'extension (dernier état connu) ; **ne pas interroger Twitch pendant l'affichage** | `open` |
| `community-stats` | **Abonnés** : total et évolution sur 7 jours | `counter` (`value` : total, `detail` : « +12 cette semaine ») | Dernier relevé et relevé d'il y a 7 jours dans l'historique de l'extension (`evolution.mjs`) | `open` |
| `twitch-bot` | **Commandes les plus utilisées** : 5 lignes | `list` | Compteur d'utilisation déjà tenu par le moteur (`engine.mjs`), s'il existe ; sinon à ajouter d'abord côté extension | `open` |
| `game-suggestions` | **Suggestions du moment** : 5 plus récentes | `list` | Rangées « proposée », les plus récentes | `open` |
| `sponsors` / `partnerships` | **Partenaires** : combien sont actifs | `counter` | Compte des entrées publiées | `open` |

Le bloc « Stream » du tableau de bord se compose **uniquement** de ces cartes : le cœur ne connaît aucune de ces extensions. Un site sans `planning`, `live-status`, `community-stats` ou `twitch-bot` n'affiche tout simplement pas le bloc.

## Ordre de travail conseillé

1. `contacts`, `game-suggestions`, `community-stats`, `twitch-bot` : les tâches (le calcul existe déjà pour trois d'entre elles, c'est celui de l'`adminBadge`).
2. `blog`, `pages`, `links`, `sponsors` : les actions rapides (aucun code, seulement `module.json`).
3. `planning`, `live-status`, `community-stats`, `twitch-bot` : les cartes du bloc « Stream ».
4. Le reste seulement si l'extension a un vrai besoin.

## Ce que le cœur garantit (pour ne pas le refaire dans les extensions)

- Appel **à l'affichage seulement**, jamais en tâche de fond ; 1,5 seconde au plus ; réponse gardée 20 secondes ; un échec masque l'extension, pas la page.
- Droit vérifié avant l'appel ; un compte sans le droit ne déclenche rien.
- Texte échappé, liens limités à l'administration, 5 lignes au plus, aucun HTML ni script.
