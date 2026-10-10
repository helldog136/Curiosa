# Changelog

Ce que chaque version change pour vous. Chaque version reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, dites ce que ça change pour vous, pas comment c'est fait. Les détails techniques vont dans la rubrique « Pour les développeurs ». Un test vérifie ces règles.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).

## Prochaine version (non publiée)

*Changements depuis la 0.1.9.*

### Nouveautés
- **Une seule clé pour les jaquettes de jeux.** Vous saisissez la clé RAWG une fois dans Réglages, à côté de l'e-mail, avec un bouton pour la tester. Vos fonctionnalités s'en servent sans jamais la demander, et celle déjà saisie dans une fonctionnalité est reprise.
- **Les fonctionnalités disent quelle version du site elles demandent.** Si une fonctionnalité a besoin d'un site plus récent, elle n'est plus installée ni mise à jour par erreur : un message vous invite à mettre d'abord le site à jour. « Tout mettre à jour » la laisse de côté sans rien casser.
- **Un menu plus court.** Le menu ne garde que ce que vous utilisez souvent, rangé sous des titres que vous pouvez plier. Les réseaux, overlays et annonces que l'on règle une fois sont regroupés dans une page « Intégrations », et vous choisissez où placer chaque fonctionnalité.
- **Les overlays ont leur page.** Alertes, labyrinthe, bandeaux : une page « Overlays » les réunit, avec l'adresse à copier pour OBS en un clic.
- **Les fonctionnalités d'une même plateforme sont regroupées.** Chaîne et statut live Twitch, lien et annonces Discord : ils apparaissent ensemble sous le nom de la plateforme.
- **Les modules au même endroit.** La page Modules réunit trois onglets : ce qui est installé, le catalogue et les mises à jour des modules en retard.

## 0.1.9

*Changements depuis la 0.1.8.*

### Améliorations
- **Page Modules plus claire.** Les modules installés forment une liste compacte, avec une recherche qui répond pendant que vous tapez. Chaque module a sa propre page pour l'activer, le mettre à jour, gérer ses instances ou le désinstaller.

## 0.1.8

*Changements depuis la 0.1.7.*

### Nouveautés
- **Vos modules en retard enfin signalés.** La page « Mises à jour » liste les modules qui ont une nouvelle version, avec un bouton « Tout mettre à jour » (ou un bouton par module), et un bilan à la fin. Le menu affiche une pastille tant qu'il en reste.

### Améliorations
- **Chiffres clés mieux présentés.** Les chiffres se centrent dans leur bloc, quel que soit leur nombre, et un long chiffre tient sur moins de lignes. Les légendes restent lisibles, sur ordinateur comme sur téléphone.

