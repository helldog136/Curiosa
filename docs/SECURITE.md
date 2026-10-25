# Sécurité de la connexion

Ce que fait Curiosa pour protéger l'espace de gestion, et comment vous dépanner si vous êtes bloqué.

## Essais ratés : des blocages qui ne sont jamais définitifs

Après **5 mots de passe faux de suite**, la connexion est bloquée **1 heure**. Après 5 erreurs de plus, **3 heures**, puis 5, 8, 13, 21, 34, 55 et 89 heures (la suite de Fibonacci, plafonnée). Le message dit toujours à quelle heure on peut revenir : une personne maladroite retrouve toujours son accès.

- Le blocage vaut pour l'**adresse IP** (tous les comptes) et pour l'**adresse e-mail** (même si elle n'existe pas : on ne révèle rien sur les comptes).
- Un inconnu ne peut pas enfermer le propriétaire dehors : le blocage d'un e-mail **ne s'applique pas depuis une adresse d'où cette personne s'est déjà connectée ces 30 derniers jours**.
- Une connexion réussie remet les compteurs à zéro ; sans aucune erreur pendant 7 jours, les paliers retombent aussi.
- Tout est gardé **en base** : redémarrer le site ne débloque personne. Chaque blocage est inscrit dans le journal d'audit.
- Le propriétaire peut **débloquer** quelqu'un depuis *Utilisateurs* (le message « Bloqué jusqu'à… » et le bouton *Débloquer* apparaissent à côté de son e-mail).

### Derrière un reverse proxy

