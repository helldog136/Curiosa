# Changelog

Ce que chaque version change pour vous. Chaque version reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, dites ce que ça change pour vous, pas comment c'est fait. Les détails techniques vont dans la rubrique « Pour les développeurs ». Un test vérifie ces règles.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).

## Prochaine version (non publiée)

*Changements depuis la 0.1.4.*

### Améliorations
- **Chiffres de rapidité et de poids à jour.** Ceux annoncés dans la documentation sont remesurés sur la 0.1.4.

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
