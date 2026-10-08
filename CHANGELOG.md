# Changelog

Ce que chaque version change pour vous. Chaque version (stable ou release candidate) reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).

## Prochaine version (non publiée)

*Changements depuis la 0.1.2.*

### Nouveautés
- **Jeu de logos** (Réglages → Identité → Logos) : logo horizontal, icône carrée, versions pour fond sombre, favicon et image de partage. Rien n'est obligatoire : le site choisit seul le bon logo selon l'endroit et la couleur du fond (horizontal sur grand écran, icône sur téléphone), sans jamais étirer un logo horizontal dans un carré. Le kit presse propose tous les logos envoyés.
- **SVG pour les logos et le favicon** : le dessin est relu élément par élément et réécrit avant d'être enregistré ; scripts, styles, textes, images intégrées et liens externes sont refusés avec un message précis. Servi, un SVG ne peut rien exécuter.
- **Menus déroulants** : l'éditeur de menu range des pages et des liens dans un groupe nommé (« À propos ▾ »), sur un niveau. Ouverture au clic, au toucher, au survol et au clavier (Échap).
- **En-tête au choix** (Réglages → Apparence) : Classique, Deux niveaux, Centré ou Discret, avec un lien secondaire (« Nous contacter »), un bouton (« Devenir membre ») et les icônes de **toutes** vos listes de réseaux sociaux.
- **Bandeau d'accueil** : une petite ligne au-dessus du titre et un bouton d'appel à l'action.

### Vie privée
- **Pas de bandeau de cookies à prévoir** : les cookies de « dernière visite » ne sont plus déposés chez tout le monde. Ils n'existent que si le visiteur clique sur le nouveau bouton **« Me prévenir des nouveautés »** (à activer dans Réglages → Confidentialité, désactivé par défaut) ; un second clic efface tout. Les anciens cookies sont supprimés chez les visiteurs qui ne l'ont pas demandé. Les statistiques ne déposent rien et ne gardent aucune donnée personnelle.
- **Page « Politique de confidentialité » fournie par le cœur** (`/privacy`, lien permanent dans le pied de page de tous les sites) : elle est écrite d'après ce que votre site fait vraiment (cookies, statistiques, bouton « nouveautés », données déclarées par chaque module actif : champ `privacy` du manifeste, déjà renseigné pour le formulaire de contact). Le texte obligatoire ne peut ni être modifié ni retiré ; le propriétaire peut **ajouter** ses propres informations (Réglages → Confidentialité, par langue). Le chemin `/privacy` devient réservé : une page nommée « privacy » est masquée par celle du cœur.
- **docs/PRIVACY.md** : ce que le framework dépose et enregistre, et quoi écrire dans votre page de confidentialité.

### Améliorations
- **Fonctionnalités et Ajouter** : « Modules » et « Catalogue » ne sont plus deux entrées de menu mais un seul endroit à deux onglets (*Fonctionnalités* | *Ajouter*, ou *Modules* | *Catalogue* en mode avancé). Les adresses restent les mêmes.
- **Réglages → Confidentialité** : la case « Compter les visites (anonyme) » (et, en mode avancé, le blocage des robots d'IA) quitte l'onglet Identité pour un onglet à part, avec la précision de ce que le site retient dans le navigateur des visiteurs.

### À savoir en mettant à jour
- Les pastilles de nouveautés du menu ne s'affichent plus tant que le visiteur n'a pas activé le bouton « Me prévenir des nouveautés » (à proposer dans Réglages → Confidentialité).
- Aucune migration de base de données. Votre logo actuel devient l'« icône » ; il s'affiche entier au lieu d'être rogné en rond.

## 0.1.2

*Changements depuis la 0.1.1 (cumule les release candidates 0.1.2-rc.1 à rc.5).*

### Nouveautés
- **Statistiques de visite anonymes** : carte « Visites » sur le tableau de bord (visiteurs du jour, 7 et 30 jours, pages les plus lues, provenances). Aucune adresse IP ni identifiant conservé ; les visiteurs qui refusent le suivi, les robots et l'équipe connectée ne sont pas comptés. Désactivable dans les réglages.
- **Pastilles de nouveautés** : le menu du site signale ce qui est nouveau depuis la dernière visite du visiteur (deux cookies qui ne contiennent que des dates). Les modules peuvent définir leur propre règle (`news`).
- **Pastilles dans l'admin** : messages à vérifier (module Contacts), mise à jour disponible, et une carte « À traiter » sur le tableau de bord (hook de module `adminBadge`).
- **Menu d'admin réorganisé** par flux de travail (Mon contenu, Mon site, Fonctionnalités, Administration), page ouverte surlignée, libellés plus simples en mode simple. Les raccourcis de liens (redirections) sont expliqués en mode simple.
- **Bandeau d'accueil avec vidéo de fond** : MP4 ou WebM envoyé sur le site (50 Mo), lecture seulement quand elle est à l'écran, son au choix (toujours démarrée sans son), compatible Safari.
- **Module « Blocs de page »** : texte et images (collage), onglets, chiffres clés, appel à l'action, texte sur vidéo, avec image de fond (position, taille et voile au choix).
- **Fond de page** : dessin SVG nettoyé, halo de couleur personnalisable, points en quinconce ; réglages rangés en onglets, pastilles de couleur visibles.
- **Thème sombre de l'admin** (automatique, clair ou sombre), **favicon** personnalisable, **ordre d'affichage** réglable par collection (le plus récent d'abord par défaut).
- **README** réécrit pour présenter le projet ; « Propulsé par Curiosa » dans le pied de page du site (sans numéro de version) et dans celui de l'admin (avec la version).

### Licence
- **Curiosa License 1.0** : usage libre pour sa propre activité (même commerciale), vente interdite, hébergement préinstallé autorisé (comme un VPS avec Curiosa), crédit obligatoire, modules de tiers hors périmètre. Les versions publiées avant la 0.1.2-rc.4 restent sous licence MIT.

### À savoir en mettant à jour
- Une migration de base de données **additive** (statistiques de visite) est appliquée automatiquement ; la base est sauvegardée avant.
- Si un nginx est devant le site et que vous envoyez des vidéos, mettez `client_max_body_size` à 60 Mo.

## 0.1.1

Première version stable publiée (installation par archive compilée, mises à jour depuis l'admin, import depuis Grav, sauvegardes chiffrées).
