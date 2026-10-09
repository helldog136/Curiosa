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
```

Elle ne touche **jamais** au compte d'une autre personne que le propriétaire (les autres comptes se gèrent depuis *Utilisateurs*), lit le même `.env` que le service, ne demande aucune installation de plus, et note chaque action dans le journal d'audit (acteur « ssh »).