### Corrections
- Le bouton « Installer la mise à jour » (et les autres demandes de confirmation de l'administration) ne reste plus sans réaction quand le navigateur masque sa boîte de dialogue. La confirmation s'affiche maintenant dans la page.

## 0.1.7

*Changements depuis la 0.1.6.*

### Nouveautés
- **Réseaux sociaux.** Le site reprend automatiquement le bouton de chaque module réseau installé. La page « Réseaux sociaux » de l'administration permet d'en ajouter un en un clic, et il n'y a plus de case sans module.
- **Catalogue plus vivant.** La recherche répond au fil de la frappe. La fiche d'un module s'ouvre en fenêtre par-dessus la liste, et l'installation s'anime pour montrer qu'elle avance.
- **Éléments facultatifs dans les modules.** Dans les réglages d'un module, vous ajoutez à la demande un bouton ou une vidéo de fond. Les liens saisis sont vérifiés avant l'enregistrement.
- **Arrière-plan en quatre couches.** Dans Réglages, l'arrière-plan se compose de quatre couches numérotées : couleur, halo, image et motif. Chacune se règle séparément.
- **15 palettes et une couleur secondaire.** Réglages → Apparence propose huit nouvelles palettes complètes. Chacune règle d'un coup le fond, les cartes, le texte, l'accent et une couleur secondaire.
- **Une couleur secondaire qui se voit.** Si vous en choisissez une, le site s'en sert : boutons pleins, détails colorés, chiffres clés et bandeau d'appel en dégradé. Sans couleur secondaire, rien ne change.
- **Mises à jour en 4 temps.** La page suit chaque étape et affiche la progression, pour savoir où l'on en est.

### Améliorations
- **Menu plus clair.** « Modules » passe en premier et est mis en avant, puisque c'est par là que tout commence.
- **Réglages d'un module.** Les valeurs sont déjà remplies avec ce qui convient dans la plupart des cas. La page est plus aérée.
- **Réglages du site.** Les onglets sont réorganisés par intention, avec des titres alignés sur le menu et des messages utiles quand une section est vide.
- **Éditeur de contenu.** Les options sont repliées pour aller à l'essentiel. Brouillon et publié sont explicites, et la suppression est séparée de l'enregistrement.
- **Liste des contenus.** Chaque contenu affiche son état. Quand la liste est vide, on vous dit par où commencer.
- **Pages d'administration revues.** Mon compte, Utilisateurs (présentés en fiches), Sauvegarde, accès externe et Journal sont plus simples à suivre. Le journal est écrit en langage courant, et une page distingue le mode Simple du mode Avancé.
- **Enregistrement.** Une seule barre flottante, centrée, remplace les boutons dispersés.
- **Boutons de mise à jour animés.** Mettre à jour le site ou un module, comme installer un module, montre maintenant que l'action est en cours. Plus de doute sur le fait que le clic a bien été pris en compte.
- **Menu latéral.** Un seul lien est mis en évidence à la fois : vous voyez tout de suite où vous êtes.
- **Éditeur du menu du site.** Le libellé passe avant l'adresse. Les boutons « Monter », « Descendre » et « Retirer du menu » portent du texte, et un seul champ « Libellé » apparaît quand le site n'a qu'une langue.
- **Palette « Personnalisé ».** Une tuile du sélecteur de palette se choisit toute seule quand vous modifiez le fond ou l'accent. Remettre les deux couleurs d'une palette la fait reconnaître, et les champs de couleur s'affichent aussi en mode simple.

### Corrections
- Le nom d'une fonctionnalité renommée se met à jour tout de suite dans le menu.
- Le navigateur ne remplit plus les réglages d'un module avec votre adresse e-mail.
- Le texte posé sur la couleur d'accent est lisible sur toutes les palettes. Le texte secondaire et les messages d'état le sont aussi.

### À savoir en mettant à jour
- **Anciens modules.** Les modules déjà installés gardent leur ancienne présentation tant que vous ne les mettez pas à jour. C'est le cas du Bandeau d'accueil, de Twitch et de YouTube.
- **Icônes de réseaux en en-tête.** Elles viennent désormais des modules réseau. Les anciennes listes de liens ne sont plus lues d'office : ajoutez vos réseaux depuis la page « Réseaux sociaux ».

### Pour les développeurs
- Sujet `social.link` et type `social` : le cœur collecte le bouton de chaque module réseau. Les listes de liens ne sont plus lues d'office.
- Manifeste de module : `optionalGroups` (groupes facultatifs), défauts `site:name` et `site:tagline`, nouveau type de réglage `link` (lien vérifié).
- Catalogue : la fiche d'un module est servie par une route interceptée (fenêtre par-dessus la liste).

## 0.1.6

*Changements depuis la 0.1.5.*

### Nouveautés
- **Mise à jour depuis une très vieille version.** Si votre site est trop ancien pour passer directement à la dernière, il installe seul les versions intermédiaires nécessaires. Vous cliquez une fois sur Installer ; sans redémarrage automatique, il vous demande de redémarrer entre deux étapes.

### Pour les développeurs
- Chaque release publie `upgrade.json` (`minFrom`) à côté de son archive ; `scripts/update-lib.mjs` (`planUpdate`, `runUpdateChain`) en déduit les étapes. Nouvelle variable facultative `CURIOSA_READY_URL`. Voir `docs/INSTALL.md`.

## 0.1.5

*Changements depuis la 0.1.4.*

### Nouveautés
- **Double vérification.** Dans Mon compte, scannez un code avec votre téléphone : à chaque connexion, on vous demande ensuite un code à 6 chiffres qui change toutes les 30 secondes. Huit codes de secours vous sont remis si vous perdez le téléphone.
- **Clés d'accès.** Connectez-vous avec votre empreinte, votre visage ou le code de votre appareil, sans mot de passe. C'est la méthode la plus sûre, et un faux site ne peut pas la voler.
- **Toute l'équipe protégée.** Le propriétaire peut exiger la double vérification de chacun, et dépanner un collègue qui a perdu son téléphone.
- **Essais de connexion limités, jamais définitivement.** Après 5 erreurs, la connexion est bloquée 1 heure, puis 3, 5, 8 heures… à chaque nouvelle série d'erreurs. Le message indique l'heure du retour, et le propriétaire peut débloquer quelqu'un.
- **Déconnecter tous mes appareils.** Un bouton dans Mon compte coupe toutes les sessions ouvertes, à utiliser si vous avez perdu un téléphone. Changer son mot de passe le fait aussi.
- **Dépannage par le propriétaire du serveur.** Une commande en SSH débloque la connexion, remet un mot de passe ou retire la double vérification du propriétaire, et uniquement la sienne.

### Améliorations
- **Chiffres de rapidité et de poids à jour.** Ceux annoncés dans la documentation sont remesurés sur la 0.1.4.
- **Réglages des modules plus confortables.** Le navigateur ne remplit plus tout seul l'identifiant et le secret d'un module avec votre e-mail et votre mot de passe. Un seul bouton Enregistrer, centré en bas de la page, remplace le doublon.

### À savoir en mettant à jour
- **Rien à refaire.** Personne n'est obligé d'activer la double vérification, et vos sessions ouvertes restent valables. Pour que les clés d'accès marchent, indiquez l'adresse définitive du site dans le réglage SITE_URL.

### Pour les développeurs
- Les clés d'accès utilisent la bibliothèque `@simplewebauthn/server` ; le code à usage unique est écrit sans dépendance. Nouvelle variable `CURIOSA_TRUSTED_PROXIES` : nombre de reverse proxys devant le site, pour lire la vraie adresse du visiteur.
- Voir `docs/SECURITE.md`.
- Suppression du code de migration des versions 0.1.2 et 0.1.3-rc (modules « intégrés », « Blocs de page »), dont l'échéance était la 0.1.4 : un site encore en 0.1.2 doit d'abord passer par la 0.1.4.

## 0.1.4

*Changements depuis la 0.1.3.*

### Améliorations
- **Mises à jour plus rapides et plus légères.** Le téléchargement passe de 268 à 128 Mo, et le site prend presque moitié moins de place sur votre serveur. Rien à faire de votre côté.

### Pour les développeurs
- L'archive n'embarque plus le compilateur de Next, `sharp`, TypeScript, les SVG de `simple-icons` ni les variantes inutiles du client de base de données ; la configuration de Next est en JavaScript (`next.config.mjs`). Chaque archive est démarrée sans ces dossiers avant publication.

## 0.1.3

*Changements depuis la 0.1.2.*

### Nouveautés
- **Les fonctionnalités vivent dans un dépôt à part.** Blog, réseaux sociaux, pages, formulaire de contact… s'installent depuis le Catalogue, et le cœur du site reste minimal. Vos sites existants se mettent à jour tout seuls, sans rien perdre.
- **Ajoutez vos propres modules.** Dans le Catalogue (mode avancé), indiquez l'adresse GitHub d'un dépôt : ses modules apparaissent et s'installent un par un, après lecture de ce qu'ils demandent.
- **Un départ plus simple.** À la première installation, une étape facultative suggère quelques modules (blog, réseaux sociaux, pages). Vous pouvez la passer sans aucun risque : tout se rajoute plus tard.
- **Page d'accueil à blocs.** Texte et images, onglets, chiffres clés, appel à l'action, texte sur vidéo : on les ajoute directement depuis la page d'accueil. Vos anciens blocs sont convertis tout seuls.
- **Logos au choix.** Envoyez un logo horizontal, une icône, des versions pour fond sombre : le site choisit le bon selon l'endroit. Le format SVG est accepté, après un nettoyage de sécurité.
- **Menus déroulants.** Rangez des pages et des liens sous un titre, par exemple « À propos ».
- **En-tête au choix.** Quatre mises en page, un lien secondaire, un bouton, et les icônes de tous vos réseaux sociaux.
- **Bandeau d'accueil plus complet.** Une petite phrase au-dessus du titre et un bouton d'action.

### Vie privée
- **Pas de bandeau de cookies à prévoir.** Rien n'est déposé chez vos visiteurs, sauf s'ils cliquent eux-mêmes sur « Me prévenir des nouveautés » (désactivé par défaut). Les statistiques restent anonymes.
- **Page « Politique de confidentialité » automatique.** Elle décrit ce que fait vraiment votre site, avec un lien dans le pied de page. Vous pouvez y ajouter vos propres informations.

### Améliorations
- **Barre « Enregistrer / Annuler » toujours visible.** Plus besoin de descendre en bas de la page ; Ctrl+S fonctionne aussi.
- **Fonctionnalités et Ajouter au même endroit.** Deux onglets au lieu de deux entrées de menu.
- **Réglages de confidentialité regroupés** dans leur propre onglet.
- **Chaque version est testée avant publication.** Nous la démarrons en conditions réelles, sur une installation neuve et sur un site existant.

### À savoir en mettant à jour
- **Rien à refaire.** Vos fonctionnalités, contenus et réglages sont conservés, et les anciennes sauvegardes se restaurent normalement.
- Les pastilles « nouveau » du menu n'apparaissent plus tant que le visiteur n'a pas cliqué sur « Me prévenir des nouveautés ».
- Votre logo actuel devient l'icône du site ; il s'affiche en entier au lieu d'être rogné en rond.

### Pour les développeurs
- Un seul dépôt peut contenir plusieurs modules : `https://…/dépôt#version:dossier` installe celui d'un dossier, mis à jour indépendamment des autres.
- Variables : `CURIOSA_CATALOGUE_REPO` choisit le dépôt de l'index du Catalogue, `CURIOSA_EXTRAS_DIR` le dossier des modules livrés.
- La suggestion de modules est une liste tenue par le dépôt de modules, pas un champ du manifeste : un auteur ne peut pas s'en attribuer le bénéfice.
- Nouveaux documents : « Développer son propre module » (README), `docs/MESURES.md` (chiffres mesurés), `docs/PRIVACY.md`, et un miroir de la documentation sur le wiki GitHub.

## 0.1.2

*Changements depuis la 0.1.1.*

### Nouveautés
- **Statistiques de visite anonymes.** Le tableau de bord montre combien de personnes viennent, quelles pages sont lues et d'où elles arrivent, sans jamais garder d'adresse IP ni d'identifiant.
- **Pastilles « nouveau ».** Le menu du site signale ce qui est nouveau depuis la dernière visite.
- **Pastilles dans l'admin.** Un rond vous prévient des messages à vérifier ou d'une mise à jour, et une carte « À traiter » les regroupe sur le tableau de bord.
- **Menu d'admin mieux rangé.** Mon contenu, Mon site, Fonctionnalités, Administration ; la page ouverte est surlignée et le mode simple a des libellés plus clairs.
- **Vidéo de fond dans le bandeau d'accueil.** Envoyez une vidéo (jusqu'à 50 Mo) : elle ne joue que lorsqu'elle est visible et démarre sans son.
- **Blocs de page.** Texte et images, onglets, chiffres clés, appel à l'action, texte sur vidéo, avec une image de fond au choix.
- **Fond de page personnalisable.** Dessin, halo de couleur et motif de points ; les réglages sont rangés en onglets.
- **Thème sombre de l'admin, favicon personnalisable, ordre d'affichage réglable** pour chaque collection.
- **README refait** pour mieux présenter le projet, et « Propulsé par Curiosa » en pied de page.

### Licence
- **Curiosa License 1.0.** Utilisation gratuite pour votre propre activité, même commerciale ; revente interdite ; crédit « Propulsé par Curiosa » obligatoire. Les versions d'avant la 0.1.2 restent sous licence MIT.

### À savoir en mettant à jour
- Une petite mise à jour de la base est faite automatiquement, après une sauvegarde de sécurité.
- Si vous envoyez des vidéos, demandez à votre hébergeur d'autoriser les envois jusqu'à 60 Mo.

## 0.1.1

Première version stable publiée : installation prête à l'emploi, mises à jour depuis l'admin, import depuis Grav et sauvegardes chiffrées.
