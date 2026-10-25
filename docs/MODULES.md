# Référence des modules

> **Première fois ?** Lisez d'abord le tutoriel pas à pas : [CREATE-A-MODULE.md](CREATE-A-MODULE.md).
> Pour savoir si votre module respecte tout cela, lancez `npm run module:check -- <dossier>` : le kit de test du cœur ([TESTSUPPORT.md](TESTSUPPORT.md)) vérifie les exigences une par une, en langage simple.
> Cette page en est la **référence exhaustive** : chaque champ du manifeste, chaque clé du code, chaque bloc, chaque
> service. L'exemple complet et fonctionnel, qui utilise toutes les capacités, est
> `examples/guestbook` (`curiosa-extras/examples/guestbook`) (un livre d'or modéré) ; le plus petit module utile est
> `examples/announcement-banner` (`curiosa-extras/examples/announcement-banner`). Un test
> (`tests/docs-coverage.test.mjs`) vérifie que cette page cite chaque capacité présente dans le code.

Sommaire : [anatomie](#anatomie-dun-module) · [manifeste `module.json`](#le-manifeste-modulejson) · [code `index.mjs`](#le-code-indexmjs) ·
[contexte `ctx`](#le-contexte-ctx) · [blocs](#blocs) · [sujets](#échanger-des-informations-entre-modules-les-sujets) ·
[admin](#panneau-dadmin-riche-formulaires-et-boutons-pilotés-par-le-module) · [MCP](#api-mcp-exposer-des-actions-aux-assistants) ·
[thème](#thème-du-site-et-apparence-dun-module) · [e-mail](#envoyer-un-e-mail) · [jaquettes RAWG](#jaquettes-de-jeux-rawg) · [RSS](#alimenter-le-flux-rss) ·
[overlay](#overlay-type-overlay) · [sauvegarde](#sauvegarde-lisible-sans-le-framework) · [installer et publier](#installer-publier-catalogue) ·
[sécurité](#sécurité-à-lire-avant-dinstaller)

## Anatomie d'un module

Un module = un dépôt git avec, **à la racine** :

```
module.json      manifeste (obligatoire)
index.mjs        code (si le module fait plus que déclarer des réglages et du contenu)
locales/fr.json  textes du module par langue (facultatif) : { "clé": "texte avec {variable}" }
```

Pas de `npm install`, pas de build : le fichier est chargé tel quel par Node (ES module). Si vous avez
besoin de dépendances, livrez un fichier unique déjà empaqueté. Un module n'importe **rien** du cœur : tout passe par
l'objet `ctx` (voir plus bas). Les modules du catalogue (dépôt `curiosa-extras`) sont bâtis exactement de la même façon.

Limites à connaître : le dépôt ne doit pas dépasser 10 Mo (le dossier `.git` ne compte pas), aucun lien symbolique n'y est
toléré, `main` doit pointer un fichier `.mjs` ou `.js` **à l'intérieur** du module. Un module dont le manifeste ou le code ne se
charge pas est ignoré (journalisé) sans jamais empêcher le site de fonctionner. Le cœur ne contient aucun module : un module ne peut donc pas être « pris pour » un module du cœur.

### Module et instances

Le module est le **type** ; l'admin en crée des **instances** (Modules → « Ajouter une
instance »). Votre code tourne **une fois par instance** : `ctx.setting()` renvoie les réglages de
l'instance courante et `ctx.instance.key` l'identifie. N'écrivez jamais comme s'il n'y avait qu'un
exemplaire : un site peut en avoir plusieurs (deux blogs, deux formulaires de contact…). Si votre
module n'a de sens qu'une fois, déclarez `"instances": "single"`. Le stockage (`ctx.api.store`) est propre à chaque instance.

#### Trois noms, trois publics

| Nom | Pour qui | Détail |
|---|---|---|
| **Surnom** | l'administrateur | Distingue deux instances du même module dans l'admin (« Actus », « Chaîne 2 »). **Superflu — donc jamais demandé ni affiché — tant qu'il n'y a qu'une instance** : le libellé est alors le nom du module. Demandé à la création de la 2e instance (et pour la 1re, si elle n'en a pas). Unique parmi les instances du même module. |
| **Nom public** | les visiteurs | Traduit par langue, affiché sur le site (menu, titre de page). Démarre à la valeur du surnom. |
| **Identifiant technique** | le code, les URL, les agents | Dérivé du surnom à la création (« Chaîne 2 » → `chaine-2`) : lisible dans `/overlays/<id>`, `/m/<id>/…`, les outils MCP (`chaine-2__list_entries`). Ne change jamais quand on renomme le surnom, pour que les liens continuent de marcher. **Visible en mode avancé seulement.** |

Votre module reçoit `ctx.instance.key` (l'identifiant) et `ctx.instance.name` (le nom public) ; il n'a pas à connaître le surnom.

### Type d'un module

Chaque module a un **type** (`"type"` dans `module.json`) qui décide où il apparaît dans l'admin
et comment ses instances sont exposées :

| Type | Pour | Particularité |
|---|---|---|
| `content` | blog, liens, codes promo, pages… | déduit de `content` ; éditeur d'entrées fourni par le cœur |
| `social` | un réseau social (Twitch, YouTube, Instagram…) | fournit son bouton au cœur (sujet `social.link`) ; une instance par compte |
| `overlay` | sources navigateur OBS | chaque instance est servie sur `/overlays/<clé>` (page nue, fond transparent) via `overlay()` |
| `widget` | morceaux de pages (bandeau, formulaire…) | défaut quand il n'y a pas de `content` |
| `integration` | services externes (Twitch, Discord…) | — |
| `utility` | outils divers (RSS…) | — |

L'admin est **une seule interface**. Le menu ne liste que les instances **épinglées** (voir « Rangement dans le menu » ci-dessous), rangées par rubrique : **Mon contenu**, **Ma communauté**.
Tout le reste vit dans **Extensions** (rubrique *Administration* du menu), une page à trois onglets : *Installées* (les modules et leurs instances, par famille, avec recherche), *Ajouter* (le catalogue, fiches en fenêtre comprises) et
*Mises à jour* (modules en retard ; propriétaire seulement). Les adresses sont `/admin/extensions`, `/admin/extensions/add` et `/admin/extensions/updates` ; les anciennes (`/admin/modules`, `/admin/catalogue`,
`/admin/integrations`, `/admin/overlays`) redirigent, paramètres conservés. La page d'un module (`/admin/modules/<id>`) et celle d'une instance (`/admin/instances/<id>`) ne changent pas : elles sont des sous-pages de cet admin,
avec leurs réglages (générés depuis `settings`), leurs abonnements (voir « sujets ») et le panneau `adminPanel` du module.

#### Rangement dans le menu : épinglée ou seulement dans Extensions

Une instance est **épinglée au menu** (placement `menu`) ou **seulement dans Extensions** (placements `integrations` et `overlays`, noms conservés pour ne pas perdre les choix déjà faits). Le cœur décide du choix par défaut, **sans rien demander au module**, à partir de son manifeste seul, dans cet ordre :

1. type `overlay` **ou** permission `overlay` **sans `page` ni `sections`** → **seulement dans Extensions** (placement `overlays`). Un module qui a une page (`"page": true`) ou des sections d'accueil ET la permission `overlay` (cœur 0.2.6) n'est pas un simple overlay : il passe aux règles suivantes (il garde son adresse OBS dans Extensions, et peut toujours être rangé dans Overlays par choix). Les sites déjà en service ne bougent pas : au premier démarrage du cœur 0.2.6, chaque instance concernée qui n'avait pas de choix reçoit, une fois, le rangement « overlays » qu'elle avait ; seules les instances créées ensuite suivent la nouvelle règle ;
2. type `social` ou `integration` → **seulement dans Extensions** (`integrations`) ;
3. module à `content` → **épinglée**, sauf une simple liste de liens qui s'ouvrent ailleurs (`content.display: "links"` avec `clickAction: "external"`) → **seulement dans Extensions** ;
4. les autres (`widget`, `utility`, type inconnu ou absent) : s'ils ont des données à gérer, c'est-à-dire des actions `mcp`, un service `offers` ou un service `requires` → **épinglée** ; sinon → **seulement dans Extensions**.

Sur les modules du dépôt `curiosa-extras` (dossier `modules/`) : *épinglés* = `blog`, `codes`, `collection`, `contact-form`, `contacts`, `game-suggestions`, `pages`, `partnerships`, `planning`, `sponsors` ;
*seulement dans Extensions* = `discord-announcer`, `hero`, `links`, `live-status`, `press-kit`, `twitch-channel`, `youtube-channel` et les overlays `alerts-overlay`, `maze-overlay`, `sponsor-ticker`, `ticker-overlay`.
Un module sans type ni contenu (module tiers) suit la règle 4 ; pour qu'il soit épinglé par défaut, déclarez des actions `mcp` ou un `type` qui le dit.

**Épingler.** L'utilisateur peut changer ce choix instance par instance (« Épingler au menu » / « Retirer du menu », sur la page de réglages de l'instance et sur sa carte dans Extensions > Installées). Le rangement « overlays » n'est proposé que pour un overlay (type ou permission `overlay`) : posé sur autre chose, il est ignoré.
Ce choix est un réglage **du cœur**, mémorisé avec l'instance (`instance.<id>.__placement`) : le module ne le voit pas et n'a rien à déclarer. Il l'emporte toujours sur la règle ; revenir au choix par défaut l'efface.

**Rubrique d'une instance épinglée.** Elle se déduit aussi du manifeste seul (`defaultSection` dans `menuPlacement.ts`, aucun champ à ajouter) : un module à `content` ou de type `content` → **Mon contenu** (blog, pages, sponsoring…) ;
tout le reste → **Ma communauté** (contacts, partenariats, statistiques de la communauté, formulaire, planning, live…). Jusqu'à 6 entrées dans Ma communauté, elles forment une liste simple ; au-delà, elles passent en groupes pliables
selon la catégorie : *Relations* (`utility`), *Pages interactives* (`widget`) et *Autres* (toute autre catégorie, ou aucune), repliés par défaut. Le dernier choix est mémorisé dans un cookie (`curiosa_nav_groups`, lu côté serveur : pas de clignotement)
et la page ouverte déplie toujours son groupe. La pastille d'une instance (`adminBadge`) reste sur son lien et le total d'un groupe plié s'affiche sur son titre.

**Pastille d'Extensions.** L'entrée Extensions cumule les modules en retard (propriétaire), les instances à régler (état *À configurer* ou *Erreur*) et les pastilles des instances qui ne sont pas épinglées : rien ne se cache parce qu'une extension n'est pas dans le menu.

**Familles (Extensions > Installées).** Chaque module est rangé dans une famille, déduite elle aussi du manifeste seul (`extensionFamily`) : **Overlays** (type ou permission `overlay`) ; **Réseaux et connexions** (type `social` ou `integration`, `platform` déclarée,
ou simple liste de liens vers l'extérieur) ; **Contenu** (module à `content`) ; **Communauté** (le reste). Les modules en erreur ou à configurer passent en tête de leur famille. Pour un overlay, la carte affiche **l'adresse à coller dans OBS**
(`<SITE_URL>/overlays/<clé>`, avec un bouton « Copier » ; la route publique est inchangée).

**Plateformes.** Le champ facultatif `platform` du manifeste (voir ci-dessous) range le module dans *Réseaux et connexions* et ajoute une pastille de plateforme sur sa carte. Purement visuel : aucune dépendance entre modules, chaque instance reste épinglable seule.

**États d'une instance.** *Actif* (il n'y a pas d'état « éteint » : une instance qui existe tourne) ; *À configurer* (un réglage à remplir est encore vide : texte, secret ou adresse sans valeur par défaut, hors groupes facultatifs et textes traduisibles) ; *Erreur* (la migration des données du module a échoué ou une de ses tâches `tasks` a échoué à son dernier passage).

## Le manifeste `module.json`

Validé à l'installation et au chargement (zod, `src/core/modules/manifest.ts`). Une erreur donne un message du type
`module.json: settings.2.key — Invalid string`.

```jsonc
{
  "apiVersion": 2,                       // contrat avec le cœur : doit être celui du cœur, sinon le module est refusé
  "id": "announcement-banner",           // a-z, 0-9, tirets ; 2 à 40 caractères, commence par une lettre ; unique
  "name": { "en": "…", "fr": "…" },      // texte ou { langue: texte }
  "version": "1.0.0",                    // semver : x.y.z (suffixe -beta.1 permis)
  "description": { "en": "…" },
  "author": "…", "license": "MIT", "homepage": "https://…",
  "icon": "📣",                          // un emoji (8 caractères au plus)
  "main": "index.mjs",                   // absent = module sans code
  "type": "widget",                      // content | social | overlay | widget | integration | utility
  "platform": "twitch",                  // facultatif : plateforme concernée (regroupement à l'écran)
  "instances": "multiple",               // ou "single"
  "page": true, "basePath": "guestbook", // l'instance a une page publique, sur ce chemin proposé
  "permissions": ["slots", "sections", "routes", "storage", "filters", "pages", "topics", "overlay", "mcp", "admin", "mail", "rawg", "privacy", "visitor.geolocation"],
  "settings": [ /* … */ ], "sections": [ /* … */ ], "consumes": [ /* … */ ], "provides": [ /* … */ ], "mcp": [ /* … */ ],
  "content": { /* … */ }, "onboarding": { /* … */ }, "defaultEnabled": true
}
```

| Champ | Rôle |
|---|---|
| `apiVersion` | Version de l'API des modules (aujourd'hui `2`). Un module d'une autre version est refusé à l'installation ; dans l'index du catalogue, il est listé mais marqué incompatible. |
| `platform` | **Plateforme** concernée, facultative : `^[a-z][a-z0-9-]{0,30}$` (`twitch`, `discord`, `youtube`, `instagram`, `tiktok`, `x`…). Regroupe à l'écran les instances d'une même plateforme (voir « Plateformes »). Libellé affiché : table du cœur pour les plateformes connues (`twitch` → Twitch, `youtube` → YouTube, `tiktok` → TikTok, `x` → X, `kofi` → Ko-fi, `github` → GitHub… voir `src/core/modules/platform.ts`), sinon l'identifiant avec une majuscule initiale. Une autre forme est refusée (`module.json: platform — …`). Absent = aucune plateforme. Un cœur plus ancien ignore la clé. |
| `minCore` | **Version minimale du cœur** (`"0.1.10"` : trois nombres, rien d'autre ; une autre forme est refusée). Absent = aucune exigence. Voir [Version minimale du cœur](#version-minimale-du-cœur-mincore). |
| `id` | Identifiant du module, stable à jamais (les instances et les sauvegardes s'y réfèrent). |
| `name`, `description` | Texte ou `{ langue: texte }` (500 caractères au plus). Langue absente : langue par défaut du site, puis `en`. |
| `version` | `x.y.z`. Sert à détecter les mises à jour (comparée à la version du catalogue). |
| `author`, `license`, `homepage` | Informatifs (`homepage` : URL valide). |
| `pageSetting` | (cœur 0.2.12, `"minCore": "0.2.12"`) Facultatif : clé d'un réglage **booléen** du module (case à cocher) qui allume ou éteint la page publique de l'instance. Tant qu'il est faux (ou jamais enregistré et sans `default: true`), la page n'existe pour personne : 404 sur l'adresse et sur son `page-script`, et rien dans le plan du site, `llms.txt`, le menu ni l'éditeur de menu. Refusé si la clé n'est pas celle d'un réglage booléen du module, ou si le module n'a pas de page. Sans le champ : rien ne change. L'administration de l'instance dit si la page est allumée. Règle unique : `hasPublicPage` (`src/core/modules/publicPage.ts`). |
| `privacy` | Facultatif : ce que le module collecte comme données personnelles, pourquoi et comment les faire effacer (texte simple, traduisible comme `description`). **Un module qui collecte des données de visiteurs doit le déclarer** : le cœur reprend ce texte tel quel, sous le nom de l'instance, dans la page « Politique de confidentialité » du site (`/privacy`, lien permanent du pied de page). Un module qui ne collecte rien n'a rien à écrire. |
| `icon` | Emoji affiché dans l'admin. |
| `main` | Fichier ES module du code, relatif à la racine. Absent : module « sans code » (réglages, contenu). |
| `type` | Catégorie (voir ci-dessus). Défaut : `content` si `content` est déclaré, sinon `widget`. |
| `instances` | `"multiple"` (défaut) ou `"single"`. |
| `page` | L'instance a une page publique. Défaut : oui si `content` (sauf type `overlay`). Le code la fournit avec `page()`. |
| `suggestInMenu` | (prochaine version du cœur) « Je suggère que la page de l'instance soit dans le menu du site. » **Une suggestion, jamais un ordre** : le cœur n'ajoute plus aucune page au menu tout seul (voir « Menu du site » dans [PLATFORM.md](PLATFORM.md)) ; une page suggérée apparaît en premier, avec la mention « Suggérée par l'extension », dans la liste « Pages qui ne sont pas dans le menu ». Défaut : la valeur de `content.showInNav`, sinon non. Sans effet pour un overlay (pas de page publique). Un cœur ancien ignore la clé. |
| `basePath` | Chemin public proposé à la création d'une instance à page (défaut : la clé de l'instance). Lettres minuscules, chiffres, tirets. |
| `settings` | Réglages **par instance** ; l'admin génère le formulaire (voir ci-dessous). 60 au plus. |
| `optionalGroups` | Groupes de réglages **facultatifs** derrière un bouton « Ajouter… » (voir « Groupes facultatifs »). 6 au plus. |
| `tabs` | (cœur 0.2.2) **Onglets** de la page d'admin d'une instance : en ajouter, en renommer, en retirer (voir « Onglets de la page d'admin (`tabs`) »). Facultatif : sans rien déclarer, le module a les quatre onglets du cœur. 8 entrées au plus. |
| `sections` | Morceaux plaçables sur la page d'accueil (voir ci-dessous). 20 au plus. |
| `offers` / `requires` | **Dépendances** : services que le module offre aux autres / dont il a besoin (voir « dépendances entre modules »). 10 au plus chacun. `requires[].optional: true` (cœur 0.2.0) : besoin **facultatif**, le module fonctionne sans. |
| `consumes` / `provides` | Sujets que le module digère / expose (voir « sujets »). 10 au plus chacun. |
| `entryPanels` | **Sections ajoutées à l'éditeur d'entrée d'un autre module** (voir « Ajouter une section à l'éditeur d'un autre module »). 5 au plus : `{ "id", "for": { "topic" } ou { "module" }, "title", "help"? }`. |
| `mcp` | Actions proposées à l'API MCP (voir « API MCP »). 60 au plus. |
| `content` | Module à contenu : le cœur fournit l'éditeur d'entrées et les pages (voir ci-dessous). |
| `onboarding` | Comment le module participe à la première installation (voir ci-dessous). |
| `seeds` | **Graines** : modules dans lesquels une migration de données de ce module pourra créer UNE instance (`{ "module": "<id>", "reason": { "fr": "…", "en": "…" } }`, 3 au plus). Exige que le module cible soit relié à celui-ci : il offre un service que ce module `requires`, ou il fournit un sujet que ce module `consumes` (lien souple, sans dépendance). Voir « `migrations` › Semer une instance ». |
| `dataVersion` | Version de la **structure de vos données** (entier ≥ 1, défaut 1). À augmenter quand elle change, avec la migration correspondante (`migrations`). |
| `dataFloor` | (cœur 0.2.0) Plus petite version des données que **cette** version sait encore convertir (entier, ≤ `dataVersion`, défaut 1). Une instance plus ancienne est mise de côté (« passez d'abord par une version intermédiaire ») au lieu d'être déclarée à jour. Voir « Réglages hérités et plancher ». |
| `legacySettings` | (cœur 0.2.0) Réglages qu'une version précédente affichait et que le module reprend lui-même : `[{ "key": "clientSecret", "secret": true }]`, 20 au plus, jamais aussi dans `settings`. **Jamais affichés**, lus par `ctx.legacy`. Voir « Réglages hérités et plancher ». |
| `legacyCollections` | (cœur 0.2.0) Collections du stockage qu'une version précédente remplissait et que le module vide après reprise (10 au plus) : comptées par la page *Entretien*, jamais lues par le cœur. |
| `defaultEnabled` | Sans effet pour un module installé depuis le catalogue ou un dépôt : sans effet non plus sur l'état : un module installé est toujours actif (l'assistant de première installation n'installe que ceux que l'on coche). |
| `permissions` | Les capacités utilisées (voir ci-dessous). |
| `rights` | (cœur 0.2.0) **Droits** du module, proposés dans les rôles de la page Équipe (voir « Droits (`rights`) »). 20 au plus. |

### Version minimale du cœur (`minCore`)

Un module qui s'appuie sur une fonction récente du cœur (par exemple la permission `rawg`, cœur 0.1.10 ou plus) le déclare : `"minCore": "0.1.10"`. Sans ce champ, aucune exigence (tous les modules existants).
(Le nom `requires` est pris : il désigne les *services* dont le module dépend, voir plus bas.)

- **Comparaison** : sur `majeure.mineure.correctif`, en comparant des **nombres** (0.1.10 est plus récent que 0.1.9) et en **ignorant l'étiquette de pré-version du cœur** : un cœur `0.1.10-rc.1` satisfait `"0.1.10"` (on teste les release candidates). La version du cœur est celle de `package.json`, la même que sur la page Mises à jour.
- **Installation** (Catalogue, dépôt personnel, assistant, restauration) et **mise à jour** (une par une ou « Tout mettre à jour ») : un cœur trop ancien **refuse** avec « Ce module demande Curiosa 0.1.10 ou plus. Mettez d'abord le site à jour (Admin → Mises à jour). ». Rien n'est téléchargé quand l'index du catalogue annonce déjà l'exigence (ci-dessous) ; une mise à jour refusée laisse le module exactement comme il était.
- **« Tout mettre à jour »** : le module incompatible est **sauté** et listé à part dans le bilan (`incompatible`), sans compter comme un échec ni arrêter les autres.
- **Restauration d'une sauvegarde** : un module du catalogue qui demande un cœur plus récent n'est pas réinstallé ; l'aperçu (`needsCore`) et le bilan le signalent comme module à réinstaller après la mise à jour du site. Ses données sont gardées.
- **Jamais rétroactif** : un module déjà installé et chargé n'est jamais désactivé ni cassé à cause de ce champ (la vérification ne porte que sur l'entrée ou la montée de version). Les modules déjà installés restent chargés tels quels.
- **Catalogue** : l'entrée de l'index peut porter `"requires": { "core": "0.1.10" }` (même numéro) pour que le cœur sache **sans télécharger** si le module convient ; le script du dépôt de modules la recopie depuis `minCore`. Un champ mal formé est ignoré.
- **Anciens cœurs (0.1.9 et avant)** : `minCore` et `requires.core` d'une entrée d'index sont des clés inconnues, **ignorées sans erreur** (schémas non stricts) ; le module reste lisible, mais l'ancien cœur n'applique évidemment pas l'exigence.
- Côté code : `isCompatible(requires, coreVersion)` et `describeIncompat(requires, coreVersion)` (`src/core/modules/compat.ts`), fonctions pures.

### Permissions

Déclaratives : elles disent à l'administrateur ce que le module fait. **Le cœur ne bloque pas** un module qui utilise une
capacité qu'il n'a pas déclarée — et la version actuelle de l'admin ne les affiche pas encore : déclarez-les quand même,
fidèlement (le test de l'exemple vérifie qu'elles correspondent au code), elles sont le contrat de confiance du module.

| Permission | Quand la déclarer |
|---|---|
| `slots` | le code définit `slots` (blocs dans le site) |
| `sections` | le code définit `sections` (morceaux d'accueil) |
| `pages` | le code définit `page` (page publique) |
| `routes` | le code définit `routes` (`/m/<clé>/<route>`) |
| `storage` | le module lit ou écrit `ctx.api.store` |
| `filters` | le code définit `filters` (transformation du corps des entrées) |
| `topics` | le module fournit (`exports`) ou consomme (`ctx.api.topics.collect`) des sujets |
| `overlay` | le code définit `overlay` (source navigateur OBS) |
| `mcp` | le module déclare des actions `mcp` |
| `admin` | le code définit `adminPanel` / `adminActions` / `entryPanels` |
| `mail` | le module appelle `ctx.api.mail.send` |
| `rawg` | le module appelle `ctx.api.rawg.cover` (jaquettes de jeux, voir « Jaquettes de jeux (RAWG) ») |
| `privacy` | (cœur 0.2.6) le module appelle `ctx.api.privacy.declarations()` (lire ce que les autres modules déclarent récolter) |
| `visitor.geolocation` | (cœur 0.2.12, déclarez `"minCore": "0.2.12"`) le code de la page appelle `navigator.geolocation` (« Près de moi »). **Seule permission qui change vraiment ce que le navigateur autorise** : voir ci-dessous |

#### Permission `visitor.geolocation` (cœur 0.2.12)

Le site envoie `Permissions-Policy: camera=(), microphone=(), geolocation=()` : la position du visiteur est **fermée**. Elle n'est permise (`geolocation=(self)`, les pages du site seulement, jamais un tiers ni un joker) que si **au moins un module installé déclare `"visitor.geolocation"`** dans `permissions`. Installer, mettre à jour, réinstaller ou désinstaller un module recalcule l'en-tête ; le cœur le garde en mémoire (30 s au plus de retard) et le **ferme au moindre doute**. Sans la déclaration, le navigateur refuse l'appel même après un clic : un module qui s'en sert doit donc la déclarer, et rien d'autre. L'administrateur lit « Demander la position du visiteur, seulement après un clic de sa part » avant d'installer. Le droit ne vaut que pour les pages publiques du site (pas l'administration, ni les routes `/m/…`). Le module ne l'appelle qu'**après un clic**, ne garde rien et n'envoie rien. Un module qui ne déclare rien ne change rien : l'en-tête reste fermé. La déclaration est reconnue à partir de la 0.2.12 ; un cœur plus ancien refuse le module (permission inconnue), d'où `minCore`.

### Droits (`rights`)

Cœur **0.2.0** (déclarez `"minCore": "0.2.0"` si votre code en dépend). Le propriétaire crée des rôles (« Modérateur »…) et coche, module par module,
ce que chacun permet ; un module dit ici quels droits il propose :

```json
"rights": [
  { "id": "email.view", "label": { "fr": "voir les e-mails et téléphones", "en": "see e-mails and phone numbers" },
    "help": { "fr": "…", "en": "…" }, "sensitive": true, "default": { "admin": true, "editor": false } }
]
```

- `id` : identifiant **local** (1 à 3 segments en minuscules : `email.view`, `targets.edit`). Le cœur le préfixe toujours par l'identifiant du module
  (`<module>:email.view`) : un module ne peut **jamais** déclarer ni tester le droit d'un autre. Un `:` dans `id` est refusé.
- `open` est **implicite** (ne le déclarez pas) : `<module>:open` ouvre la page d'administration du module. Tout administrateur l'a ; un éditeur non (comme avant).
- `label` (obligatoire), `help` : en mots simples, ils s'affichent à côté de la case à cocher. `sensitive` : marqué « sensible ».
- `default` : ce que reçoivent les rôles prédéfinis. Administrateur : oui, sauf `"admin": false`. Éditeur : non, sauf `"editor": true`.
- Lire un droit : `ctx.can("email.view")` (voir « Le contexte `ctx` »), ou protéger une action : `adminActions: { save: { right: "phone.edit", run } }`
  (le cœur vérifie `<module>:open` ET `<module>:phone.edit` **avant** d'appeler `run`).
- Un cœur plus ancien ignore cette clé et n'a pas `ctx.can` : traitez son absence comme un refus.

### Réglages (`settings`)

Chaque réglage est un objet (`SettingField`) :

| Clé | Rôle |
|---|---|
| `key` | Identifiant (lettre puis lettres, chiffres, `_` ; 41 caractères au plus). C'est ce que lit `ctx.setting("clé")`. |
| `label` | Libellé affiché dans l'admin (texte ou `{ langue: texte }`). |
| `type` | L'un des types ci-dessous. |
| `help` | Aide sous le champ. |
| `default` | Valeur par défaut (texte, nombre ou booléen). `ctx.setting` la renvoie tant que rien n'est réglé, et l'admin **pré-remplit** le champ avec elle. Pour `text` / `textarea` : `"site:name"` (nom du site) ou `"site:tagline"` (accroche), dans la langue du champ (voir ci-dessous). |
| `options` | Pour `select` : `[{ "value": "info", "label": { "en": "…" } }]` (50 au plus). |
| `translatable` | `true` : une valeur par langue du site (sinon une seule valeur globale). `ctx.setting` renvoie celle de la langue courante. |
| `advanced` | `true` : réglage technique, masqué dans la version simplifiée de l'admin ; **sa valeur par défaut s'applique** — donnez-en toujours une. |
| `optional` | `true` : réglage facultatif. Vide, il ne met pas l'extension « À configurer » ; sans cela, un texte, une adresse, un lien ou un secret vide et sans valeur par défaut est signalé à l'administrateur comme « à remplir » (avec son libellé). |
| `group` | `"appearance"` : réglage d'apparence, regroupé sous « Apparence de ce module ». |
| `source` | Pour `choice` (obligatoire) : d'où viennent les options. Voir « Réglage `choice` » ci-dessous. |
| `allowCreate` | Pour `choice` de source `service` avec `create` : propose « Créer « X » » (jamais pour un rôle, un connecteur, un module, une instance ou un compte). |
| `fromText` | Pour `choice` qui remplace un réglage texte de même clé : une valeur texte égale à l'étiquette d'UNE option est remplacée par son identifiant. |
| `refersTo` | Ce que désigne le réglage : `category`, `contact`, `organisation`, `channel`, `connector`, `instance`, `module`, `calendar`, `game`, `page`, `user`, `role`, `theme`, ou `external` (un profil hors du site). Un cœur ancien ignore la clé ; le kit de test s'en sert (règles `settings.refersToChoice`, `settings.textNamesExisting`). |
| `tab` | (cœur 0.2.2) Onglet de la page d'admin où s'affiche le réglage : `settings` (défaut, onglet « Réglages »), `sources`, `general` ou l'`id` d'un onglet déclaré dans `tabs`. Tous les réglages d'un groupe facultatif sont dans le même onglet. Un cœur ancien ignore la clé ; déclarez `"minCore": "0.2.2"`. |

Types : `text`, `textarea`, `url` (adresse http ou https), `link` (une page du site comme `/contact`, une adresse `https://…` ou `mailto:…` ; contrôlé dans le navigateur et par le serveur), `number`, `boolean`, `select`, `color`, `image` (envoi de fichier ou URL), `video` (envoi d'une vidéo MP4 ou WebM de 50 Mo au plus, réservée aux fichiers du site : `/uploads/…`), `secret`
(jamais réaffiché une fois enregistré ; ne l'écrivez jamais dans un journal), `choice` (« choix parmi », cœur 0.2.0 : voir ci-dessous).

#### Réglage `choice` (« choix parmi », cœur 0.2.0)

Un réglage qui **désigne un élément qui existe déjà** (une chaîne, une catégorie, un agenda…) n'est jamais du texte libre : c'est un `choice`. La personne cherche et choisit dans une liste ; le module reçoit un **identifiant stable** (jamais un nom, jamais une clé renommable).

```json
{ "key": "channel", "type": "choice", "label": { "fr": "Chaîne", "en": "Channel" },
  "source": { "kind": "providers", "service": "demo.channel" }, "fromText": true, "optional": true }
{ "key": "category", "type": "choice", "label": { "fr": "Catégorie", "en": "Category" }, "refersTo": "category",
  "source": { "kind": "service", "service": "demo.book", "list": "categories", "get": "getCategories", "create": "createCategory" }, "allowCreate": true }
```

- **Sources** (le `service` doit figurer dans `requires`) :
  - `providers` : les instances actives qui offrent ce service (`ctx.api.services.providers`), version ≥ `min`. Valeur stockée : l'**id d'instance**.
  - `service` : le module **propriétaire** de la donnée offre trois méthodes, appelées au nom de votre instance :
    `list({ q?, cursor?, limit? })` → `{ items: [{ id, label, aliases?, hint? }], next }` (`q` ≤ 100 caractères, `limit` ≤ 50, défaut 20 ; un `next` de plus de 500 caractères est ignoré) ;
    `get({ ids })` (≤ 50) → `{ items: [{ id, label }], moved?: { ancien: nouveau }, missing: [...] }` ;
    `create({ label })` (facultative, ≤ 100 caractères) → `{ ok: true, id, label }` ou `{ ok: false, error: "duplicate" | "invalid" | "denied", id? }`. `create` est appelée **dans le contexte de la personne connectée** : vérifiez votre droit avec `ctx.can(…)` et refusez (`denied`) sinon ; un `duplicate` qui donne l'`id` de l'existant le fait sélectionner.
- **Pas de défaut, pas de traduction** (refusés par le manifeste), pas dans les options d'une section.
- **Lire la valeur** : `ctx.setting("clé")` renvoie la valeur brute ; `await ctx.resolveChoice("clé")` la résout (3 s au plus, ne lève jamais) :
  `chosen` (choisi ; une fusion `moved` est suivie), `only` (rien de choisi et **une seule** option : utilisez son `id` ; il n'est **jamais écrit**, pour qu'une deuxième option fasse réapparaître le sélecteur), `none` (aucune option), `ambiguous` (plusieurs, rien de choisi), `missing` (l'élément a disparu ; s'il ne reste qu'une option, `id` et `label` la donnent et vous pouvez l'utiliser), `unverified` (le fournisseur n'a pas répondu : ne décidez rien).
  Pour une source `providers` : `ctx.api.services.call(service, méthode, args, { provider: r.id })`.
- **Dans l'admin** : 0 option → le champ est masqué et une bannière dit quoi faire (source `providers` : bloc `suggestInstall` ; source `service` : « créez-en d'abord un dans … », et « Créer » si `allowCreate`) ; 1 option → champ masqué (« Utilise : … » en mode avancé) ; 2 ou plus → recherche paginée au clavier. Un élément disparu met l'instance « à configurer », sauf s'il ne reste qu'une option.
- **Enregistrement** : le navigateur n'envoie qu'un identifiant ; le cœur le revérifie auprès du fournisseur (3 s par champ, 5 s en tout). Au délai dépassé, **rien n'est enregistré** (« Impossible de vérifier ce choix, réessayez »). Même règle pour un `choice` semé par `ctx.seedInstance`.
- **`fromText`** : passer un réglage `text` en `choice` garde la même clé. Si la valeur enregistrée n'est pas un identifiant connu et égale **exactement** (sans casse, espaces réduits) l'étiquette ou un alias d'**une seule** option, le cœur la remplace par l'identifiant (à l'ouverture de l'admin de l'instance et au balayage de démarrage ; audit `setting.fromText`). Sinon l'admin affiche « Valeur à confirmer ». Pour une source `providers`, la clé technique de l'instance sert d'alias.
- **Kit de test** : `fakeCtx({ choices: { clé: { status: "chosen", id, label } } })` ; règles `settings.refersToChoice` et `settings.textNamesExisting` (conseils en 0.2.0).
- Exige `"minCore": "0.2.0"` : un cœur plus ancien refuse le manifeste.

- **Valeurs** : `ctx.setting` renvoie ce que l'admin a saisi, **sans garantie de type** (un nombre peut arriver en texte, une
  adresse peut être n'importe quoi) : convertissez, bornez et validez avant d'utiliser. Un réglage inconnu du manifeste vaut `undefined`.
- **Couleur qui suit le thème** : `{ "key": "accent", "type": "color", "default": "theme:accent" }`. Jetons : `accent`, `accentFg`,
  `bg`, `surface`, `fg`, `muted`, `line`, `success`, `successFg`, `warning`, `warningFg`, `danger`, `dangerFg`, `accent2`, `accent2Fg` (pas `gradient`, qui n'est pas une couleur unie). Seul un réglage `color` peut avoir un défaut `theme:…`, et le jeton doit exister (sinon le
  manifeste est refusé). Tant que l'administrateur n'a pas choisi sa couleur (case « Suivre le thème du site »), `ctx.setting`
  renvoie la valeur du thème courant.
- **Texte qui suit le site** : `{ "key": "title", "type": "text", "translatable": true, "default": "site:name" }`. Le champ s'affiche
  pré-rempli avec le nom du site (`site:name`) ou son accroche (`site:tagline`) dans la langue du champ, et `ctx.setting` renvoie cette
  valeur tant que rien d'autre n'est saisi. Si la valeur saisie est identique à celle du site, **rien n'est enregistré** : le champ continue de
  suivre le site quand celui-ci change. Réservé aux réglages `text` et `textarea` (sinon le manifeste est refusé).
- **Réglage traduisible.** Avec une seule langue sur le site, l'admin montre un champ simple ; avec plusieurs, une ligne par langue
  sous le libellé du réglage.
- **Simple et avancé.** L'admin existe en deux versions (bascule dans la barre latérale). Gardez dans la version simple l'essentiel :
  ce qu'une personne sans connaissances web comprend (un nom, une couleur, une image, un nombre). Les réglages avancés déjà
  enregistrés ne sont jamais effacés quand quelqu'un édite en version simple.

### Groupes facultatifs (`optionalGroups`)

Des réglages qu'on ne veut pas toujours (un bouton, une vidéo de fond) restent cachés derrière un seul bouton « ＋ … » :

```jsonc
"optionalGroups": [
  { "id": "button", "label": { "fr": "Bouton" }, "addLabel": { "fr": "Ajouter un bouton" }, "removeLabel": { "fr": "Retirer le bouton" },
    "fields": ["buttonLabel", "buttonUrl"], "required": ["buttonLabel", "buttonUrl"] }
]
```

| Clé | Rôle |
|---|---|
| `id` | Identifiant du groupe (minuscules, chiffres, tirets). |
| `label` | Titre de la carte du groupe, une fois ouverte. |
| `addLabel` | Texte du bouton qui ouvre le groupe (« Ajouter un bouton »). |
| `removeLabel` | Texte du bouton qui le retire (défaut : « Retirer »). |
| `fields` | Clés de `settings` du groupe. Un réglage n'est que dans un seul groupe ; le groupe s'affiche à la place de son premier réglage. |
| `required` | Sous-ensemble de `fields` à remplir dès que le groupe est ouvert (pas une case à cocher). |

Tant qu'aucun champ du groupe n'a de valeur, l'admin ne montre que le bouton. Ouvert, le groupe est une carte avec ses champs et
« Retirer » ; on ne peut pas enregistrer tant que les champs `required` ne sont pas remplis (navigateur **et** serveur). « Retirer »
supprime toutes les valeurs du groupe à l'enregistrement : `ctx.setting` renvoie alors les défauts. Le manifeste est refusé si un champ
est inconnu, si `required` n'est pas inclus dans `fields`, si un champ est dans deux groupes ou s'il y a plus de 6 groupes.

### Onglets de la page d'admin (`tabs`) — cœur 0.2.2

La page d'une instance (`/admin/instances/<id>`, et la même fenêtre ouverte depuis Extensions) est rangée en **onglets**, pour **tous** les modules,
sans rien déclarer. Le cœur classe tout seul :

| Onglet (`id`) | Ce qu'il contient |
|---|---|
| **Utiliser** (`use`) | Le panneau propre du module (`adminPanel`) et, pour un overlay, l'adresse à coller dans OBS. C'est ce qu'on ouvre souvent : il s'affiche **en premier**. |
| **Réglages** (`settings`) | Les réglages `settings` (options, apparence ; les réglages `advanced` n'apparaissent qu'en mode avancé, **repliés** sous « Options avancées »). Sans panneau, c'est l'onglet ouvert à l'arrivée. |
| **Sources** (`sources`) | « D'où viennent les informations » : les sujets consommés (`consumes`), en mode avancé. |
| **Général** (`general`) | Nom, description, menu, accès des assistants IA (MCP), langues, tâches ; puis, en bas et à part, la **zone sensible** (données gardées, retirer, tout effacer : chaque bouton demande une confirmation en clair). |

Règles du cœur, identiques partout :

- **Un onglet vide n'est pas affiché** (pas d'« Utiliser » sans panneau, pas de « Sources » sans `consumes`). Un panneau qui renvoie `[]` compte comme vide :
  l'onglet disparaît tant que le panneau n'a rien à montrer. Avec un seul onglet, la rangée n'est pas affichée.
- **Onglet ouvert à l'arrivée** : celui de l'adresse (`?tab=<id>`, lien partageable, le bouton Retour revient à l'onglet d'avant) ; sinon l'onglet du premier
  réglage **à remplir** (le module ne fonctionne pas sans) ; sinon le premier onglet affiché. Rien n'est retenu dans un cookie.
- **Un seul bouton « Enregistrer »**, collant en bas, pour tous les onglets ; un point sur l'onglet modifié ; rien n'est perdu en changeant d'onglet ;
  avertissement avant de quitter la page avec des modifications non enregistrées.
- **Erreur dans un onglet caché** : la page bascule sur cet onglet (point rouge), le message s'affiche **sous le champ** et le champ prend le focus. Renvoyez
  donc vos erreurs par champ (`errors: { champ: "message" }`, voir « Panneau d'admin riche ») plutôt qu'un `error` général.
- **Droits inchangés** : une personne qui peut seulement ouvrir le module (`<module>:open`, rôle personnalisé) ne voit que l'onglet « Utiliser » ; les autres
  onglets restent réservés aux administrateurs, et le retrait du module (dernière instance) au propriétaire.
- **Mobile** : la rangée d'onglets défile horizontalement et reste collée en haut de l'écran ; l'onglet actif est toujours visible. Au clavier : flèches
  gauche/droite, Début, Fin (motif WAI-ARIA « tabs »).

Le manifeste peut **ajuster** ce classement (tout est facultatif, additif ; un cœur plus ancien ignore ces clés : déclarez `"minCore": "0.2.2"`) :

```jsonc
"tabs": [
  { "id": "use", "label": { "fr": "Fabriquer la vidéo", "en": "Make the video" } },   // renommer un onglet par défaut
  { "id": "look", "label": { "fr": "Apparence", "en": "Look" } },                       // AJOUTER un onglet (après Réglages)
  { "id": "sources", "hidden": true }                                                    // RETIRER un onglet par défaut
],
"settings": [
  { "key": "color", "type": "color", "tab": "look", "label": { "fr": "Couleur", "en": "Colour" } },
  { "key": "tags", "type": "text", "tab": "sources", "label": { "fr": "Étiquettes", "en": "Tags" } }
]
```

| Clé d'une entrée | Rôle |
|---|---|
| `id` | `use`, `settings`, `sources` ou `general` pour agir sur un onglet du cœur ; sinon l'identifiant d'un onglet **ajouté** (minuscules, chiffres, tirets, 2 à 24 caractères ; il apparaît dans l'adresse `?tab=`). |
| `label` | Nom affiché (`{ "fr": "…", "en": "…" }`, 40 caractères au plus ; court : le kit conseille 20). Obligatoire pour un onglet ajouté ; pour `use`, `settings`, `sources` : renomme l'onglet (le premier prend volontiers le vrai nom de ce qu'on y fait : « Fabriquer la vidéo », « Ma liste »). `general` ne se renomme pas. |
| `hidden` | `true` : **retire** un onglet du cœur. Rien n'est perdu : son contenu rejoint un autre onglet — `use` (le panneau) et `sources` vont dans **Réglages** (en haut / en bas), `settings` va dans **Général**. `general` ne se retire jamais. Exemple : un connecteur dont le panneau n'est qu'un état de connexion le range ainsi à côté de sa clé. |

Un onglet **ajouté** contient les réglages qui le visent (`"tab": "<id>"`) et/ou des blocs du panneau (voir ci-dessous) ; il est refusé s'il n'a ni réglage ni `"panel": true`. 4 onglets ajoutés au plus (le kit
**conseille** 3 au plus : règle `tabs.reasonable`, avec des noms courts en français et en anglais). L'action d'enregistrement du cœur n'écrit que les réglages
de l'onglet envoyé : un réglage d'un autre onglet garde sa valeur.

#### Placer un bloc du panneau dans un onglet (cœur 0.2.5)

Par défaut tous les blocs de `adminPanel` vont dans **Utiliser**. Un bloc peut viser un autre onglet avec la clé facultative `tab` (type `PanelBlock`) :

```js
adminPanel: (ctx) => [
  { type: "table", columns: ["Jour", "Heure"], rows: [...] },                                   // sans tab : Utiliser, comme avant
  { type: "markdown", text: "Choisissez l'apparence dans la liste ci-dessous.", tab: "look" },  // dans l'onglet « look », au-dessus de ses réglages
]
```

- `tab` : `settings`, `sources`, `general` ou l'id d'un onglet **ajouté**. `use`, absent ou id inconnu : Utiliser (un bloc n'est jamais perdu). Si l'onglet visé est retiré (`hidden`), le bloc suit le contenu de cet onglet.
- **Ordre** : dans un onglet, les blocs viennent **au-dessus** de ses réglages (l'explication ou l'aperçu se lit avant l'option qu'il illustre), dans l'ordre où le panneau les renvoie. Dans Utiliser : l'adresse OBS d'un overlay, puis les blocs.
- Un onglet ajouté qui ne reçoit que des blocs déclare `"panel": true` (sans cela il est refusé faute de réglage) ; comme tout onglet, il n'est pas affiché tant qu'aucun bloc ne l'atteint.
- **Droits** : une personne qui peut seulement ouvrir le module (pas administrateur) ne voit que Utiliser : tous les blocs y restent, quel que soit leur `tab`.
- **Compatibilité** : un cœur plus ancien ignore `tab` (le bloc reste dans Utiliser) et refuse `"panel"` : déclarez `"minCore": "0.2.5"` ; la règle `compat.minCore` du kit l'exige.
- Gardez la cohérence : un texte du bloc qui renvoie à un réglage dit « dans l'onglet X », jamais « ci-dessus » ou « plus bas » (l'ordre des onglets n'est pas celui d'une page).

### Sections d'accueil (`sections`)

```jsonc
"sections": [
  { "id": "next", "label": { "en": "Next stream" }, "size": "small" },
  { "id": "days", "label": { "en": "The next days" }, "size": "medium",
    "options": [{ "key": "count", "type": "number", "default": 3, "label": { "en": "How many days" } }] }
]
```

| Clé | Rôle |
|---|---|
| `id` | Identifiant (minuscules, chiffres, tirets ; 31 caractères au plus) : la clé de `sections.<id>` dans le code. |
| `label` | Nom montré à l'administrateur qui place la section. |
| `options` | Réglages du **placement** (mêmes champs qu'un réglage ; 10 au plus). Reçus dans `options` par la fonction de rendu. |
| `size` | Taille naturelle **recommandée** : `small`, `medium`, `large` ou `full` (absent = `full`). L'administrateur peut la changer. |

La page d'accueil appartient au cœur : elle n'a pas de contenu propre, c'est un **flux** de morceaux proposés par les modules
actifs. Dans *Accueil*, l'administrateur ajoute, ordonne et choisit la **taille naturelle** de chacun : `small` (petit encart :
un code, le prochain stream), `medium` (une carte), `large` (un morceau qui aime la place) ou `full` (toute la largeur).
Il n'y a ni colonnes ni lignes à régler : les morceaux s'écoulent dans l'ordre, **à la ligne quand la place manque, comme du texte**.
Plusieurs petits morceaux se rangent côte à côte et s'étirent pour remplir la ligne ; sur un téléphone tout s'empile ; la hauteur est
toujours celle du contenu. Un morceau sans rien à montrer (la fonction renvoie `null` ou `[]`) disparaît et les autres s'écoulent à sa place.
L'administrateur peut aussi **isoler** un morceau : retour à la ligne avant, centré seul sur sa ligne (à sa taille naturelle), retour à la ligne après.

Le rendu d'une section doit rester lisible quelle que soit la place qu'on lui laisse : titre court, peu de texte, pas de largeur fixe.
Chaque placement est `(instance, section)` + options + taille : plusieurs instances = plusieurs sections indépendantes.
Le cœur fournit déjà deux sections aux modules à contenu : `latest` (les dernières entrées, option `count`) et, pour ceux dont les
entrées portent un code (codes promo…), `random` (un code au hasard, `small`).

### Sujets (`consumes`, `provides`)

```jsonc
"provides": [{ "topic": "feed.item", "label": { "en": "Messages in the RSS feed" } }]
"consumes": [{ "topic": "overlay.item", "label": { "en": "Items" }, "tags": true,
               "schema": [{ "key": "title", "type": "string", "required": true }] }]
```

| Clé | Rôle |
|---|---|
| `topic` | Identifiant du sujet : minuscules, `domaine.objet` (jusqu'à 4 niveaux séparés par des points). |
| `label` | Nom montré à l'administrateur (`consumes` : obligatoire ; `provides` : facultatif). |
| `schema` | `consumes` seulement : le format que le consommateur sait digérer, une liste de `{ key, type, required? }`. Types : `string`, `url`, `number`, `boolean`, `string[]`, `datetime` (chaîne ISO 8601 : voir « sujets »). Absent pour les sujets du cœur (`core.entry`). |
| `tags` | `consumes` seulement : l'administrateur peut restreindre les sources par étiquette. |

### Actions MCP (`mcp`)

| Clé | Rôle |
|---|---|
| `name` | Identifiant de l'action (minuscules, chiffres, `_` ; 2 à 40 caractères). Clé de `mcp.<name>` dans le code. |
| `description` | Ce que fait l'action, **écrit pour l'assistant qui la lit** (1000 caractères au plus). |
| `readOnly` | Lecture seule (défaut : non). Les jetons « lecture » n'ont accès qu'aux actions en lecture seule. |
| `default` | Accordée d'office aux jetons ? Défaut : oui pour une lecture seule, non pour une action qui écrit. |
| `destructive` | Irréversible (suppression…). Jamais `default: true`, jamais `readOnly` : le manifeste est refusé sinon. |
| `input` | Schéma des arguments (sous-ensemble de JSON Schema, voir « API MCP »). |

### Module à contenu (`content`) : zéro code

```jsonc
"content": {
  "display": "cards",                  // cards | list | links | codes
  "clickAction": "detail",             // detail | external
  "features": ["cover", "summary", "body"],   // cover icon summary body url code expiresAt featured tags
  "basePath": "blog", "showInNav": true,
  "allowGoLinks": false, "fallbackToDefault": true,
  "fieldSchema": [{ "key": "price", "label": "Price", "type": "number" }]
}
```

| Clé | Rôle |
|---|---|
| `display` | Présentation de la liste publique : `cards`, `list`, `links`, `codes`. |
| `clickAction` | `detail` (page de l'entrée) ou `external` (lien sortant). |
| `features` | Champs proposés par l'éditeur : `cover`, `icon`, `summary`, `body`, `url`, `code`, `expiresAt`, `featured`, `tags`. |
| `fieldSchema` | Champs personnalisés (20 au plus) : `{ key, label, type, topic? }`, `type` ∈ `text`, `url`, `number`, `boolean`, `ref` (référence vers un sujet, voir plus bas). |
| `allowGoLinks` | Active les liens courts `/go/<instance>/<entrée>`. |
| `fallbackToDefault` | Retomber sur la langue par défaut quand une entrée n'est pas traduite. |
| `basePath` | Chemin public proposé à la création d'une instance. |
| `showInNav` | **Suggère** que la page de l'instance soit au menu du site (même effet que `suggestInMenu`, qui l'emporte s'il est déclaré). Depuis cette version le cœur n'ajoute plus rien au menu sans la décision de la personne. |

Avec `content`, le cœur fournit gratuitement l'éditeur d'entrées (multilingue, brouillons, dates, image), les pages publiques (liste +
entrée), le sitemap, le flux RSS, les liens `/go/…`, la section d'accueil `latest`, le sujet `core.entry` et quatre actions MCP
(`list_entries`, `get_entry`, `create_draft`, `update_draft`). Les listes publiques sont **paginées** (voir « Pagination du contenu » ci-dessous). Un module « galerie », « FAQ » ou « événements » peut n'être qu'un `module.json`.

### Pagination du contenu

- **Page publique d'une collection** : 12 entrées par page (50 pour une liste de liens en pastilles), adresse `?page=N` (jamais `/page/N`, qui entrerait en conflit avec une entrée dont l'adresse serait « page »). Sous 12 entrées rien ne change : aucune navigation n'apparaît. `?page=1` et toute valeur invalide (`0`, `abc`, `-2`, `2.5`, répétée) renvoient vers l'adresse sans paramètre ; une page au-delà de la dernière répond 404. Chaque page a sa propre adresse `canonical`, son titre (« … (page 2) ») et ses liens `rel=prev` / `rel=next` ; les langues alternatives (`hreflang`) ne sont déclarées que sur la première page. Une liste = une langue (même repli de langue qu'avant).
- **Tri** : par date ou à la main, la pagination est faite par la base (un `count`, puis `skip/take` sur les entrées non expirées, puis sur les expirées, qui passent à la fin) ; le tri par titre se fait en mémoire, borné à 5 000 entrées (au-delà, la liste retombe sur « plus récent d'abord » et l'administration l'indique).
- **Administration** (`/admin/entries?c=<clé>&page=N&q=…&state=all|published|draft|scheduled|expired`) : 50 par page, recherche (100 caractères au plus) dans le titre et l'adresse de chaque traduction. SQLite ne distingue pas la casse que pour A–Z : la recherche essaie donc aussi la saisie en minuscules, en majuscules et avec majuscule initiale ; les accents restent significatifs.
- **Flux RSS** : les 50 dernières entrées de chaque instance (triées par date par la base, quel que soit le tri de l'instance), fusionnées, puis les 50 plus récentes.
- **Plan du site** : une seule page `sitemap.xml`, tant qu'il y a au plus 50 000 adresses. Au-delà, il garde les pages fixes puis les entrées les plus récentes, une erreur est écrite une seule fois dans le journal et la page *Visibilité dans les réponses des IA* affiche un bandeau. Pas de plan en plusieurs fichiers dans cette version.

### Première installation (`onboarding`)

Le cœur ne connaît aucun module par son nom. L'assistant de première installation a une étape facultative « Voulez-vous ajouter des modules ? » (qu'on peut
passer sans aucun risque) : elle propose les modules que le **Catalogue suggère**. Cette suggestion n'est **pas** un champ du manifeste (n'importe quel
auteur pourrait se l'attribuer) : c'est une liste, `catalogue/suggested.json`, tenue par le dépôt de modules `curiosa-extras` ; seul un module du catalogue avec la
version et inscrit dans cette liste est proposé (et marqué « suggéré » dans le Catalogue). Les modules qui exigent un autre module ne sont pas proposés
là : ils s'ajoutent depuis le Catalogue. `onboarding` règle ce qui se passe quand l'utilisateur coche le module :

| Clé | Rôle |
|---|---|
| `home` | `{ section, count? }` : section placée sur l'accueil à la création (`count` = nombre d'entrées pour `latest`). |
| `sample` | `{ title, summary?, body? }` : entrée d'exemple créée pour que le site ne soit pas vide. |
| `collectsLinks` | L'assistant demande à l'utilisateur ses liens (Twitch, YouTube…) et les range dans ce module. |

## Le code `index.mjs`

```js
export default {
  slots:    { "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }] },
  sections: { note: (ctx, options) => [{ type: "markdown", text: ctx.setting("homeText") }] },
  page:     (ctx, { segments }) => ({ title: "…", blocks: [/* … */] }),     // page publique sur le chemin de l'instance
  overlay:  (ctx, { query }) => ({ html, css, script }),                    // modules de type overlay
  exports:  { "mon.sujet": (ctx, query) => [/* éléments au format du sujet */] },
  routes:   { send: async (request, ctx) => Response.json({ ok: true }) },  // /m/<clé de l'instance>/send
  filters:  { entryBody: (body, ctx) => body.replaceAll(":wave:", "👋") },
  adminPanel:   async (ctx, { query }) => [{ type: "heading", text: "…" }],
  adminActions: { save: async (ctx, values) => ({ ok: "Enregistré." }) },
  entryPanels:  { "ma-section": { render: async (ctx, entry) => [/* blocs */], actions: { save: async (ctx, entry, values) => ({ ok: "Enregistré." }) } } },
  mcp:      { my_action: async (ctx, args, actor) => ({ done: true }) },
  migrations: { 2: async (ctx) => { /* données v1 → v2 */ } },
  backup:   { readable: async (ctx) => [{ path: "data.csv", content: "…" }] },
  services: { "contact.store": { add: async (ctx, args) => ({ id: "…" }) } },
  tasks:    { sync: { everyMinutes: 15, run: async (ctx) => { /* travail de fond */ } } },
  hooks:    { onInstanceCreate: async (ctx) => {}, onInstanceDelete: async (ctx) => {} },
};
```

Toutes les clés sont facultatives. Une fonction qui lève une exception est journalisée et **n'affecte jamais le reste du site** :
un slot en échec disparaît, une section en échec donne `[]`, une page en échec donne une 404, une route en échec répond 500.

| Clé | Appelée quand | Reçoit | Doit renvoyer |
|---|---|---|---|
| `slots.<emplacement>` | on rend l'emplacement, pour chaque instance active | `SlotContext` | blocs, `null` ou `undefined` |
| `sections.<id>` | on rend un placement d'accueil | `ctx`, `options` du placement | blocs, `null` ou `undefined` |
| `adminBadge` | le cœur construit le menu de l'admin | `ctx` | un nombre : éléments qui attendent l'équipe (pastille sur le lien du menu et carte « À traiter » du tableau de bord) ; 0 = rien |
| `news` | le cœur construit le menu du site | `ctx` (avec `ctx.visit.lastVisit`) | `true` s'il y a du nouveau pour ce visiteur (pastille sur le lien du menu) |
| `page` | on visite le chemin de l'instance | `ctx`, `{ segments }` | `PageResult` ou `null` |
| `overlay` | on visite `/overlays/<clé>` | `ctx`, `{ query }` (`URLSearchParams`) | `OverlayResult` |
| `exports.<sujet>` | un consommateur (ou le cœur) collecte | `ctx`, `{ locale, limit, tags }` | liste d'objets au format du sujet |
| `routes.<nom>` | requête GET ou POST sur `/m/<clé>/<nom>` | `Request`, `ctx` | `Response` |
| `filters.entryBody` | on rend le corps d'une entrée | `body` (markdown), `SlotContext` | le corps transformé (texte) |
| `adminPanel` | on ouvre la page d'admin de l'instance | `ctx`, `{ query }` | blocs |
| `adminActions.<nom>` | un bloc `adminForm` ou un bouton de ligne | `ctx`, `values` (texte) | `{ ok?, error?, redirect? }` (`grid?` pour une `generateAction` de `gridEditor`) |
| `entryPanels.<id>.render` | on ouvre l'éditeur d'une entrée d'un module visé (déclaré dans `entryPanels` du manifeste) | `ctx` (de CETTE instance), `entry` (`EntryPanelTarget`), `{ advanced, role }` (mode avancé de la personne ; son rôle `owner`, `admin` ou `editor`) | blocs ; `[]` masque la section |
| `entryPanels.<id>.actions.<nom>` | un bloc `adminForm` ou un bouton de ligne de la section | `ctx`, `entry`, `values` (texte) | `{ ok?, error? }` (`redirect` est ignoré) |
| `mcp.<action>` | un assistant appelle l'action | `ctx`, `args` validés, `actor` | une valeur JSON |
| `migrations.<N>` | après une mise à jour du module ou une restauration, pour chaque instance dont les données sont en retard | `ctx` | rien (lever une erreur annule tout) |
| `backup.readable` | on exporte une sauvegarde | `ctx` | liste de `{ path, content }` |
| `services.<service>.<méthode>` | un module qui `requires` ce service l'appelle | `ctx` (celui du fournisseur), `args` | une valeur (objet JSON de préférence) |
| `tasks.<nom>` | toutes les `everyMinutes` minutes, pour chaque instance active (jamais deux fois en même temps) | `ctx` | rien (une erreur est mémorisée, rien d'autre ne s'arrête) |
| `hooks.onInstanceCreate` / `hooks.onInstanceDelete` | cycle de vie d'une instance | `ctx` | rien |

### `slots` : emplacements

| Emplacement | Où | Notes |
|---|---|---|
| `layout.head` | `<head>` de chaque page | uniquement des blocs `head` |
| `layout.banner` | tout en haut, avant l'en-tête | typiquement un bloc `banner` |
| `layout.footer` | pied de page | |
| `nav.items` | menu du site | un bloc `links` |
| `page.top` / `page.bottom` | autour de la page d'une instance (liste ou page de module) | `ctx.page` = l'instance dont on affiche la page — pas forcément la vôtre |
| `entry.top` / `entry.bottom` | autour d'une entrée | `ctx.page` et `ctx.entry` (`{ id, title, slug }`) |

Plusieurs modules peuvent contribuer au même emplacement : les blocs sont mis bout à bout.

### `sections` : morceaux d'accueil

`sections.<id>(ctx, options)` : `options` = les options du placement (valeurs saisies par l'administrateur, **à convertir et borner** :
`Math.min(10, Math.max(1, Number(options.count) || 3))`). Voir « Sections d'accueil » pour la taille.

### `page` : page publique

Montée sur le chemin (`basePath`) de l'instance. `segments` = ce qui suit ce chemin, en minuscules et décodé : `/guestbook/page/2`
→ `["page", "2"]`. Il n'y a pas de paramètres de requête (`?x=y`) : faites passer ce que vous voulez par le chemin. `PageResult` :

| Clé | Rôle |
|---|---|
| `title` | Titre de la page (affiché en `<h1>` et dans l'onglet) |
| `description` | Description (méta) |
| `blocks` | Contenu |
| `notFound` | `true` : affiche la page d'erreur 404 (ou renvoyer `null`) |
| `scripts` | (cœur 0.2.6) Scripts de **cette page seulement** : 3 noms de fichiers au plus du dossier `scripts/` du module (`["faq.js"]`), 32 Ko chacun. Voir ci-dessous. |

Les slots `page.top` et `page.bottom` entourent le contenu. Une instance n'a de page que si son chemin public est défini
(`ctx.instance.basePath` n'est pas `null` ; `""` = racine du site).

#### Un script pour une seule page (`scripts`, cœur 0.2.6)

Avant, un script ne pouvait être chargé que par le slot `layout.head`, donc sur **toutes** les pages du site. Pour un petit script de confort qui ne sert qu'à la page du module :

```js
// scripts/faq.js dans le dossier du module
async page(ctx) { return { title: "FAQ", blocks: [...], scripts: ["faq.js"] }; }
```

- **Fichiers du module** : le nom désigne `scripts/<nom>` dans le dossier du module (minuscules, chiffres, `.` `-` `_`, fini par `.js`). Pas de script en ligne, pas d'adresse extérieure. Un nom invalide, un fichier absent, plus gros que 32 Ko ou qui est un lien symbolique est **ignoré** (la page s'affiche sans lui).
- **Servi par le cœur** : `<script src="/m/<clé>/page-script/<nom>?v=<empreinte>" defer integrity="sha256-…">` placé en bas de la page, **uniquement sur cette page** (pas sur les pages d'erreur ni sur les autres). Même origine : compatible avec une politique `script-src 'self'` sans `'unsafe-inline'`, aucun nonce à gérer. Le chemin `page-script` est réservé dans `/m/<clé>/` (une route de module de ce nom ne serait pas atteinte).
- **Cache** : l'adresse porte l'empreinte du contenu ; servi `immutable` seulement si cette empreinte est la bonne, `no-cache` sinon. Un fichier modifié change d'adresse.
- **Limites** : 3 scripts par page, 32 Ko chacun, 64 fichiers gardés en mémoire (puis le plus ancien est oublié).
- **Kit de test** : l'exigence `page.scripts` (conseil) ; déclarez `minCore` : `0.2.6` (un cœur plus ancien ignore la clé : la page s'afficherait sans son script).
- Le script s'exécute avant que la page soit « réveillée » : travaillez sur des éléments de votre contenu, jamais sur les attributs de `<html>` ou `<body>` (ils sont remis à zéro).
- Ce n'est pas une porte ouverte : le script s'exécute dans la page avec les droits du visiteur, comme tout script. Écrivez-le défensivement (rien d'`eval`, rien de personnel).

### `overlay` : source navigateur OBS

Voir « Overlay (type `overlay`) ». `OverlayResult` : `html`, `css?`, `script?`, `title?`.

### `exports` : fournir un sujet

`exports["mon.sujet"](ctx, { locale, limit, tags, from?, to? })`, pour chaque instance fournisseuse. Le sujet doit être déclaré dans `provides`.
`from` / `to` n'existent que si le consommateur a demandé une période (voir « sujets » › Période) : ce sont des `Date`, que vous pouvez utiliser pour ne renvoyer que ce qui tombe dans la période, ou ignorer.
Le cœur ne garde que les champs du schéma du consommateur et écarte les éléments invalides ; voir « sujets ».

### `routes` : endpoints HTTP

`routes.<nom>(request, ctx)` est servie sur `/m/<clé de l'instance>/<nom>` pour **GET et POST** (un nom peut contenir `/`).
`?lang=fr` choisit la langue du contexte. Le cœur refuse les écritures venues d'un autre site (en-tête `Origin` différent de l'hôte : 403) :
vous n'avez pas à gérer le CSRF, mais **vous restez responsable de la validation des données, de l'anti-abus (limiteur de débit, piège à
robots) et de la méthode** (répondre 405 aux méthodes que vous n'attendez pas). Le bloc `form` poste en `fetch` en `multipart/form-data`,
ajoute un champ piège `website` et ne lit que le code HTTP de la réponse (2xx = succès affiche `successText`, autre = message d'erreur générique).

### `filters` : transformer le corps des entrées

`filters.entryBody(body, ctx)` reçoit le markdown d'une entrée avant son rendu et renvoie le texte transformé (ex. des shortcodes). Les
filtres de toutes les instances actives s'appliquent en chaîne. `ctx.entry` indique l'entrée.

### `adminPanel`, `adminActions` : administration

Le panneau s'affiche dans l'onglet **Utiliser** de la page de l'instance, ouvert en premier (voir « Onglets de la page d'admin »). `query.tab` contient l'onglet
demandé dans l'adresse : ignorez-le. Voir « Panneau d'admin riche ». Deux formes pour une action :

- **fonction** `(ctx, values) => …` : réservée aux administrateurs (comportement d'avant la 0.2.0, inchangé) ;
- **objet** `{ right: "phone.edit", run: (ctx, values) => … }` (cœur 0.2.0) : le cœur vérifie `<module>:open` et `<module>:phone.edit` pour la personne
  connectée (relue en base à chaque requête) **avant** d'appeler `run`. Une personne d'un rôle personnalisé qui a ces deux droits peut l'exécuter ;
  le droit d'un autre module (`"autre:x"`) est toujours refusé. Le module ne fait jamais lui-même le contrôle d'accès, mais il peut adapter ce qu'il
  montre avec `ctx.can`.
- Le kit de test (`def.loads`, `def.matches`, sonde d'exécution) reconnaît les deux formes partout : un formulaire ou un bouton `adminForm` qui vise une action `{ right, run }` est valide, et la sonde exécute son `run`. Déclarez le droit dans `rights` de module.json pour qu'un rôle personnalisé puisse le recevoir.

### `adminDownloads` : un fichier à télécharger depuis l'administration

(Cœur 0.2.0, `minCore` 0.2.0 : un cœur plus ancien ignore la clé et le bloc `download`.) Un export (fiches, journal…) contient souvent des **données personnelles** : il ne passe
**jamais** par `routes` (les routes `/m/…` sont publiques et ne connaissent aucune personne connectée). Il se déclare dans `adminDownloads`, et c'est le cœur qui le sert :

```js
export default {
  adminDownloads: {
    contacts: {
      right: "contacts.export",              // droit déclaré dans `rights` de module.json ; absent = administrateurs
      contentType: "text/csv",               // ou "application/json", "text/plain"
      filename: (ctx, params) => "contacts", // le cœur nettoie le nom et ajoute .csv
      async *generate(ctx, params) {         // générateur asynchrone : du texte, morceau par morceau
        yield "nom,courriel\n";
        let cursor = null;
        do {
          const page = await ctx.api.store.page("contacts", { limit: 1000, cursor });
          for (const r of page.items) yield `${cell(r.data.name)},${cell(r.data.email)}\n`;
          cursor = page.next;
        } while (cursor);
      },
    },
  },
  async adminPanel() {
    return [{ type: "download", name: "contacts", label: "Télécharger les contacts (CSV)" }];
  },
};
```

- **Bloc** `{ type: "download", name, label, params? }` (panneau d'admin seulement) : un petit formulaire POST. Le bouton n'est montré qu'aux personnes qui ont le droit de télécharger (même décision que la route) ; les autres ne le voient pas. `params` (20 valeurs de 1 000 caractères au plus) revient dans `generate(ctx, params)` ; il vient du navigateur, **validez-le** comme toute entrée.
- **Qui peut** : `<module>:open` ET `right` (préfixe imposé par le cœur ; le droit d'un autre module est refusé) ; sans `right`, les administrateurs. La personne est relue en base à chaque requête. `ctx.can` y est vrai comme dans `adminActions`.
- **Jamais construit en entier** : lisez le stockage par `store.page` (1 000 lignes) et faites des `yield` ligne par ligne. Le cœur tire le générateur à la demande du navigateur.
- **Limites du cœur** : 512 Mo et 10 minutes au plus ; un générateur qui reste muet 60 s est coupé ; 2 téléchargements en même temps par personne (4 pour tout le site, puis « réessayez » avec un message clair) ; si le navigateur coupe, le générateur est fermé (`finally` exécuté). Un flux coupé arrive **en erreur** (le navigateur affiche « échec », jamais un fichier tronqué qui aurait l'air complet).
- **En-têtes** : `Content-Disposition: attachment` (nom assaini : pas de chemin, de guillemet ni de retour à la ligne, extension toujours celle du type), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, CSP `sandbox`. Pas de GET : un lien ne déclenche jamais un export.
- **Audit** : `module.<clé>.download.<nom>` au début, `module.<clé>.download.<nom>.end` à la fin avec le nombre d'octets et la cause (`done`, `client`, `bytes`, `time`, `idle`, `error`).
- **Tableurs** : une cellule texte qui commence par `=`, `+`, `-` ou `@` est lue comme une formule par un tableur ; préfixez-la d'une apostrophe (le kit ne le vérifie pas encore).
- **Kit de test** : l'exigence `downloads.bounded` (conseil) vérifie que le générateur finit, produit du texte et que le droit est déclaré.

### Champ fichier (`kind: "file"`) dans un `adminForm`

(Cœur 0.2.0.) `{ name: "list", label: "Fichier CSV", kind: "file", accept: ".csv,.txt", maxBytes: 1048576, required: true }`. Le formulaire est envoyé à une **route dédiée du cœur**
(`POST /api/admin/modules/<instance>/action/<action>`) et non à une action serveur : celles de Next sont plafonnées à 1 Mo, et le cœur ne relève pas cette limite pour tout le site.

- **Mêmes gardes que les `adminActions`** (même site, connecté, `<module>:open` + droit de l'action), vérifiées **avant** de lire le fichier.
- **Taille** : 5 Mo au plus par fichier (`maxBytes` ne peut que l'abaisser), 2 fichiers par envoi. La lecture est comptée et coupée : un envoi énorme n'est jamais lu en entier. Message : « Fichier trop gros (5 Mo au plus) ».
- **Type** : du texte seulement (`.csv`, `.tsv`, `.txt`, `.json`, `.vcf`, `.ics`, `.md`, ou un type MIME `text/*`) ; `accept` restreint encore. Pas d'octet nul, **UTF-8 strict** (un octet invalide est refusé, jamais remplacé), BOM retiré. Pas de fichier binaire en v2.
- **Ce que reçoit le module** : le contenu en **texte** dans `values[name]` (jusqu'à 5 Mo ; `""` si aucun fichier n'a été choisi), avec les autres champs. Le nom du fichier envoyé n'est pas transmis.
- **Pas dans l'éditeur d'entrée** (`entryPanels`) : le champ y est écarté.
- Un cœur plus ancien rend un simple champ fichier mais l'envoie à une action serveur qui ignore les fichiers : `values[name]` reste vide. D'où `minCore` 0.2.0.

La page d'administration d'un module s'ouvre avec `<module>:open`. Une personne qui n'est pas administratrice n'y voit que le panneau du module
(`adminPanel`) : ni réglages, ni retrait.

### `mcp` : actions pour les assistants

Voir « API MCP ». Les clés de `mcp` doivent être déclarées dans le manifeste : une action déclarée mais non implémentée (ou l'inverse) n'est pas exposée.

### Réinstaller un module (maintenance)

Quand un module se comporte comme une ancienne version alors que son numéro est à jour (le cœur compare le **numéro** d'une ligne `bundled` d'un ancien site, et l'empreinte git d'un module installé depuis un dépôt), le propriétaire ouvre *Modules › le module › Maintenance* (en mode simple : « Problème avec ce module ? Réinstaller »). La section montre la version, la **source** (dépôt `adresse#référence` ; « source inconnue » pour une ligne `bundled` d'un ancien site que le catalogue ne liste plus) et l'**empreinte du code installé** (7 caractères d'une empreinte SHA-256 du contenu du dossier). Le bouton « Comparer avec la source » fait un téléchargement explicite du dépôt pour dire si le code installé est **identique ou différent**.

« Réinstaller ce module » remet le **code** à neuf depuis la source : la référence que suit la mise à jour (celle du catalogue s'il en vient, sinon la sienne), même à numéro et à empreinte identiques. Une ligne `bundled` (ancien site) est **convertie** en module du catalogue si le catalogue est joignable et la liste ; sinon erreur claire (« Le catalogue n'est pas joignable, réessayez »), jamais de copie locale (voir « Un module installé et le catalogue »). Un module installé à la main n'a pas de source : refus. La réinstallation **conserve tout le reste** : instances, réglages, données, état activé/désactivé, rangement et épinglage, placements d'accueil, droits MCP. Elle remet la version de la **source actuelle** du module.

Garde-fous : refus si le module est inconnu, si une mise à jour du site est en cours, si le manifeste porte un autre `id`, un `main` absent, plus de 10 Mo ou un `minCore` plus récent que le cœur, et si la source demande de **nouvelles permissions** (jamais accordées en silence : passer par « Mettre à jour »). L'ancien dossier est mis de côté pendant l'échange (`.previous-<pid>`) et revient tel quel au moindre échec. Si la `dataVersion` change, les migrations de données sont rejouées comme après une mise à jour. Action de journal : `module.reinstall` (identifiant, versions et empreintes, jamais d'adresse ni de réglage). Idempotente : sur un code déjà identique, « Code identique : rien n'a changé ».

**Cache d'imports.** Node garde en mémoire un `import()` déjà fait pour une même adresse. Le cœur importe le fichier principal avec `?v=<commit ou version>` ; la réinstallation y ajoute un **compteur de rechargement** (`.r<n>`), si bien que le nouveau code du fichier principal sert tout de suite. Limite : les fichiers que ce fichier importe en chemin relatif (`./lib.mjs`) ne portent pas ce paramètre ; s'ils ont changé, le bilan demande de **redémarrer le site**.

### `migrations` : faire évoluer ses données

Votre stockage (`ctx.api.store`) est du JSON libre : quand une nouvelle version de votre module change la **forme** de ses données (champ renommé, champ ajouté,
collection coupée en deux), **c'est à vous de les convertir** — le cœur ne peut pas deviner. Vous déclarez :

```json
"dataVersion": 3
```
```js
export default {
  migrations: {
    // N = la version vers laquelle on va : migrations[2] fait passer de la v1 à la v2.
    2: async (ctx) => { for (const r of await ctx.api.store.list("notes")) { const { name, ...rest } = r.data; await ctx.api.store.update(r.id, { ...rest, author: name }); } },
    3: async (ctx) => { /* … */ },
  },
};
```

Le cœur retient la version des données **de chaque instance** (absente = 1) et, après une **mise à jour du module** ou une **restauration de sauvegarde**, exécute pour
chaque instance en retard les migrations manquantes, **dans l'ordre** (si l'utilisateur a sauté des versions, le cœur rejoue chaque étiquette intermédiaire `vX.Y.Z` avec son propre code, l'une après l'autre, puis installe la dernière ; s'il y a un échec il s'arrête sur la version fautive) (une version sans fonction avance simplement le numéro). Une instance **créée** après coup
naît directement à la version courante. Garanties :

- une **copie de la base** est gardée avant (`data/backups/pre-migration-*.db`), sauf si une copie de lot (`pre-bulk-update`, prise avant une mise à jour groupée) date de moins d'une heure ;
- si une migration **lève une erreur**, l'instance est **remise exactement dans son état d'avant** (stockage et réglages, rien à moitié converti), **mise à l'écart** (elle ne
  tourne pas) et l'admin affiche l'erreur avec un bouton « Réessayer » ; les autres instances ne sont pas touchées. Publiez une version corrigée : la mise à jour relance la migration ;
- des données **plus récentes** que votre code (sauvegarde restaurée dans un module plus ancien) sont aussi mises à l'écart, jamais modifiées.

#### Semer une instance d'un autre module (`seeds`, `ctx.seedInstance`, `ctx.clearSetting`)

Cas typique : votre module gardait lui-même une adresse (un calendrier iCal) et, dans la nouvelle version, c'est un autre module dont vous dépendez qui s'en charge. Votre migration peut **créer UNE instance de ce
module, une seule fois, avec des réglages initiaux** (secrets compris), puis **effacer vos propres réglages**. Un module ne peut toujours ni lire ni écrire les réglages ou les instances d'un autre : le cœur fait le travail,
dans des limites qu'il contrôle.

```jsonc
// module.json : déclaration explicite (l'administrateur la voit), + le lien avec la cible : un service dont vous dépendez...
"requires": [{ "service": "calendar.source" }],
"seeds": [{ "module": "calendar-provider", "reason": { "fr": "Reprendre votre adresse iCal", "en": "Carry over your iCal address" } }],
"dataVersion": 2
```
```js
migrations: {
  2: async (ctx) => {
    const url = ctx.setting("icalUrl");
    if (!url) return;
    const { created, instanceKey } = await ctx.seedInstance("calendar-provider", {
      nickname: "Agenda iCal",              // surnom d'admin (rendu unique : « Agenda iCal 2 »…)
      names: { fr: "Agenda", en: "Calendar" }, // facultatif ; sinon le surnom
      settings: { url, token: ctx.setting("icalToken") },   // validés par le manifeste du module cible, comme dans l'admin
      seedKey: "ical-url",                  // identifiant stable de cette graine
    });
    await ctx.clearSetting("icalUrl");      // seulement après le semis
    await ctx.clearSetting("icalToken");
  },
}
```

- **`ctx.seedInstance(cible, { nickname, names?, settings, seedKey })`** n'existe que **pendant une migration de données** (`undefined` ailleurs). Renvoie `{ created, instanceKey }`. Le module `cible` doit figurer dans votre `seeds`,
- **Deux liens possibles, au choix de l'auteur.** *Dépendance* (`requires`) : votre module ne marche pas sans la cible, le cœur la garde en place et la marque « installée automatiquement ». *Lien souple* (`consumes`, sans `requires`) : votre module marche sans la cible (il lit un sujet que n'importe quel module peut fournir) ; la migration l'installe quand même pour reprendre l'ancien réglage, mais elle n'est **pas** marquée « installée automatiquement » (aucun nettoyage ne la proposera : elle porte désormais l'adresse). Exemple : un planning qui affiche les streams de n'importe quel agenda (`"consumes": [{ "topic": "planning.slot" }]`, `"seeds": [{ "module": "calendar-ical" }]`).
  **et** offrir un service que vous `requires` (version comprise) : on ne sème que chez un fournisseur dont on dépend. Sinon : erreur, la migration échoue.
- **Les réglages** (`settings`) sont validés par le manifeste du **module cible**, avec les **mêmes règles que le formulaire d'admin** (type du champ : adresse `http(s)`, nombre, choix dans `options`, couleur…) ; une clé inconnue ou une valeur invalide
  refuse tout, **sans que la valeur apparaisse dans l'erreur** (ce peut être un secret). Un réglage traduisible accepte un texte (toutes les langues du site) ou `{ langue: texte }`. Un texte vide n'enregistre rien. Les secrets sont stockés comme ceux de l'admin.
- **Une seule fois par `seedKey`** (`a-z0-9._-`, commence par une lettre, 41 caractères au plus) et par instance du module semeur : une graine déjà semée renvoie `{ created: false, instanceKey }`, **même si l'instance a été supprimée depuis** ;
  la marque est dans les réglages de l'instance semeuse (hors de portée du module, sauvegardée avec elle). Vous pouvez donc appeler `seedInstance` à chaque passage sans risque de doublon.
- **Jamais d'écrasement** : le semis crée toujours une **nouvelle** instance (clé libre dérivée du surnom) ; les instances existantes du module cible ne sont ni lues ni modifiées. Un module cible en `"instances": "single"` qui a déjà une instance : refus.
- **Active d'office** : un module installé est actif, donc l'instance semée l'est aussi. Le module cible n'est pas encore installé : voir la séquence ci-dessous.
- **`ctx.clearSetting(clé)`** (migration seulement) efface l'un de **vos** réglages d'instance (déclaré dans votre `settings`, toutes langues). Il est **refusé tant qu'aucun `seedInstance` n'a abouti** dans cette migration
  (`created: false` compte : la graine est confirmée). Si la migration échoue plus tard, le réglage revient.
- **Tout ou rien** : si une étape lève une erreur, la migration échoue comme d'habitude (vos réglages et votre stockage reviennent comme avant, l'instance est mise à l'écart, « Réessayer »), **et** tout ce que le semis avait créé est défait
  (instance, marque, module cible installé pour l'occasion). L'audit `module.seed` (module semeur, module cible, clé de l'instance créée : jamais de valeur) et les crochets `onInstanceCreate` de la cible ne passent qu'**une fois la migration réussie**.
- **Module cible absent.** La migration d'une mise à jour s'exécute **avant** la résolution des dépendances de cette mise à jour. Pour qu'une graine ne laisse pas une instance vide à côté de l'instance semée, le cœur, au premier `seedInstance` :
  (1) vérifie que le catalogue annonce un module compatible qui offre le service ; (2) l'installe **sans créer d'instance par défaut** ; (3) vérifie dans son manifeste réel qu'il offre bien le service ; (4) installe ses
  propres dépendances ; (5) crée l'instance semée ; (6) à la réussite, marque le module cible « installé automatiquement » pour vous (comme une cascade de dépendances) ; en cas
  d'échec, le retire avec ses fichiers. La résolution des dépendances qui suit la migration trouve alors le service déjà fourni et ne crée rien de plus. Cible introuvable (ni installée ni au catalogue, ou catalogue injoignable) : la migration échoue,
  « Réessayer » plus tard.
- Pour tester un module : `fakeCtx({ migration: true, settings: {...} })` ajoute `ctx.seedInstance` et `ctx.clearSetting` factices (appels enregistrés dans `ctx.calls.seeds` et `ctx.calls.cleared`, résultat réglable par `seedResult`).

#### Réglages hérités et plancher (`legacySettings`, `ctx.legacy`, `dataFloor`) — cœur 0.2.0

Quand un réglage change de propriétaire (par exemple un identifiant d'API repris par un module « connecteur »), ne le laissez pas dans `settings` avec un libellé « (ancien réglage) » :
déplacez sa clé dans `legacySettings`. Le cœur ne l'affiche plus nulle part (ni en mode avancé), mais la valeur reste lisible par **votre** module :

```js
const secret = await ctx.legacy?.get("clientSecret");   // null si vide ou absent ; ctx.legacy absent sur un cœur plus ancien
if (secret) {
  const r = await ctx.api.services.call("x.api", "adopt", { clientSecret: secret });
  if (r.ok && r.value.ready) await ctx.legacy.clear("clientSecret");   // effacer APRÈS la confirmation
}
```

- `ctx.legacy.keys()` liste vos clés déclarées ; `get(clé)` rend une chaîne, un nombre, un booléen ou `null` ; `clear(clé)` efface la valeur (toutes langues) et laisse une ligne d'audit `module.legacy.clear` (la clé, jamais la valeur). Une clé non déclarée lève une erreur (code `undeclared`).
- Disponible dans tous les contextes serveur de l'instance (migration, tâche, panneau d'admin, service). Une valeur `secret` ne sort jamais de la mémoire : ni journal, ni message d'erreur, ni réponse de service, ni bloc.
- Au démarrage, le cœur efface seul les valeurs **vides** de ces réglages (et des réglages que plus rien ne déclare) ; une valeur remplie n'est jamais effacée par le cœur. La page *Entretien* compte celles qui restent.
- `dataFloor` : si votre migration v3 suppose des données déjà en v2, déclarez `"dataFloor": 2`. Une instance en v1 n'est alors **pas** étiquetée « à jour » (le cœur saute sinon en silence les versions sans migration) : elle est mise de côté (`error: "floor"`) avec un message clair. Ne **baissez jamais** `dataVersion` d'une version à l'autre : les instances déjà converties seraient mises de côté (« plus récentes que le module »).
- Un test du cœur (`tests/core/legacy-labels.test.mjs`, copie dans le dépôt de modules) refuse « ancien », « ancienne », « legacy », « reprise automatiquement », « anciennes versions » (et l'anglais) dans un libellé ou une aide visible, et vérifie que chaque clé de `settings` est lue par le code du module.
- Pour tester : `fakeCtx({ legacy: { clientSecret: "x" } })` ajoute `ctx.legacy` (effacements notés dans `ctx.calls.legacyCleared`).

Écrivez des migrations **idempotentes** quand c'est possible (elles peuvent être rejouées après un échec) et **testez-les** sur des données réelles de l'ancienne version.
Ne supprimez jamais une migration déjà publiée : un site peut sauter plusieurs versions d'un coup.

### `backup` : sauvegarde lisible

Voir « Sauvegarde lisible sans le framework ». `backup.readable(ctx)` renvoie des fichiers `{ path, content }`.

### Dépendances entre modules : `offers` / `requires` / `services`

**Principe : pas de doublons.** Les modules sont comme des microservices à l'intérieur du backend de Curiosa. **Un module fait une chose** ; ce qui appartient à un autre module s'obtient **par service, jamais par copie** ; **une donnée n'a qu'un propriétaire**. Un module qui a besoin d'une capacité d'un autre le **déclare** dans `requires`, et **le cœur s'occupe d'installer le fournisseur** : « si on installe Partenariats, Contacts s'installe aussi », avec une instance prête à l'emploi.

On dépend d'un **service** (un nom : `contact.store`), jamais d'un module précis : n'importe quel module qui l'offre convient.

```jsonc
// module.json du FOURNISSEUR (Contacts)                          // module.json du CONSOMMATEUR (Partenariats, formulaire…)
"offers":   [{ "service": "contact.store", "version": 2 }]        "requires": [{ "service": "contact.store", "min": 2 }]
```

```js
// fournisseur : les méthodes du service                // consommateur
services: { "contact.store": {                           const r = await ctx.api.services.call("contact.store", "add", { name, email });
  add: async (ctx, args) => ({ id: await ctx.api.store.add("contacts", args) }),   // r = { ok: true, value } | { ok: false, reason }
} },
```

Exemple court : *Contacts* offre `contact.store` et possède le carnet ; *Partenariats* et le formulaire de contact le `requires`. Ni l'un ni l'autre ne recopie un champ de contact : ils appellent le service. Installer Partenariats depuis le Catalogue installe, active et prépare Contacts (une instance), puis Partenariats.

#### Versions de services (rétrocompatibles)

`offers[].version` (entier ≥ 1, **défaut 1**) : la version de l'interface offerte, à augmenter quand le service gagne une capacité. `requires[].min` (entier ≥ 1, **défaut 1**) : la plus ancienne version dont le consommateur s'accommode. Un fournisseur ne **satisfait** une exigence que si sa version est ≥ `min` (ce que fait aussi `ctx.api.services.call` : il ignore les fournisseurs trop anciens). Un manifeste sans version reste valide (version 1 partout). Si seul un fournisseur trop ancien est disponible, l'installation ou l'activation est refusée avec un message dédié : *« Il faut Contacts en version 2 (vous avez la 1) : mettez le module à jour »* ; mettre à jour le fournisseur lève le blocage. Les modules sont versionnés indépendamment du cœur : changez la `version` du service quand vous ajoutez une méthode dont dépendent des consommateurs, pas à chaque correctif.

#### Ce que fait le cœur

- **Un fournisseur est « présent »** quand une **instance** d'un module installé l'offre, en version suffisante. Un module installé sans instance, ou une instance dont les données sont à l'écart, ne compte pas : le service est alors `unavailable`.
- **Résolution avant l'installation** (Catalogue, dépôt personnel, activation d'un module installé) : pour chaque service qui manque, le cœur cherche un fournisseur — (1) un module **déjà installé** qui l'offre (par identifiant ; ses données gardées, s'il en a, reviennent à la place d'une instance neuve) ; (2) le **premier module non installé du catalogue** qui l'offre (dans l'ordre de l'index). Il l'**installe et crée son instance par défaut** (`single` : une ; `multiple` : une, sans surnom — la première n'en a pas besoin), après avoir fait de même pour **ses propres besoins** (profondeur 3 au plus ; un cycle est refusé). Le consommateur vient ensuite. Jamais un dépôt personnel n'est choisi comme fournisseur.
- **Rien à moitié** : si un maillon échoue (clone impossible, dépôt qui ne sert pas le module annoncé, service absent du manifeste réel, cycle, profondeur), tout ce que la cascade avait fait est **défait** (modules installés, activés, instances créées, fichiers) et le message dit **quel module** a échoué et **pourquoi**. L'index peut se tromper : c'est le manifeste réellement téléchargé qui tranche, et le candidat suivant est essayé.
- **Deux fournisseurs déjà actifs** : rien n'est choisi ni installé ; le mécanisme maître/répliques ci-dessous décide.
- **Installé automatiquement** : un module (ou une instance) apporté par la cascade est noté dans le réglage cœur `modules.auto` (`{ "<id>": { "for": ["<consommateurs>"], "module": true, "instances": ["<id d'instance>"], "at": … } }` ; sans migration de base, sauvegardé avec les réglages). La page du module dit *« Installé automatiquement pour : … »*, et quand plus aucun module **actif** n'en dépend, un **nettoyage est proposé** (page du module, et encadré dans Modules › Installés). **Jamais de suppression automatique** : le propriétaire confirme, et si le module porte des données ou des réglages saisis, l'avertissement est affiché et une case « je comprends » est exigée. « Le garder » retire la marque.
- **Mises à jour (cœur 0.2.0) : les `requires` d'abord, les migrations ensuite.** Ordre de `updateModule` : (1) la nouvelle version est récupérée et validée (cœur compris), sans rien migrer ; (2) ses fichiers remplacent les anciens ; (3) ses `requires` **durs** sont satisfaits : fournisseur du catalogue officiel installé avec son instance, ou fournisseur installé **trop ancien mis à jour** si le catalogue propose la version voulue (une mise à jour de fournisseur réussie n'est jamais défaite : elle est valide seule) ; (4) s'il manque quelque chose, **tout est défait** : le module reste dans son ancienne version, ses données intactes, et l'erreur `modules.error.requires` dit quoi (*« Il manque : … »*) ; (5) sinon seulement, les migrations de données tournent (un échec met l'instance à l'écart avec « Réessayer », les fournisseurs restent). Tout cela dans un seul journal d'annulation. **Versions sautées** : l'étape 3 est rejouée avant les migrations de **chaque** version intermédiaire, avec son manifeste ; si un besoin manque en cours de route, le module s'arrête sur la dernière version dont les données ont été migrées (jamais un code plus ancien que ses données). Exception : un besoin que la migration elle-même couvrira en **semant** une instance (`seeds`) est vérifié après elle, et seulement signalé s'il manque encore. **« Tout mettre à jour »** passe les **fournisseurs avant leurs consommateurs** (besoins lus dans l'index du catalogue, version visée ; à égalité par identifiant ; un cycle garde l'ordre d'origine) ; un module refusé n'empêche jamais les autres. Un module dont la migration appelle un service déclare `minCore: "0.2.0"` (un cœur 0.1.x migre avant d'installer les fournisseurs).
- **Besoin facultatif** (`"requires": [{ "service": "…", "optional": true }]`, cœur 0.2.0 ; un cœur plus ancien ignore la clé et le traite comme dur) : il n'empêche ni l'installation ni l'activation, n'est **jamais installé d'office**, n'apparaît jamais dans *« Il manque »* et ne retient pas son fournisseur (le désinstaller est permis : votre module doit alors dégrader proprement). L'appel reste permis s'il existe un fournisseur (sinon `unavailable`). L'aperçu d'installation l'affiche sous *« Fonctionne mieux avec… (facultatif) »*. Pour proposer l'installation au propriétaire, renvoyez un bloc `suggestInstall` (voir « Blocs »).
- **Restauration** ([BACKUP.md](BACKUP.md)) : les modules sont réinstallés dans l'ordre des dépendances (fournisseurs d'abord), puis les `requires` de chaque module actif restauré sont vérifiés ; un fournisseur absent de la sauvegarde mais disponible est installé avec son instance par défaut. Sinon le consommateur est restauré avec ses données, l'état « activé » de la sauvegarde est respecté, et l'aperçu comme le bilan disent *« il manque : … »*.
- **Désinstaller** un module que d'autres modules installés requièrent (parce que lui seul fournit le service, dans la version voulue) est refusé en nommant ces modules (leurs noms, pas leurs identifiants), ce qu'ils perdraient, et ce qu'il faut faire (*« retirez d'abord … »*).
- **Interface** : le Catalogue (liste et fiche) annonce *« Installe aussi : Contacts »* **avant** d'installer — ce qui sera installé, activé ou déjà en place ✔ — pour un module du catalogue qui déclare ses services. Le bouton **Installer** fait tout en une action. La page d'un module montre *« A besoin de »* et *« Utilisé par »* en noms lisibles (identifiants techniques et versions en mode avancé).
- `ctx.api.services.call` n'accepte que les services déclarés dans `requires` (sinon `undeclared`), prend le premier fournisseur actif de version suffisante (par clé d'instance), ne lève jamais : à vous de gérer `unavailable` (par exemple après une restauration) en dégradant proprement.
- **Choisir le fournisseur (cœur 0.2.0)** : `ctx.api.services.providers(service)` → `[{ id, key, name, module, version, each, master }]` (50 au plus, par ordre de création) : les instances que **votre** module peut appeler (service déclaré dans `requires`, version ≥ `min`). `id` est l'identifiant **stable** de l'instance, `name` son libellé lisible, `master` vaut vrai pour celle que `call` viserait sans option. Service non déclaré ou sans fournisseur : `[]`. Puis `ctx.api.services.call(service, method, args, { provider: id })` : seule cette instance répond (sans réplique, sauf si c'est le maître). Un `id` qui n'est plus dans `providers` (instance supprimée, mise à l'écart, trop ancienne, ou d'un autre service) donne `{ ok: false, reason: "unavailable" }` : dites-le à l'utilisateur (« La source choisie n'existe plus : choisissez-en une autre »). Sans `provider`, la règle reste la même : maître pour un service classique, **première instance par ordre de création** pour un service `each`. Un module qui passe `provider` déclare `minCore: "0.2.0"` (un cœur plus ancien ignorerait l'option et appellerait une autre instance) ; pour détecter `providers` : `typeof ctx.api.services.providers === "function"`.
- **Plusieurs fournisseurs du même service** (un doublon, ou un changement de fournisseur) : dès qu'un deuxième module qui offre le service est activé (ou qu'une de ses instances est créée), l'admin est invité (page *Modules* → *Services offerts par plusieurs modules*) à choisir un **maître** — il reçoit les appels et c'est sa réponse que voit l'appelant — et des **répliques**, qui reçoivent aussi les appels qui **écrivent**, au mieux (la panne d'une réplique ne fait jamais échouer l'appel ; celle du maître, si). Le fournisseur peut déclarer ses méthodes de lecture dans `offers` (`"readOnly": ["count"]`) : elles ne sont jamais répliquées. Tant que rien n'est choisi, le premier fournisseur (par clé d'instance) est le maître, sans réplique ; un choix périmé (maître retiré) retombe sur le premier. **Une réplique reçoit les appels futurs** : les données déjà reçues par l'ancien fournisseur ne sont pas copiées (aucun conflit à fusionner, mais un historique réparti : pour une bascule propre, mettez le nouveau en maître, gardez l'ancien en réplique le temps voulu, puis retirez-le).
- **Un service où chaque instance parle de SA propre chose : `each`** (voir aussi « Quand choisir quoi » ci-dessous). Deux chaînes Twitch offrent toutes deux `twitch.live` : chacune répond pour sa chaîne, il n'y a donc **aucun maître à choisir**. Le fournisseur le déclare : `"offers": [{ "service": "twitch.live", "each": true }]` (booléen facultatif, défaut `false` ; cohérent avec `version` : `{ "service": "twitch.live", "version": 2, "each": true }`). Pour un service `each` : (1) la page *Services offerts par plusieurs modules* n'en parle plus (ni « À choisir », ni pastille Maître, ni graphe) ; (2) une exigence `requires` est satisfaite dès qu'**une** instance active du service existe ; (3) `ctx.api.services.call` garde son comportement et renvoie la réponse de la **première instance active par ordre de création** (jamais un « maître », aucune réplique) ; (4) `ctx.api.services.callAll` les interroge **toutes**. Si, parmi les fournisseurs actifs, un seul ne déclare pas `each`, le service reste classique (maître/répliques) : le choix le plus prudent pour une donnée partagée.
- **`ctx.api.services.callAll(service, method, args)`** → `Promise<Array<{ instance, name?, ok: true, value } | { instance, name?, ok: false, error }>>`. Une entrée par instance **active**, dans l'ordre de création (`instance` = clé de l'instance, `name` = son surnom ou nom lisible). Mêmes règles que `call` (service déclaré dans `requires`, version suffisante, la méthode s'exécute avec le contexte de l'instance fournisseuse). Un fournisseur qui lève, ou qui n'a pas la méthode, donne `{ ok: false, error: "failed" | "no_method" }` : le message du fournisseur n'est jamais transmis (il pourrait contenir un secret, il n'est que journalisé) et les autres entrées ne sont pas touchées. Service **non-each** : **une seule** entrée, la réponse du maître (comme `call`). Service non déclaré dans `requires`, inconnu ou sans fournisseur actif : `[]`. Ne lève jamais.
- **Quand choisir quoi.** *Une donnée, un propriétaire* (un carnet de contacts : `contact.store`) → service classique, l'admin choisit un maître. *Chaque instance parle de sa propre chose* (une chaîne Twitch par instance, un compte par instance : `twitch.live`) → `each: true`, et le consommateur appelle `callAll` pour tout agréger (« en direct sur chaîne A et sur chaîne B ») au lieu de n'en voir qu'une. Dans le doute : si deux instances répondent des choses **différentes et toutes vraies**, c'est `each`.
- Le `ctx` reçu par la méthode est celui de l'instance **fournisseur** : elle écrit dans **son** stockage, jamais dans celui de l'appelant.
- **Appeler un service avec les droits de la personne connectée : `asCaller` (cœur 0.2.4, `minCore: "0.2.4"` pour compter dessus).** Par défaut, un service appelé par un autre module n'a aucun droit (`ctx.can` y est toujours faux). Pour une écriture qui doit rester réservée à une personne précise (par exemple « créer une catégorie »), le **fournisseur** (propriétaire de la donnée) liste la méthode dans son manifeste, `"offers": [{ "service": "contact.book", "callerRights": ["createCategory"] }]` (dix noms au plus ; un cœur plus ancien ignore la clé), puis vérifie lui-même son droit avec `ctx.can("categories.create")` comme pour le `create` d'un `choice`. Le **consommateur** le demande à chaque appel : `ctx.api.services.call("contact.book", "createCategory", { label }, { asCaller: true })`. Le fournisseur reçoit alors `ctx.can` pour **la personne qui vient de cliquer**, et seulement si les quatre conditions sont réunies : (1) l'appel est fait dans une `adminAction` (ou l'action d'un champ fichier) déclenchée par cette personne ; (2) `{ asCaller: true }` est passé ; (3) la méthode est listée dans `callerRights` du fournisseur ; (4) la personne a le droit **du fournisseur** (relu en base, le droit d'un autre module ne vaut rien ; le propriétaire du site les a tous). Dans un panneau (`adminPanel`, même ouvert par un administrateur), une route, un overlay, une tâche, un service ou le MCP, `asCaller` est ignoré : l'appel est ordinaire et le fournisseur répond « denied ». Chaque appel qui porte des droits est consigné au journal d'audit (`module.<instance>.asCaller`, cible `service.méthode`, jamais les arguments). Sur un cœur plus ancien l'option est ignorée : traitez « denied » comme « demandez à la personne de le faire dans le module propriétaire ».

#### Dire ses services dans l'index du catalogue

Pour qu'un module d'un dépôt reconnu puisse être choisi comme fournisseur (ou annonce ses besoins) **avant d'être téléchargé**, son entrée de `catalogue/index.json` peut porter, en plus de ses champs habituels, deux listes facultatives : `"offers": ["contact.store"]` et `"requires": ["contact.store"]` — chaque élément est un nom de service, ou un objet `{ "service": "contact.store", "version": 2 }` (offres ; `"each": true` possible, voir plus haut : `{ "service": "twitch.live", "each": true }`) / `{ "service": "contact.store", "min": 2 }` (besoins). Valeurs validées (noms de services, entiers ≥ 1, 10 au plus, doublons écartés) ; un cœur plus ancien ignore ces clés. À ne pas confondre avec `"requires": { "core": "0.1.10" }` (version minimale du cœur, un objet) : le cœur distingue les deux par la forme. Un besoin peut porter `"optional": true` (`{ "service": "contact.store", "optional": true }`) : il faut le recopier dans l'index (le script qui génère l'index du dépôt de modules doit le transporter), sans quoi un cœur 0.2.0 le prendrait pour un besoin dur. Ces listes ne servent qu'à **choisir et annoncer** ; à l'installation c'est le `module.json` réel qui fait foi. Un module dont l'entrée n'annonce rien n'a rien à ajouter : son manifeste est lu à l'installation.

#### Vérifier le principe dans un dépôt de modules

`tests/helpers/builtinChecks.mjs` fournit `findSrpViolations(manifests, opts)` (fonction pure) et `assertNoSrpViolations`. Règles exactes : (1) **service** — un même `offers[].service` dans plusieurs modules est une violation, sauf s'il est listé dans `opts.substitutes` (substitution voulue, gérée par maître/répliques) ; (2) **mcp** — deux modules déclarent une action MCP du même nom (sauf `opts.mcp`) ; (3) **secret** — la même clé de réglage de `type: "secret"` dans deux modules qui ne sont **pas** fournisseur/consommateur l'un de l'autre (sauf `opts.secrets`). Elle ne juge que les manifestes qu'on lui passe.

### `adminBadge` : ce qui attend l'équipe

`adminBadge: async (ctx) => (await ctx.api.store.list("messages", { limit: 500 })).filter((m) => !m.data.read).length` fait apparaître ce nombre dans une pastille sur le lien de l'instance dans le menu de l'admin, et la liste sur le tableau de bord (« À traiter »). Rendez-la rapide (elle s'exécute à chaque page d'admin) ; une erreur n'affiche simplement pas de pastille. Le cœur ajoute lui-même une pastille « Mises à jour » pour le propriétaire quand une version est disponible.

### `news` : y a-t-il du nouveau depuis la dernière visite ?

Le cœur retient, dans le navigateur du visiteur, la date de son passage précédent (deux cookies qui ne contiennent que des dates) et affiche une **pastille** sur le lien du menu des instances où il y a du nouveau. Sans `news`, la règle du cœur s'applique : des entrées **publiées** (ni brouillon ni expirées) depuis cette date. Un module qui compte autre chose (un message, un résultat…) fournit sa propre règle :

```js
news: async (ctx) => (await ctx.api.store.get("lastPostAt") ?? 0) > ctx.visit.lastVisit.getTime(),
```

`ctx.visit.lastVisit` vaut le 1er janvier 1970 pour un visiteur inconnu ; le cœur n'affiche alors aucune pastille (il n'a rien « manqué »). La date est figée pour toute la durée d'une visite : la pastille ne disparaît pas dès la deuxième page ouverte. Une erreur dans `news` n'affiche simplement pas de pastille.

### `tasks` : travail en arrière-plan

Pour surveiller un service externe, publier à l'heure, envoyer une annonce : déclarez des tâches, le cœur les exécute (pas de cron à installer).

```js
tasks: {
  // nom en minuscules/chiffres/tirets ; everyMinutes ≥ 1
  announce: { everyMinutes: 5, run: async (ctx) => { /* ctx.api.store, ctx.api.mail, ctx.api.topics… comme partout */ } },
},
```

Le cœur passe **une fois par minute** : une tâche jamais exécutée l'est au premier passage, puis pas avant `everyMinutes` minutes. Elle ne tourne que pour les instances **actives**, **jamais deux fois en même temps** (une tâche encore en cours est
ignorée au passage suivant), est interrompue du point de vue du suivi après 5 minutes, et son dernier résultat (date, durée, erreur) est mémorisé et affiché sur la page de l'instance dans l'admin. Une tâche qui plante n'arrête ni les autres ni
le serveur. Rendez-la **idempotente** : le serveur peut redémarrer ou manquer un passage. Retenez ce que vous avez déjà traité dans `ctx.api.store` plutôt que de supposer.

### `hooks` : cycle de vie

- `hooks.onInstanceDelete(ctx)` : appelé **avant** la suppression d'une instance, pour nettoyer ce que seul le module connaît (mémoire,
  service externe). Le cœur supprime ensuite lui-même les réglages et le stockage de l'instance. Une erreur est journalisée et la
  suppression continue.
- `hooks.onInstanceCreate(ctx)` : appelé une fois l'instance créée (depuis l'admin ou l'assistant de première installation), quand son
  stockage est utilisable. Une erreur du module est journalisée, jamais bloquante. Restez **idempotent** : l'instance peut aussi naître d'une
  restauration de sauvegarde, qui ne rappelle pas ce crochet — initialisez aussi paresseusement, au premier usage.

## Le contexte `ctx`

Chaque fonction du module reçoit un `ctx` (`ModuleContext`) ; les slots reçoivent un `SlotContext`, qui y ajoute `ctx.page` et `ctx.entry`.

| Membre | Contenu |
|---|---|
| `ctx.moduleId` | identifiant du module (celui du manifeste) |
| `ctx.instance` | `{ id, key, basePath, name }` de l'instance courante (`name` = nom public dans la langue courante ; `basePath` : `null` = pas de page, `""` = racine) |
| `ctx.locale` | langue du visiteur (ou de l'admin, dans le panneau d'admin) |
| `ctx.defaultLocale` | langue par défaut du site |
| `ctx.locales` | toutes les langues du site |
| `ctx.setting("clé")` | réglage de l'instance pour la langue courante, avec sa valeur par défaut (voir « Réglages ») |
| `ctx.t("clé", { vars })` | texte de `locales/<langue>.json` du module, `{variable}` remplacée. Repli : langue par défaut, puis `en`, puis les textes du cœur, puis la clé elle-même. |
| `ctx.theme` | thème du site : `{ accent, accentFg, bg, surface, fg, muted, line, success, successFg, warning, warningFg, danger, dangerFg, accent2, accent2Fg, gradient, font, fontKey }` (couleurs `#RRGGBB`, sauf `gradient`, un dégradé CSS ; `font` = pile CSS, `fontKey` = `sans`, `serif` ou `mono`) |
| `ctx.visit` | `{ lastVisit: Date }` : le passage précédent du visiteur (cookie tenu par le cœur, rien de personnel) ; **1er janvier 1970** s'il est inconnu |
| `ctx.page` | (slots `page.*` et `entry.*`) `{ key, basePath }` de l'instance dont on affiche la page |
| `ctx.entry` | (slots `entry.*`) `{ id, title, slug }` de l'entrée affichée |
| `ctx.api` | tout ce que le cœur met à disposition (ci-dessous) |
| `ctx.legacy` | (cœur 0.2.0) réglages hérités de **cette** instance déclarés dans `legacySettings` : `keys()`, `get(clé)`, `clear(clé)` (voir « Réglages hérités et plancher »). Absent sur un cœur plus ancien. |
| `ctx.can("droit")` | (cœur 0.2.0) la personne qui regarde l'administration a-t-elle ce droit du module (identifiant **local**, voir « Droits (`rights`) ») ? Vrai seulement dans `adminPanel`, `adminActions` et `entryPanels` ; **toujours faux** ailleurs (page publique, route, overlay, tâche, service, MCP). Absent sur un cœur plus ancien : traitez l'absence comme un refus. |

| `ctx.can("droit")` | (cœur 0.2.0) la personne qui regarde l'administration a-t-elle ce droit du module (identifiant **local**, voir « Droits (`rights`) ») ? Vrai seulement dans `adminPanel`, `adminActions`, `entryPanels`, le `create` d'un réglage `choice` (appelé pour la personne connectée) et une méthode de service listée dans `offers[].callerRights` appelée avec `{ asCaller: true }` depuis une `adminAction` (cœur 0.2.4) ; **toujours faux** ailleurs (page publique, route, overlay, tâche, service, MCP). Absent sur un cœur plus ancien : traitez l'absence comme un refus. |
| `ctx.resolveChoice("clé")` | (cœur 0.2.0) résout un réglage `choice` : `{ status: "chosen" \| "only", id, label }`, `{ status: "missing", id?, label? }`, ou `none` / `ambiguous` / `unverified`. Borné à 3 s, ne lève jamais, n'écrit rien. Voir « Réglage `choice` ». |

### `ctx.api`

Deux familles : les **services** du cœur (génériques, voir [PLATFORM.md](PLATFORM.md)) et la **lecture du site** (lecture seule).

| Appel | Famille | Rôle |
|---|---|---|
| `ctx.api.services.call(service, méthode, args, { provider? })` / `.available(service)` | dépendance | Appelle un service offert par un autre module (déclaré dans `requires`) ; renvoie `{ ok: true, value }` ou `{ ok: false, reason }` (`undeclared`, `unavailable`, `no_method`, `failed`), ne lève jamais. `provider` (cœur 0.2.0) : l'`id` d'une instance de `providers(service)`. |
| `ctx.api.services.providers(service)` | dépendance | (cœur 0.2.0) Les fournisseurs que ce module peut appeler : `[{ id, key, name, module, version, each, master }]`, par ordre de création, 50 au plus ; `[]` si le service n'est pas déclaré. |
| `ctx.api.qr(texte)` | service | QR code en SVG (fond transparent) pour un texte ou une URL |
| `ctx.api.png({ width, height, tree })` | service | Image PNG (une `Response`) à partir d'une arborescence de boîtes `{ type: "div"\|"span"\|"p"\|"b"\|"img", props: { style, children, src } }` (flexbox, styles en ligne, 16 à 2000 px). Une `img` n'accepte qu'un chemin du site ou une adresse https publique. Exemple : l'image de la semaine du module *planning* (`/m/<clé>/image`). |
| `ctx.api.store.add(collection, data, { key? })` | service | ajoute un document JSON, renvoie son `id` ; `key` : clé facultative (200 caractères au plus, non unique) pour le retrouver sans parcourir la collection |
| `ctx.api.store.get(id)` | service | `{ id, createdAt, data, key }` ou `null` (aussi `null` pour un document d'une autre instance) |
| `ctx.api.store.update(id, data, { key? })` | service | **remplace** le document ; renvoie `false` s'il n'existe pas. `key` absente = inchangée, `key: null` l'efface. Pour modifier un champ, relisez, fusionnez, réécrivez. |
| `ctx.api.store.list(collection, { limit? })` | service | les plus récents d'abord ; 100 par défaut, **10 000 au plus** (au-delà : `page`) |
| `ctx.api.store.page(collection, { limit?, cursor?, order?, key? })` | service | `{ items, next }` : lecture par pages (100 par défaut, **1 000 au plus**), `order` `"desc"` (défaut) ou `"asc"`. Passez `next` comme `cursor` à l'appel suivant ; `next` vaut `null` à la dernière page. Le curseur est opaque ; un curseur illisible donne une page vide. |
| `ctx.api.store.getByKey(collection, key)` | service | l'enregistrement le plus ancien portant cette clé, ou `null` (index : pas de parcours de la collection) |
| `ctx.api.store.listByKey(collection, key, { limit?, cursor? })` | service | la liste paginée (`{ items, next }`, comme `page`) de ceux qui portent cette clé, du plus récent au plus ancien |
| `ctx.api.store.addMany(collection, [{ data, key? }])` | service | jusqu'à 5 000 lignes d'un coup (tranches de 500, **une transaction** : tout ou rien) ; renvoie les `id` dans l'ordre |
| `ctx.api.store.generation()` | service | entier propre à l'instance, **augmenté par le cœur** quand ses données sont remplacées de l'extérieur (restauration d'une sauvegarde, annulation d'une migration, reprise de données gardées). Vos propres écritures ne le changent pas. Comparez-le à la valeur notée quand vous avez construit un index en mémoire : s'il a changé, reconstruisez. |
| `ctx.api.store.remove(id)` | service | supprime (sans erreur si absent) |
| `ctx.api.store.count(collection)` | service | nombre de documents |
| `ctx.api.topics.collect(sujet, { limit? })` | service | éléments des sources auxquelles l'instance est abonnée (le sujet doit figurer dans `consumes`, sinon erreur) |
| `ctx.api.topics.collectPage(sujet, { limit?, cursor? })` | service | comme `collect`, page par page : `{ items, next }` (200 au plus par page ; `cursor` = le `next` précédent, opaque ; `next: null` = fini). Seul `core.entry` est lu par curseur (du plus récent au plus ancien, expirées écartées) ; un sujet fourni par un module n'a qu'une page. Curseur illisible : erreur. |
| `ctx.api.mail.configured()` | service | un serveur d'e-mail est-il réglé ? |
| `ctx.api.mail.send({ to, subject, text, replyTo? })` | service | e-mail au nom du site (permission `mail`, voir « Envoyer un e-mail ») |
| `ctx.api.rawg.configured()` | service | une clé RAWG est-elle réglée par le propriétaire ? (permission `rawg` ; `false` sans elle) |
| `ctx.api.rawg.cover(title)` | service | jaquette d'un jeu : `{ status, url, name?, id?, ambiguous? }` avec `status` = `found` (`url` en https), `none` (aucun résultat, ou « aucune jaquette » choisi par la propriétaire), `no-key` (pas de clé), `refused` (RAWG refuse la clé), `unreachable` (RAWG injoignable) ; `name`, `id` et `ambiguous` sont **facultatifs** (cœur 0.2.10) ; permission `rawg`, voir « Jaquettes de jeux (RAWG) » |
| `ctx.api.rawg.candidates(title)` | service | cœur 0.2.10 : les jeux que RAWG propose pour ce titre, `{ status, candidates: [{ id, name, year, platforms, url }] }` (6 au plus, jaquette obligatoire) ; même permission `rawg`, mêmes statuts, ne lève jamais |
| `ctx.api.net.request({ url, method?, headers?, body?, timeoutMs?, maxBytes?, dedupe?, retry?, priority?, bucket? })` | service | appel réseau **neutre et borné** vers une API externe (https seulement, aucune permission) : `{ ok: true, status, headers, json?, text?, shared }` ou `{ ok: false, error, status?, retryAt? }` ; ne lève jamais. Voir « Appeler une API externe : `ctx.api.net` » |
| `ctx.api.net.health()` | service | état des hôtes contactés depuis le démarrage : `[{ host, state: "ok" \| "slow" \| "rate" \| "quota" \| "down", since, retryAt? }]` |
| `ctx.api.net.budgetMs()` | service | temps restant (ms) de la page publique en cours, ou `null` hors page publique |
| `ctx.api.site(locale?)` | lecture | `{ name, tagline, logo }` du site |
| `ctx.api.brand(locale?)` | lecture | identité visuelle complète (`ModuleBrand`, ci-dessous) |
| `ctx.api.instances.list({ module?, locale? })` | lecture | `[{ id, key, module, basePath, name, adminPath }]` des instances actives ; `adminPath` (`/admin/instances/<id>`) est la page de réglages de l'instance : de quoi y renvoyer l'administrateur par un lien (`href`) |
| `ctx.api.entries.list({ instance?, locale?, limit? })` | lecture | entrées publiées (`EntrySummary`) ; par défaut celles de l'instance courante ; **200 au plus** (sans `limit`, ou au-delà : 200), dans l'ordre de la liste publique (non expirées d'abord, puis expirées) ; pour tout lire, passez par `ctx.api.topics.collectPage` |
| `ctx.api.siteUrl` | lecture | adresse publique du site, sans `/` final |
| `ctx.api.visitor.fingerprint(request, scope?)` | service | (cœur 0.2.6, aucune permission) une **empreinte** de 22 caractères du visiteur de la requête (celle d'une `route`, ou ses `Headers`), pour une limite de débit : `const who = ctx.api.visitor.fingerprint(request, "envoi")`. **À utiliser à la place de la lecture de `X-Forwarded-For`**, dont le début est écrit par le visiteur (un robot change d'adresse inventée à chaque envoi et passe sous la limite). Le cœur prend l'entrée ajoutée par SON proxy (règle de [SECURITE.md](SECURITE.md#derrière-un-reverse-proxy) ; IPv6 par réseau /64) et rend un HMAC avec un sel au hasard, gardé en mémoire, renouvelé chaque jour, propre à votre module et à `scope` : non réversible, jamais l'adresse. Le cœur ne garde rien par visiteur ; bornez vos propres compteurs (par exemple 5 000 empreintes, les plus anciennes oubliées) et ne gardez que l'empreinte. Sans proxy devant le site, tous les visiteurs ont la même empreinte. Le kit signale (conseil `routes.visitorIp`) la lecture directe de ces en-têtes. |
| `ctx.api.privacy.declarations()` | lecture | (cœur 0.2.6, permission `privacy` ; sans elle : rien) les déclarations `privacy` des modules **actifs** : `{ modules: [{ module, name, instances: [{ key, name }], declares, text: { langue: texte } }], truncated }`. Un élément par module (100 au plus, triés par identifiant ; `truncated` si davantage ; 10 instances par module). `declares` : vrai si le module déclare quelque chose ; `text` : sa déclaration par langue (un texte simple vaut pour la langue par défaut ; 500 caractères et 20 langues au plus). Texte et noms seulement : jamais un réglage, un secret ni une donnée. Pour qu'un module « Mentions légales » reprenne la liste au lieu de la recopier à la main. |
| `ctx.api.seo.jsonLd(données)` | service | prépare des données structurées (JSON-LD) pour le slot `layout.head` : renvoie la balise `{ tag: "script", jsonLd }` à mettre dans un bloc `head`, ou `null` si la donnée est inutilisable (pas de `@type`, trop volumineuse). Le cœur ajoute `@context`, borne la taille (texte 5 000 caractères, 100 éléments par liste, 8 niveaux, 20 000 caractères au total) et échappe `</script>`. Voir « Données structurées » dans [CREATE-A-MODULE.md](CREATE-A-MODULE.md). |

**Stockage** : privé à l'instance (une instance ne voit jamais celui d'une autre), en collections libres de documents JSON, sans
requête (filtrez en code, d'où le `limit`). Il est sauvegardé par le cœur (JSON) et supprimé avec l'instance ou la désinstallation du module.

`ModuleBrand` : `name`, `tagline`, `about`, `logo` (le visuel principal : l'icône, sinon le logo horizontal), `logos` (`[{ kind: "wide" | "square" | "wideDark" | "squareDark", src }]` : le jeu complet), `contactEmail`, `colors` (`[{ key, name, hex, role }]`), `font` (`{ key, name, stack }`),
`defaultLocale`, `locales`. Lecture seule : un module qui *montre* l'identité (kit presse) la lit au lieu de la copier.

`EntrySummary` : `id`, `title`, `cover`, `icon`, `tags`, `fields` (valeurs des champs personnalisés ; les champs `ref` contiennent
l'identifiant référencé), `slug`, `summary`, `url`, `code`, `path` (chemin public), `publishedAt`.

## Blocs

Un module renvoie des **blocs déclaratifs** ; le cœur se charge du rendu, des thèmes et des langues. Le module ne manipule jamais React.

| `type` | Champs |
|---|---|
| `markdown` | `text` — **sans HTML brut** (les liens et images Markdown fonctionnent : ne mettez pas de texte de visiteur ici) |
| `html` | `html` — **brut**, sous la responsabilité du module : échappez tout ce qui vient d'un visiteur |
| `heading` | `text` |
| `swatches` | `items: [{ name, hex, role? }]` — pastilles de couleur avec code copiable |
| `netHealth` | `items: [{ host, label, lastGoodAt? }]` — **panneau d'admin seulement** : santé des services externes appelés par `ctx.api.net`, une phrase simple par service écrite par le cœur en FR/EN (« répond normalement », « répond lentement depuis 10:42 ; les données affichées datent de 10:30 », « trop de demandes, pause jusqu'à 11:00 », « quota du jour épuisé, reprise à 09:00 », « ne répond pas ») et, en cas de souci, « Un service externe ne répond pas : le site affiche les dernières données connues ». `label` : nom lisible du service (le cœur n'en connaît aucun) ; `lastGoodAt` : date ISO des données affichées |
| `downloads` | `items: [{ src, label, detail? }]` — images à télécharger, avec aperçu |
| `copy` | `text`, `label?` — texte à copier d'un clic |
| `hero` | `title`, `text?`, `image?`, `eyebrow?`, `button?` (`label`, `href`), `video?` (fichier envoyé sur le site), `videoPoster?`, `videoSound?` |
| `panel` | `kind` (`media`, `tabs`, `stats`, `cta`, `video`), `eyebrow?`, `title?`, `text?` (Markdown), `button?` (`label`, `href`), `images?` (jusqu'à 3), `imageSide?`, `tone?` (`plain`, `surface`, `accent`), `bg?` (`src`, `size`, `position`, `veil`), `items?` (`title`, `heading?`, `text?`, `image?`), `video?` — un morceau de page d'accueil ; fonction du cœur, créée dans Page d'accueil → Ajouter un bloc (voir `core/homeBlocks.ts`) ; un module peut aussi renvoyer ce bloc depuis une section |
| `banner` | `text`, `href?`, `tone?` (`info` · `success` · `warning`) |
| `links` | `items: [{ label, href, icon? }]` — les adresses non sûres deviennent `#` |
| `entries` | `instance` (clé), `limit?`, `title?`, `link?`, `pick?` (`"random"`) — entrées d'une instance, rendues par le cœur |
| `embed` | `src` (https uniquement), `title`, `ratio?` |
| `form` | `action` (`<clé d'instance>/<route>`), `fields: [{ name, label, kind?, required? }]` (`kind` : `text`, `email`, `textarea`), `submitLabel`, `successText` |
| `table` | `columns`, `rows` (tableaux de texte), `rowIds?`, `rowActions?` (admin seulement, voir plus bas) |
| `adminForm` | `action`, `fields`, `submitLabel`, `title?`, `cancelHref?` — panneau d'admin uniquement |
| `gridEditor` | éditeur de **grille** (panneau d'admin uniquement) : `action`, `width`, `height`, `cells` (un caractère par case, ligne après ligne), `palette` (`[{ value, label, color }]`, une `value` = un caractère), `submitLabel`, `title?`, `minSize?`, `maxSize?`, `cancelHref?`, `labels?` (`width`, `height`, `fillAll`, `border`, `reset`, `hint`, `generateError`), et, en option, `generateAction` + `generateLabel` (bouton « générer ») et `autoLabel` + `autoNotice` + `autoActive?` (mode « automatique »). L'utilisateur choisit un pinceau et peint à la souris ou au doigt, redimensionne, et enregistre : l'action reçoit `width`, `height` et `cells` en texte (à valider !). Les options sont décrites sous le tableau. Exemple : le tracé du module *maze-overlay*. |
| `head` | `tags`: `meta` / `link` / `script` (uniquement dans `layout.head`) |
| `suggestInstall` | `service`, `min?`, `reason` — **panneau d'admin uniquement** (cœur 0.2.0 ; ignoré ailleurs et par un cœur plus ancien). « Il vous manque un module qui `reason` » : le cœur cherche lui-même dans le catalogue les modules qui offrent `service` (version ≥ `min`) — officiels d'abord, puis ceux de l'index supplémentaire avec l'avertissement « non vérifié par le catalogue officiel » et une case à cocher. Le **propriétaire** voit la liste (nom, description), un bouton *Installer* (le module et son instance) et *Ne plus proposer* ; les autres lisent *« Demandez au propriétaire du site d'installer un module qui … »*. Rien n'est affiché si un fournisseur actif existe, ou si le propriétaire a dit *Ne plus proposer* (mémorisé par instance et par service, jusqu'à *Afficher de nouveau les suggestions* sur la page de l'instance). Le catalogue est lu 2 s au plus ; au-delà, « Catalogue injoignable, réessayez plus tard ». Rien n'est jamais installé sans ce clic : `ctx.api` n'offre aucune installation (ni service, ni tâche, ni migration, ni MCP). `reason` : une fin de phrase en mots simples, dans la langue du panneau (« affiche vos prochains lives »). Audit : `module.install.suggested`. |

**`gridEditor` : génération et mode automatique (optionnels, un module qui ne les passe pas se comporte comme avant).** Aucun de ces boutons n'enregistre quoi que ce soit : tout reste dans l'éditeur jusqu'à « Enregistrer » (la barre flottante d'enregistrement et l'avertissement en quittant la page s'appliquent), et « Annuler les modifications » revient exactement à l'état chargé (grille et mode).

- `generateAction` (nom d'une `adminAction`) + `generateLabel` : le bouton appelle cette action (réservée aux administrateurs, comme toute `adminAction`, `values` vide). Elle **renvoie** un tracé sans le persister : `{ grid: { width, height, cells } }` (ou `{ error }`). Le cœur n'enregistre rien et charge le résultat dans l'éditeur ; il refuse une réponse invalide (largeur/hauteur non entières ou hors de `minSize`–`maxSize`, `cells` de longueur différente de `width × height`, caractère absent de la `palette`) et affiche `labels.generateError`.
- `autoLabel` (+ `autoNotice`, `autoActive`) : bouton qui met l'éditeur en mode « automatique » : la grille est atténuée et `autoNotice` s'affiche. Enregistrer envoie alors à `action` `auto` = `"true"` **à la place** de `width`, `height` et `cells` ; l'action décide de ce que cela veut dire (supprimer son tracé, par exemple). Retoucher la grille, la redimensionner ou générer sort du mode. `autoActive: true` : l'éditeur démarre dans ce mode (la grille passée dans `width`/`height`/`cells` sert alors de support si on le quitte).

Une valeur de cellule de `table`, un `text` de `heading`, de `banner`… sont du **texte** : le cœur les échappe. Seul `html` est brut.

Balises de `head` : `{ tag: "meta", name?, property?, content }`, `{ tag: "link", rel, href, type?, title? }`, `{ tag: "script", src?, inline?, defer?, jsonLd? }`. `jsonLd` (un objet, obtenu par `ctx.api.seo.jsonLd`) : le cœur écrit une balise `application/ld+json` sûre ; `src` et `inline` restent du code exécuté, à éviter.

Champs d'un `adminForm` (`AdminField`) : `{ name, label, kind?, value?, required?, help?, options? }`. `kind` : `text`, `textarea`, `email`,
`url`, `number`, `date`, `select` (avec `options: [{ value, label }]`), `hidden`, `image` (téléversement), `checkbox` (case à cocher : cochée si `value` vaut `on`, `1` ou `true` ; une fois envoyée, le module reçoit `values[name] === "on"`, et rien du tout si elle est décochée).

## Échanger des informations entre modules : les sujets

Un overlay « labyrinthe » affiche des affiches tirées d'articles, un overlay « sponsors » affiche
les offres de partenaires… sans que le module d'overlay connaisse le blog ou les codes promo. Le
principe : **le consommateur déclare ce qu'il sait digérer, les fournisseurs exposent des
informations dans ce format.**

**Convention de nommage : les identifiants de sujets et de rubriques sont en anglais**, en minuscules, `domaine.objet` pour
un sujet (`sponsor.card`, `planning.slot`, `feed.item`) et un mot ou des mots reliés par des tirets pour une rubrique
(`announcement`, `behind-the-scenes`). C'est le standard de notre propre code et de nos exemples, pour que des modules écrits
par des personnes différentes se retrouvent sur les mêmes noms ; rien ne l'impose (un module peut publier sur `annonce`),
mais deux modules ne partagent un sujet ou une rubrique que s'ils s'écrivent pareil. Les **libellés** montrés aux humains,
eux, sont traduits comme le reste.

Sujets connus (tous fournis par des modules du catalogue, ou par le cœur) :

| Sujet | Fourni par | Rôle |
|---|---|---|
| `core.entry` | le cœur | entrées publiées de toute instance à contenu |
| `feed.item` | tout module | éléments proposés au flux RSS (voir plus bas) |
| `social.link` | tout module « réseau social » | le bouton d'un réseau (`label`, `url`, `icon`) que le cœur affiche dans l'en-tête (voir « Réseaux sociaux ») |
| `overlay.item` | tout module | éléments simples (titre, texte, image, lien) pour les overlays |
| `guestbook.message` | `guestbook` (exemple) | message validé d'un livre d'or (`id`, `name`, `text`, `publishedAt`) |
| `sponsor.card` | `sponsors` | carte de sponsor (nom, code, logo, lien) |
| `partnership.partner` | `partnerships` | fiche de partenaire (nom, logo) |
| `planning.slot` | tout module « agenda de streams » | un stream (`id`, `title`, `start`, `end?`, `allDay?`, `day?`, `games?`, `status?`, `timezone?`) consommé par `planning` et par le bot Twitch ; reçoit une période `from` / `to` |
| `calendar.event` | tout module « calendrier » (réservé) | un évènement d'agenda quelconque (`id`, `title`, `start`, `end?`, `allDay?`, `description?`, `location?`, `url?`, `status?`, `category?`, `color?`, `sourceLabel?`), pour les lecteurs qui ne parlent pas de streams ; reçoit une période `from` / `to`. Les streams, eux, passent par `planning.slot` |
| `social.stat` | tout module « réseau social » | les chiffres d'un compte (`id`, `metric` : `followers` / `paying` / `content` / `views`, `value`, `asOf`, `error?`) collectés par `community-stats` |
| `maze.poster` | tout module (`youtube-channel`, `twitch-channel`…) | affiche pour le labyrinthe |
| `stream.live` | `twitch-channel` | live en cours (`id`, `title`, `url`, `startedAt`, `game`) ; vide hors ligne |
| `ha.result` | `home-assistant` | ce qui est arrivé à un ordre confié à Home Assistant (`ref`, `id`, `status` : `done` / `failed` / `ignored` / `expired` / `refused`, `code`, `at`) ; consommé par le bot Twitch et Actions du live YouTube pour valider, rembourser ou afficher l'issue |
| `ha.state` | `home-assistant` | l'état du pont avec Home Assistant, un seul élément (`enabled`, `live`, `paired`, `lastSeenAt?`) ; consommé par le bot Twitch pour mettre ses récompenses en pause ou les réactiver |
| `live.event` | `youtube-live-actions` | les dons et adhésions vus dans le chat d'un direct, en mémoire seulement (15 minutes, 50 au plus) : `id`, `platform`, `kind` (`superchat`, `supersticker`, `member`, `gift`), `who`, `at`, et selon le cas `amount` (toujours avec `currency`), `count`, `text` ; consommé par l'Overlay alertes (OBS) pour les afficher à l'écran |
| `map.place` | `events`, `directory` (tout module qui a des lieux) | un lieu pour la carte (`id`, `title`, `lat`, `lng`, `kind`, `url?`, `at?`, `note?`) ; consommé par `map`, qui reçoit 200 éléments au plus. `lat` entre -90 et 90, `lng` entre -180 et 180, jamais le point (0, 0), 5 décimales suffisent ; `kind` (`event`, `member`…) peut rejoindre un type de la carte ; `at` : date ISO d'un évènement. **Jamais d'adresse personnelle sans consentement** : un lieu public ou la ville arrondie d'une personne qui a dit oui, rien par défaut. La carte montre les données telles que reçues et n'écrit jamais chez la source |
| `mascot.hint` | tout module qui a une nouveauté à annoncer (le jeu du jour…) | une phrase que la mascotte peut dire (`id`, `text`, `url?`) ; consommé par `mascot`, 10 au plus. `id` change quand l'état change (« à jouer », « déjà joué »), pour que la mascotte ne répète pas ; `text` court (140 caractères), sans balise ; `url` d'une page du site. Un module qui n'a rien à dire ne publie rien |

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
  (champs inconnus supprimés, éléments invalides écartés) et ajoute sa provenance (`source` : `{ instance, module, name }`).
  Un fournisseur qui plante est ignoré. Un fournisseur n'est interrogé que si son manifeste déclare `provides` **et** que son code définit `exports.<sujet>`.
- **Abonnements dans l'admin** : sur la page d'une instance consommatrice, section « Sources de
  données » : on coche quelles instances fournisseuses l'alimentent (tout coché = toutes, y compris
  celles ajoutées plus tard) et, si le consommateur a déclaré `"tags": true`, on filtre par étiquette (`tags` est alors transmis à `exports`).
- **`core.entry`** est fourni d'office par toute instance à contenu (sauf si l'option « Proposer ses
  entrées aux autres modules » est décochée) : titre, résumé, chemin, lien, image, icône, code,
  étiquettes, date. Un blog, une liste de codes promo ou de liens alimentent donc n'importe quel
  consommateur **sans écrire une ligne de code**. Les entrées ont des **étiquettes** (`tags`) pour
  que le consommateur ne prenne que ce qui l'intéresse (« sponsor », « mur »…).
- **Pull à la consommation** : rien n'est copié ni synchronisé ; le consommateur lit l'état courant
  à chaque appel. Un overlay rafraîchit ses données depuis sa propre route (`routes.items`), ce qui
  garde le cœur sans état. Un push (SSE) pourra s'ajouter plus tard sans changer ce contrat.
- Formats de champs : `string`, `url` (http(s) ou chemin `/…`), `number`, `boolean`, `string[]`, `any` (réservé aux sujets du cœur, refusé dans un manifeste : la valeur passe telle quelle, le cœur la vérifie et l'ignore si elle ne convient pas), `datetime` (chaîne ISO 8601 : `2026-10-14`, `2026-10-14T20:30`, `2026-10-14T20:30:00Z` ou avec décalage `+02:00` ;
  la date et l'heure doivent exister — le 30 février est refusé ; sans décalage, l'heure est lue en UTC). Un élément dont un champ est invalide est **écarté seul** : les autres éléments du même
  fournisseur, et les autres fournisseurs, sont servis. Un élément qui n'est pas un objet (`null`, texte…) est écarté de même ; un fournisseur qui ne renvoie pas un tableau ne donne rien.
  Les types d'avant sont inchangés : un manifeste qui n'emploie pas `datetime` marche aussi sur un ancien cœur (un module qui l'emploie doit déclarer `minCore`).
  Choisissez un identifiant de sujet préfixé par votre domaine (`monmodule.truc`) ; `core.*` est réservé.
- `limit` : 50 par défaut, 200 au plus.

#### Période : `from` / `to`

Un consommateur dont les éléments ont une date (un calendrier, des évènements) peut demander une **période** :

```js
const events = await ctx.api.topics.collect("calendar.event", { from: "2026-10-12", to: new Date("2026-10-19T00:00:00Z"), limit: 100 });
```

- `from` et `to` sont **facultatifs** et indépendants (`from` seul : à partir de cet instant). Acceptés : un objet `Date` ou une chaîne ISO 8601 (mêmes formes que `datetime`), entre 1970 et 2100.
- Le cœur **valide** : `from` ne peut pas être après `to`, et la période ne dépasse pas **400 jours**. Une période invalide **lève une erreur** chez le module qui appelle `collect` (c'est un bogue du consommateur,
  pas une donnée à ignorer) ; rien n'est collecté.
- Les fournisseurs reçoivent `{ locale, limit, tags, from, to }` avec `from` / `to` en objets `Date` (les clés sont **absentes** si le consommateur n'a rien demandé). Un fournisseur qui les **ignore** continue de marcher :
  ses éléments sont servis tels quels, c'est au consommateur de filtrer ce qu'il ne veut pas. Un fournisseur qui les utilise doit rester borné (`limit` s'applique toujours).
- Le cœur ne filtre pas lui-même les éléments par date : le champ qui porte la date (`start`…) n'a pas de sens pour lui.
- Exemple de schéma d'un évènement de calendrier : `id`, `title` (`string`), `start`, `end?` (`datetime`), `allDay?` (`boolean`), `description?`, `location?`, `status?`, `color?`, `sourceLabel?` (`string`), `url?` (`url`).
- Pour tester : `fakeCtx({ topics: { "calendar.event": (opts) => [...] } })` appelle la fonction avec `{ limit, from, to }` tels que le module les a passés, et lève comme le vrai cœur si la période est invalide.

Pour qu'un module tiers alimente un consommateur existant, il lui suffit de déclarer
`provides: [{ "topic": "…" }]` et d'implémenter `exports` — sans rien savoir du consommateur.

### Références entre modules

Un champ personnalisé d'un module à contenu peut être une **référence** vers un élément d'un autre module :
dans `content.fieldSchema`, `{ "key": "partner", "label": "Partenaire", "type": "ref", "topic": "partnership.partner" }`
(dans l'admin : `partner | Partenaire | ref:partnership.partner`). Le module déclare le sujet dans `consumes`
(avec un schéma contenant au moins `id` et `title`), l'éditeur affiche une liste déroulante alimentée par les
fournisseurs, et la valeur stockée est l'`id`. Le module résout la référence dans son code
(`ctx.api.topics.collect(...)`) ; elle n'est jamais affichée sur le site public.

## Panneau d'admin riche : formulaires et boutons pilotés par le module

Un module dont l'administration dépasse les réglages (suivi de partenaires, modération, liste de contacts…) construit
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

- **Champs** d'un `adminForm` : `text`, `textarea`, `email`, `url`, `number`, `date`, `select` (`options`), `image`, `hidden`, `checkbox`, `file` (voir « Champ fichier »). Les blocs
  `adminForm` ne s'affichent que dans l'admin (jamais sur le site public).
- **Boutons de ligne** d'une `table` (`rowActions`, admin seulement) : `{ label, action?, href?, confirm?, danger? }`. `action` exécute une
  `adminAction` en lui envoyant `values.id` (pris dans `rowIds`, même ordre que `rows`) ; `href` navigue (`{id}` est remplacé par l'identifiant) ;
  `confirm` demande confirmation ; `danger` colore le bouton en rouge.
- **Valeurs** : `adminActions.<nom>(ctx, values)` reçoit les champs du formulaire **en texte** (20 000 caractères au plus par champ) ; **validez-les**.
- **Résultat** (`AdminActionResult`) : `ok` (message vert), `error` (bandeau rouge, pour une erreur qui ne concerne AUCUN champ), `errors` (erreurs PAR CHAMP : `{ monChamp: "Écrivez une adresse complète, par exemple https://www.monsite.be/contact." }` ; chaque message s'affiche juste sous son champ, le champ prend un contour rouge, reçoit le focus et la page défile jusqu'à lui ; l'erreur disparaît quand la personne corrige le champ ; un cœur plus ancien qui ne connaît que `error` affiche simplement le bandeau, donc ajouter `errors` est sans risque), `redirect` — par exemple `{ ok: "Enregistré." }`. `redirect: "?"` reste sur la page de l'instance
  (`"?edit=abc"` y ajoute des paramètres, lus par `adminPanel` dans `query`) ; `"/admin/…"` va ailleurs dans l'admin ; toute autre cible est ignorée.
  Une exception donne un message d'erreur générique (détail dans les journaux).
- Chaque action est consignée dans le journal d'audit (`module.<clé>.<action>`), sans son contenu.
- `ctx.locale` est la langue de l'administrateur ; `ctx.api.store` offre `add`, `get`, `update`, `list`, `page`, `getByKey`, `listByKey`, `addMany`, `generation`, `remove`, `count`.

## Ajouter une section à l'éditeur d'un autre module

Un module peut ajouter **une section de réglages à la fiche d'une entrée d'un autre module** (une commande de chat dans la fiche d'un sponsor, une publication sociale dans la fiche d'un article…).
Le principe : la donnée reste chez le module qui ajoute la section (clé = `entry.id`), et le module hôte **ne sait rien** de la section. Le cœur ne l'affiche que si le module qui la fournit est installé ET
actif (au moins une instance en marche) et que l'entrée correspond ; sans lui, la fiche reste exactement ce qu'elle était. Rien n'est jamais requis du module hôte.

Dans `module.json` (permission `admin`) :

```json
"entryPanels": [
  { "id": "chat-command",
    "for": { "topic": "sponsor.card" },
    "title": { "en": "Chat command for this partner", "fr": "Commande de chat de ce partenaire" },
    "help": { "en": "…", "fr": "…" } }
]
```

`for` désigne les entrées concernées SANS nommer de module quand c'est possible : `{ "topic": "sponsor.card" }` vise les entrées de toute instance dont le module **fournit** ce sujet (`provides`) ;
`{ "module": "sponsors" }` vise un module précis (à éviter : c'est une dépendance). Exactement l'un des deux. `title` est le titre de la section (et `help` une phrase d'aide). Si le module fournisseur a
plusieurs instances, chacune montre sa section, suivie de son nom.

Dans le code :

```js
export default {
  entryPanels: {
    "chat-command": {
      // `entry` : { id, title, slug, path, instance, published } — relu en base par le cœur, jamais envoyé par le navigateur.
      async render(ctx, entry, { advanced, role }) {   // advanced : options de technicien ; role : un « editor » n'ouvre pas les pages d'admin des modules (pas de lien vers elles) ; [] masque la section
        const saved = (await ctx.api.store.list("commands")).find((r) => r.data.entryId === entry.id)?.data;
        return [
          { type: "adminForm", action: "save", submitLabel: ctx.t("save"), fields: [
            { name: "enabled", kind: "checkbox", label: ctx.t("enable"), value: saved?.enabled ? "on" : "" },
            { name: "text", kind: "textarea", label: ctx.t("text"), value: saved?.text ?? "" },
          ] },
        ];
      },
      actions: {
        async save(ctx, entry, values) {          // `values` : texte seulement ; validez-les
          // … enregistrer sous la clé entry.id (c'est la donnée de VOTRE module) …
          return { ok: ctx.t("saved") };            // ou { error: "…quoi faire…" }
        },
      },
    },
  },
};
```

- **Blocs** : ceux du panneau d'admin (`adminForm`, `table` avec `rowActions`, `markdown`, `banner`, `heading`, `links`…), sauf `gridEditor`. Une `action` de bloc désigne une clé de `actions` **de la section**.
- **Aucun rechargement** : une action ne redirige jamais (`redirect` est ignoré). Le cœur la lance, rafraîchit la section et affiche `ok` / `error` dans la section : la position de défilement, le texte en cours de saisie
  de l'éditeur et l'état ouvert ou fermé des sections ne bougent pas. La section est un bloc repliable (ouvert d'office) avec ses propres boutons ; elle s'enregistre seule, indépendamment du bouton « Enregistrer » de la fiche.
- **Droits** : les mêmes que pour modifier l'entrée (éditeur et plus), contrairement au panneau d'admin d'une instance (administrateurs). Le cœur relit l'entrée et vérifie que la section s'applique bien à elle avant
  d'appeler votre action ; la protection contre les requêtes forgées est celle de toutes les actions d'admin. Chaque action est consignée dans le journal d'audit (`module.<clé>.entry.<id>.<action>`), sans son contenu.
- **Rien à montrer, pas de section** : si `render` renvoie `[]` (l'entrée n'est pas concernée finalement, une condition manque…), la section n'apparaît pas. **Pas de fiche, pas de section** : elle n'apparaît que sur une entrée existante (pas pendant la création). Une exception dans `render` n'affiche qu'un message d'erreur à la place de la section.
- **Orphelins** : si l'entrée est supprimée, votre donnée ne l'est pas ; nettoyez-la vous-même (une tâche `tasks` qui compare avec `ctx.api.entries.list`).
- **Test** : la vérification de conformité (`npm run module:check`) appelle `render` et les actions avec une fausse fiche (`{ id: "e0", title, slug: "demo-0", path, instance, published: true }`), y compris avec des données piégées, et contrôle que chaque bouton vise une action de la section.

## API MCP : exposer des actions aux assistants

Le cœur héberge un serveur MCP (`/api/mcp`, désactivable depuis l'admin → *Assistants IA*, qui s'intitule aussi « API & MCP » en mode avancé) **sans aucun outil codé
en dur** : il collecte les actions déclarées par tous les modules actifs. Le cœur y ajoute ses propres outils `site_info`, `redirects_…` (liens courts : voir [PLATFORM.md](PLATFORM.md)) et `maintenance_…` (maintenance du site par une IA : voir [MAINTENANCE-IA.md](MAINTENANCE-IA.md)) ; un jeton « Maintenance » n'a que ceux-là, jamais vos actions de module sans que vous les lui accordiez.

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
- **Toute instance à contenu** reçoit aussi `list_entries`, `get_entry`, `create_draft` et `update_draft`. `list_entries` rend 30 entrées par défaut, 100 au plus (`limit`), de la plus récemment créée à la plus ancienne ; l'argument `cursor` reprend après la dernière entrée lue. Tant qu'il ne reste rien après et qu'aucun `cursor` n'est passé, la réponse est le simple tableau d'avant ; sinon c'est `{ items, next }` (`next: null` sur la dernière page). Le curseur est opaque : on le renvoie tel quel.
- **Schéma des arguments** (`input`) : un objet plat. `type` doit valoir `"object"` ; `properties` : chaque propriété a un `type`
  (`string`, `number`, `integer`, `boolean`, `array`) et, selon le cas, `description`, `enum` (texte), `maxLength` (texte, 20 000 au plus),
  `minimum` / `maximum` (nombres), `items` (`{ "type": "string" }`, pour `array` : 100 textes courts au plus) ; `required` : liste des
  propriétés obligatoires. Les propriétés inconnues sont **refusées** (l'agent doit savoir que son argument n'a pas été pris en compte).
  Votre fonction reçoit des arguments conformes — mais vérifiez quand même ce qui touche vos données (un identifiant existe-t-il ?).
- Une valeur renvoyée est sérialisée en JSON pour l'agent (200 000 caractères au plus). Une erreur n'est visible de l'agent que si elle porte `expose: true` ; les
  autres sont masquées (l'agent lit seulement « The action failed. ») et journalisées.

### Qui a accès à quoi : un module implémente plus qu'il n'active

Un jeton n'a pas « tout » : l'administrateur règle, **jeton par jeton et action par action** (admin → Assistants IA →
page de l'accès, en mode avancé), ce qu'il peut faire. Les changements sont **immédiats** : le serveur relit les accès à chaque requête,
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
### Se connecter : en-tête ou adresse secrète

Le serveur parle le transport MCP « Streamable HTTP » dans sa forme la plus simple : les requêtes JSON-RPC 2.0 arrivent en **POST** sur `/api/mcp`, la réponse est un JSON (`Content-Type: application/json`), sans session (`Mcp-Session-Id` n'est jamais exigé) ni flux SSE. `initialize` négocie `protocolVersion` (2025-06-18, 2025-03-26, 2024-11-05) ; toute notification (message sans `id`, dont `notifications/initialized`) reçoit **202 sans corps** ; `ping`, `tools/list` (sans pagination), `tools/call` et les lots sont acceptés ; `GET` et `DELETE` répondent **405** avec `Allow: POST`.

Deux authentifications, au choix de chaque jeton :

| Mode | Forme | Pour qui |
|---|---|---|
| En-tête (toujours possible) | `POST {site}/api/mcp` avec `Authorization: Bearer vit_…` | Claude Code (`claude mcp add --transport http curiosa <adresse> --header "Authorization: Bearer vit_…"`), Cursor, VS Code, Windsurf, MCP Inspector, scripts |
| Adresse secrète (option **par jeton**, désactivée par défaut) | `POST {site}/api/mcp/vit_…` (segment de chemin, jamais un paramètre de requête) | claude.ai et les clients qui ne saisissent qu'une adresse |

L'option se coche à la création du jeton (*Autoriser la connexion par adresse secrète*) ou se règle ensuite sur la page du jeton ; elle est gardée dans le réglage du cœur `mcp.urlTokens` (liste d'identifiants de jeton, sans migration) et disparaît à la révocation. Le jeton en clair n'existe qu'à la création : c'est le seul écran qui affiche l'adresse complète et les consignes de branchement avec le vrai jeton ; ailleurs elles montrent `<votre-jeton>`. Un jeton inconnu, mal formé, révoqué ou non autorisé par adresse reçoit la même réponse 404. Compromis : l'adresse apparaît dans les journaux du serveur web, voir [SECURITE.md](SECURITE.md).

- Les jetons sont créés par le propriétaire (affichés une fois, seul leur hash est conservé), révocables, limités à
  120 requêtes/minute. L'option avancée « Proposer ses actions à l'API MCP » retire une instance du MCP.

## Thème du site et apparence d'un module

Le thème réglé dans l'admin (*Réglages › Apparence*) atteint les modules de trois façons, sans rien demander :

- **`ctx.theme`** : `{ accent, accentFg, bg, surface, fg, muted, line, success, successFg, warning, warningFg, danger, dangerFg, accent2, accent2Fg, gradient, font, fontKey }` — exactement les valeurs que le site utilise (même calcul). Un module qui génère du HTML ou du CSS (overlay, bloc `html`) s'en sert au lieu de couleurs en dur.
- **Variables CSS** : sur le site comme dans les overlays, `:root` porte `--v-accent`, `--v-bg`, `--v-fg`, `--v-surface`, `--v-muted`, `--v-line`, `--v-accent-fg`, `--v-success`, `--v-warning`, `--v-danger` (chacune avec son texte : `--v-success-fg`, `--v-warning-fg`, `--v-danger-fg`) `--v-accent2` (avec `--v-accent2-fg`), `--v-gradient` et `--v-font`. Un bloc `html` ou un overlay peut écrire `color: var(--v-accent)`.
- **Lisibilité garantie** : `accentFg` est le texte (noir `#111111` ou blanc) au meilleur contraste WCAG sur `accent` ; `muted` est lisible (≥ 4,5:1) sur `bg` et sur `surface`. `success`, `warning` et `danger` sont les couleurs d'état (succès, avertissement, erreur) : une version claire sur fond sombre, une version foncée sur fond clair, toutes lisibles (≥ 4,5:1) sur `bg` et `surface` ; `successFg`, `warningFg` et `dangerFg` sont le texte à poser dessus. Ils n'existent pas dans les cœurs plus anciens : un module qui les utilise en valeur par défaut `theme:…` exige un cœur récent.
- **Accent secondaire et dégradé** : `accent2` est la deuxième couleur de la marque, que l'administrateur choisit facultativement (« ＋ Couleur secondaire »). Tant qu'il n'en a pas choisi, `accent2` est identique à `accent`. `accent2Fg` est le texte (noir `#111111` ou blanc) au meilleur contraste sur `accent2`. `gradient` (variable CSS `--v-gradient`) est le dégradé de l'accent vers l'accent secondaire, à 120° : à utiliser tel quel comme `background: var(--v-gradient)` (ou `background-image`), jamais comme couleur. Quand les deux accents sont identiques, c'est une couleur unie. Les navigateurs qui savent interpoler en OKLCH (milieu net, sans teinte boueuse) l'utilisent ; les autres reçoivent le même dégradé en sRGB. Pour du texte en dégradé : `background: var(--v-gradient); -webkit-background-clip: text; color: transparent`. Ces trois jetons n'existent pas dans les cœurs plus anciens : un module qui utilise `theme:accent2` ou `theme:accent2Fg` en valeur par défaut exige un cœur récent (`gradient` n'est pas utilisable en `theme:…`).
- **Règle `data-accent2`** : quand l'administrateur a choisi un accent secondaire différent de l'accent, le site pose `data-accent2="1"` sur `<html>` (et `data-surface="1"` s'il a choisi la couleur des cartes). Le site s'en sert pour passer ses boutons principaux en plein, colorer ses petits détails en `accent2` (puces, onglet actif, soulignements au survol), mettre ses chiffres clés et son panneau d'appel à l'action en dégradé et mieux séparer ses cartes. Un module n'a rien à faire pour suivre : il lit `--v-*` comme d'habitude. Pour adopter le même style, écrivez des règles scopées, par exemple `[data-accent2] .mon-badge { background: var(--v-accent2); color: var(--v-accent2-fg); }`, et gardez `accent2` pour les détails (environ 10 % de la surface) : fond plein = `accent2-fg` ; texte en dégradé = `background: var(--v-gradient); -webkit-background-clip: text; color: transparent`, avec une couleur unie en repli. Sans l'attribut, le rendu doit rester celui d'avant.
- **Surface et texte choisis** : l'administrateur peut aussi fixer lui-même `surface` (fond des cartes) et `fg` (couleur du texte) au lieu de les laisser dériver du fond ; `muted` et `line` se calculent alors à partir de ces valeurs. Un module n'a rien à faire de spécial : il lit toujours `ctx.theme.surface` et `ctx.theme.fg`.
- **Couleurs par défaut qui suivent le thème** : `{ "key": "accent", "type": "color", "default": "theme:accent" }` (jetons : `accent`, `accentFg`, `bg`, `surface`, `fg`, `muted`, `line`, `success`, `successFg`, `warning`, `warningFg`, `danger`, `dangerFg`, `accent2`, `accent2Fg`). Tant que l'administrateur n'a pas choisi sa propre couleur — case « Suivre le thème du site », cochée par défaut — la valeur change avec le thème.

Un module peut en plus déclarer **ses propres réglages d'apparence** (la texture des murs du labyrinthe, la couleur du sol, le style d'un bandeau…) avec `"group": "appearance"` : ils sont regroupés sous « Apparence de ce module » dans son panneau d'admin, séparés de ses réglages de comportement. Types utiles : `color`, `image` (téléversement), `select`.

## Envoyer un e-mail

Un module qui déclare la permission `mail` peut appeler `ctx.api.mail.send({ to: "owner", subject, text, replyTo? })` (`to` : `"owner"` = contact du site, ou une adresse). Le serveur d'envoi (SMTP) est réglé une fois par le propriétaire dans *Réglages › E-mail* ; le module n'a ni identifiants ni choix de l'expéditeur. L'appel ne lève jamais : il renvoie `{ ok: true }` ou `{ ok: false, reason }` (`not_configured`, `no_recipient`, `invalid`, `rate_limited`, `failed`). Prévoyez que l'e-mail est un plus : conservez l'information (`ctx.api.store`) avant de l'envoyer. `ctx.api.mail.configured()` dit si un serveur est réglé.

Garde-fous du cœur : texte brut uniquement (20 000 caractères au plus), objet nettoyé (une ligne, 150 caractères), un seul destinataire,
`replyTo` doit être une adresse valide, 10 envois par heure et par instance et 40 par heure pour tout le site (`rate_limited` au-delà),
chaque envoi consigné dans le journal d'audit (sans contenu).


## Appeler une API externe : `ctx.api.net`

Un service externe finit toujours par tomber, ralentir ou demander une pause. `ctx.api.net.request(…)` est le client réseau **du cœur**, partagé par tous les modules : préférez-le à `fetch`. Il ne demande **aucune permission** et ne connaît **aucun fournisseur**.

```js
const r = await ctx.api.net.request({ url: "https://api.example.org/v1/items?page=1", headers: { authorization: `Bearer ${ctx.setting("apiKey")}` } });
if (r.ok && r.status === 200 && r.json) { /* mettre en cache avec la date */ }
else { /* r.error : timeout | network | rate | quota | circuit | busy | too_large | invalid — afficher les dernières données connues */ }
```

- **Ne lève jamais.** Toute réponse HTTP reçue donne `ok: true` avec son `status` (à vous de juger un 404) ; `json` si le corps est du JSON lisible, sinon `text` (un JSON tronqué arrive en `text`). Les redirections ne sont pas suivies (`status` 3xx, en-tête `location`).
- **Délai dur** : `timeoutMs` (8 000 par défaut, 20 000 au plus), file d'attente et lecture du corps comprises. Dans une page publique, jamais plus que le temps restant de la page (`ctx.api.net.budgetMs()`), moins une petite marge pour afficher votre repli. Corps limité à `maxBytes` (2 Mo par défaut, 10 Mo au plus).
- **Trop de demandes** : un 429 (ou un 503 avec `Retry-After`) met le **seau** en pause jusqu'à `retryAt`, lu dans `Retry-After`, puis `RateLimit-Reset` / `X-RateLimit-Reset`, `X-RateLimit-Reset-After`, enfin `retry_after` dans le corps JSON (60 s à défaut, 1 h au plus). Pendant la pause, chaque demande reçoit `{ ok: false, error: "rate", retryAt }` **sans appel réseau**. Une réponse normale avec `RateLimit-Remaining: 0` déclenche la même pause, préventive. Le seau est `bucket` (une même application chez un fournisseur, partagée par plusieurs modules ; haché, jamais journalisé), sinon l'hôte.
- **Quota du jour** : un 403 dont le JSON porte `error.errors[].reason` = `quotaExceeded` ou `dailyLimitExceeded` donne `quota`, sans aucun appel avant minuit, heure du Pacifique (`retryAt`).
- **Disjoncteur par hôte**, partagé par tout le site : 5 échecs (délai, réseau, 5xx) en 60 s l'ouvrent 30 s (`circuit`), puis un seul essai ; s'il échoue, la pause double, jusqu'à 5 min.
- **Déduplication** : des GET identiques en cours (même adresse, mêmes en-têtes) partagent un seul appel (`shared: true` pour les suivants ; chacun reçoit sa propre copie). `dedupe: false` pour s'en passer.
- **File bornée** : 4 appels simultanés par hôte, 16 admis par hôte, 32 pour tout le site ; au-delà, `busy` **tout de suite** (jamais d'attente). `priority: "interactive"` passe devant `background` (défaut).
- **Une seule reprise** au plus (`retry`, 1 par défaut pour GET/HEAD ; jamais pour les autres méthodes), après une erreur réseau ou un 502/503/504 sans `Retry-After`, après 200 à 800 ms au hasard, et seulement s'il reste 1 s de délai. Jamais après un 429 ou un quota.
- **Journal** : une ligne `[net] <module> <hôte> <méthode> <chemin> <statut|erreur> <ms>ms`, sans en-têtes, sans paramètres de requête, sans corps ; un segment de chemin qui ressemble à un jeton est masqué. Un refus sans réseau n'est écrit qu'une fois par minute.
- **Santé** : `ctx.api.net.health()`, et le bloc d'admin `netHealth` (voir « Blocs ») pour la montrer à l'administrateur en mots simples.

Un cœur plus ancien n'a pas `ctx.api.net` : exigez `"minCore": "0.2.0"`, ou prévoyez un repli (`ctx.api.net ? … : fetch(url, { signal: AbortSignal.timeout(8000) })`). Le kit de test vérifie les appels réseau (règles `net.bounded`, `net.429`, `net.fallback`, `net.noIdleTimer`, voir [TESTSUPPORT.md](TESTSUPPORT.md)) ; dans vos tests, `fakeCtx()` fournit le vrai client, à combiner avec `withFakeFetch` et `netReplies` (`rateLimited`, `quotaExceeded`, `silence`, `truncatedJson`, `slow`, `down`).

## Jaquettes de jeux (RAWG)

Un module qui déclare la permission `rawg` peut demander la jaquette d'un jeu : `const cover = await ctx.api.rawg.cover("Hades")`. La **clé d'API RAWG se règle une seule fois**, par le propriétaire, dans *Réglages › Services externes* (comme le serveur d'e-mail) : un module ne demande **jamais** la clé à l'utilisateur, n'a pas de réglage « clé RAWG », et ne la voit jamais. Si un ancien module en avait une, le cœur la reprend une fois au démarrage quand le réglage du cœur est vide.

`cover(title)` ne lève jamais et renvoie `{ status, url }` : `found` (`url` = adresse https de l'image du jeu qui ressemble le plus au titre demandé), `none` (RAWG ne connaît pas ce titre, ou la propriétaire a choisi « Aucune jaquette »), `no-key` (le propriétaire n'a pas saisi de clé, ou le module n'a pas la permission), `refused` (RAWG refuse la clé : à ne pas confondre avec « aucun résultat »), `unreachable` (RAWG ne répond pas). `url` vaut `null` sauf pour `found`. `ctx.api.rawg.configured()` dit si une clé est réglée. La jaquette est un plus : affichez le jeu sans image dans tous les autres cas, et gardez l'adresse trouvée plutôt que de la redemander.

Garde-fous du cœur, partagés par tous les modules : titre nettoyé et limité à 100 caractères, https uniquement, délai de 5 secondes, cache en mémoire (24 h pour une jaquette trouvée, 1 h pour « aucun résultat »), deux requêtes simultanées au plus. Le dernier état de la clé (fonctionne, refusée, injoignable, avec la date) est mémorisé dans les réglages et affiché à l'administrateur.

### Le bon jeu, et « Ce n'est pas le bon jeu ? » (cœur 0.2.10)

RAWG classe ses résultats par pertinence, pas par ressemblance : pour un titre ambigu, le premier peut être un autre jeu. Le cœur demande donc **8 résultats au plus**, compare chacun au titre demandé (casse, accents, ponctuation, articles, chiffres romains et sous-titres sont ignorés pour comparer) et garde le plus ressemblant. Trois champs **facultatifs** s'ajoutent à la réponse `found` ; un module qui ne lit que `status` et `url` n'a rien à changer :

| Champ | Sens |
|---|---|
| `name` | le nom du jeu trouvé sur RAWG (à afficher à côté de la jaquette si vous voulez que la personne repère une erreur) |
| `id` | son numéro RAWG |
| `ambiguous` | `true` quand le choix est douteux : le meilleur n'est pas un titre quasi identique, ou un autre jeu est presque aussi proche. Absent quand le cœur n'a pas pu comparer |

Un titre douteux entre dans la liste **Jaquettes à vérifier** (*Réglages › Services externes*), où la propriétaire choisit le bon jeu, « Aucune jaquette », ou valide le choix du site. Sa décision est une **correction mémorisée par le cœur** : elle est appliquée à tous les modules, avant le cache et avant RAWG, et `cover(title)` renvoie alors `found` avec `ambiguous: false` (ou `none`).

`ctx.api.rawg.candidates(title)` (permission `rawg`, jamais d'exception) renvoie `{ status, candidates }` : `status` comme pour `cover`, `candidates` = **6 jeux au plus**, du plus ressemblant au moins ressemblant, chacun `{ id, name, year, platforms, url }` (`year` ou `null`, 3 plateformes au plus, `url` = jaquette sur `https://media.rawg.io`). Elle sert à **montrer** les choix ; le choix lui-même se fait dans l'admin.

**Lien stable vers l'écran de correction** : `/admin/settings/rawg-covers?titre=<titre>` (le titre encodé, par exemple `encodeURIComponent("Playrooms")`). Il est réservé aux administrateurs : une personne sans ce droit est renvoyée comme pour toute page d'admin. Le titre est lu et validé côté serveur (1 à 120 caractères, au moins une lettre ou un chiffre ; sinon l'écran dit que le titre n'est pas valable) et n'est jamais écrit sans échappement. Un module qui affiche une jaquette dont `ambiguous` est vrai (ou qui veut toujours l'offrir) peut écrire « Ce n'est pas le bon jeu ? » avec ce lien, dans l'espace d'administration du module seulement (jamais sur une page publique). Pour que le titre soit celui que la propriétaire verra, passez **le même titre** à `cover` et au lien.

Pas de lien ni de méthode pour écrire une correction depuis un module : le cœur est l'unique propriétaire de la donnée « jaquette d'un jeu ». Les outils d'un assistant IA (`rawg_covers_to_check`, `rawg_cover_set`) sont décrits dans [MAINTENANCE-IA.md](MAINTENANCE-IA.md).

Pour vos tests : `fakeCtx({ rawgCover, rawgCandidates })` (objets ou fonctions `(titre) => résultat`) ; `ctx.calls.rawgCandidates` garde les titres demandés. Exigez `"minCore": "0.2.10"` si vous appelez `candidates` ou lisez `ambiguous`.

## Alimenter le flux RSS

### Réseaux sociaux

Le cœur ne connaît aucun réseau : il demande à **tous** les modules actifs qui fournissent `social.link` leur bouton et l'affiche dans l'en-tête. Un réseau est donc un module (`"type": "social"`, `"instances": "multiple"` pour en ajouter un par compte) : `"provides": [{ "topic": "social.link" }]` et `exports["social.link"] = (ctx) => [{ label, url, icon? }]`. `label` et `url` sont obligatoires (`url` : adresse https externe ; les autres sont écartées), `icon` est un identifiant d'icône (`twitch`, `youtube`…) ou un emoji. Le cœur garde 10 boutons au plus, sans doublon, dans l'ordre des instances. Renvoyez une liste vide tant que le module n'est pas réglé.

**Rendu du lien (facultatif, par bouton).** Un bouton peut aussi déclarer `rel`, `referrerPolicy` et `target`. Le cœur garde la maîtrise du rendu : il vérifie chaque valeur dans une **liste fermée**, ignore ce qui n'y est pas (le bouton reste affiché, avec le défaut sûr) et n'écrit jamais d'autre attribut.

| Champ | Valeurs acceptées | Défaut |
|---|---|---|
| `rel` | texte séparé par des espaces ou liste : `noopener`, `noreferrer`, `nofollow`, `sponsored`, `ugc` (casse ignorée, doublons retirés) ; `noopener` est **toujours** ajouté | `noopener noreferrer` |
| `referrerPolicy` | `no-referrer`, `no-referrer-when-downgrade`, `origin`, `origin-when-cross-origin`, `same-origin`, `strict-origin`, `strict-origin-when-cross-origin` (`unsafe-url` est refusée : elle transmet l'adresse complète de la page) | aucun attribut |
| `target` | `_blank` ou `_self` | `_blank` |

Un `rel` déclaré **remplace** le défaut (ne demandez pas `noreferrer` si vous voulez que la destination voie d'où vient le visiteur). Une `referrerPolicy` choisie **sans** `rel` remplace `noreferrer` par `noopener` seul, car `noreferrer` annulerait la politique. Une adresse `javascript:` (ou toute adresse qui n'est pas http(s)/mailto) reste écartée quels que soient ces champs. Un bouton qui ne déclare rien est rendu exactement comme avant (`rel="noopener noreferrer" target="_blank"`, sans `referrerpolicy`).

Le flux RSS est une fonctionnalité du cœur (`/feed.xml`). Les modules à contenu y sont déjà. Un autre module y ajoute ses éléments en fournissant le sujet `feed.item` : `"provides": [{ "topic": "feed.item" }]` et `exports["feed.item"] = (ctx, { locale, limit }) => [{ title, url, summary?, publishedAt?, id?, topics? }]`. `title` et `url` sont obligatoires (`url` : chemin du site `/…` ou adresse http(s) ; les autres schémas sont écartés), `publishedAt` est une date ISO **en texte**. `topics` : les rubriques **partagées** sur lesquelles publier (`["announcement", "concert"]`). Elles sont communes à tous les modules : si le blog et votre agenda publient tous deux sur `announcement`, un lecteur abonné à `announcement` reçoit les deux. Le cœur ajoute lui-même `@<instance>` ; un module ne peut pas le déclarer. Ne mettez que des éléments **publics** (jamais un message en attente de modération) : le flux est lisible par tous. Le cœur échappe le XML : donnez du texte brut.

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
affiche l'URL à coller dans OBS, et la famille **Overlays** d'Extensions (Installées) les réunit toutes avec un bouton « Copier ». Un module de type `overlay` (ou qui déclare la permission `overlay`) est rangé dans cette famille par défaut. L'overlay livré, `ticker-overlay`, est un exemple complet : il ne sait
rien des blogs ni des codes promo, il digère `core.entry` et `overlay.item`.

## Sauvegarde lisible sans le framework

Le cœur sauvegarde déjà, pour tout module, ses réglages, son stockage (`ctx.api.store`, en JSON) et les entrées de ses instances.
`backup.readable(ctx)` ajoute des fichiers **lisibles sans le framework** (CSV, Markdown, texte…) pour les données que le module juge
importantes : si le framework disparaît, l'utilisateur les relit avec n'importe quel éditeur ou tableur.

```js
export default {
  backup: { readable: async (ctx) => [{ path: "messages.csv", content: '"id","name"\r\n"1","Ada"\r\n' }] },
};
```

`path` est relatif au dossier de l'instance : le fichier atterrit dans `readable/modules/<clé de l'instance>/<path>`. Règles : texte
uniquement, 50 fichiers et 5 Mo par fichier au plus, chemin relatif sans `..`, un chemin déjà pris est ignoré, une erreur est journalisée
et n'empêche pas la sauvegarde. Le contexte est celui de la langue par défaut. Pour un CSV : mettez chaque cellule entre guillemets (doublez
les guillemets internes) et neutralisez les cellules qui commencent par `=`, `+`, `-` ou `@` (injection de formule dans un tableur) — voir `cell()` dans l'exemple.


## Installé ou pas : le cycle de vie d'un module

Il n'y a que **deux états** : *installé* (actif : page, menu, tâches, outils MCP, routes publiques) et *pas installé*. Pas d'interrupteur « on/off » ni pour un module ni pour une instance ; pour ne plus avoir l'un ou l'autre, on le **retire**, en choisissant le sort de ses données :

| Choix (boutons) | Effet |
|---|---|
| **Retirer et garder mes données** | le module n'est plus installé (son code est retiré) ; ses instances, réglages, contenus et stockage sont **rangés**, inertes, dans la table `RetiredInstance` du cœur |
| **Retirer et tout effacer** | tout est supprimé, y compris des données rangées auparavant (irréversible ; la confirmation conseille une sauvegarde) |

- **Un module = propriétaire de ses données (SRP).** Le cœur ne les interprète pas : il les range en un bloc JSON par instance (ligne d'instance, traductions, entrées et traductions, réglages `instance.<id>.…`, stockage) et les remet **à l'identique** (mêmes identifiants), sans jamais les rendre au module. Aucune lecture par le module retiré, ni par l'API (`ctx.api`), le MCP, les flux, les tâches planifiées, le menu ou le site : les tables vivantes ne contiennent plus rien de lui. La sauvegarde du site contient ce bloc (`data/retired-instances.json`).
- **Réinstaller le même module** (catalogue, dépôt) remet ses instances et leurs données, puis les met à niveau si le module a changé de `dataVersion` (comme après une mise à jour). La liste *Ajouter* et la fiche du module annoncent « vos données ont été gardées ». Ce qui ne peut pas revenir (module à instance unique déjà servi) reste rangé, intact. Une adresse ou un identifiant pris entre-temps est remplacé par un libre (`-2`), rien n'est écrasé.
- **Retirer une seule instance** suit le même choix. En « garder », `hooks.onInstanceDelete` n'est **pas** appelé (rien n'est détruit) ; en « effacer », il l'est. Le propriétaire qui retire la *seule* instance de son module retire le module.
- **Dépendances.** Retirer un module dont un autre module installé a besoin est refusé. Le nettoyage proposé des modules « installés automatiquement » (plus personne n'en dépend) offre le même choix. Si une cascade échoue après avoir retrouvé des données gardées, elles sont rangées de nouveau, jamais effacées.
- **MCP de maintenance.** `maintenance_module_uninstall` prend `keepData` (défaut **vrai**, non destructif) ; `keepData: false` efface. Comme tout outil destructif, il reste soumis à la validation humaine.
- **Balayage de conversion au démarrage (0.2.0).** À chaque démarrage, avant de servir la moindre page, le cœur range les « éteints » (ci-dessous), fait passer au catalogue les modules copiés par les toutes premières versions quand la dernière copie reçue du catalogue les connaît à la même version (sans réseau), lance les conversions de données en attente (une instance à la fois), puis note `core.legacyCleared`. Borné à 20 secondes ; ce qui n'est pas fini reprend au démarrage suivant. Tant que le marqueur manque, l'administration affiche un avertissement (le site public n'est pas touché) et la page *Entretien* (`/admin/maintenance/legacy`, outil MCP `maintenance_legacy`) dit ce qui reste. Code : `src/core/modules/legacySweep.ts`, `legacyReport.ts`.
- **Migration des « éteints » (temporaire, retrait en 0.3.0).** Un site d'avant la 0.1.20 peut avoir des modules ou instances « éteints » : au premier démarrage (et après la restauration d'une ancienne sauvegarde), un module éteint est désinstallé et une instance éteinte retirée, **données gardées** (`src/core/modules/legacyOff.ts`). Les colonnes `enabled` restent dans la base pour cette seule lecture.

## Installer, publier, catalogue

**Le Catalogue est gratuit** : aucun module ne s'y vend, tous sont sous licence ouverte. Un auteur qui accepte des dons volontaires l'indique dans le **README.md** de son dépôt, que l'admin affiche avant toute installation ; jamais une condition d'installation.

**Avant d'installer**, l'admin affiche pour chaque module (du catalogue comme d'un dépôt personnel) son **README.md**, ses permissions, les services qu'il offre ou requiert et sa licence, lus **sans l'installer** (dépôt git : clonage superficiel temporaire, mêmes garde-fous que l'installation). Le README est du texte d'un tiers : rendu Markdown sans HTML brut, aucune image distante chargée, liens relatifs inertes. Écrivez donc un vrai README (à quoi sert le module, réglages, permissions).

**Installer** (propriétaire seulement). Admin → **Catalogue** :

- **Le catalogue** : dépôts git listés dans l'index du dépôt `curiosa-extras` (voir ci-dessous), chacun avec sa version épinglée par étiquette : celui qui publie l'index se porte garant des dépôts qu'il liste. C'est la seule source de vérité, lue sur le réseau : le cœur n'embarque aucun module ni copie de la liste. Le catalogue connaît par défaut UN seul dépôt (`curiosa-extras`) ; d'autres se configurent (`CURIOSA_CATALOGUE_REPO`, `MODULES_INDEX_URL`, *Mes dépôts de modules*).
- **Origine d'une entrée** (cœur 0.2.0) : `official` (le dépôt du catalogue, ou sa dernière copie reçue) ou `extra` (l'index supplémentaire `MODULES_INDEX_URL`). Un module `extra` est marqué *« non vérifié par le catalogue officiel »* ; il n'est **jamais installé d'office** (ni comme fournisseur d'un autre, ni par une graine, ni mis à jour par la cascade : le manque est signalé avec la raison « extra ») et ne s'installe que par le propriétaire, après avoir lu l'avertissement et coché la case. À service égal, l'officiel passe toujours avant.
- **Mes dépôts de modules** (mode avancé) : vous publiez vos modules dans UN dépôt git (un dossier par module, chacun avec son `module.json`, jusqu'à trois niveaux de profondeur ; ou un seul module à la racine). Le propriétaire du site ajoute l'adresse du dépôt dans Catalogue → *Mes dépôts de modules* ; Curiosa lit les manifestes (sans rien exécuter) et liste les modules, qui s'installent un par un avec la même confirmation que ci-dessous. Chaque module se met à jour depuis son dossier de ce dépôt, et seulement quand ce dossier change. Dix dépôts au plus.
- **Installer un dépôt personnel (non vérifié)** : n'importe quelle adresse de dépôt, avec un avertissement et une case « je comprends » à cocher :

```
https://github.com/<vous>/<depot>          # dernière version de la branche par défaut
https://github.com/<vous>/<depot>#v1.2.0   # étiquette, commit ou branche épinglé
```

Hôtes autorisés : `MODULES_ALLOWED_HOSTS` (défaut `github.com,gitlab.com,codeberg.org,bitbucket.org` ; `*` = tous). Seul `https://` est
accepté, sans identifiant ni paramètres. Le module est installé **actif** (dans `data/modules/<id>`) : l'accord se donne avant, sur la fiche (case « je fais confiance » pour un dépôt personnel) ; on lui ajoute ensuite des instances. Chaque instance active a sa propre entrée dans le menu d'admin.
Les modules installés se gèrent dans **Extensions** : « Réglages » (une fenêtre), « Chercher une mise à jour » (compare avec le dépôt distant),
mettre à jour, retirer (voir « Installé ou pas : le cycle de vie » ci-dessous).
**Mise à jour d'un module — sans perdre aucune donnée** : seuls les fichiers du module changent ; ses instances, réglages, données (stockage, entrées) restent
tels quels. Le sens de « mise à jour » dépend de l'installation :

| Installé avec | « Chercher une mise à jour » propose |
|---|---|
| une **étiquette** (`#v1.2.0`, recommandé) | la plus haute version stable du dépôt (`v1.3.0`) ; le module passe d'étiquette en étiquette. Un changement **majeur** (`v2.0.0`) est signalé : lisez ses notes avant |
| un **commit** (`#a1b2c3d`) | jamais : c'est le but de l'épinglage |
| une **branche**, ou rien | le dernier commit de la branche |
| le catalogue (ligne `bundled` d'un ancien site — compatibilité, à retirer en 0.3.0) | la version du catalogue : la mise à jour la **convertit** en module du catalogue (voir ci-dessous) |

Si la nouvelle version est **invalide** (manifeste illisible, autre identifiant, API incompatible, fichier principal absent, trop volumineuse), l'ancienne est
rétablie automatiquement : un module ne reste jamais à moitié mis à jour.

**Développer en local** : avec `CURIOSA_ALLOW_LOCAL_MODULES=1` dans l'environnement du serveur, une adresse `file:///chemin/absolu/vers/depot`
est acceptée par « Installer un dépôt personnel ». Le dépôt doit avoir au moins un commit ; pour voir une modification, validez-la
(`git commit`) puis *Chercher une mise à jour* → *Mettre à jour*. À ne jamais activer sur un serveur public.

### Un module installé et le catalogue

Il n'y a que deux états : un module est **installé** ou **non installé** (le reste du catalogue). Le catalogue (dépôt de modules, version épinglée par étiquette) est la source de vérité de tout module installé, quel que soit le moment de l'installation (à la configuration ou trois mois plus tard). Le cœur n'embarque aucun module et ne lit aucun dossier de modules local.

- **Catalogue injoignable.** Pas de copie locale : la dernière liste reçue (gardée dans `data/cache`) tient une panne passagère ; sans elle, le Catalogue est vide avec le message « Le catalogue n'est pas joignable, réessayez », et une installation ou une mise à jour échoue avec ce même message. Les modules déjà installés continuent de fonctionner.
- **Sites anciens (compatibilité, à retirer en 0.3.0).** Les anciennes versions du cœur copiaient des modules sur le serveur (ligne `source: bundled`). Une telle ligne continue de fonctionner (son dossier est déjà sur le disque) et le catalogue est sa seule source : si l'entrée du catalogue est plus récente, *Modules › Mises à jour* et « Tout mettre à jour » l'affichent (`1.0.0 → 1.1.0`) ; à égalité ou si le catalogue est en retard, rien. Si cette version demande un cœur plus récent, la mise à jour affiche « demande Curiosa X » et est sautée. Si le catalogue ne liste plus ce module, il reste installé, signalé « source inconnue ».
- **Conversion, sans rien perdre.** La mise à jour récupère le dépôt à l'étiquette épinglée, vérifie `id`, `main`, taille, `minCore` et permissions (jamais élargies en silence), échange le dossier (`.previous-<pid>` conservé jusqu'au bout), passe la ligne en `git` (dépôt, étiquette, dossier, commit, empreinte), casse le cache d'imports et rejoue les migrations de données. Instances, réglages, données, état activé, placements, droits MCP et date d'installation ne sont pas touchés. Au moindre échec, fichiers **et** ligne `Module` reviennent à l'état d'origine. Ensuite le module suit le catalogue comme tout module du catalogue. Journal : `module.update` avec « version avant → après (bundled -> catalogue) ».
- **Origine.** Une ligne `bundled` que le catalogue liste est « catalogue », convertie ou non.
- **Installation initiale.** L'assistant de configuration propose les modules « suggérés » lus dans le catalogue et installe ceux que l'on coche depuis le catalogue (git, étiquette épinglée). Si le catalogue est injoignable à ce moment, le site se crée quand même, sans module, et le tableau de bord dit : « Aucun module n'a pu être installé (catalogue injoignable) : installez-les plus tard depuis Modules › Catalogue » ; aucune tentative de copie locale.

**Mises à jour en bloc.** Admin → **Mises à jour** (propriétaire) contient une section « Vos modules » : au chargement (résultat gardé quelques minutes, bouton « Revérifier »), elle vérifie chaque module installé qui a une source (catalogue ou dépôt) avec le même `checkForUpdate` et ne liste que ceux qui ont une version plus récente (`1.0.0 → 1.0.1`, avertissement pour un changement « majeur »). « Tout mettre à jour » les met à jour **un par un**, jamais en parallèle (`updateModule`) : l'échec d'un module n'arrête pas les autres, une **erreur de migration** de données arrête tout et nomme le module ; un bilan est affiché. Une vérification impossible (réseau, source absente) n'est qu'un message discret sur ce module. Après une mise à jour réussie du site, la section est mise en avant, et le lien « Mises à jour » du menu porte une pastille tant que des modules sont en retard (vérifiés en arrière-plan, jamais d'attente réseau dans le menu).

**Index des modules reconnus** : un fichier `catalogue/index.json` (format : [`catalogue/README.md`](../catalogue/README.md)) **dans le dépôt de modules `curiosa-extras`**, relu **à l'exécution**
sur le réseau (au plus toutes les 15 minutes) : **il ne suit pas le rythme des versions du framework**. Ajouter un module =
une demande de fusion sur ce fichier, visible par toutes les installations dès qu'elle est fusionnée (voir [`catalogue/README.md`](../catalogue/README.md)).

```json
{ "version": 1, "modules": [
  { "id": "my-module", "name": "My module", "description": "…", "repo": "https://github.com/<vous>/<depot>",
    "ref": "v1.0.0", "version": "1.0.0", "apiVersion": 2, "author": "…", "icon": "📖" } ] }
```

`id`, `name`, `description`, `repo` sont les champs de base ; `ref` (**étiquette ou commit relus** — c'est ce qui rend « vérifié » vrai), `version`, `apiVersion`,
`author`, `icon`, `requires` (`{ "core": "0.1.10" }` : cœur minimal, voir `minCore`) sont facultatifs. Chaque entrée est revalidée (identifiant, dépôt `https` sur un hôte autorisé ; 300 au plus). Un module dont `apiVersion`
diffère de celle du framework est listé mais **non installable**. Rien n'est installé automatiquement ; le dépôt installé doit servir le module annoncé
(`id` identique à celui de son `module.json`). Le catalogue ne vient que de ces dépôts (voir « Un module installé et le catalogue »).

D'où vient la liste, dans l'ordre : (1) le dépôt de modules `curiosa-extras` (constante nommée `DEFAULT_CATALOGUE_REPO`, son adresse par défaut : la seule adresse que le cœur connaît ; `CURIOSA_CATALOGUE_REPO` pour en choisir un autre, `CURIOSA_CATALOGUE_REF` pour une autre
branche ou étiquette que `HEAD`) ; (2) à défaut, la **dernière copie reçue** (`data/cache/`) : une panne réseau passagère ne vide pas le Catalogue ; sans elle, la liste est **vide** (jamais une copie locale) ; (3) **en plus**, un index JSON `https://` (`MODULES_INDEX_URL`, modèle : [`modules-index.example.json`](modules-index.example.json))
dont les entrées ne peuvent qu'**ajouter** des modules, jamais remplacer ceux du dépôt. Le dépôt publie aussi `catalogue/suggested.json` (les identifiants que l'assistant de première installation propose, lu comme l'index). La page Catalogue indique d'où vient la liste affichée.

Pour qu'un module rejoigne le catalogue : une demande de fusion sur `curiosa-extras` avec un dossier dans `modules/` (modules complets) ou `examples/` (exemples), son `module.json` à sa racine.

## Les modules : dépôt `curiosa-extras`

**Le cœur ne contient aucun module** : il fait fonctionner le site et son admin, point. Blog, réseaux sociaux, codes promo, pages, collection vierge,
bandeau d'accueil, formulaire de contact, statut live, overlay défilant, **kit presse** (il lit l'identité réglée dans le cœur via `ctx.api.brand()` et
ne stocke rien) et tous les autres vivent dans le dépôt `curiosa-extras` et s'installent comme n'importe quel module. Si le cœur avait
besoin d'un module pour fonctionner, ce ne serait pas un module : ce serait une fonction du cœur (c'est le cas des blocs de page de l'accueil). Un test
vérifie que le cœur ne cite aucun module.

- **`examples/`** : exemples pour apprendre. `guestbook` (`curiosa-extras/examples/guestbook`) (livre d'or modéré : réglages de tous types,
  sections avec taille, page, formulaire, stockage, e-mail, sujets dont `feed.item`, admin, MCP, sauvegarde lisible, thème, i18n, crochets) et
  `announcement-banner` (`curiosa-extras/examples/announcement-banner`) (le plus petit module utile : un slot, une section, un sujet).
- **`modules/`** : modules complets. Par exemple
  `maze-overlay` (`curiosa-extras/modules/maze-overlay`), un labyrinthe 3D existant porté en module
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

- `partnerships` (`curiosa-extras/modules/partnerships`) : suivi privé (fiches, journal, contacts, relances) — aucune page publique, panneau d'admin complet, actions MCP.
- `sponsors` (`curiosa-extras/modules/sponsors`) : module à contenu ; chaque sponsor peut référencer un partenaire ; affiche la mention de partenariat ; fournit `sponsor.card`.
- `sponsor-ticker` (`curiosa-extras/modules/sponsor-ticker`) : l'overlay, qui ne connaît que `sponsor.card` (ou `core.entry`).

### Présence en ligne : annonces, live, vidéos, alertes

Des modules communautaires qui coopèrent aussi uniquement par sujets (aucun ne connaît les autres) :

```
 Chaîne Twitch ──stream.live──────────▶ Annonces Discord ◀──feed.item / core.entry── tout module qui publie
 (live, clips)  ──maze.poster────────▶ Overlay labyrinthe        (blog, vidéos YouTube, agenda…)
 Chaîne YouTube ──feed.item (vidéos)──▶ Annonces Discord · flux RSS
                ──maze.poster────────▶ Overlay labyrinthe
```

- `discord-announcer` (`curiosa-extras/modules/discord-announcer`) : webhook Discord, anti-doublon, journal, test ; utilise le service `tasks`.
- `youtube-channel` (`curiosa-extras/modules/youtube-channel`) : vidéo mise en avant (sans lecteur intégré), vidéos proposées au flux RSS et aux affiches.
- `twitch-channel` (`curiosa-extras/modules/twitch-channel`) : le live en cours (`stream.live`) et les derniers clips.
- `alerts-overlay` (`curiosa-extras/modules/alerts-overlay`) : alertes OBS en direct (SSE), alimentées par une requête authentifiée par jeton.
- `game-suggestions` (`curiosa-extras/modules/game-suggestions`) : suggestions de jeux avec statuts, votes « rejoue-le », jaquettes RAWG.

### Contacts et formulaire de contact : une dépendance

`contacts` (`curiosa-extras/modules/contacts`) est un carnet d'adresses privé (admin, MCP, sauvegarde lisible) qui **offre** le service `contact.store`. Le formulaire de contact intégré le **requiert** : il ne garde aucun message lui-même, il les range dans le carnet comme contacts « à vérifier » (même e-mail → note ajoutée, pas de doublon). Installer ou activer le formulaire installe et active `contacts` d'office, avec son carnet prêt à l'emploi ; tant que le formulaire est actif, `contacts` ne peut être ni désactivé ni désinstallé. Un assistant MCP complète ensuite la fiche et la passe « active », ou la supprime si c'est du spam.

### Planning

`planning` (`curiosa-extras/modules/planning`) **affiche** les prochains streams : section d'accueil, page `/planning`, image de la semaine et action MCP `planning_upcoming` (lecture seule), avec l'apparence
choisie (liste, alternance, semaine, timeline, affiches…). Il ne lit aucun agenda : ses streams viennent du sujet `planning.slot`, que fournissent des modules « agenda de streams » (`calendar-ical` lit un Google Agenda
ou tout flux iCal — répétitions, exceptions, fuseaux ; `calendar-manual` garde des streams saisis à la main), sans que le Planning sache lesquels. Le bot Twitch lit le même sujet : un agenda suffit, le Planning n'est pas
nécessaire. Aucun des deux n'en dépend : sans agenda, le Planning montre « pas de stream planifié ». L'adresse d'un agenda iCal est un réglage secret, n'accepte que du https public (aucune adresse interne, redirections
revérifiées) et n'est jamais réaffichée. Un Planning d'avant la 2.0.0 gardait lui-même cette adresse : sa migration la reprend dans une instance de `calendar-ical` (`seeds`, lien souple par le sujet).

## Tests

`npm test` lance toute la batterie (Node, sans dépendance de test) : cœur, services, gestion des modules
(installation depuis un vrai dépôt git local, registre, exécution, sujets, MCP) et chaque module. Les outils
sont dans `tests/helpers/` : un chargeur qui résout l'alias `@/` et les modules `next/*`, une base SQLite
temporaire (`useTestDb`), des dépôts git jetables (`makeRepo`) et un contexte de module factice (`fakeCtx`)
pour tester le code d'un module sans serveur (voir `tests/guestbook.test.mjs` de `curiosa-extras`, qui sert de modèle). `tests/docs-coverage.test.mjs` garde cette
documentation alignée sur le code.

## Sécurité : à lire avant d'installer

Un module s'exécute dans le serveur avec les mêmes droits que le site. Installez seulement des
modules dont vous faites confiance à l'auteur, épinglez une version (`#tag`), et relisez le code
avant d'activer. L'installation et la mise à jour sont réservées au propriétaire.

Pour l'auteur d'un module : tout ce qui vient d'un visiteur (formulaire, requête, `segments`, `query`) est une donnée non fiable — validez à
l'entrée, échappez à la sortie (surtout dans un bloc `html`), n'utilisez jamais `eval` ni `new Function`, ne journalisez ni secret ni contenu
privé, n'acceptez dans un lien que `https:`, `http:`, `mailto:` ou un chemin du site. Voir la checklist du tutoriel : [CREATE-A-MODULE.md](CREATE-A-MODULE.md#checklist-avant-de-publier).
