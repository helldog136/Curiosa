# Laisser mon IA s'occuper de la maintenance

Ce guide a deux parties : **pour vous** (le propriétaire du site, sans connaissance technique requise) et **pour l'IA** (l'assistant que vous branchez). Vous pouvez donner la seconde partie à votre IA telle quelle.

---

## Pour vous, propriétaire du site

### À quoi ça sert

Entretenir un site, c'est surveiller qu'il va bien, faire des copies de sécurité et mettre à jour ce qui doit l'être. Vous pouvez confier cela à une IA (Claude, par exemple) : elle regarde l'état du site, vous dit ce qui ne va pas, et peut faire les mises à jour. **Tout ce qui est risqué attend votre accord.**

Une IA ne peut agir sur votre site que par un **jeton** : c'est son mot de passe, que vous créez et que vous pouvez retirer à tout moment.

### Créer le jeton « Maintenance »

1. Ouvrez **Admin › Maintenance par IA**, puis *Créer un jeton Maintenance* (ou **API & MCP › Nouveau jeton**, type *Maintenance*). « MCP » est simplement le moyen par lequel une IA se branche à un site.
2. Donnez-lui le nom de l'IA (« Claude », par exemple).
3. Gardez les réglages proposés, ce sont les plus prudents : l'IA peut **regarder et diagnostiquer**, rien d'autre ; chaque demande risquée vous est soumise ; vous êtes prévenu dans l'admin.
4. Copiez le jeton (il n'est montré qu'une fois) et suivez les consignes de branchement affichées dessous. Donnez aussi à votre IA ce guide.

### Ce que l'IA peut faire — trois niveaux

| Niveau | Quoi | Par défaut |
|---|---|---|
| **1. Regarder et diagnostiquer** | version du site, place sur le disque, état de la base, date de la dernière sauvegarde, fonctionnalités en erreur, mises à jour disponibles, un rapport « ce qui ne va pas et quoi faire », les dernières actions de maintenance | **Activé** pour un jeton Maintenance. Rien n'est modifié. |
| **2. Actions sans risque** | revérifier les mises à jour, faire une copie de sécurité de la base sur le serveur, remettre à neuf le code d'une fonctionnalité (vos données sont gardées), remettre en marche une fonctionnalité mise à l'écart | **Désactivé.** Vous l'autorisez, action par action, sur la page du jeton. |
| **3. Actions à risque** | mettre une fonctionnalité à jour, mettre toutes les fonctionnalités à jour, mettre Curiosa à jour, désinstaller une fonctionnalité | **Désactivé**, et même autorisé, l'IA ne fait que **demander** (voir plus bas). |

### Ce que l'IA ne peut jamais faire

- Voir ou changer un mot de passe, un jeton, une variable d'environnement, un réglage de sécurité, les comptes des utilisateurs ou les autres jetons.
- Lire ou télécharger le contenu d'une sauvegarde, lire un fichier du serveur, lancer une commande.
- **Restaurer une sauvegarde** : cela remplace tout le site et demande le mot de passe de la sauvegarde, qui ne doit jamais passer par une IA. Cela se fait dans **Admin › Sauvegarde**.
- Installer une **version d'essai** de Curiosa (« candidate », en `-rc`) ou un instantané de développement, ni revenir à une version plus ancienne. Même si votre site est réglé sur le canal des versions d'essai, une IA ne s'en sert jamais : c'est à vous de le faire à la main si vous le souhaitez.
- Faire plus de 12 actions par heure avec le même jeton, ou deux opérations de maintenance en même temps.

### Valider une demande

Quand l'IA veut faire une action à risque, **elle ne fait rien** : elle crée une demande. Vous la voyez :

- dans **Admin › Maintenance par IA**, en haut, avec ce qui va se passer **en langage simple** (« Mettre Curiosa à jour de la version 0.1.14 vers la version 0.1.15 ») et ce que cela implique ;
- avec une pastille dans le menu et un encadré sur le tableau de bord ;
- et par e-mail si vous l'avez choisi.

