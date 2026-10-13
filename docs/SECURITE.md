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
| 1 : lecture | état, santé, modules, mises à jour, diagnostic, audit | actif **seulement** pour un jeton « Maintenance » (désactivé pour tout autre jeton) | lecture seule ; sorties masquées et bornées |
| 2 : sans risque | revérifier, copie de la base sur le serveur, réinstaller un module (données gardées), relancer une instance | désactivé | accordé action par action ; verrou ; 12 actions par heure et par jeton |
| 3 : à risque (`destructive`) | mises à jour du cœur et des modules, désinstallation | désactivé, **jamais** `default: true` | **validation humaine par défaut** ; versions stables seulement ; revérification à l'exécution |

Il n'y a **volontairement pas** d'outil de restauration : elle remplace tout le site et demande le mot de passe de la sauvegarde. Jamais exposés : secrets, mots de passe, jetons, variables d'environnement, contenu des sauvegardes, réglages de sécurité, utilisateurs, gestion des jetons, fichiers arbitraires, commandes arbitraires. Un jeton « Maintenance » n'a **que** ces outils : les actions des modules y sont désactivées par défaut, y compris celles qu'un module ajouterait plus tard (`access.ts`, `MAINTENANCE_PROFILE`).

**Menaces et réponses**

- *IA compromise ou manipulée (injection de consignes dans un texte qu'elle lit)* : au pire elle peut **demander**. Avec la validation humaine, le niveau 3 se limite à une demande en attente que seul le **propriétaire connecté** peut approuver (les administrateurs et éditeurs n'ont pas ce droit) ; l'approbation ne s'applique qu'à ce qui est décrit dans la demande, en langage simple. Les niveaux 1 et 2 ne peuvent rien détruire ni rien exfiltrer : pas de secret dans les sorties, la copie de la base n'est ni lisible ni téléchargeable par l'API, et la file est bornée (5 demandes par jeton, 12 actions par heure).
- *Jeton volé* : mêmes limites que ci-dessus (c'est le pire cas d'une IA compromise), et le propriétaire le **révoque** en un clic ; l'exécution directe, elle, doit avoir été choisie **explicitement** pour ce jeton, avec un avertissement : ne l'activez que pour une IA de confiance. La connexion par adresse secrète reste désactivée par défaut.
- *Demande forgée* : une demande n'existe que créée par un outil appelé avec un jeton qui en a le droit ; elle est liée à ce jeton (une IA ne relit que les siennes). Son contenu (le « plan » : versions de départ et d'arrivée) est figé à la création, puis **revérifié au moment d'exécuter** ; une demande dont la cible a changé n'est pas exécutée. Une demande ne s'approuve **qu'une fois** (passage atomique « en attente → en cours »), expire au bout de **24 heures**, et une demande refusée ou expirée ne s'exécute jamais, même si on tente de l'approuver ensuite.
- *Mise à jour vers un code non éprouvé* : le cœur **n'exécute jamais** de mise à jour demandée par une IA vers une version candidate (`X.Y.Z-rc.N`) ou un instantané `dev-…`, quel que soit le canal du site (un site sur le canal des candidates peut être mis à jour à la main par l'administrateur, jamais par l'IA), et jamais de rétrogradation. Une candidate n'a pas fini d'être éprouvée : si elle est défaillante, une mise à jour automatisée sans regard humain étendrait le dégât. `core_update` ne vise que la plus haute release **stable**, `startUpdate(…, { stableOnly })` le refuse une seconde fois en dernier recours, et un module n'est mis à jour que s'il suit des étiquettes stables `vX.Y.Z` (pas une branche, pas un commit, pas une préversion). Un module qui exige un cœur plus récent est refusé.
- *Fuite par les sorties* : tout texte venu d'ailleurs (journaux, erreurs, adresses de dépôt, notes de version, détails d'audit) passe par un masquage de secrets (jetons `vit_…`, clés, mots de passe, adresses avec jeton, longues suites opaques) et des bornes de taille. Il n'y a pas de lecture libre des journaux du serveur : seulement la fin du journal de mise à jour, filtrée, et les erreurs des instances.
- *Fausse sécurité* : toute action de niveau 2 ou 3 est inscrite au journal d'audit (`mcp.maintenance.<outil>` : nom du jeton, paramètres sans secret, résultat) ; les décisions humaines aussi (`approve`, `deny`). Les adresses e-mail des humains ne sont jamais données à l'IA.
- *Avertissement* : le propriétaire est averti dans l'admin (pastille, tableau de bord) et, s'il le choisit, par le service e-mail du cœur, sans secret dans le message.

## Réinstaller un module (propriétaire seulement)

Remettre le code d'un module à neuf (*Modules › le module › Maintenance*) exécute du code côté serveur : l'action est réservée au **propriétaire**, avec confirmation dans la page. Elle ne reprend que la source du module (le dépôt du catalogue ou le dépôt git déjà connu, mêmes règles d'hôtes que l'installation), **n'accorde jamais de nouvelle permission** (refus, il faut passer par la mise à jour), met l'ancien dossier de côté et le rétablit au moindre échec, et est inscrite au journal (`module.reinstall`, sans adresse ni secret).

## Sessions

Une session dure **14 jours au plus**. Elle se coupe aussi à tout moment :
- **Mon compte → Appareils connectés → En cas de perte ou de prêt d'un appareil → Déconnecter tous mes appareils** (à faire si vous avez perdu un téléphone ou prêté un ordinateur) ;
- **changer son mot de passe** coupe toutes les sessions ouvertes et demande de se reconnecter ;
- le propriétaire peut **couper les sessions** de quelqu'un depuis *Utilisateurs*.

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
