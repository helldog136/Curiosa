# Vie privée et cookies : ce que Curiosa dépose, et ce qu'il faut dire

Ce document décrit ce que le framework stocke chez vos visiteurs et dans sa base, pour que vous puissiez écrire la page de confidentialité de votre site. **Ce n'est pas un avis juridique** : pour un site qui traite des données sensibles, ou pour un doute, demandez à un juriste (en Belgique, l'Autorité de protection des données publie des lignes directrices sur les cookies).

## En bref : pas de bandeau de cookies

La règle européenne (directive ePrivacy, RGPD) exige l'accord du visiteur avant de déposer ou lire quelque chose dans son navigateur, **sauf** ce qui est strictement nécessaire au service qu'il demande ou qu'il a choisi lui-même. Curiosa est conçu pour rester dans ces exceptions : **tant que vous n'ajoutez pas de module qui dépose autre chose, aucun bandeau n'est nécessaire.**

## La page « Politique de confidentialité » est fournie par le cœur

Chaque site Curiosa a une page `/privacy`, liée en permanence dans le pied de page. Le cœur l'écrit lui-même d'après ce que **votre** site fait vraiment : cookies, statistiques activées ou non, bandeau de cookies (« nouveautés »), et ce que déclare chaque module actif (champ `privacy` de son manifeste, par exemple le formulaire de contact).

- Le texte obligatoire **ne peut pas être modifié ni retiré** : il suit le fonctionnement réel du site, il ne peut donc pas être faux.
- Vous pouvez **ajouter** vos propres informations (responsable du traitement, durée de conservation, comment exercer ses droits…) dans Réglages → Confidentialité : elles s'affichent à la fin, par langue.
- Le chemin `/privacy` est réservé : une page ou une collection ne peut pas le prendre.

## Ce que le framework dépose chez un visiteur

| Quoi | Quand | Durée | Pourquoi c'est sans consentement |
|---|---|---|---|
| `curiosa_locale` | quand le visiteur choisit une langue | 1 an | c'est son choix de langue, nécessaire pour la lui montrer |
| `curiosa_news` | quand le visiteur clique sur « Accepter les cookies » dans le bandeau qui monte du bas de l'écran (facultatif, à activer dans Réglages → Confidentialité) | 1 an | c'est le choix explicite du visiteur, et rien d'autre n'est déposé tant qu'il n'a pas accepté |
| `curiosa_seen` et `curiosa_since` | seulement si `curiosa_news` existe | 1 an / la session | le visiteur a donné son accord ; elles ne contiennent qu'une date (sa dernière visite). « Retirer mon accord » les efface |
| `curiosa_cookies` | quand le visiteur répond « Non merci » (30 jours), ou ferme le bandeau avec Échap (le temps de la session) | 30 jours / la session | simple souvenir de la réponse (« no » ou « later ») pour ne pas redemander à chaque page ; il n'identifie personne |

Le bandeau n'existe que si le réglage est actif. Il s'affiche tant que le visiteur n'a pas répondu, puis plus du tout ; un lien « Cookies » dans le pied de page (et un contrôle sur `/privacy`) le rouvre pour **retirer l'accord**. Refuser est aussi simple qu'accepter. Réglage désactivé : ni bandeau ni lien, car rien de facultatif n'est déposé.

### Le choix « clair / sombre » du visiteur (skins à deux modes)

Quand le skin du site fournit les deux apparences (clair et sombre), l'en-tête propose au visiteur un sélecteur « Automatique / Clair / Sombre ». S'il choisit « Clair » ou « Sombre », son choix est gardé dans le **stockage local de son navigateur** (clé `curiosa-mode`, valeur `light` ou `dark`). Ce n'est **pas un cookie** : il n'est jamais envoyé au serveur ni à personne, il ne contient aucun identifiant et ne sert qu'à afficher les pages comme le visiteur l'a demandé. C'est une préférence d'affichage strictement fonctionnelle, choisie par le visiteur lui-même : elle ne demande pas de consentement et **le bandeau de cookies ne change pas**. Sans choix, le site suit le réglage de l'appareil (`prefers-color-scheme`). Le petit script du cœur qui la lit (`/skins/mode.js`, même origine, servi par le cœur, jamais par un skin) ne fait aucune requête. Cette ligne est ajoutée à la page `/privacy` seulement quand le sélecteur existe (skin à deux modes) ; le skin de base, qui n'a qu'un mode, ne le propose pas.

