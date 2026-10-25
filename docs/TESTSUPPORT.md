# Le kit de test des modules (testsupport)

Vous écrivez un module pour Curiosa et vous voulez savoir : **« suis-je conforme ? »** Le cœur vous répond avec une suite de vérifications prête à l'emploi, versionnée avec le cœur (elle décrit son contrat de module). Elle ne demande ni serveur, ni réseau, ni base de données.

## En une commande

Depuis le dossier du cœur (le dépôt Curiosa) :

```
npm run module:check -- /chemin/vers/votre-module
```

(équivalent : `node testsupport/check.mjs /chemin/vers/votre-module`)

Le rapport liste chaque exigence avec ✅ réussi ou ❌ échec. Pour chaque ❌ il dit **ce qui ne va pas**, **pourquoi c'est exigé** et **comment corriger**, avec un lien vers la fiche de l'exigence (ci-dessous). **Tout ce qui est ❌ est à corriger ; lancez la même commande jusqu'à ce qu'il n'y en ait plus.**

- **Obligatoire** : condition pour être proposé dans le catalogue. Un échec donne un code de sortie différent de 0.
- **Conseil** (⚠️) : un avertissement. Il n'empêche rien, mais votre module sera meilleur en le suivant.
- **Sans objet** (➖) : l'exigence ne concerne pas votre module (par exemple « tâches planifiées » si vous n'en avez pas).
- **Non vérifié** : la vérification n'a pas pu se faire (par exemple parce que module.json est invalide) ; corrigez d'abord le reste.