L'adresse du visiteur est lue dans l'en-tête `X-Forwarded-For`, **à la fin** : c'est l'entrée que **votre proxy** ajoute (voir la configuration nginx du [README](../README.md#installer)). Le début de l'en-tête vient du visiteur et peut être inventé, il est ignoré. Si plusieurs proxys se suivent devant le site, indiquez leur nombre avec `CURIOSA_TRUSTED_PROXIES` (1 par défaut). Une adresse IPv6 compte pour tout son réseau /64.

Cette règle est la **seule** : le comptage des visites (`/api/hit`) la suit depuis la 0.2.6, et les modules n'ont pas à la réimplémenter. Ils demandent `ctx.api.visitor.fingerprint(request, portée)` : une empreinte salée (HMAC-SHA-256, sel au hasard gardé en mémoire seulement, renouvelé chaque jour, propre au module et à la portée) qui ne permet pas de retrouver l'adresse. Le cœur ne garde rien par visiteur. Un module qui lit lui-même `X-Forwarded-For` prendrait la première entrée, que le visiteur écrit.

## Double vérification (code à usage unique)

Chacun peut l'activer dans **Mon compte → Double vérification** : on scanne un QR code avec une application d'authentification (Google Authenticator, Authy, 1Password…), puis on confirme avec le code affiché. Ensuite, la connexion se fait en deux temps : mot de passe, puis code à 6 chiffres.

- **8 codes de secours** sont donnés à l'activation (une seule fois) : chacun ne sert qu'une fois si le téléphone est perdu. On peut en générer de nouveaux (mot de passe demandé), ce qui annule les anciens.
- Un code ne sert **jamais deux fois**, même dans ses 30 secondes de validité. Un mauvais code compte comme un mot de passe raté : il alimente les mêmes blocages.
- Le mot de passe seul n'ouvre **jamais** un compte protégé, y compris en s'adressant directement à l'API d'authentification.
- Désactiver demande le mot de passe **et** un code.
- Le propriétaire peut **exiger la double vérification de toute l'équipe** (page *Utilisateurs*), à condition de l'avoir activée lui-même ; chacun la configure alors à sa prochaine visite. Il peut aussi **réinitialiser** celle d'un collègue qui a perdu son téléphone et ses codes.
- Le secret est gardé dans la base (comme le reste de vos données) : protégez-la et ses sauvegardes, qui sont chiffrées.

## Clés d'accès (passkeys)

La méthode la plus sûre : on se connecte avec l'**empreinte, le visage, le code de l'appareil** ou une clé de sécurité (YubiKey), **sans mot de passe ni code**. À enregistrer dans **Mon compte → Clés d'accès** (une par appareil, dix au plus ; le mot de passe est redemandé pour en ajouter ou en retirer). Sur la page de connexion, le bouton *Se connecter avec une clé d'accès* n'exige aucun e-mail.

- Le site ne garde que la **clé publique** ; la clé privée ne quitte jamais l'appareil. Une clé n'est valable que pour **le domaine du site** : un faux site ne peut pas s'en servir.
- La vérification de la personne (empreinte, code…) est **exigée** : une clé d'accès vaut les deux facteurs à elle seule, elle n'est donc pas suivie du code de la double vérification.
- Le mot de passe reste possible à côté (avec son code si la double vérification est activée) : une clé d'accès s'ajoute, elle ne remplace rien d'office.
- Les clés d'accès comptent pour l'exigence de double vérification de l'équipe.
- **Le domaine compte** : réglez `SITE_URL` dans `.env` avec l'adresse définitive du site. Si elle change, les clés d'accès déjà enregistrées ne fonctionnent plus (le mot de passe, lui, continue) et il faut les recréer.
- Un propriétaire qui perd l'accès à ses appareils se dépanne en SSH (voir plus bas) : la commande `reset-2fa` retire aussi ses clés d'accès. Pour un collègue, *Utilisateurs → Réinitialiser sa double vérification et ses clés d'accès*.

## Robots IA et llms.txt

`robots.txt` exclut toujours `/admin`, `/api` et `/m/` pour tous les robots ; il ne protège de rien (un robot malhonnête l'ignore) : la protection d'une page privée est son authentification, jamais `robots.txt`. `/llms.txt` est généré à partir des seules données publiques (aucune adresse e-mail, aucun brouillon, aucune page non publiée), borné à 40 Ko et 120 liens ; les liens des réseaux sociaux n'y figurent qu'en `https`. Les JSON-LD des modules passent par `ctx.api.seo.jsonLd` : bornés, `</script>` échappé, jamais exécutés comme du code. Voir [GEO.md](GEO.md).

## Assistants IA (MCP) : deux façons de s'authentifier

Un assistant se connecte à `/api/mcp` avec un **jeton** (`vit_…`, créé par le propriétaire, affiché une seule fois, seul son hash est gardé). Deux modes :

- **En-tête (par défaut, recommandé)** : `Authorization: Bearer vit_…`. Le jeton ne figure ni dans l'adresse ni dans les journaux du serveur web. C'est ce qu'utilisent Claude Code, Cursor, VS Code, Windsurf, MCP Inspector et les scripts.
- **Adresse secrète (option par jeton, désactivée par défaut)** : `{SITE_URL}/api/mcp/<jeton>`, pour les clients qui ne savent saisir qu'une adresse (les « connecteurs personnalisés » de claude.ai). **L'adresse EST le mot de passe** : elle apparaît dans les journaux de votre serveur web ou de votre proxy (nginx…), elle ne doit pas être partagée, et si elle fuit il faut **révoquer le jeton**. Seul le propriétaire peut l'autoriser (à la création du jeton, ou ensuite sur la page du jeton) ; l'adresse complète n'est montrée qu'à la création. Un jeton qui n'a pas l'option est refusé par adresse, même s'il est valide en en-tête.

Garde-fous communs : droits réglés jeton par jeton et action par action, relus à chaque requête ; 120 requêtes par minute et par jeton ; révocation immédiate (elle retire aussi l'option d'adresse). Garde-fous propres à l'adresse : un jeton inconnu, mal formé, révoqué ou non autorisé par adresse reçoit **la même réponse** (404) ; le jeton n'est jamais écrit dans le journal d'audit (qui note seulement « connexion par adresse activée/désactivée » avec le nom du jeton), ni dans les erreurs ; les réponses portent `Cache-Control: no-store` et `Referrer-Policy: no-referrer`. Si vous activez l'option, évitez de journaliser les chemins des requêtes `/api/mcp/` dans votre proxy (le serveur de développement `next dev` les affiche aussi dans son terminal ; le serveur de production ne journalise pas les requêtes).

## Maintenance par IA : modèle de menace

Le serveur MCP du cœur propose des outils de **maintenance** (`maintenance_…`, voir [MAINTENANCE-IA.md](MAINTENANCE-IA.md)) pour qu'une IA surveille le site et l'entretienne. Ce sont des outils du cœur, pas d'un module, au même format que les autres (annotations `readOnlyHint` / `destructiveHint`, `default`, accès jeton par jeton, relus à chaque requête).

**Ce que chaque niveau permet, et ce qui le borne**

| Niveau | Permet | Défaut | Borne |
|---|---|---|---|
| 1 : lecture | état, santé, modules, mises à jour, diagnostic, audit, **catalogue des modules et fiche d'un module** (`maintenance_catalog_list/get`) | actif **seulement** pour un jeton « Maintenance » (désactivé pour tout autre jeton) | lecture seule ; sorties masquées et bornées |
| 2 : sans risque | revérifier, copie de la base sur le serveur, réinstaller un module (données gardées), relancer une instance, vérifier le contenu du site (visites de liens bornées), **lire et régler les réglages d'une instance** (`maintenance_module_settings`, `_configure`, `_configure_advanced`) | désactivé | accordé action par action ; verrou ; 12 actions par heure et par jeton ; jamais un secret ; les réglages avancés ont leur outil à part |
| 3 : à risque (`destructive`) | **installer un module du catalogue**, mises à jour du cœur et des modules, désinstallation | désactivé, **jamais** `default: true` | **validation humaine par défaut** ; versions stables seulement ; revérification à l'exécution |

Il n'y a **volontairement pas** d'outil de restauration : elle remplace tout le site et demande le mot de passe de la sauvegarde. Jamais exposés : secrets, mots de passe, jetons, variables d'environnement, contenu des sauvegardes, réglages de sécurité, utilisateurs, gestion des jetons, fichiers arbitraires, commandes arbitraires. Un jeton « Maintenance » n'a **que** ces outils : les actions des modules y sont désactivées par défaut, y compris celles qu'un module ajouterait plus tard (`access.ts`, `MAINTENANCE_PROFILE`).

**Menaces et réponses**

- *IA compromise ou manipulée (injection de consignes dans un texte qu'elle lit)* : au pire elle peut **demander**. Avec la validation humaine, le niveau 3 se limite à une demande en attente que seul le **propriétaire connecté** peut approuver (les administrateurs et éditeurs n'ont pas ce droit) ; l'approbation ne s'applique qu'à ce qui est décrit dans la demande, en langage simple. Les niveaux 1 et 2 ne peuvent rien détruire ni rien exfiltrer : pas de secret dans les sorties, la copie de la base n'est ni lisible ni téléchargeable par l'API, et la file est bornée (5 demandes par jeton, 12 actions par heure).
- *Jeton volé* : mêmes limites que ci-dessus (c'est le pire cas d'une IA compromise), et le propriétaire le **révoque** en un clic ; l'exécution directe, elle, doit avoir été choisie **explicitement** pour ce jeton, avec un avertissement : ne l'activez que pour une IA de confiance. La connexion par adresse secrète reste désactivée par défaut.
- *Demande forgée* : une demande n'existe que créée par un outil appelé avec un jeton qui en a le droit ; elle est liée à ce jeton (une IA ne relit que les siennes). Son contenu (le « plan » : versions de départ et d'arrivée) est figé à la création, puis **revérifié au moment d'exécuter** ; une demande dont la cible a changé n'est pas exécutée. Une demande ne s'approuve **qu'une fois** (passage atomique « en attente → en cours »), expire au bout de **24 heures**, et une demande refusée ou expirée ne s'exécute jamais, même si on tente de l'approuver ensuite.
- *Mise à jour vers un code non éprouvé* : le cœur **n'exécute jamais** de mise à jour demandée par une IA vers une version candidate (`X.Y.Z-rc.N`) ou un instantané `dev-…`, quel que soit le canal du site (un site sur le canal des candidates peut être mis à jour à la main par l'administrateur, jamais par l'IA), et jamais de rétrogradation. Une candidate n'a pas fini d'être éprouvée : si elle est défaillante, une mise à jour automatisée sans regard humain étendrait le dégât. `core_update` ne vise que la plus haute release **stable**, `startUpdate(…, { stableOnly })` le refuse une seconde fois en dernier recours, et un module n'est mis à jour que s'il suit des étiquettes stables `vX.Y.Z` (pas une branche, pas un commit, pas une préversion). Un module qui exige un cœur plus récent est refusé.
- *Fuite par les sorties* : tout texte venu d'ailleurs (journaux, erreurs, adresses de dépôt, notes de version, détails d'audit) passe par un masquage de secrets (jetons `vit_…`, clés, mots de passe, adresses avec jeton, longues suites opaques) et des bornes de taille. Il n'y a pas de lecture libre des journaux du serveur : seulement la fin du journal de mise à jour, filtrée, et les erreurs des instances.
- *Installer du code à la place de la propriétaire* : `maintenance_module_install` ne prend qu'un **identifiant du catalogue officiel** (jamais une adresse : pas de SSRF, pas de dépôt choisi par l'IA ; l'index supplémentaire non vérifié et les dépôts personnels sont refusés, `confirmExtra` n'est jamais passé). Il crée **toujours une demande**, même pour un jeton en exécution directe (aucune classification « module sans danger » n'existe dans le modèle ; le réglage direct vaut pour les mises à jour et désinstallations). La demande fige la version et la liste des modules qui viendront avec (jamais installés en cachette) ; l'approbation relit tout et refuse si l'un a changé. L'installation passe par `installFromCatalogue` comme l'admin (étiquette épinglée, identifiant relu, cœur minimal, annulation en bloc). Toutes les lectures du catalogue passent par le client existant (hôtes permis, 15 min de cache, attente bornée à 20 s).
- *Réglages lus ou posés par l'IA* : un réglage `secret` n'est **jamais** lu (seulement « renseigné ») ni écrit (refus avec le chemin de l'écran d'admin) ; les adresses sont montrées sans identifiant, requête ni ancre ; la valeur de chaque réglage passe par le masquage des secrets ; seuls les réglages déclarés par le manifeste sont touchés (ni droits, ni rôles, ni nom, menu ou chemin public) ; la validation est celle de l'admin, tout est contrôlé avant d'écrire ; 20 réglages au plus par appel ; l'ancienne et la nouvelle valeur (hors secrets) sont dans le journal d'audit. Les réglages « avancés » exigent l'outil `maintenance_module_configure_advanced`, que le propriétaire accorde à part.
- *Fausse sécurité* : toute action de niveau 2 ou 3 est inscrite au journal d'audit (`mcp.maintenance.<outil>` : nom du jeton, paramètres sans secret, résultat) ; les décisions humaines aussi (`approve`, `deny`). Les adresses e-mail des humains ne sont jamais données à l'IA.
- *Avertissement* : le propriétaire est averti dans l'admin (pastille, tableau de bord) et, s'il le choisit, par le service e-mail du cœur, sans secret dans le message.

## Contrôle du contenu : visites de liens sortants

Le cœur visite lui-même des adresses venues du contenu (liens d'un texte, du menu, des raccourcis) : c'est une porte d'entrée classique pour sonder le réseau interne (SSRF). Les réponses, dans `src/core/maintenance/content/` et `src/core/url.ts` :

- *Adresse interne ou piégée* : refusée **avant toute résolution** (`hostProblem`) : autre schéma, identifiants, port ≠ 443, adresse numérique sous toute écriture, noms `localhost` / `.local` / `.lan` / `.internal` / sans point. Idem à **chaque redirection** (5 au plus, une boucle est coupée).
- *Nom qui mène à une adresse privée, et rebinding* : le nom est résolu **une fois** ; une seule adresse privée, locale ou réservée (`addressIsPrivate`) refuse tout le nom. La connexion est ouverte avec un `lookup` qui ne rend que les adresses vérifiées : pas de seconde résolution, un nom non vérifié n'est jamais contacté (fail closed). Le certificat reste celui du nom.
- *Marteler un site* : 200 liens par vérification, 25 par site, jamais deux visites de suite sur le même site, 250 ms entre visites, HEAD puis GET de 2 Ko, délai de 6 s par demande, et un site qui répond « trop de demandes » n'est plus contacté. Le disjoncteur du client réseau du cœur s'applique.
- *Visites non voulues* : jamais en arrière-plan ni planifiées ; un clic d'administrateur (ou l'outil `maintenance_content_check_run`, niveau 2, accordé jeton par jeton) ; un seul passage à la fois.
- *Fuite* : le rapport ne garde ni paramètres, ni fragments, ni identifiants d'adresse ; les outils de l'assistant IA ne donnent que le **nom** du site visité, sans secret. Le lien « Corriger » est choisi dans une liste fermée d'écrans d'administration (aucune redirection ouverte, même si le rapport gardé était modifié).

## Réinstaller un module (propriétaire seulement)

Remettre le code d'un module à neuf (*Modules › le module › Maintenance*) exécute du code côté serveur : l'action est réservée au **propriétaire**, avec confirmation dans la page. Elle ne reprend que la source du module (le dépôt du catalogue ou le dépôt git déjà connu, mêmes règles d'hôtes que l'installation), **n'accorde jamais de nouvelle permission** (refus, il faut passer par la mise à jour), met l'ancien dossier de côté et le rétablit au moindre échec, et est inscrite au journal (`module.reinstall`, sans adresse ni secret).

## Installer d'office : seulement l'officiel, seulement ce qui est exigé

- **Origine** : une entrée du catalogue vaut `official` (dépôt du catalogue ou sa dernière copie reçue) ou `extra` (index supplémentaire `MODULES_INDEX_URL`). Une entrée `extra` n'est **jamais** installée ni mise à jour d'office (cascade de dépendances, graine, restauration d'un fournisseur manquant) : le manque est signalé (raison « extra »). Elle ne s'installe que par le propriétaire, après l'avertissement « non vérifié par le catalogue officiel » et une case cochée (`confirmExtra`, revérifié côté serveur). À service égal, l'officiel passe toujours avant. Seule exception : restaurer une sauvegarde remet un module `extra` que le propriétaire avait déjà installé (il confirme la restauration).
- **Besoin facultatif** (`requires[].optional`) : jamais installé d'office, ne retient pas son fournisseur.
- **Bloc `suggestInstall`** : seul un clic du **propriétaire** installe (action serveur `installSuggested`, rôle propriétaire exigé, puis revérifiés : l'instance existe, son module déclare le service dans `requires`, l'entrée du catalogue offre bien ce service en version suffisante, est compatible, et une entrée `extra` porte la case cochée). Un administrateur ou un rédacteur lit seulement « Demandez au propriétaire… ». `ctx.api` n'expose aucune installation : ni un service, ni une tâche, ni une migration, ni le MCP ne peuvent en déclencher. Audit : `module.install.suggested` (module, service, origine ; jamais de secret). La lecture du catalogue pendant le rendu est bornée à 2 s.
- **Mise à jour** : aucune migration de données tant qu'un `requires` dur de la nouvelle version manque ; sinon tout est défait (fichiers, ligne du module, modules apportés par la cascade) et les données restent intactes.

## Module qui sème une instance (modèle de menace)

Pendant la migration de données d'un module, il peut demander au cœur de créer une instance d'**un autre** module avec des réglages initiaux (`ctx.seedInstance`, voir [MODULES.md](MODULES.md#migrations--faire-évoluer-ses-données)). Un module ne peut toujours ni lire ni écrire les réglages ou les instances d'un autre ; ce que le cœur autorise est étroit :

- *Module malveillant qui sème n'importe où* : refusé. La cible doit être déclarée dans `seeds` du manifeste **et** être reliée au module : offrir un service que le module `requires`, ou fournir un sujet qu'il `consumes`. Une mise à jour qui ajoute `seeds` ne contourne rien : la cible n'est qu'un fournisseur dont le module dépend déjà (ou dépendrait, s'il est installé) ou dont il lit déjà les sujets, et l'installation reste celle du catalogue (modules du catalogue reconnus et compatibles seulement, jamais un dépôt personnel).
- *Écraser ou lire une instance existante* : impossible. Le semis crée toujours une instance **neuve** ; il n'y a aucune lecture. Un module cible en instance unique déjà instancié refuse.
- *Semer en boucle (spam d'instances)* : une graine (`seedKey`) ne sème qu'une fois par instance semeuse, la marque est hors de portée du module ; l'API n'existe que pendant sa migration (une fois par version de données), pour 3 cibles au plus.
- *Réglage détourné* : les réglages sont validés par le manifeste du **module cible** avec les règles de l'admin (adresses `http(s)`, nombres, choix, couleurs) ; une clé inconnue refuse tout. Un secret n'apparaît ni dans le message d'erreur, ni dans le journal d'audit, ni dans les journaux du serveur.
- *Effacer les réglages d'autrui* : `ctx.clearSetting` ne touche que les réglages **déclarés par le module lui-même**, pour **sa propre** instance, et seulement après un semis abouti ; tout revient si la migration échoue.
- *Échec à mi-chemin* : l'instance créée, la marque et le module cible installé pour l'occasion sont retirés ; l'instance semeuse est remise à l'écart (« Réessayer ») ; le journal ne garde rien d'un semis défait.
- *Traces* : `module.seed` (semeur → cible : clé de l'instance créée), jamais de valeur. Limite connue : un secret semé est stocké comme tous les réglages de l'instance (dans la base, donc dans ses sauvegardes chiffrées) ; un module cible malveillant pourrait le lire, comme n'importe quelle instance de lui — c'est pourquoi on ne sème que chez un module dont on dépend et que l'administrateur a choisi d'installer.

## Réglages hérités et balayage du démarrage (0.2.0)

- Un réglage déclaré dans `legacySettings` n'est **jamais affiché** (ni en mode simple, ni en mode avancé : il n'est pas dans `settings`). Seul le module de l'instance le lit, par `ctx.legacy.get` ; la valeur reste en mémoire.
- `ctx.legacy.clear` n'efface que **sa** clé déclarée ; l'audit (`module.legacy.clear`) dit le module et la clé, jamais la valeur. Une clé non déclarée lève une erreur sans valeur.
- Le rapport d'héritage (page *Entretien*, propriétaire seulement ; outil MCP `maintenance_legacy`, lecture) donne des nombres et des noms de clés, **jamais** une valeur, même masquée. Le journal du balayage (`[legacy]`) ne contient que des nombres.
- Le balayage du démarrage n'utilise pas le réseau et ne dure pas plus de 20 secondes : il ne peut ni bloquer le site, ni être déclenché par un visiteur. « Relancer » est réservé au propriétaire.
- Une sauvegarde chiffrée contient ces valeurs (comme tous les réglages) pour pouvoir les restaurer ; le résumé lisible de la sauvegarde ne cite aucun réglage d'instance.

## Sessions

Une session dure **14 jours au plus**. Elle se coupe aussi à tout moment :
- **Mon compte → Appareils connectés → En cas de perte ou de prêt d'un appareil → Déconnecter tous mes appareils** (à faire si vous avez perdu un téléphone ou prêté un ordinateur) ;
- **changer son mot de passe** coupe toutes les sessions ouvertes et demande de se reconnecter ;
- le propriétaire peut **couper les sessions** de quelqu'un depuis *Utilisateurs*.

### Mot de passe temporaire (propriétaire seulement)

Dans *Utilisateurs → Actions sensibles → Définir un mot de passe temporaire*, le propriétaire peut remplacer le mot de passe d'un administrateur ou d'un éditeur (jamais le sien, qui se change dans *Mon compte*, ni celui d'un autre propriétaire). Le rôle est vérifié par le serveur, pas seulement par l'interface.

- Par défaut le site **génère** un mot de passe de 16 caractères lisibles (sans `0/O` ni `1/l/I`), affiché **une seule fois** avec un bouton *Copier* ; le propriétaire peut aussi en choisir un (10 caractères au moins). Le mot de passe n'est ni enregistré en clair, ni écrit dans le journal d'audit, ni envoyé par e-mail, ni placé dans l'adresse ou un cookie.
- Toutes les sessions ouvertes de la personne sont coupées. Le journal note *qui*, *pour qui* et *quand* (`user.password.reset`). Si l'e-mail du site est réglé, la personne reçoit un courrier (sans le mot de passe) ; sinon, rien n'est envoyé et le propriétaire la prévient lui-même. L'action est limitée en débit (10 par quart d'heure, 5 par heure pour une même personne).
- **La prochaine connexion réussie, quel que soit le moyen** (mot de passe, mot de passe + code, clé d'accès), mène uniquement à la page « Choisissez votre mot de passe » : aucune page, action ni route d'administration ne s'ouvre avant (seule la déconnexion reste possible). Le nouveau mot de passe doit faire 10 caractères au moins et différer du temporaire ; ensuite le drapeau est levé, les *autres* sessions sont coupées, la session en cours continue (journal : `user.password.chosen`).
- La double vérification et les clés d'accès **restent en place** : réinitialiser le mot de passe ne les retire pas (c'est une autre action).
- Les **jetons des assistants IA (MCP)** appartiennent au site, pas à la session de la personne : ils restent valables et ne sont pas touchés. Si un compte est compromis, révoquez aussi les jetons concernés dans *Assistants IA*.

## Rôles et droits (0.2.0)

Une personne a **un ou plusieurs rôles** ; elle peut faire tout ce que l'un d'eux permet (union des droits).

- **Rôles prédéfinis**, non modifiables : *Propriétaire* (tout ; une seule personne, intouchable), *Administrateur* (tout sauf ce qui est réservé au propriétaire),
  *Éditeur* (écrire, modifier et publier les contenus). Ils sont créés au démarrage (`src/core/auth/roles.ts`, idempotent) ; chaque personne reçoit celui de son niveau.
- **Rôles personnalisés** (*Équipe → Rôles*, **propriétaire seulement**) : un nom, une phrase, des cases à cocher par module en mots simples
  (« Contacts : voir les e-mails »). Sur la fiche d'une personne, des **puces cumulables** (Éditeur + Modérateur) et l'aperçu « Ce que cette personne peut faire ».
- **Droits** : ceux du cœur (`core:entries.edit`, `core:entries.publish`) et ceux des modules, toujours **préfixés par le cœur** (`<module>:<droit>`) : un module ne peut
  ni déclarer ni tester le droit d'un autre. `<module>:open` ouvre la page d'un module (administrateurs : oui ; éditeurs : non, comme avant).
- **Jamais proposés** dans un rôle (et refusés par le serveur s'ils arrivent dans un formulaire forgé) : `core:team`, `core:roles`, `core:backup`, `core:updates`,
  `core:modules.install`, `core:mcp.tokens`, `core:security`. Ces pages restent celles du propriétaire.

**Ce que vérifie le serveur** (testé par `tests/core/roles-security.test.mjs`) :

- La personne est **relue en base à chaque requête** : un droit retiré est refusé dès la requête suivante, sans reconnexion. Le jeton de session garde un champ `role`
  (compatibilité) mais **ne décide de rien**.
- **Anti-élévation** : seul le propriétaire (relu en base) crée, modifie ou supprime un rôle et choisit les rôles des autres ; un rôle ne contient que des droits connus que
  son créateur possède ; le rôle *Propriétaire* ne s'affecte jamais ; un identifiant de rôle forgé ou inconnu est refusé (rien n'est écrit en partie).
- **Anti-verrouillage** : une personne garde au moins un rôle ; un rôle en usage ne se supprime qu'en choisissant le rôle que recevront ses membres (la base le refuse
  aussi : `onDelete: Restrict`) ; le propriétaire est intouchable.
- **Ordre inchangé** : connecté → mot de passe temporaire → rôle ou droit → double vérification. Un mot de passe temporaire bloque tout, quels que soient les rôles.
- `ctx.can` d'un module ne répond « oui » que dans l'administration (panneau du module, ses actions, sections de l'éditeur d'entrée) ; il répond toujours « non »
  dans une page publique, une route, un overlay, une tâche, un service ou le MCP. Seule exception (cœur 0.2.4) : `asCaller`, ci-dessous.
- **Journal d'audit** : `role.create`, `role.update`, `role.delete`, `user.roles`, et `access.denied` (au plus une ligne par personne et par droit toutes les 10 minutes).
- Une personne connectée qui n'a **aucun** accès utile (par exemple un rôle personnalisé sans droit) arrive sur une page « Pas encore d'accès », hors du menu.

**Niveau historique `User.role`** : il est conservé et recalculé à chaque changement : le plus haut rôle prédéfini de la personne, sinon **« none »**
(elle n'a que des rôles personnalisés). Il reste la source du niveau : un changement fait par un ancien cœur est respecté au retour, jamais une élévation.

**Retour à la 0.1.28** (après une mise à jour annulée) : les tables `Role` et `UserRole` sont ignorées. Un compte « none » est **refusé partout** par l'ancien cœur
(son rang vaut 0) : il est **bloqué, jamais élevé**, jusqu'au retour en 0.2.0 ou jusqu'à ce que le propriétaire lui redonne le rôle Éditeur ou Administrateur.
Les propriétaires, administrateurs et éditeurs ne voient aucune différence.

## Exports et envois de fichiers de l'administration (0.2.0)

**Un export contient des données personnelles** (noms, courriels, messages) : il demande donc **un droit** et **laisse une trace**.

- **Téléchargement** (`adminDownloads`, `POST /api/admin/modules/[instance]/download/[nom]`) : jamais par une route de module (`/m/…` est public). Ordre des gardes : même site (en-tête `Origin`),
  connecté, mot de passe temporaire / double vérification, `<module>:open` ET le droit déclaré (relus en base à cette requête ; un module ne peut exiger que ses propres droits), puis seulement le corps.
  Pas de GET : un lien ou une image sur un autre site ne peut pas déclencher un export. Un refus est noté (`access.denied`).
- **Audit** : `module.<clé>.download.<nom>` au début et `….end` à la fin (octets et cause : `done`, `client`, `bytes`, `time`, `idle`, `error`), sans le contenu.
- **En-têtes** : `Content-Disposition: attachment`, nom de fichier assaini (pas de chemin, de guillemet, de retour à la ligne ni de caractère d'inversion du sens d'écriture ; extension imposée par le type, donc jamais `.exe` ni `.html`),
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; sandbox`.
- **Bornes** : 512 Mo, 10 minutes, 60 s de silence du générateur, 2 téléchargements simultanés par personne et 4 pour le site. Le flux est tiré à la demande (un client lent ne fait pas grossir la mémoire),
  coupé en erreur à la limite, et fermé si le navigateur coupe. Une erreur du module n'est jamais montrée à la personne (journal serveur seulement).
- **Fichier envoyé par un formulaire** (`kind: "file"`, `POST /api/admin/modules/[instance]/action/[action]`) : mêmes gardes que les `adminActions` avant toute lecture ; corps compté et coupé (5 Mo par fichier,
  2 fichiers), jamais lu en entier au-delà ; texte UTF-8 strict sans octet nul ; la limite de 1 Mo des actions serveur n'est **pas** relevée pour le reste du site.
  Les indications `$max_…` et `$accept_…` du formulaire ne peuvent que restreindre.
- **Tableurs** : un export CSV dont une cellule commence par `=`, `+`, `-` ou `@` peut exécuter une formule à l'ouverture. Le module doit préfixer ces cellules d'une apostrophe.
- Tests : `tests/core/admin-transfer.test.mjs` (autre origine, sans droit, non connecté, nom hostile, gros fichier, flux interrompu, générateur muet, téléchargements simultanés).

## Réglage « choix parmi » (`choice`, 0.2.0) : modèle de menace

- **Identifiant forgé** : le navigateur n'envoie qu'un identifiant ; le serveur revérifie à chaque enregistrement qu'il est une option ACTUELLE (instance qui offre le service et que le module peut appeler, ou élément rendu par `get` du module propriétaire). Une clé d'instance (renommable) n'est jamais acceptée comme identifiant.
- **Fournisseur lent ou muet** : chaque vérification a un délai dur (3 s par champ, 5 s par formulaire). Au-delà, l'enregistrement est **refusé** : une valeur non vérifiée n'est jamais stockée. La lecture répond « non vérifié » et ne remplace rien en silence.
- **Création à la volée** : seulement si le réglage déclare `allowCreate`, jamais pour un rôle, un connecteur, un module, une instance ou un compte. Le cœur appelle `create` du module **propriétaire de la donnée**, pour la personne connectée (même garde que l'enregistrement des réglages) : ce module vérifie SON droit avec `ctx.can` (préfixé par le cœur, un module ne peut pas tester le droit d'un autre) et refuse sinon. Hors administration, `ctx.can` vaut toujours « non ». Audit : `module.<instance>.choice.create`.
- **Droits de l'appelant (`asCaller`, 0.2.4) : modèle de menace.** Un service ne reçoit les droits de la personne connectée que pour **une action d'administration que cette personne vient de déclencher**, jamais pour une route publique, un overlay, une tâche de fond, un autre service, un panneau (le simple affichage d'une page n'écrit rien) ni un outil MCP : ces contextes n'ont aucune personne, `ctx.can` y reste faux et l'option est ignorée sans erreur. Il faut en plus (a) que le **consommateur** le demande à l'appel (`{ asCaller: true }` : rien n'est porté par défaut), (b) que le **fournisseur** ait listé la méthode dans `offers[].callerRights` (le propriétaire de la donnée choisit les rares écritures qui acceptent ce mode ; une lecture sensible comme un e-mail ou un export n'y est pas), et (c) que la personne ait réellement le droit **du fournisseur** (préfixé par le cœur, relu en base à cette requête ; le droit d'un autre module ne vaut rien ; un rôle sans le droit reçoit « denied »). Le fournisseur reste seul juge (`ctx.can`) et valide ses arguments comme pour tout appel. La personne n'est retenue que dans le contexte de **cette** exécution d'action (jamais partagée, jamais gardée entre deux requêtes). Un module malveillant ne peut donc faire, par une action que vous déclenchez, que ce que vous pourriez faire vous-même dans le module propriétaire ET que ce propriétaire a ouvert à ce mode. Audit : `module.<instance>.asCaller`, cible `service.méthode`.
- **Conversion de texte** (`fromText`) : remplacée seulement sur une correspondance exacte et unique ; l'audit `setting.fromText` ne recopie jamais la valeur.

## Scripts de page des modules (0.2.6)

Le site n'envoie aucune politique `Content-Security-Policy` globale (seulement `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`). `Permissions-Policy` (cœur 0.2.12, moindre privilège) : caméra et micro restent fermés pour tout le monde, sans condition. La position est fermée aussi (`geolocation=()`, partout : administration, API, fichiers) et ne devient `geolocation=(self)` que sur les pages publiques traitées par le proxy, **si au moins un module installé déclare la permission `visitor.geolocation`** dans son `module.json` (`src/core/permissionsPolicy.ts`). Jamais un tiers, jamais une page intégrée d'un autre site, jamais un joker, et le navigateur la demande toujours au visiteur : un module (la carte, « Près de moi ») ne doit l'appeler qu'après un clic explicite, ne rien garder et ne rien envoyer. L'état est gardé en mémoire (30 s), recalculé à chaque installation, mise à jour, réinstallation ou désinstallation, et **fermé par défaut** si la base ou le fichier est illisible, si le délai (500 ms) est dépassé ou si le `module.json` est invalide. Un module sans déclaration laisse l'en-tête fermé. Tests : `tests/core/permissions-policy.test.mjs` ; les scripts en ligne du cœur (données structurées JSON-LD) ne sont pas exécutables. Un module qui veut un script sur SA page (`PageResult.scripts`) n'écrit donc jamais de script en ligne : il nomme un fichier de son dossier `scripts/`, que le cœur sert lui-même sur la même origine (`/m/<clé>/page-script/<nom>`), en `defer` et avec une empreinte d'intégrité SHA-256. Cela reste valable le jour où le cœur ajoutera `script-src 'self'` sans `'unsafe-inline'` et sans nonce. Bornes : 3 scripts par page, 32 Ko, fichier ordinaire du dossier `scripts/` (pas de lien symbolique, pas de `..`), réponse `404` si l'instance n'est pas active ou n'a pas de page.

## Liens courts : pas de redirection ouverte, pas de fuite (0.2.6)

- **Destination** : seulement `http(s)` (`mailto:`, `javascript:`, `data:`, `file:` refusés), sans nom ni mot de passe dans l'adresse, 2 000 caractères au plus, jamais vers un autre lien court du site (boucle). Elle est **saisie par la personne connectée** : aucun paramètre de la requête d'un visiteur n'entre dans la réponse, donc aucune redirection ouverte. Elle est revérifiée à chaque passage. Le cœur ne visite jamais la destination (aucune requête sortante, donc pas de SSRF).
- **Noms** : `a-z`, `0-9`, `-`, `_` et `/`, jamais un chemin réservé (`admin`, `api`, `m`, `go`, `uploads`…), une langue ni le chemin d'une instance.
- **Aucune fuite d'existence** : un lien désactivé et un lien inexistant donnent la même réponse (404, même page, même repli). Seul un lien dont la date de fin est passée répond 410, **sans destination** ni autre information que son message ; la route `api/redirect-gone` répond 404 à tout lien qui n'est pas actif et terminé. 
- **Vie privée** : un nombre par lien et par jour ; ni cookie, ni adresse IP, ni provenance, ni navigateur gardés (le texte « agent » sert à écarter les robots, il n'est ni lu plus loin ni conservé). Voir [PRIVACY.md](PRIVACY.md).
- **Bornes** : aucune lecture ni écriture non bornée (2 000 liens, pages de 50, 500 compteurs en attente, paquets de 200, porte du proxy limitée à 1,5 s), aucun minuteur de fond, une panne de base ne bloque jamais une redirection.
- **QR et export** : routes réservées à l'équipe connectée (401 sinon, 403 sans accès), `Cache-Control: private, no-store`, SVG avec `Content-Security-Policy: default-src 'none'`, texte alternatif échappé, CSV neutralisé contre les formules.
- **Assistants IA** : `redirects_list` et `redirects_stats` sont des lectures ; `redirects_create`, `redirects_update` (écriture) et `redirects_delete` (destructif) ne sont **jamais accordés d'office**, un jeton en lecture ne peut pas les recevoir, et chaque écriture est consignée (`mcp:<jeton> redirect.create|update|delete`).

## Jaquettes de jeux : corrections de la propriétaire (0.2.10)

- **Aucune requête vers une adresse donnée par une personne** : le cœur n'interroge que l'API RAWG (`api.rawg.io`), comme avant. Le jeu se choisit par son **numéro** parmi les propositions que RAWG vient de donner ; l'image enregistrée est celle de cette réponse, jamais une adresse envoyée par le navigateur ou un assistant. Le texte « Chercher un autre nom » n'est qu'un mot de recherche (nettoyé, 100 caractères).
- **Images** : une image (choisie parmi les jeux ou, en mode avancé, collée) doit être exactement `https://media.rawg.io/media/….(png|jpg|jpeg|webp)` : https, cet hôte seulement, ni port, ni identifiant, ni paramètre, ni `..`, ni `%`, ni sous-domaine ; l'adresse doit être sous sa forme canonique. Le cœur ne la télécharge pas et ne suit aucune redirection : il garde le **chemin** (l'hôte est écrit par le cœur à la lecture). Une correction abîmée ou piégée dans une sauvegarde est ignorée à la lecture (mêmes règles).
- **Affichage** : les titres et noms sont du texte (jamais du HTML) ; `?titre=` est validé côté serveur et échappé.
- **Droits** : l'écran et ses actions exigent un administrateur (`adminCtx("admin")` en tête de chaque action serveur) ; cadence limitée par personne (30 lectures et 60 écritures par minute) ; 1000 corrections au plus, titres de 120 caractères au plus, journal de 100 titres purgé à la lecture, sans minuteur de fond.
- **Assistants IA** : `rawg_covers_to_check` est une lecture ; `rawg_cover_set` (écriture) n'est **jamais accordé d'office**, un jeton en lecture ne peut pas le recevoir, la cadence est limitée par jeton, et chaque écriture est consignée (`mcp:<jeton> rawg.fix` ou `rawg.fix.forget`).
- **Vie privée** : la clé RAWG n'est affichée ni journalisée nulle part ; aucune donnée de visiteur n'entre dans ces réglages (des titres de jeux et des numéros RAWG).

## Fichiers envoyés : revendiquer et supprimer (0.2.13)

Permission de module `files` (`ctx.api.files`). Modèle de menace : un module ne doit jamais pouvoir effacer un fichier qui n'est pas le sien (logo, image d'une entrée, fichier d'un autre module), ni sortir du dossier des envois.

- **Un fichier est au cœur tant qu'une personne n'a pas décidé autrement.** La route `/api/admin/upload` note chaque envoi (personne, heure, taille) ; la **revendication** exige : la permission `files`, une action d'administration en cours (jamais une page publique, une route, une tâche ni le MCP), que ce soit **la même personne** qui ait envoyé le fichier, moins de 30 minutes après l'envoi, un fichier sans propriétaire, présent sur le disque, et le plafond du module respecté (1 Go, 20 000 fichiers). Elle est atomique (une seule instance gagne).
- **Pas de rattrapage.** Un fichier sans ligne au registre (envoyé avant la 0.2.13, logo SVG, fichier écrit par le cœur lui-même) n'est **jamais** revendiquable : aucun module ne peut s'approprier un fichier existant.
- **Supprimer** : seule l'instance propriétaire. Le nom doit passer `UPLOAD_NAME_RE` (`<uuid>.<ext>`) ; le chemin est recalculé à partir du nom (jamais d'un texte reçu), donc ni `..`, ni encodage, ni autre dossier. Les dérivés en cache sont retrouvés par le préfixe du nom (`<uuid>-…`), dans leur seul dossier. L'ordre disque → dérivés → registre fait qu'un échec laisse un état réessayable.
- **Journal d'audit** : `file.claim`, `file.remove`, `file.erase`, sans contenu. **Sauvegarde** : le propriétaire des fichiers revendiqués est sauvegardé et restauré avec eux.
- **Retrait d'un module** : garder les données garde les fichiers ; « tout effacer » les supprime avec les données (jamais sans que l'administrateur l'ait choisi, et la confirmation le dit).
- **Pas de minuteur de fond** : le registre est nettoyé à la lecture (envois jamais revendiqués, après la fenêtre de 30 minutes) ; le fichier d'un envoi non revendiqué n'est jamais supprimé.
- **Limite connue** : la personne qui a envoyé un fichier pour un autre usage (couverture d'une entrée…) puis le confie à un module dans les 30 minutes autorise ce module à le supprimer ; c'est son choix explicite, et ce module est celui qu'elle vient d'utiliser.

## Dépannage en SSH (propriétaire du serveur seulement)

Si le propriétaire est bloqué (trop d'essais, mot de passe perdu), la commande de secours se lance **sur le serveur**, depuis le dossier de l'application, avec l'utilisateur du service :

```bash
cd /var/www/curiosa
node scripts/auth-recover.mjs                          # état : ce qui est bloqué, et qui est propriétaire
node scripts/auth-recover.mjs unlock                   # tout débloquer
node scripts/auth-recover.mjs unlock 203.0.113.7       # une adresse IP
node scripts/auth-recover.mjs unlock vous@exemple.org  # l'e-mail du propriétaire
node scripts/auth-recover.mjs reset-password vous@exemple.org   # nouveau mot de passe, affiché une seule fois
node scripts/auth-recover.mjs reset-2fa vous@exemple.org        # retire la double vérification et les clés d'accès (appareils et codes de secours perdus)
```

Elle ne touche **jamais** au compte d'une autre personne que le propriétaire (les autres comptes se gèrent depuis *Utilisateurs*), lit le même `.env` que le service, ne demande aucune installation de plus, et note chaque action dans le journal d'audit (acteur « ssh »).

## Suivi des opérations longues (0.2.1)

- La route `GET /api/admin/operations/<id>` est en lecture seule. Le suivi d'une personne n'est lisible que par elle ou par un propriétaire ; un suivi inconnu, oublié ou interdit donne la même réponse (404), pour ne rien révéler. `core-update` (mise à jour du site) est réservé au propriétaire.
- Le suivi ne contient jamais de secret, de jeton ni de chemin disque : étapes nommées, numéros, nom lisible d'un module, texte d'erreur nettoyé (`safeText`). Il est en mémoire du processus, borné (40 opérations, 10 minutes après la fin, 2 heures au plus pour une opération « en cours ») et sans minuteur de fond.
- Les droits des actions ne changent pas : le contrôle (`adminCtx("owner")`, `guardOwner`…) passe AVANT le suivi. Un second lancement avec la même clé rejoint l'opération en cours ; la clé d'une sauvegarde contient une empreinte salée du mot de passe, pour que personne ne reçoive le fichier chiffré d'un autre.
- L'identifiant d'une opération est choisi par le navigateur, mais le serveur le valide (16 à 64 caractères sûrs), refuse un identifiant déjà pris par quelqu'un d'autre et lie toujours l'opération à la personne authentifiée.

## Menu du site (prochaine version)

- Le navigateur n'est jamais cru sur parole : à l'enregistrement du menu, chaque référence (page du cœur, instance, entrée, raccourci) est vérifiée en base ; un lien libre est normalisé puis validé (`/chemin` ou `http(s)://`, `mailto:` ; `javascript:` et `//hôte` non résolu sont refusés). L'adresse est **revalidée à chaque affichage** (`safeHref`, `isSafeExternalUrl`) : un réglage altéré en base n'atteint pas le visiteur.
- La recherche du sélecteur est réservée à l'administration (`adminCtx("admin")`), bornée (requête de 80 caractères, 12 résultats, 1 500 lignes regardées au plus, paquets de 250, repère de reprise validé par expression régulière) et ne journalise que le nom d'une erreur. Elle ne fait aucune requête sortante.
- Un raccourci de lien au menu mène à `/<chemin>` sur le site ; sa cible externe n'est atteinte que par la redirection du cœur (aucune redirection ouverte).
