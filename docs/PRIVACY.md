# Vie privée et cookies : ce que Curiosa dépose, et ce qu'il faut dire

Ce document décrit ce que le framework stocke chez vos visiteurs et dans sa base, pour que vous puissiez écrire la page de confidentialité de votre site. **Ce n'est pas un avis juridique** : pour un site qui traite des données sensibles, ou pour un doute, demandez à un juriste (en Belgique, l'Autorité de protection des données publie des lignes directrices sur les cookies).

## En bref : pas de bandeau de cookies

La règle européenne (directive ePrivacy, RGPD) exige l'accord du visiteur avant de déposer ou lire quelque chose dans son navigateur, **sauf** ce qui est strictement nécessaire au service qu'il demande ou qu'il a choisi lui-même. Curiosa est conçu pour rester dans ces exceptions : **tant que vous n'ajoutez pas de module qui dépose autre chose, aucun bandeau n'est nécessaire.**

## Ce que le framework dépose chez un visiteur

| Quoi | Quand | Durée | Pourquoi c'est sans consentement |
|---|---|---|---|
| `curiosa_locale` | quand le visiteur choisit une langue | 1 an | c'est son choix de langue, nécessaire pour la lui montrer |
| `curiosa_news` | quand le visiteur clique sur « Me prévenir des nouveautés » (bouton facultatif, à activer dans Réglages → Confidentialité) | 1 an | c'est le choix explicite du visiteur, et rien d'autre n'est déposé tant qu'il n'a pas cliqué |
| `curiosa_seen` et `curiosa_since` | seulement si `curiosa_news` existe | 1 an / la session | le visiteur a demandé cette fonction ; elles ne contiennent qu'une date (sa dernière visite). Le second clic sur le bouton les efface |

Rien d'autre côté visiteur : pas de cookie publicitaire, pas d'identifiant, pas de service tiers (polices, statistiques, vidéos intégrées…).

L'équipe du site, elle, reçoit un cookie de **session** à la connexion à l'admin (strictement nécessaire).

## Les statistiques de visite

- Elles ne déposent **rien** dans le navigateur : le navigateur envoie seulement la page vue, et le serveur compte.
- Pour ne compter qu'une fois un visiteur par jour, le serveur calcule une empreinte à partir de son adresse IP et de son navigateur, **mélangée à un sel tiré au hasard chaque jour** ; l'adresse IP n'est jamais enregistrée, l'empreinte est supprimée le lendemain avec le sel de la veille. Il est impossible de reconnaître quelqu'un d'un jour à l'autre.
- Ne sont pas comptés : les robots, les visiteurs qui envoient « Do Not Track » ou « Global Privacy Control », et l'équipe connectée à l'admin.
- Elles se coupent dans Réglages → Confidentialité.

## Ce que vous devriez écrire dans votre page de confidentialité

- que le site compte ses visites de façon anonyme, sans cookie, sans conserver l'adresse IP, et que c'est désactivable ;
- que la langue choisie est mémorisée dans un cookie ;
- si le bouton « Me prévenir des nouveautés » est activé : qu'il mémorise la date de la dernière visite dans le navigateur, à la demande du visiteur seulement, effaçable par un second clic ;
- les données que **vos** modules collectent (par exemple le formulaire de contact : nom, e-mail, message ; combien de temps vous les gardez ; comment on demande leur suppression) ;
- un moyen de vous contacter.

## Si vous installez des modules

Un module peut déposer des cookies ou charger un service tiers (lecteur vidéo, widget). Le catalogue décrit ce que chaque module demande avant l'installation ; dès qu'un module dépose quelque chose de non essentiel, **un consentement préalable devient nécessaire** pour cette partie. Le framework n'ajoute aucun bandeau de lui-même.