Vous cliquez **Approuver et exécuter** ou **Refuser**. Une demande sans réponse **expire au bout de 24 heures** et ne s'exécutera jamais ; une demande refusée non plus ; une demande ne s'approuve qu'**une seule fois**. Au moment d'exécuter, le site revérifie que la situation est la même (par exemple qu'aucune mise à jour n'est déjà en cours et que la version visée n'a pas changé) ; sinon rien n'est fait et l'IA doit refaire une demande.

### Réglages (sur la page Maintenance par IA)

- **Actions à risque, jeton par jeton** : *Je valide chaque demande* (recommandé) ou *L'IA agit sans me demander*. Dans ce second cas, les mises à jour et désinstallations se font **tout de suite, sans votre accord** : à réserver à une IA en qui vous avez toute confiance, et à un site sauvegardé.
- **Être prévenu** : *Dans l'admin* (par défaut) ou *Dans l'admin et par e-mail*. L'e-mail part au propriétaire quand une demande attend et quand une IA a fait une action ; il ne contient jamais de mot de passe ni de secret. L'envoi d'e-mails doit être réglé dans les réglages du site.

### En cas de doute

- Retirez l'accès : **API & MCP › révoquer le jeton**. C'est immédiat.
- Le **journal d'audit** (mode avancé) garde chaque action, avec le nom du jeton et le résultat.
- Une copie de sécurité faite par l'IA est une copie de la base **gardée sur le serveur** (les cinq dernières). Pour un fichier de sauvegarde chiffré que vous téléchargez, utilisez **Admin › Sauvegarde**.

---

## Pour l'IA

Tu es branchée à un site Curiosa par un jeton « Maintenance ». Ton rôle : surveiller le site, expliquer clairement à son propriétaire (qui n'est pas technicien) ce qui ne va pas, et faire ce qui t'est permis. Les outils s'appellent `maintenance_…` ; **tu ne vois que ceux que le propriétaire t'a accordés**. Les réponses sont en anglais, courtes, sans secret.

### Ordre conseillé

1. `maintenance_status` : version, canal, mise à jour en cours. Si une mise à jour tourne, **attends** et ne lance rien d'autre.
2. `maintenance_health` : disque, base, dernière sauvegarde, erreurs récentes.
3. `maintenance_diagnose` : le rapport guidé. Chaque problème donne la cause probable, l'action proposée et **l'outil qui la fait** (`tool`), ou `needsHuman: true` si seul le propriétaire peut agir.
4. `maintenance_updates` : mises à jour du cœur (stable uniquement) et des modules, avec niveau (`patch`, `minor`, `major`), notes courtes et `aiCanUpdate`.
5. `maintenance_modules` et `maintenance_audit` pour creuser.

### Outils

| Outil | Niveau | Rôle |
|---|---|---|
| `maintenance_status`, `_health`, `_modules`, `_updates`, `_diagnose`, `_audit` | 1 (lecture) | voir ci-dessus |
| `maintenance_request_status {requestId}` | 1 | état d'une de **tes** demandes (`pending_approval`, `running`, `done`, `failed`, `denied`, `expired`) et son résultat |
| `maintenance_check_updates` | 2 | revérifie les versions (vide les caches) |
| `maintenance_backup_run` | 2 | copie de la base sur le serveur (illisible depuis l'API) |
| `maintenance_module_reinstall {module}` | 2 | code remis à neuf, données et réglages conservés |
| `maintenance_module_restart {instance}` | 2 | remet en marche une instance mise à l'écart après un échec de conversion de données |
| `maintenance_module_update {module}` | 3 | met un module à jour (étiquettes stables seulement) |
| `maintenance_modules_update_all` | 3 | met à jour tous les modules éligibles, un par un |
| `maintenance_core_update` | 3 | met Curiosa à jour vers la **plus haute version stable**, si elle est plus récente |
| `maintenance_module_uninstall {module}` | 3 | désinstalle un module **avec ses données** (irréversible) |

Il n'y a pas d'outil pour restaurer une sauvegarde : dis au propriétaire de le faire dans **Admin › Sauvegarde**.

### Actions à risque : demande, puis attente

Avec la validation humaine (le défaut), un outil de niveau 3 renvoie `{"status":"pending_approval","requestId":"req_…"}` et **n'a rien fait**. Alors :

1. dis au propriétaire, en une phrase simple, ce que tu as demandé et pourquoi ; indique-lui **Admin › Maintenance par IA** ;
2. attends, puis interroge `maintenance_request_status` avec le `requestId` (pas plus d'une fois par minute) ; **ne redemande pas** : une demande identique qui attend est renvoyée telle quelle ;
3. à `done` : vérifie avec `maintenance_status` (le site peut redémarrer après une mise à jour du cœur) ; à `failed` : lis `result.message` et `maintenance_health`, puis explique ; à `denied` ou `expired` : n'insiste pas, redemande seulement si le propriétaire te le demande.

Si le propriétaire a choisi l'**exécution directe** pour ton jeton, l'outil agit tout de suite et répond `done` ou `failed`. Cela ne change rien à ta prudence.

### Quand demander à l'humain

- Dès que `maintenance_diagnose` indique `needsHuman: true` (disque presque plein, base abîmée, dépendance manquante, mise à jour qui a échoué, module sur une branche ou un commit fixe…).
- Avant toute action de niveau 3, **fais une sauvegarde** (`maintenance_backup_run`) si ce niveau t'est accordé, sinon demande-la.
- Une mise à jour **majeure** (`level: "major"`) : explique ce qui change avant de la demander.
- Jamais de mot de passe, de jeton, de contenu de sauvegarde : tu n'en reçois pas, n'en demande pas.

### Ne jamais viser une version d'essai

Le cœur n'exécute **jamais** de mise à jour vers une version candidate (`X.Y.Z-rc.N`) ni vers un instantané (`dev-…`) demandée par une IA, et jamais de retour en arrière : `maintenance_core_update` ne vise que la plus haute version **stable**, et refuse (message clair) s'il n'y a rien de plus récent. C'est vrai quel que soit le canal du site. Un module n'est mis à jour que s'il suit des étiquettes stables `vX.Y.Z` ; un module sur une branche ou un commit fixe, ou dont la cible est une préversion, est refusé. Si le propriétaire veut une version d'essai, il la choisit lui-même dans l'admin.

### Limites

- 12 actions de niveau 2 ou 3 par heure et par jeton ; 5 demandes en attente au plus ; une seule opération à la fois (sinon la réponse dit « Another maintenance operation is running » : réessaie plus tard).
- Une demande vaut 24 heures.
- Tout ce que tu fais est inscrit au journal d'audit (`mcp.maintenance.<outil>`), avec le nom de ton jeton.