Options : `--json` (rapport lisible par une machine), `--voisins <dossier>` (comparer à d'autres modules, voir « srp.single »), `--strict` (les conseils font aussi échouer), `--seulement id1,id2`, `--liste` (affiche les exigences), `--tableau` (plusieurs modules : tableau module × exigence).

## Laisser Claude (ou une autre IA) corriger

Demandez-lui de lancer `npm run module:check -- <dossier> --json`, de lire le rapport et de corriger jusqu'à ce que `summary.ok` soit `true`. Le JSON a cette forme :

```json
{
  "module": { "dir": "…", "folder": "guestbook", "id": "guestbook", "version": "1.0.0" },
  "core": { "version": "0.1.22", "apiVersion": 2 },
  "summary": { "ok": false, "mandatory": { "passed": 29, "failed": 3, "na": 4, "skipped": 0 }, "advice": { "passed": 7, "failed": 2, "na": 4, "skipped": 0 } },
  "results": [
    { "id": "settings.optional", "level": "mandatory", "group": "settings", "title": "…", "status": "fail",
      "problems": ["réglage « banner » dit « facultatif » mais ne déclare pas \"optional\": true"],
      "what": "…", "why": "…", "fix": "…", "doc": "docs/TESTSUPPORT.md#settingsoptional", "note": "" }
  ]
}
```

`status` vaut `pass`, `fail`, `na` (sans objet) ou `skip` (non vérifié). Les champs `problems` et `fix` sont faits pour être lus par une IA comme par une personne.

## Dans vos tests (node:test)

```js
import test from "node:test";
import { registerConformanceTests, fakeCtx, loadModuleDir } from "<dossier du cœur>/testsupport/index.mjs";

registerConformanceTests(new URL(".", import.meta.url).pathname, { test }); // une exigence = un test nommé
// … puis vos propres tests, avec fakeCtx
```

Une exigence obligatoire en échec fait échouer son test (avec le message complet) ; un conseil s'affiche en remarque. Un exemple complet à copier : [`testsupport/template/`](../testsupport/template) (un module minimal et son `my-module.test.mjs`).

Le kit se retrouve tout seul : il peut être importé depuis un autre dépôt (par exemple `curiosa-extras`) par le chemin du cœur, sans dépendre de la position relative des dossiers. Lancez alors vos tests avec le chargeur de test du cœur : `node --import <cœur>/tests/helpers/register.mjs --test …`.

## L'API publique du kit

Tout s'importe depuis `testsupport/index.mjs` (stable) :

| Export | Rôle |
|---|---|
| `checkModule(dir, opts)` | Lance toutes les exigences sur un dossier et renvoie le rapport (celui de `--json`). `opts.siblings` : dossiers des autres modules ; `opts.only` : identifiants à lancer. Ne lève jamais pour un module fautif. |
| `registerConformanceTests(dir, { test, siblings, only, prefix })` | Adaptateur node:test : une exigence = un test nommé. |
| `fakeCtx(options)` | Faux contexte de module (réglages, stockage en mémoire, e-mail enregistré, sujets, services…). Option `permissions` : le contexte refuse ce qui n'est pas déclaré. `ctx.api.files` (cœur 0.2.13) : mêmes règles et mêmes refus que le cœur, options `uploads`, `person`, `filesQuota`, appels dans `ctx.calls.files`, `ctx.dumpFiles()` pour constater qu'un fichier a disparu. `ctx.api.rawg` : `cover` et `candidates` (options `rawgCover`, `rawgCandidates` ; appels dans `ctx.calls.rawg` et `ctx.calls.rawgCandidates`). `ctx.api.net` est le vrai client réseau du cœur (état neuf par contexte ; options `netLimits`, `netBudgetMs`), branché sur `globalThis.fetch`. `ctx.calls` garde les appels, `ctx.dumpStore()` le contenu du stockage. Voir l'en-tête de `testsupport/fakeCtx.mjs`. |
| `loadModuleDir(dir)` | Charge un dossier de module comme le cœur (manifeste, code, textes), sans jamais lever. |
| `fakeFetch(routes)`, `withFakeFetch(routes, fn)`, `blockNetwork(fn)` | Faux `fetch` pour tester un module qui appelle un service, sans réseau. La clé `"*"` répond à toutes les adresses ; le `signal` d'annulation est respecté. |
| `netReplies`, `makeNetClient(options)` | Pannes prêtes à l'emploi pour `fakeFetch` : `rateLimited(120)` (429 + Retry-After), `rateLimitedBody(s)`, `rateLimitedReset(époque)`, `quotaExceeded()` (403), `silence()` (jamais de réponse), `truncatedJson()`, `slow(ms, réponse)`, `down()`, `status(code)`. `makeNetClient` : le vrai client `ctx.api.net`, état neuf. |
| `startLocalServer(handler)` | Petit serveur HTTP local (127.0.0.1) pour tester un module qui parle à une adresse ; rien ne sort de la machine. |
| `settingsDefaults`, `assertValidManifest`, `assertLocalesParity`, `findSrpViolations`… | Les vérifications unitaires que la suite réutilise (source unique). |
| `REQUIREMENTS`, `GROUPS`, `formatText`, `formatMatrix` | La liste des exigences et la mise en forme du rapport. |

## Comment la suite essaie votre module

Le code de votre module est exécuté avec un faux contexte, **sans réseau** (tout accès est refusé et noté), dans plusieurs situations : réglages par défaut, réglages remplis (français et anglais), puis **données piégées** (textes contenant des balises et des scripts dans les réglages, le stockage, les formulaires, l'adresse de la page, le nom du site, les entrées et les sujets reçus). Rien n'est installé et rien n'est écrit en dehors de la mémoire du test. C'est une **sonde**, pas une preuve : elle atteint ce qu'elle peut atteindre. Un ✅ veut dire « rien trouvé », pas « parfait ».

## Les exigences, une par une

Chaque fiche : ce qui est vérifié, pourquoi, comment corriger. L'identifiant est stable (utilisable dans `--seulement`).

| Identifiant | Niveau | Exigence |
|---|---|---|
| [`manifest.file`](#manifestfile) | obligatoire | Le dossier du module est complet |
| [`manifest.valid`](#manifestvalid) | obligatoire | module.json est valide |
| [`manifest.version`](#manifestversion) | obligatoire | La version est au format x.y.z |
| [`manifest.id`](#manifestid) | conseil | L'identifiant correspond au nom du dossier |
| [`manifest.catalogue`](#manifestcatalogue) | conseil | La fiche du module est complète pour le catalogue |
| [`compat.apiVersion`](#compatapiversion) | obligatoire | Le module vise la bonne version de l'API des modules |
| [`compat.minCore`](#compatmincore) | obligatoire | minCore couvre les fonctions du cœur utilisées |
| [`compat.minCoreKnown`](#compatmincoreknown) | conseil | minCore n'est pas plus récent que ce cœur |
| [`def.loads`](#defloads) | obligatoire | Le code se charge sans erreur |
| [`def.matches`](#defmatches) | obligatoire | Ce que module.json annonce est ce que le code fait |
| [`code.imports`](#codeimports) | obligatoire | Le module ne dépend de rien d'autre que de ctx |
| [`code.noDanger`](#codenodanger) | obligatoire | Pas de code dangereux |
| [`load.noNetwork`](#loadnonetwork) | obligatoire | Aucun accès au réseau au chargement |
| [`page.scripts`](#pagescripts) | conseil | Les scripts de page sont de vrais fichiers du dossier scripts/ |
| [`perm.declared`](#permdeclared) | obligatoire | Chaque capacité utilisée est déclarée dans « permissions » |
| [`perm.minimal`](#permminimal) | conseil | Aucune permission inutile n'est demandée |
| [`i18n.manifest`](#i18nmanifest) | obligatoire | Les textes de module.json existent en français et en anglais |
| [`i18n.parity`](#i18nparity) | obligatoire | Les fichiers de langue fr et en sont alignés |
| [`i18n.keys`](#i18nkeys) | obligatoire | Toutes les clés de traduction utilisées existent |
| [`i18n.unused`](#i18nunused) | conseil | Pas de traduction inutilisée |
| [`settings.sane`](#settingssane) | obligatoire | Les réglages sont bien formés |
| [`tabs.reasonable`](#tabsreasonable) | conseil | Les onglets ajoutés restent peu nombreux et bien nommés |
| [`settings.optional`](#settingsoptional) | obligatoire | Un réglage « facultatif » le déclare |
| [`settings.advanced`](#settingsadvanced) | obligatoire | Les réglages « advanced » ont une valeur par défaut |
| [`settings.refersToChoice`](#settingsreferstochoice) | conseil | Un réglage qui désigne un élément existant est un « choix parmi » |
| [`settings.textNamesExisting`](#settingstextnamesexisting) | conseil | On ne fait pas taper le nom d'un élément qui existe déjà |
| [`secrets.hidden`](#secretshidden) | obligatoire | Les secrets ne s'affichent ni ne se journalisent jamais |
| [`html.escaped`](#htmlescaped) | obligatoire | Les textes venus de l'extérieur sont échappés dans les pages |
| [`links.safe`](#linkssafe) | obligatoire | Les liens venus de l'extérieur sont vérifiés |
| [`blocks.valid`](#blocksvalid) | obligatoire | Ce que le module renvoie a la bonne forme |
| [`run.noCrash`](#runnocrash) | conseil | Le module ne plante pas, même avec des données inattendues |
| [`routes.methods`](#routesmethods) | obligatoire | Les routes n'écrivent que sur demande explicite (POST) |
| [`routes.size`](#routessize) | obligatoire | Les routes bornent la taille de ce qu'elles reçoivent |
| [`routes.redirect`](#routesredirect) | obligatoire | Aucune redirection vers un site extérieur |
| [`routes.errors`](#routeserrors) | obligatoire | Les réponses d'erreur ne révèlent rien d'interne |
| [`routes.protected`](#routesprotected) | obligatoire | Une route publique qui écrit est protégée contre les abus |
| [`routes.visitorIp`](#routesvisitorip) | conseil | L'adresse du visiteur n'est pas lue dans les en-têtes |
| [`forms.fieldErrors`](#formsfielderrors) | conseil | Une erreur de champ s'affiche sous son champ |
| [`mcp.name`](#mcpname) | obligatoire | Les noms d'outils MCP restent assez courts |
| [`mcp.safety`](#mcpsafety) | obligatoire | Les outils MCP déclarent honnêtement ce qu'ils font |
| [`mcp.readOnly`](#mcpreadonly) | obligatoire | Une action « lecture seule » ne modifie rien |
| [`mcp.described`](#mcpdescribed) | conseil | Les outils MCP sont bien décrits |
| [`tasks.valid`](#tasksvalid) | obligatoire | Les tâches planifiées sont bien déclarées |
| [`tasks.idempotent`](#tasksidempotent) | obligatoire | Lancer une tâche deux fois de suite ne duplique rien |
| [`tasks.failure`](#tasksfailure) | conseil | Une tâche supporte un service indisponible |
| [`net.bounded`](#netbounded) | conseil | Chaque appel réseau a un délai |
| [`net.noIdleTimer`](#netnoidletimer) | conseil | Aucune boucle réseau qui tourne sans personne |
| [`net.429`](#net429) | conseil | Après « trop de demandes » (429), le module fait une pause |
| [`net.fallback`](#netfallback) | conseil | En cas de panne d'un service externe, la page s'affiche quand même |
| [`downloads.bounded`](#downloadsbounded) | conseil | Les téléchargements d'administration sont bornés |
| [`data.version`](#dataversion) | obligatoire | dataVersion et migrations sont cohérentes |
| [`data.migrations`](#datamigrations) | conseil | Les migrations se déroulent sans erreur |
| [`privacy.declared`](#privacydeclared) | obligatoire | Un module qui collecte des données le déclare (privacy) |
| [`privacy.thirdParty`](#privacythirdparty) | conseil | Les services tiers chargés chez le visiteur sont mentionnés |
| [`srp.single`](#srpsingle) | obligatoire | Un module fait une chose ; chaque donnée a un seul propriétaire |
| [`srp.coupling`](#srpcoupling) | conseil | Le module ne connaît pas un autre module par son nom |
| [`wording.simple`](#wordingsimple) | obligatoire | Pas de jargon dans ce que lit la personne |
| [`wording.locales`](#wordinglocales) | conseil | Pas de jargon dans les phrases affichées par le module |
| [`readme.exists`](#readmeexists) | obligatoire | Un README.md explique le module |
| [`readme.plain`](#readmeplain) | conseil | Le README est écrit en langage de tous les jours |
| [`neutrality.clean`](#neutralityclean) | conseil | Aucune donnée personnelle ni propre à un site dans le module |

36 exigences obligatoires et 25 conseils.

### Le fichier module.json

#### `manifest.file`

**Le dossier du module est complet** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le dossier contient un module.json lisible à sa racine, le fichier principal annoncé par « main », aucun lien symbolique, et pèse moins de 10 Mo.
- **Pourquoi.** Le cœur installe un module en lisant son dossier tel quel. Sans module.json à la racine, avec un fichier principal manquant, des liens symboliques ou plus de 10 Mo, l'installation est refusée.
- **Comment corriger.** Placez module.json à la racine du dossier (pas dans un sous-dossier), vérifiez que « main » nomme un fichier qui existe, remplacez les liens symboliques par de vrais fichiers et retirez les gros fichiers inutiles.

#### `manifest.valid`

**module.json est valide** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le manifeste passe la même validation que celle du cœur à l'installation (parseManifest) : champs connus, types corrects, valeurs dans les limites.
- **Pourquoi.** Un manifeste invalide est refusé à l'installation : le module n'apparaît pas dans le catalogue et ne peut pas être essayé.
- **Comment corriger.** Lisez le message : il donne le champ fautif (par exemple « settings.2.key »). Comparez avec docs/MODULES.md, section « Le manifeste module.json », et corrigez ce champ.

#### `manifest.version`

**La version est au format x.y.z** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le champ « version » est faite de trois nombres séparés par des points (1.0.0, 0.3.12), sans suffixe.
- **Pourquoi.** Les mises à jour comparent les versions pour savoir ce qui est plus récent. Un autre format (v1, 1.0, 1.0.0-beta) ne se compare pas correctement.
- **Comment corriger.** Écrivez par exemple « version »: « 1.0.0 », et augmentez-la à chaque nouvelle publication.

#### `manifest.id`

**L'identifiant correspond au nom du dossier** — niveau : **conseil**

- **Ce qui est vérifié.** Le champ « id » est identique au nom du dossier du module.
- **Pourquoi.** Quand plusieurs modules vivent dans un même dépôt (un dossier chacun), retrouver un module par son dossier évite les confusions. Les dépôts de modules reconnus l'exigent.
- **Comment corriger.** Renommez le dossier comme l'« id », ou l'« id » comme le dossier (attention : l'« id » ne doit plus changer une fois le module publié).

#### `manifest.catalogue`

**La fiche du module est complète pour le catalogue** — niveau : **conseil**

- **Ce qui est vérifié.** Le module a un nom et une description en français et en anglais, un auteur et une licence.
- **Pourquoi.** Le catalogue affiche cette fiche avant l'installation. Une description manquante ou dans une seule langue laisse les visiteurs du catalogue sans explication.
- **Comment corriger.** Ajoutez « description »: { « fr »: « … », « en »: « … » }, « author » et « license » (MIT, propriétaire…) dans module.json.

### Compatibilité avec le cœur

#### `compat.apiVersion`

**Le module vise la bonne version de l'API des modules** — niveau : **obligatoire**

- **Ce qui est vérifié.** « apiVersion » vaut la version de l'API des modules que parle ce cœur.
- **Pourquoi.** Un module d'une autre version d'API est refusé plutôt que cassé. C'est la promesse du cœur : tant que la version est la même, le module continue de fonctionner quand le cœur évolue.
- **Comment corriger.** Mettez « apiVersion » à la valeur indiquée dans le message. Si le cœur a changé d'API, lisez CHANGELOG.md : les changements à faire y sont décrits.

#### `compat.minCore`

**minCore couvre les fonctions du cœur utilisées** — niveau : **obligatoire**

- **Ce qui est vérifié.** Si le module utilise une fonction apportée par une version récente du cœur (par exemple « optional » : 0.1.22), « minCore » est au moins cette version.
- **Pourquoi.** Sans « minCore », un site dont le cœur est plus ancien installe quand même le module, et celui-ci se comporte mal (réglage qui n'existe pas, manifeste refusé…). Avec « minCore », le site répond clairement « mettez d'abord le site à jour ».
- **Comment corriger.** Ajoutez dans module.json « minCore »: « x.y.z » avec la version indiquée dans le message (trois nombres, rien d'autre).

#### `compat.minCoreKnown`

**minCore n'est pas plus récent que ce cœur** — niveau : **conseil**

- **Ce qui est vérifié.** « minCore » n'est pas supérieur à la version du cœur qui vérifie le module.
- **Pourquoi.** Si « minCore » dépasse le cœur sur lequel vous testez, ce module ne peut pas s'y installer : vous ne pourriez pas l'essayer.
- **Comment corriger.** Baissez « minCore » à la plus petite version qui apporte ce dont le module a besoin, ou testez avec un cœur à jour.

### Le code du module

#### `def.loads`

**Le code se charge sans erreur** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le fichier principal s'importe, exporte par défaut un objet, et chaque morceau (sections, routes, actions…) est une fonction.
- **Pourquoi.** Un module dont le code ne se charge pas ne fait rien sur le site : le cœur l'écarte et journalise l'erreur.
- **Comment corriger.** Corrigez l'erreur indiquée (souvent une faute de syntaxe ou un import manquant). Le fichier doit finir par « export default { … } ».

#### `def.matches`

**Ce que module.json annonce est ce que le code fait** — niveau : **obligatoire**

- **Ce qui est vérifié.** Chaque section, section d'éditeur d'entrée, action MCP, service offert, sujet partagé, page et overlay déclarés existent dans le code — et inversement. Les emplacements (slots) ont un nom connu, les formulaires pointent vers une route ou une action qui existe (une action d'administration peut être une fonction OU un objet « { right, run } » ; dans une section d'éditeur : une action de cette section), et les services ou sujets appelés sont déclarés.
- **Pourquoi.** Le cœur ne connaît le module que par son manifeste. Une section annoncée mais absente s'affiche vide ; un code jamais annoncé n'est jamais appelé ; un service non déclaré est refusé à l'appel.
- **Comment corriger.** Ajoutez ce qui manque d'un côté ou de l'autre : le message dit si c'est le manifeste (module.json) ou le code (index.mjs) qui est en retard.

#### `code.imports`

**Le module ne dépend de rien d'autre que de ctx** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le code n'importe rien du cœur (« @/… », « src/… »), aucun paquet à installer (npm), aucun fichier hors de son dossier. Seuls sont permis les modules intégrés de Node (« node:… ») et les fichiers du dossier du module.
- **Pourquoi.** Un module est un simple dossier chargé tel quel : pas de « npm install », pas de compilation. Tout ce dont il a besoin lui est donné par ctx. Une dépendance cachée casserait l'installation sur un autre site.
- **Comment corriger.** Remplacez l'import par ce que ctx.api offre (stockage, e-mail, QR…), ou recopiez le petit morceau de code dans votre dossier. Gardez les fichiers du module dans son dossier.

#### `code.noDanger`

**Pas de code dangereux** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le code n'utilise ni eval, ni new Function, ni lancement de commandes (child_process), ni accès direct à la base (Prisma), ni écriture de fichiers sur le disque, ni arrêt du serveur (process.exit).
- **Pourquoi.** Un module tourne dans le serveur avec les droits du site. Ces outils permettent de tout casser ou de tout lire ; ctx.api offre les moyens sûrs de stocker et d'envoyer.
- **Comment corriger.** Stockez avec ctx.api.store, envoyez avec ctx.api.mail, et supprimez l'usage de la fonction citée. Si vous construisez du code à la volée, remplacez-le par une table de correspondance.

#### `load.noNetwork`

**Aucun accès au réseau au chargement** — niveau : **obligatoire**

- **Ce qui est vérifié.** Charger le fichier principal ne déclenche aucune requête réseau (fetch, http, connexion, résolution de nom).
- **Pourquoi.** Le cœur charge tous les modules au démarrage du site, y compris quand Internet ne répond pas. Un module qui appelle un service dès son chargement ralentit ou bloque le démarrage de tout le site.
- **Comment corriger.** Déplacez l'appel réseau dans une fonction (section, route, tâche planifiée) : il ne part alors qu'à la demande, jamais à l'import.

#### `page.scripts`

**Les scripts de page sont de vrais fichiers du dossier scripts/** — niveau : **conseil**

- **Ce qui est vérifié.** Si la page renvoie « scripts » (cœur 0.2.6), ce sont au plus 3 noms de fichiers (lettres minuscules, chiffres, « . », « - » ou « _ », qui finissent par .js) qui existent dans le dossier « scripts/ » du module et pèsent 32 Ko au plus.
- **Pourquoi.** Le cœur sert lui-même ces fichiers, uniquement sur la page concernée, avec une empreinte d'intégrité. Un nom invalide ou un fichier absent est ignoré sans bruit : la page s'affiche, mais sans son script.
- **Comment corriger.** Mettez le script dans scripts/mon-script.js (dossier du module) et renvoyez « scripts: ["mon-script.js"] » avec la page. N'écrivez pas de script en ligne et n'en chargez pas depuis un autre site.

### Les droits demandés

#### `perm.declared`

**Chaque capacité utilisée est déclarée dans « permissions »** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le code n'utilise le stockage, l'e-mail, les sujets d'échange, les jaquettes de jeux, les fichiers envoyés (ctx.api.files), la position du visiteur, les routes, pages, emplacements, sections, overlay, filtres, actions MCP ou l'administration que si la permission correspondante est dans module.json. Le test l'a vérifié en lisant le code et en le faisant tourner avec un contexte qui refuse ce qui n'est pas déclaré.
- **Pourquoi.** Les permissions sont montrées à l'administrateur avant l'installation : c'est ce qui lui permet de dire oui en connaissance de cause. Un module qui en utilise plus qu'il n'en annonce trompe cette confiance.
- **Comment corriger.** Ajoutez la permission citée au tableau « permissions » de module.json — ou retirez du code ce qui l'utilise si ce n'est pas voulu.

#### `perm.minimal`

**Aucune permission inutile n'est demandée** — niveau : **conseil**

- **Ce qui est vérifié.** Chaque permission déclarée correspond à quelque chose que le code fait vraiment.
- **Pourquoi.** Moins un module demande, plus il est facile à accepter pour l'administrateur (principe du moindre privilège). Une permission en trop fait hésiter pour rien.
- **Comment corriger.** Retirez de « permissions » celles que le message cite comme inutilisées.

### Les langues

#### `i18n.manifest`

**Les textes de module.json existent en français et en anglais** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le nom, la description, les libellés de sections, les libellés et aides de réglages (et leurs options) sont fournis en français ET en anglais.
- **Pourquoi.** Le site est multilingue : un texte absent dans la langue du visiteur ou de l'administrateur s'affiche vide ou dans la mauvaise langue.
- **Comment corriger.** Remplacez chaque texte seul par { « fr »: « … », « en »: « … » } dans module.json.

#### `i18n.parity`

**Les fichiers de langue fr et en sont alignés** — niveau : **obligatoire**

- **Ce qui est vérifié.** Si le module a un dossier locales/, il contient fr.json ET en.json avec exactement les mêmes clés, les mêmes variables {x} dans chaque phrase, et aucune traduction vide. Un code qui appelle ctx.t() doit avoir ce dossier.
- **Pourquoi.** Une clé qui n'existe que dans une langue affiche la clé brute (« err_config ») au visiteur. Une variable oubliée donne des phrases à trous (« Bonjour  »).
- **Comment corriger.** Ajoutez la clé manquante dans l'autre fichier, avec les mêmes {variables}. Gardez les deux fichiers triés pareil pour les comparer à l'œil.

#### `i18n.keys`

**Toutes les clés de traduction utilisées existent** — niveau : **obligatoire**

- **Ce qui est vérifié.** Chaque ctx.t("clé") du code correspond à une clé présente dans fr.json et en.json.
- **Pourquoi.** Une clé inconnue s'affiche telle quelle à l'écran (« err_hidden ») au lieu d'une phrase.
- **Comment corriger.** Ajoutez la clé dans fr.json et en.json (ou corrigez la faute de frappe dans le code).

#### `i18n.unused`

**Pas de traduction inutilisée** — niveau : **conseil**

- **Ce qui est vérifié.** Chaque clé des fichiers de langue est utilisée quelque part dans le code.
- **Pourquoi.** Les clés oubliées alourdissent les fichiers et laissent croire qu'un texte existe alors qu'il n'est plus affiché.
- **Comment corriger.** Supprimez les clés citées des deux fichiers de langue (après vérification qu'aucun code ne les construit dynamiquement).

### Les réglages

#### `settings.sane`

**Les réglages sont bien formés** — niveau : **obligatoire**

- **Ce qui est vérifié.** Chaque réglage a une clé unique, un libellé en français et en anglais ; une liste a des options et un défaut qui en fait partie ; un secret n'a jamais de valeur par défaut ; le défaut a le bon type (nombre pour un nombre, couleur #RRGGBB pour une couleur…).
- **Pourquoi.** Ce sont les champs que l'administrateur remplit. Un défaut hors liste ou d'un mauvais type donne un formulaire cassé ou un module qui démarre sur une valeur absurde ; un secret avec un défaut serait publié avec le code.
- **Comment corriger.** Corrigez le réglage cité dans module.json.

#### `tabs.reasonable`

**Les onglets ajoutés restent peu nombreux et bien nommés** — niveau : **conseil**

- **Ce qui est vérifié.** Si le module déclare « tabs » (cœur 0.2.2) : au plus 3 onglets ajoutés en plus des quatre onglets du cœur (Utiliser, Réglages, Sources, Général), et chaque nom d'onglet (ajouté ou renommé) est court (20 caractères au plus) et existe en français ET en anglais.
- **Pourquoi.** Sur un téléphone, la rangée d'onglets défile : au-delà de six ou sept onglets, ou avec des noms longs, on ne voit plus où l'on est et on cherche le bon onglet. Un nom dans une seule langue laisse la moitié des administrateurs devant un mot qu'ils ne lisent pas.
- **Comment corriger.** Regroupez les réglages proches dans un même onglet (« tab » d'un réglage), raccourcissez les noms (« Vidéo », « Ma liste », « Créneaux ») et donnez « label »: { « fr »: « … », « en »: « … » }.

#### `settings.optional`

**Un réglage « facultatif » le déclare** — niveau : **obligatoire**

- **Ce qui est vérifié.** Quand le libellé ou l'aide d'un réglage dit « facultatif », « optionnel » ou « optional », le réglage porte "optional": true.
- **Pourquoi.** Sans cela, le site compte le réglage vide comme « à remplir » et affiche l'extension « À configurer » alors que tout va bien : l'administrateur croit qu'il doit encore faire quelque chose.
- **Comment corriger.** Ajoutez "optional": true au réglage cité (et "minCore": "0.1.22" au module), ou retirez le mot « facultatif » du texte si le réglage est en réalité obligatoire.

#### `settings.advanced`

**Les réglages « advanced » ont une valeur par défaut** — niveau : **obligatoire**

- **Ce qui est vérifié.** Un réglage marqué "advanced": true (nombre, liste ou couleur) a une valeur par défaut raisonnable.
- **Pourquoi.** Les réglages avancés sont cachés en mode simple : la personne ne les voit jamais, c'est donc le défaut qui s'applique. Sans défaut, le module démarre sur du vide.
- **Comment corriger.** Ajoutez "default" au réglage cité, ou retirez "advanced": true s'il doit être rempli par la personne.

#### `settings.refersToChoice`

**Un réglage qui désigne un élément existant est un « choix parmi »** — niveau : **conseil**

- **Ce qui est vérifié.** Un réglage qui déclare « refersTo » (une catégorie, une chaîne, une page, un agenda…) autre que « external » est de type « choice » : la personne choisit dans une liste, elle ne tape pas un nom. Conseil dans le cœur 0.2.0 ; deviendra obligatoire.
- **Pourquoi.** Un nom tapé à la main casse dès que l'élément est renommé, ne voit pas qu'il a été supprimé, et laisse passer les fautes de frappe. Un « choix parmi » garde un identifiant stable, se cache quand il n'y a qu'une option et signale un élément disparu.
- **Comment corriger.** Passez le réglage en « type »: « choice » avec une « source » (« providers » pour une instance qui offre un service, « service » pour un élément d'un autre module), « fromText »: true pour reprendre les valeurs déjà tapées, et « minCore »: « 0.2.0 ». Pour un profil sur une autre plateforme, écrivez « refersTo »: « external ».

#### `settings.textNamesExisting`

**On ne fait pas taper le nom d'un élément qui existe déjà** — niveau : **conseil**

- **Ce qui est vérifié.** Un réglage texte dont l'aide demande de « saisir le nom de… » (« type the name of… », « type the channel name ») un élément du site déclare « refersTo » ; s'il désigne un élément du site, c'est un « choice ». Les profils externes (« profile », « channelId », et « channel » dans un module de type « social ») ne sont pas concernés ; « refersTo »: « external » fait taire la règle.
- **Pourquoi.** La personne doit retrouver et recopier un nom exact, qui casse au premier renommage. Une liste où l'on choisit est plus simple, et le module reçoit un identifiant qui ne change jamais.
- **Comment corriger.** Remplacez le réglage par un « choice » (même clé, « fromText »: true pour convertir les valeurs déjà saisies, « minCore »: « 0.2.0 »). Si c'est un profil sur une autre plateforme (un pseudo, une adresse), ajoutez « refersTo »: « external ».

#### `secrets.hidden`

**Les secrets ne s'affichent ni ne se journalisent jamais** — niveau : **obligatoire**

- **Ce qui est vérifié.** Une valeur de réglage « secret » (clé d'API, mot de passe, code) ne ressort dans aucune page, section, overlay, panneau d'administration, réponse de route, résultat MCP, message d'erreur ni journal. Le test donne une valeur-piège au secret et cherche où elle réapparaît.
- **Pourquoi.** Une page publique, un journal ou une réponse MCP qui contient un secret le livre à n'importe qui. Un secret ne sert qu'à parler au service qui l'a émis.
- **Comment corriger.** Ne mettez jamais la valeur du secret dans un bloc, un message, une réponse ou console.log. Affichez plutôt « enregistré » / « manquant ». Un message d'erreur court suffit.

### Sécurité et forme des pages

#### `html.escaped`

**Les textes venus de l'extérieur sont échappés dans les pages** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le module est essayé avec des données piégées (textes contenant des balises, des scripts, des guillemets) placées dans les réglages, le stockage, les formulaires, l'adresse de la page, le nom du site, les entrées et les sujets reçus. Aucune page, section, emplacement, overlay ni réponse de route ne doit les restituer tels quels.
- **Pourquoi.** Le bloc « html » est brut : ce que vous y mettez est exécuté par le navigateur du visiteur. Un message de livre d'or contenant <script> pourrait voler la session de l'administrateur qui le modère (faille XSS).
- **Comment corriger.** Passez CHAQUE valeur qui n'est pas écrite par vous dans une fonction d'échappement (& < > " ' devenant &amp; &lt; &gt; &quot; &#39;) avant de l'insérer dans du HTML. Voir la fonction esc() de l'exemple guestbook. Préférez les blocs markdown, heading, table, qui échappent seuls.

#### `links.safe`

**Les liens venus de l'extérieur sont vérifiés** — niveau : **obligatoire**

- **Ce qui est vérifié.** Une adresse « javascript:… » saisie dans un réglage, une entrée ou un sujet reçu n'est jamais reprise comme lien, image ou vidéo.
- **Pourquoi.** Un lien « javascript: » s'exécute au clic dans le navigateur du visiteur. Seuls https:, http:, mailto: et les chemins du site (/…) sont sûrs.
- **Comment corriger.** Avant d'utiliser une adresse, vérifiez qu'elle commence par https://, http://, mailto: ou par un seul « / » (pas « // »), sinon ignorez-la. Voir safeSrc() dans l'exemple guestbook.

#### `blocks.valid`

**Ce que le module renvoie a la bonne forme** — niveau : **obligatoire**

- **Ce qui est vérifié.** Les sections, emplacements, pages, panneaux d'administration, overlays et partages renvoient des blocs connus (markdown, html, links, form…) avec leurs champs obligatoires, sous la forme attendue (liste de blocs, { blocks }, { html }…).
- **Pourquoi.** Le cœur affiche ce qu'on lui rend sans le deviner. Un bloc inconnu ou une forme inattendue s'affiche vide ou fait échouer toute la page.
- **Comment corriger.** Comparez avec les exemples de docs/CREATE-A-MODULE.md (sections 5 à 7 et 11) : chaque bloc a un « type » connu et ses champs.

#### `run.noCrash`

**Le module ne plante pas, même avec des données inattendues** — niveau : **conseil**

- **Ce qui est vérifié.** Sections, pages, emplacements, overlay, panneau d'administration et routes terminent sans erreur avec les réglages par défaut, des réglages remplis et des données piégées.
- **Pourquoi.** Le cœur isole les erreurs d'un module (le site continue), mais le visiteur voit alors une section vide ou une page d'erreur. Un module robuste dégrade son affichage sans planter.
- **Comment corriger.** Protégez le code qui lit une donnée optionnelle (valeur absente, liste vide, texte trop long) et répondez par un code 4xx plutôt que de laisser une erreur remonter.

### Les routes (formulaires et envois)

#### `routes.methods`

**Les routes n'écrivent que sur demande explicite (POST)** — niveau : **obligatoire**

- **Ce qui est vérifié.** Appeler une route en GET (lecture simple, y compris via un lien ou une image) ou avec une autre méthode (PUT, DELETE) ne modifie rien : ni stockage, ni e-mail envoyé.
- **Pourquoi.** Un GET peut être déclenché par n'importe quelle page, image ou robot, sans formulaire ni intention de la personne. Seul un POST, soumis à la protection contre les envois venus d'autres sites, est une action volontaire.
- **Comment corriger.** Au début de la route, répondez 405 si request.method n'est pas POST : if (request.method !== "POST") return new Response("Method not allowed", { status: 405 }).

#### `routes.size`

**Les routes bornent la taille de ce qu'elles reçoivent** — niveau : **obligatoire**

- **Ce qui est vérifié.** Envoyer des champs de plusieurs mégaoctets à une route ne remplit pas le stockage : la route refuse (4xx) ou tronque.
- **Pourquoi.** Sans borne, un seul envoi peut remplir la base de données du site (déni de service) ou la ralentir pour tout le monde.
- **Comment corriger.** Limitez chaque champ à sa taille utile avant de le stocker : String(valeur).slice(0, 500). Voir clean() dans l'exemple guestbook.

#### `routes.redirect`

**Aucune redirection vers un site extérieur** — niveau : **obligatoire**

- **Ce qui est vérifié.** Une route ou une action d'administration ne redirige jamais vers une adresse reçue (paramètres next, redirect, return, url…) : seules les adresses du site sont permises.
- **Pourquoi.** Une « redirection ouverte » permet de bâtir un lien qui part de votre site et atterrit chez un escroc : la confiance dans votre adresse sert l'hameçonnage.
- **Comment corriger.** Ignorez les adresses reçues. Si vous devez rediriger, n'acceptez qu'un chemin du site (qui commence par un seul « / »).

#### `routes.errors`

**Les réponses d'erreur ne révèlent rien d'interne** — niveau : **obligatoire**

- **Ce qui est vérifié.** Les réponses des routes sont de vrais objets Response et ne contiennent ni chemin de fichier, ni trace d'erreur, ni détail de base de données ou de réglage secret.
- **Pourquoi.** Un chemin ou une trace aide un attaquant à comprendre le serveur. Un visiteur n'a rien à faire d'un message technique.
- **Comment corriger.** Répondez par un code et un mot (400, 403, 404) sans détail : new Response(null, { status: 400 }) ou Response.json({ ok: false }, { status: 400 }). Journalisez l'erreur côté serveur, brièvement.

#### `routes.protected`

**Une route publique qui écrit est protégée contre les abus** — niveau : **obligatoire**

- **Ce qui est vérifié.** Quarante envois valides, à la suite, depuis le même visiteur, ne sont pas tous acceptés : la route a un limiteur de débit, un plafond de stockage, un code d'accès ou une modération qui la protège.
- **Pourquoi.** Une route ouverte à tous qui écrit sans limite permet à un robot de remplir le stockage du site en quelques minutes.
- **Comment corriger.** Ajoutez un limiteur de débit par visiteur (voir limited() dans l'exemple guestbook : N envois par heure), un plafond du nombre d'éléments stockés (réponse 503 au-delà), et un champ piège pour les robots.

#### `routes.visitorIp`

**L'adresse du visiteur n'est pas lue dans les en-têtes** — niveau : **conseil**

- **Ce qui est vérifié.** Le code ne lit pas lui-même X-Forwarded-For, X-Real-IP ou un en-tête d'adresse du même genre : pour une limite de débit, il demande ctx.api.visitor.fingerprint(request) (cœur 0.2.6). Vérifié seulement quand le cœur qui teste fournit cette fonction.
- **Pourquoi.** Le début de X-Forwarded-For est écrit par le visiteur : le lire permet de contourner la limite en changeant d'adresse inventée à chaque envoi. Le cœur, lui, prend l'entrée ajoutée par SON proxy, la seule de confiance, et ne rend qu'une empreinte salée, jamais l'adresse.
- **Comment corriger.** Remplacez la lecture de l'en-tête par « const who = ctx.api.visitor.fingerprint(request, "envoi") » et comptez par « who ». Déclarez « minCore »: « 0.2.6 ». Ne gardez jamais l'adresse elle-même.

### Les formulaires d'administration

#### `forms.fieldErrors`

**Une erreur de champ s'affiche sous son champ** — niveau : **conseil**

- **Ce qui est vérifié.** Une action d'administration qui refuse une valeur saisie dit QUEL champ pose problème (`errors: { champ: "message" }`) au lieu d'un seul `error` général.
- **Pourquoi.** Un message général s'affiche loin du champ, parfois hors de l'écran sur un téléphone : la personne ne voit pas ce qu'il faut corriger. Avec `errors`, le message apparaît juste sous le champ, qui prend le focus.
- **Comment corriger.** Renvoyez `{ errors: { adresse: "Écrivez une adresse complète, par exemple https://www.monsite.be/contact." } }` (nom du champ → message, avec un exemple). Gardez `error` pour ce qui ne concerne aucun champ.

### Les actions pour les assistants IA (MCP)

#### `mcp.name`

**Les noms d'outils MCP restent assez courts** — niveau : **obligatoire**

- **Ce qui est vérifié.** L'outil visible par l'assistant s'appelle « clé-de-l'instance__nom-de-l'action ». Avec une clé de 31 caractères au plus, le nom d'action fait 31 caractères au plus pour que le total ne dépasse jamais 64.
- **Pourquoi.** Les assistants IA refusent les outils dont le nom dépasse 64 caractères : l'action disparaîtrait sans message pour une instance à clé longue.
- **Comment corriger.** Raccourcissez le nom de l'action dans module.json (« mcp ») et dans le code, par exemple « guestbook_list » plutôt que « list_all_guestbook_messages_for_moderation ».

#### `mcp.safety`

**Les outils MCP déclarent honnêtement ce qu'ils font** — niveau : **obligatoire**

- **Ce qui est vérifié.** Une action qui lit seulement est marquée « readOnly » ; une action qui écrit n'est jamais activée par défaut (« default »: true) ; une action irréversible est « destructive » (et jamais par défaut) ; une action dont le nom parle de suppression ou de publication est « destructive ».
- **Pourquoi.** L'administrateur décide quels outils chaque assistant peut utiliser, et par défaut un assistant reçoit les outils « sûrs ». Un outil qui écrit, annoncé par erreur comme sûr, laisse un assistant modifier le site sans accord.
- **Comment corriger.** Dans module.json (« mcp »), ajoutez "readOnly": true aux lectures, retirez "default": true des écritures, et ajoutez "destructive": true à tout ce qui supprime, retire ou publie.

#### `mcp.readOnly`

**Une action « lecture seule » ne modifie rien** — niveau : **obligatoire**

- **Ce qui est vérifié.** Appeler une action marquée « readOnly » ne modifie pas le stockage et n'envoie pas d'e-mail.
- **Pourquoi.** Les accès en lecture seule donnent des actions « readOnly » aux assistants les moins fiables : si elles écrivent, la protection ne sert à rien.
- **Comment corriger.** Retirez "readOnly": true de l'action si elle écrit vraiment (et mettez-la hors défaut), ou supprimez l'écriture de l'action.

#### `mcp.described`

**Les outils MCP sont bien décrits** — niveau : **conseil**

- **Ce qui est vérifié.** Chaque action a une description claire (une phrase) ; chaque paramètre est décrit, les textes ont une longueur maximale, et chaque paramètre « required » existe.
- **Pourquoi.** L'assistant ne voit que ces descriptions pour choisir l'outil et remplir ses paramètres. Une description vague donne des erreurs et des appels inutiles.
- **Comment corriger.** Complétez « description » de l'action et de chacun de ses paramètres, ajoutez "maxLength" aux textes, en anglais simple.

### Les tâches planifiées

#### `tasks.valid`

**Les tâches planifiées sont bien déclarées** — niveau : **obligatoire**

- **Ce qui est vérifié.** Chaque tâche a un intervalle « everyMinutes » (nombre d'au moins 1) et une fonction « run ».
- **Pourquoi.** Le cœur lance les tâches une fois par minute au plus : un intervalle absent ou inférieur à 1 minute n'est jamais respecté, la tâche ne tournerait pas comme prévu.
- **Comment corriger.** Écrivez par exemple tasks: { refresh: { everyMinutes: 60, async run(ctx) { … } } }.

#### `tasks.idempotent`

**Lancer une tâche deux fois de suite ne duplique rien** — niveau : **obligatoire**

- **Ce qui est vérifié.** Exécuter deux fois la même tâche, dans la même situation, ne crée pas de nouvelles données et n'envoie pas deux fois la même notification.
- **Pourquoi.** Le cœur peut relancer une tâche (après une panne, un redémarrage, une exécution en retard). Sans cette garantie, le site se remplit de doublons ou prévient dix fois du même événement.
- **Comment corriger.** Avant de créer un élément, cherchez s'il existe déjà (par un identifiant stable de la source) et mettez-le à jour au lieu d'en ajouter un. Mémorisez ce qui a déjà été notifié.

#### `tasks.failure`

**Une tâche supporte un service indisponible** — niveau : **conseil**

- **Ce qui est vérifié.** Quand le réseau ne répond pas, la tâche se termine sans erreur (elle note l'échec et réessaiera) au lieu de s'interrompre.
- **Pourquoi.** Le cœur isole les erreurs, mais une tâche qui lève une exception perd son travail en cours et affiche une erreur dans l'administration à chaque panne passagère.
- **Comment corriger.** Entourez l'appel réseau d'un try/catch : en cas d'échec, gardez les anciennes données et terminez normalement.

### Les appels réseau

#### `net.bounded`

**Chaque appel réseau a un délai** — niveau : **conseil**

- **Ce qui est vérifié.** Aucun « fetch( » sans délai : soit l'appel passe par ctx.api.net.request (délai, pauses et disjoncteur fournis par le cœur), soit il porte un « signal » (par exemple AbortSignal.timeout(8000)). Conseil dans le cœur 0.2.0 ; deviendra obligatoire.
- **Pourquoi.** Un appel sans délai vers un service qui ne répond plus attend pour toujours : la page, la tâche ou l'action qui l'attend reste figée, et les appels suivants s'empilent jusqu'à faire tomber le site entier.
- **Comment corriger.** Remplacez « await fetch(url) » par « await ctx.api.net.request({ url }) » (il ne lève jamais : testez « r.ok »), ou au minimum ajoutez « { signal: AbortSignal.timeout(8000) } » à l'appel.

#### `net.noIdleTimer`

**Aucune boucle réseau qui tourne sans personne** — niveau : **conseil**

- **Ce qui est vérifié.** Le code ne lance pas de minuteur répétitif (setInterval) : un travail régulier est une tâche planifiée déclarée (« tasks »), et un appel réseau ne part que quand quelqu'un en a besoin (une page, une action, une tâche).
- **Pourquoi.** Un setInterval tourne même quand personne ne regarde, n'est jamais arrêté à la désactivation du module, se multiplie à chaque rechargement du code, et appelle des services externes pour rien : quotas consommés, pannes aggravées.
- **Comment corriger.** Déclarez une tâche planifiée (tasks: { refresh: { everyMinutes: 15, run } }) : le cœur la lance une fois par instance active, sans chevauchement. Ou bien calculez à la demande et gardez le résultat en cache daté.

#### `net.429`

**Après « trop de demandes » (429), le module fait une pause** — niveau : **conseil**

- **Ce qui est vérifié.** Sonde : toutes les adresses répondent 429 avec « Retry-After: 120 ». On fait tourner deux fois les tâches planifiées et les routes du module ; au second passage, il ne doit partir AUCUN appel réseau. Conseil dans le cœur 0.2.0 ; deviendra obligatoire.
- **Pourquoi.** Un service qui répond 429 demande une pause. L'ignorer prolonge le blocage, peut faire bannir la clé ou l'adresse du site, et gaspille le temps des pages. ctx.api.net s'en charge seul : jusqu'à la reprise, il répond « rate » sans appeler le réseau.
- **Comment corriger.** Passez par ctx.api.net.request (la pause est automatique, partagée par tout le site). Sinon, notez « Retry-After » (en secondes ou en date) dans votre stockage et ne rappelez pas avant cette heure.

#### `net.fallback`

**En cas de panne d'un service externe, la page s'affiche quand même** — niveau : **conseil**

- **Ce qui est vérifié.** Sonde « trou noir » : le réseau ne répond jamais. Chaque section, emplacement et page du module doit rendre la main en moins de 3 s, sans erreur (avec les dernières données connues et leur date, ou un message simple).
- **Pourquoi.** Un service externe finit toujours par tomber. Si la page attend sa réponse, elle se fige pour tous les visiteurs ; le cœur coupe alors la section, et le visiteur ne voit rien du tout.
- **Comment corriger.** Dans une page, ne lancez pas d'appel réseau long : affichez ce que la tâche planifiée a mis en cache (avec « mis à jour à 10 h 30 »), ou passez par ctx.api.net.request, dont le délai suit le temps restant de la page, et affichez un repli si « r.ok » est faux.

### Les données

#### `downloads.bounded`

**Les téléchargements d'administration sont bornés** — niveau : **conseil**

- **Ce qui est vérifié.** Chaque téléchargement déclaré dans adminDownloads a un nom de fichier, un type connu, un droit déclaré dans module.json (si « right » est donné), et son générateur FINIT : avec des données d'essai, il produit moins de 20 Mo, en moins de 5 secondes, et n'envoie que du texte.
- **Pourquoi.** Un export contient souvent des données personnelles : il est servi par le cœur (droit, journal d'audit), mais c'est le module qui le produit. Un générateur qui ne s'arrête pas, ou qui construit tout en mémoire, bloque le site ; le cœur le coupe à 512 Mo ou 10 minutes, et l'administratrice n'obtient alors qu'un fichier en échec.
- **Comment corriger.** Lisez le stockage par pages (ctx.api.store.page, 1 000 lignes) dans une boucle qui s'arrête à la dernière page, produisez le texte ligne par ligne avec « yield », et déclarez le droit dans « rights » de module.json.

#### `data.version`

**dataVersion et migrations sont cohérentes** — niveau : **obligatoire**

- **Ce qui est vérifié.** Chaque migration porte un numéro entre 2 et dataVersion ; un module sans dataVersion n'a pas de migrations ; un module qui change la forme de ses données (dataVersion > 1) les convertit.
- **Pourquoi.** Quand la forme des données stockées change, les anciennes données d'un site doivent suivre. Le cœur rejoue les migrations dans l'ordre après une mise à jour : une migration au mauvais numéro ne serait jamais jouée et laisserait des données illisibles.
- **Comment corriger.** Augmentez « dataVersion » de 1 à chaque changement de forme des données et écrivez migrations: { 2: async (ctx) => { … } } qui convertit celles de la version précédente.

#### `data.migrations`

**Les migrations se déroulent sans erreur** — niveau : **conseil**

- **Ce qui est vérifié.** Chaque migration s'exécute sans erreur sur un stockage vide, et deux fois de suite sans rien dupliquer.
- **Pourquoi.** Une migration qui échoue met l'instance à l'écart sur le site réel. Le test sur stockage vide attrape les erreurs les plus bêtes avant qu'un administrateur ne les rencontre.
- **Comment corriger.** Traitez le cas « rien à convertir » (liste vide) et ne supposez aucun champ : lisez-les avec une valeur par défaut.

### La vie privée

#### `privacy.declared`

**Un module qui collecte des données le déclare (privacy)** — niveau : **obligatoire**

- **Ce qui est vérifié.** Si le module reçoit des données de visiteurs (formulaire public qui enregistre ou envoie quelque chose), module.json a un texte « privacy » en français et en anglais : quoi, pourquoi, comment faire effacer.
- **Pourquoi.** Le site écrit lui-même sa politique de confidentialité d'après ce que déclarent ses modules. Sans votre déclaration, elle serait fausse — et le propriétaire du site responsable d'une collecte qu'il ignore.
- **Comment corriger.** Ajoutez dans module.json : "privacy": { "fr": "Si vous … votre nom et votre message sont … Pour les faire retirer, écrivez au contact du site.", "en": "…" }.

#### `privacy.thirdParty`

**Les services tiers chargés chez le visiteur sont mentionnés** — niveau : **conseil**

- **Ce qui est vérifié.** Si une page du module charge quelque chose depuis un autre site (vidéo intégrée, script, iframe), module.json le dit dans « privacy ».
- **Pourquoi.** Charger un service tiers transmet l'adresse (IP) du visiteur à ce service. C'est une information que le propriétaire doit connaître et pouvoir donner dans sa politique de confidentialité.
- **Comment corriger.** Ajoutez une phrase dans « privacy » (fr et en) : « Cette page charge un lecteur de <service> : … », ou n'intégrez pas le service.

### Un module, une seule chose

#### `srp.single`

**Un module fait une chose ; chaque donnée a un seul propriétaire** — niveau : **obligatoire**

- **Ce qui est vérifié.** Comparé aux autres modules du même ensemble : pas de service offert par deux modules, pas d'action MCP du même nom, pas de réglage secret identique demandé à deux modules sans lien, pas de collection de données de même nom chez deux modules sans lien.
- **Pourquoi.** Deux modules qui offrent la même chose ou demandent la même clé obligent l'administrateur à tout saisir deux fois et créent des conflits. Une donnée a un propriétaire ; les autres modules la demandent à ce propriétaire (service).
- **Comment corriger.** Confiez la donnée ou la clé à un seul module (fournisseur) que l'autre appelle par un service (offers / requires), ou renommez ce qui n'est qu'une coïncidence de nom.

#### `srp.coupling`

**Le module ne connaît pas un autre module par son nom** — niveau : **conseil**

- **Ce qui est vérifié.** Le code ne cherche pas les instances d'un module précis (ctx.api.instances.list({ module: "…" })) : il dépend d'un service ou d'un sujet, pas d'un module.
- **Pourquoi.** On dépend d'un service, jamais d'un module précis : n'importe quel module qui l'offre doit convenir. Une dépendance nommée casse dès que l'autre module est remplacé ou renommé.
- **Comment corriger.** Déclarez ce dont vous avez besoin avec « requires » (service) ou « consumes » (sujet) et appelez ctx.api.services / ctx.api.topics.

### Les mots et la documentation

#### `wording.simple`

**Pas de jargon dans ce que lit la personne** — niveau : **obligatoire**

- **Ce qui est vérifié.** Le nom, la description, les libellés de sections et les libellés, aides et options des réglages non avancés n'emploient aucun terme technique (sujet, métrique, API, JSON, jeton, OAuth, MCP…).
- **Pourquoi.** Ces textes sont ce que voit Emma, qui n'a aucun bagage technique. Un réglage doit dire « Adresse de votre salon Discord », pas « webhookUrl ». Les réglages techniques vont en mode avancé ("advanced": true).
- **Comment corriger.** Réécrivez la phrase avec des mots de tous les jours, ou marquez le réglage "advanced": true s'il n'est destiné qu'aux techniciens.

#### `wording.locales`

**Pas de jargon dans les phrases affichées par le module** — niveau : **conseil**

- **Ce qui est vérifié.** Les textes des fichiers de langue (messages, erreurs, titres) n'emploient pas de terme technique.
- **Pourquoi.** Ce sont les phrases que lisent les visiteurs et l'administrateur. Une erreur « JSON invalide » ne dit pas quoi faire ; « Ajoutez votre clé dans Réglages » si.
- **Comment corriger.** Reformulez en disant ce qui se passe et ce qu'on peut faire, avec des mots simples.

#### `readme.exists`

**Un README.md explique le module** — niveau : **obligatoire**

- **Ce qui est vérifié.** Un fichier README.md à la racine du dossier, d'au moins quelques phrases.
- **Pourquoi.** Le catalogue affiche le README avant l'installation : c'est la vitrine du module (à quoi il sert, ses réglages, ses limites). Sans lui, personne n'ose l'installer.
- **Comment corriger.** Créez README.md : une phrase sur ce que fait le module, la liste de ses réglages en mots simples, ses limites, et si vous le souhaitez un lien pour un don volontaire.

#### `readme.plain`

**Le README est écrit en langage de tous les jours** — niveau : **conseil**

- **Ce qui est vérifié.** Le README n'emploie pas de termes techniques (API, JSON, endpoint…) hors des blocs de code.
- **Pourquoi.** Le README s'adresse d'abord à quelqu'un qui veut savoir si le module lui sert, pas à un développeur.
- **Comment corriger.** Réécrivez les passages cités. Les détails techniques peuvent rester dans une section « Pour les développeurs » à la fin.

#### `neutrality.clean`

**Aucune donnée personnelle ni propre à un site dans le module** — niveau : **conseil**

- **Ce qui est vérifié.** Aucun fichier du module ne contient un des termes interdits de votre liste de neutralité (noms, domaines, adresses réels), ni une adresse e-mail personnelle courante.
- **Pourquoi.** Un module se partage : y laisser le nom de son propre site ou une adresse réelle livre ces informations à tous ceux qui l'installent. Utilisez des exemples neutres (example.org, « Demo »).
- **Comment corriger.** Remplacez l'élément cité par une valeur d'exemple. Pour une liste de termes à vérifier, créez un fichier .neutrality-terms (un terme par ligne) ou la variable NEUTRALITY_TERMS.

## Limites connues

- La suite lit votre code avec des motifs simples (permissions, imports, appels de `ctx.t`) : un code très dynamique peut lui échapper. Les sondes d'exécution comblent une partie de ce manque.
- Les sondes de sécurité n'ont pas de service tiers à interroger : un module qui n'affiche des données qu'après un appel réseau réussi n'est essayé qu'avec ses données locales. Testez ces cas avec `fakeFetch` dans vos propres tests.
- « Un propriétaire par donnée » (`srp.single`) demande à voir les autres modules : sans `--voisins` ou voisins de dossier, il est « sans objet ».
- La neutralité (`neutrality.clean`) utilise votre liste de termes : fichier `.neutrality-terms` (un terme par ligne) ou variable `NEUTRALITY_TERMS`.
- Le fichier que vous lisez est généré par `node testsupport/docs.mjs --write` à partir des exigences : ne le modifiez pas à la main.