Rien d'autre côté visiteur : pas de cookie publicitaire, pas d'identifiant, pas de service tiers (polices, statistiques, vidéos intégrées…).

L'équipe du site, elle, reçoit un cookie de **session** à la connexion à l'admin (strictement nécessaire).

## Les statistiques de visite

- Elles ne déposent **rien** dans le navigateur : le navigateur envoie seulement la page vue, et le serveur compte.
- Pour ne compter qu'une fois un visiteur par jour, le serveur calcule une empreinte à partir de son adresse IP et de son navigateur, **mélangée à un sel tiré au hasard chaque jour** ; l'adresse IP n'est jamais enregistrée, l'empreinte est supprimée le lendemain avec le sel de la veille. Il est impossible de reconnaître quelqu'un d'un jour à l'autre.
- Ne sont pas comptés : les robots, les visiteurs qui envoient « Do Not Track » ou « Global Privacy Control », et l'équipe connectée à l'admin.
- Elles se coupent dans Réglages → Confidentialité.

## Les liens courts

Un lien court (`/twitch`) ne dépose aucun cookie. Chaque passage ajoute 1 au compteur du lien pour le jour en cours (heure du site) et à son total : rien d'autre n'est gardé, ni adresse IP, ni navigateur, ni provenance, ni identifiant de visiteur. Les robots, les aperçus de messagerie et les personnes connectées à l'administration ne sont pas comptés. Le détail par jour est gardé 120 jours. Détails : [PLATFORM.md](PLATFORM.md), « Liens courts ».

## Les robots IA et le fichier llms.txt

- Les **robots de réponse** des assistants IA (ceux qui lisent une page pour répondre à une question) sont autorisés par défaut ; les robots d'**entraînement** sont bloqués par défaut. Les deux se règlent dans Réglages › Confidentialité (voir [GEO.md](GEO.md)).
- Ces robots ne lisent que des **pages publiques**, comme n'importe quel visiteur : rien de privé n'est exposé (l'admin, l'API et les routes des modules sont exclus par `robots.txt`).
- Le fichier `/llms.txt` est construit uniquement à partir de ce qui est déjà public (nom, description, pages et publications, liens de réseaux sociaux). Il ne contient ni adresse e-mail, ni brouillon, ni page non publiée. Il se désactive dans les mêmes réglages.
- Le cœur n'envoie rien à ces services : ce sont eux qui viennent lire le site.

## Ce que vous devriez écrire dans votre page de confidentialité

- que le site compte ses visites de façon anonyme, sans cookie, sans conserver l'adresse IP, et que c'est désactivable ;
- que la langue choisie est mémorisée dans un cookie ;
- si le bandeau de cookies est activé : qu'il mémorise la date de la dernière visite dans le navigateur, avec l'accord du visiteur seulement, retirable à tout moment (lien « Cookies » du pied de page) ;
- les données que **vos** modules collectent (par exemple le formulaire de contact : nom, e-mail, message ; combien de temps vous les gardez ; comment on demande leur suppression) ;
- un moyen de vous contacter.

## Si vous installez des modules

Un module peut déposer des cookies ou charger un service tiers (lecteur vidéo, widget). Le catalogue décrit ce que chaque module demande avant l'installation ; dès qu'un module dépose quelque chose de non essentiel, **un consentement préalable devient nécessaire** pour cette partie. Le framework n'ajoute aucun bandeau de lui-même. Une image, une police ou un script d'un autre domaine chargé par la page contacte ce tiers depuis le navigateur du visiteur : le site n'envoie aucune politique de sécurité de contenu qui l'empêcherait, c'est donc au module de ne pas le faire sans consentement (modèle : une route du module qui sert l'image depuis le site, voir [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md#vie-privée)).
