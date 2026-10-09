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

## Sessions

Une session dure **14 jours au plus**. Elle se coupe aussi à tout moment :
- **Mon compte → Déconnecter tous mes appareils** (à faire si vous avez perdu un téléphone ou prêté un ordinateur) ;
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
