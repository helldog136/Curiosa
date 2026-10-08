# Changelog

Ce que chaque version change pour vous. Chaque version (stable ou release candidate) reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).

## 0.1.3

*Changements depuis la 0.1.2 (cumule les release candidates 0.1.3-rc.1 à rc.3 et ce qui a suivi).*

### Nouveautés
- **Le cœur ne contient plus aucun module.** Il se limite à ce qu'il faut pour faire fonctionner le site et son admin ; blog, réseaux sociaux, codes promo, pages, bandeau d'accueil, formulaire de contact, statut live, overlays, sponsors, planning… vivent désormais dans leur propre dépôt, **`curiosa-extras`**, et s'installent depuis le **Catalogue** comme n'importe quel module. Si le cœur avait besoin d'un module pour fonctionner, ce n'était pas un module : un test vérifie maintenant que le cœur n'en cite aucun.
- **Un seul dépôt peut contenir plusieurs modules.** Une adresse du type `https://github.com/propriétaire/dépôt#ref:dossier` installe le seul module de ce dossier. Chaque module est mis à jour **indépendamment** : une mise à jour n'est proposée que si le contenu de *son* dossier a changé. Le Catalogue, l'aperçu avant installation, les sauvegardes et la restauration savent maintenant dans quel dossier se trouve un module.
- **Le Catalogue lit son index dans `curiosa-extras`** (le dépôt de modules voisin du dépôt du cœur) ; la variable `CURIOSA_CATALOGUE_REPO` permet d'en choisir un autre, et `CURIOSA_EXTRAS_DIR` désigne le dossier des modules livrés.
- **Vos propres dépôts de modules.** Catalogue → **Mes dépôts de modules** (mode avancé, propriétaire) : on ajoute l'adresse d'un dépôt git (par exemple `https://github.com/jeanmi/mes-modules-curiosa`) ; Curiosa y trouve tous les modules (un dossier par module, ou un seul module à la racine) et les affiche. Chacun s'installe séparément après avoir lu son README et ses permissions, avec la confirmation habituelle d'un dépôt non vérifié, et se met à jour depuis ce même dépôt. Un dépôt sans module, injoignable ou à l'adresse refusée est rejeté ; dix dépôts au plus.
- **Une étape « Modules » dans l'assistant de première installation.** L'assistant ne propose plus de modules précis : il présente les modules que le **Catalogue suggère** (blog, réseaux sociaux, pages pour l'instant), décochés, avec la mention qu'on peut **passer cette étape sans aucun risque** (un bouton « Passer cette étape » la saute) : tout s'ajoute ou se retire plus tard depuis Fonctionnalités → Ajouter. Rien n'est créé d'office : un site neuf n'a que ce qu'on a coché.
- **« Suggéré » dans le Catalogue.** Les modules suggérés portent une pastille. La suggestion est une **liste tenue par le dépôt de modules**, pas un champ que pourrait s'attribuer n'importe quel module : un auteur ne peut pas faire passer son module pour suggéré.
- **Les blocs de page sont maintenant dans le cœur** : « Blocs de page » n'est plus un module à activer puis à instancier, mais une fonction de la page d'accueil. **Page d'accueil → Ajouter un bloc** propose cinq blocs aux descriptions claires (Texte et images, Onglets, Chiffres clés, Appel à l'action, Texte sur une vidéo), qui se remplissent directement dans l'éditeur du bloc (textes par langue, images, onglets, chiffres, vidéo, fond) sans passer par « Fonctionnalités ».
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
- **Plus de mention « livré avec le framework »** dans la page Modules et dans le Catalogue : elle n'apprenait rien à l'utilisateur. Un module installé depuis un dépôt personnel garde son avertissement « non vérifié ».
- **Barre flottante « Enregistrer / Annuler »** : dès qu'une modification est enregistrable (réglages, menu, page d'accueil, réglages d'une fonctionnalité, entrées), une petite barre apparaît en bas à droite de l'écran, sans avoir à défiler jusqu'au bouton. « Annuler » abandonne les modifications (après confirmation), « Enregistrer » les enregistre et la barre affiche brièvement « Enregistré ». **Ctrl/Cmd+S** enregistre aussi, et le navigateur prévient si l'on quitte la page avec des modifications non enregistrées.
- **Fonctionnalités et Ajouter** : « Modules » et « Catalogue » ne sont plus deux entrées de menu mais un seul endroit à deux onglets (*Fonctionnalités* | *Ajouter*, ou *Modules* | *Catalogue* en mode avancé). Les adresses restent les mêmes.
- **Réglages → Confidentialité** : la case « Compter les visites (anonyme) » (et, en mode avancé, le blocage des robots d'IA) quitte l'onglet Identité pour un onglet à part, avec la précision de ce que le site retient dans le navigateur des visiteurs.

### Fiabilité
- **Chaque archive de release est démarrée avant d'être publiée.** La CI la décompresse ailleurs et vérifie, comme chez un hébergeur : l'assistant de première installation sur une installation neuve, et le démarrage d'un site existant (modules « intégrés » convertis, instance intacte, page publique du module qui répond). Une archive qui échoue n'est pas publiée.

### À savoir en mettant à jour
- **Rien à refaire.** Au premier démarrage, chaque module qui était « intégré » (blog, réseaux sociaux, codes promo, pages, collection, bandeau d'accueil, formulaire de contact, statut live, bandeau défilant, kit presse) devient un module ordinaire, copié depuis les modules livrés avec cette version : mêmes réglages, mêmes entrées, même affichage, et il se met à jour ensuite comme les autres.
- Si vous aviez créé des blocs avec l'ancien module, ils sont **convertis automatiquement** au premier démarrage : même place sur l'accueil, même taille, mêmes textes, images, onglets et chiffres ; l'ancien module disparaît de « Fonctionnalités ».
- Les **anciennes sauvegardes** qui mentionnent des modules « intégrés » se restaurent normalement : ces modules sont réinstallés depuis le Catalogue.
- Les **archives de version** embarquent un instantané des modules (dossier `extras/`) : la première installation et le Catalogue fonctionnent toujours sans réseau.
- Les pastilles de nouveautés du menu ne s'affichent plus tant que le visiteur n'a pas activé le bouton « Me prévenir des nouveautés » (à proposer dans Réglages → Confidentialité).
- Aucune migration de base de données. Votre logo actuel devient l'« icône » ; il s'affiche entier au lieu d'être rogné en rond.

### Documentation
- Documentation des modules mise à jour : où vivent les modules, comment ils sont livrés, installation depuis un dossier d'un dépôt, nouvelle variable `CURIOSA_EXTRAS_DIR`.
- **« Pourquoi Curiosa, et quand ne pas le choisir »** dans le README : le public visé, ce qui distingue le projet (avec comment le vérifier) et les cas où un autre outil est meilleur.
- **docs/MESURES.md** : chiffres mesurés sur une release publiée (installation chronométrée, poids sur disque, ce que la page envoie, mémoire, cookies, services tiers) avec leur méthode, y compris les points faibles, et la liste de ce qui n'est pas mesuré. **`scripts/measure.mjs`** permet de refaire la mesure d'une page soi-même.
- Vocabulaire : le README ne parle plus d'« ouvert » à tort ; la licence est celle d'un code source **disponible**, pas d'un logiciel « open source » au sens strict.
- **« Développer son propre module » dans le README** : un module complet en deux fichiers (testé), comment l'essayer en local, les règles à connaître (licence du module, vie privée, sécurité), et l'ordre de lecture de la documentation ; ainsi qu'un index de toute la documentation.
- **Tutoriel des modules complété** : type de réglage `video`, nouvelle section « Vie privée, cookies et licence » (champ `privacy`, pas de cookie non essentiel, licence de son module), nouveaux hooks `news` et `adminBadge`, chemin d'installation locale mis à jour.
- **Wiki GitHub** : la documentation est reflétée automatiquement sur le wiki à chaque release stable (le dépôt reste la source de vérité ; le wiki n'est qu'un miroir).

## 0.1.3-rc.3

*Release candidate : changements depuis la 0.1.3-rc.2. À essayer avant la version stable, à vos risques.*

### Nouveautés
- **Le cœur ne contient plus aucun module.** Il se limite à ce qu'il faut pour faire fonctionner le site et son admin ; blog, réseaux sociaux, codes promo, pages, bandeau d'accueil, formulaire de contact, statut live, overlays, sponsors, planning… vivent désormais dans leur propre dépôt, **`curiosa-extras`**, et s'installent depuis le **Catalogue** comme n'importe quel module. Si le cœur avait besoin d'un module pour fonctionner, ce n'était pas un module : un test vérifie maintenant que le cœur n'en cite aucun.
- **Un seul dépôt peut contenir plusieurs modules.** Une adresse du type `https://github.com/propriétaire/dépôt#ref:dossier` installe le seul module de ce dossier. Chaque module est mis à jour **indépendamment** : une mise à jour n'est proposée que si le contenu de *son* dossier a changé. Le Catalogue, l'aperçu avant installation, les sauvegardes et la restauration savent maintenant dans quel dossier se trouve un module.
- **Le Catalogue lit son index dans `curiosa-extras`** (le dépôt de modules voisin du dépôt du cœur) ; la variable `CURIOSA_CATALOGUE_REPO` permet d'en choisir un autre, et `CURIOSA_EXTRAS_DIR` désigne le dossier des modules livrés.

### À savoir en mettant à jour
- **Rien à refaire.** Au premier démarrage, chaque module qui était « intégré » (blog, réseaux sociaux, codes promo, pages, collection, bandeau d'accueil, formulaire de contact, statut live, bandeau défilant, kit presse) devient un module ordinaire, copié depuis les modules livrés avec cette version : mêmes réglages, mêmes entrées, même affichage, et il se met à jour ensuite comme les autres. La mention « intégré » disparaît de la page Modules.
- Les **anciennes sauvegardes** qui mentionnent des modules « intégrés » se restaurent normalement : ces modules sont réinstallés depuis le Catalogue.
- Les **archives de version** embarquent un instantané des modules (dossier `extras/`) : la première installation et le Catalogue fonctionnent toujours sans réseau.

- **Vos propres dépôts de modules.** Catalogue → **Mes dépôts de modules** (mode avancé, propriétaire) : on ajoute l'adresse d'un dépôt git (par exemple `https://github.com/jeanmi/mes-modules-curiosa`) ; Curiosa y trouve tous les modules (un dossier par module, ou un seul module à la racine) et les affiche. Chacun s'installe séparément après avoir lu son README et ses permissions, avec la confirmation habituelle d'un dépôt non vérifié, et se met à jour depuis ce même dépôt. Un dépôt sans module, injoignable ou à l'adresse refusée est rejeté ; dix dépôts au plus.

### Fiabilité
- **Chaque archive de release est démarrée avant d'être publiée.** La CI la décompresse ailleurs et vérifie, comme chez un hébergeur : l'assistant de première installation sur une installation neuve, et le démarrage d'un site existant (modules « intégrés » convertis, instance intacte, page publique du module qui répond). Une archive qui échoue n'est pas publiée.

### À essayer en priorité
- Catalogue → Mes dépôts de modules : ajoutez un dépôt de modules (le vôtre ou un dépôt de test), installez-en un module, puis cherchez une mise à jour.
- Après la mise à jour : le site s'affiche comme avant (accueil, menu, réseaux sociaux en en-tête) ; Admin → Modules montre vos modules comme « du catalogue ».
- Admin → Catalogue : installer un module, puis vérifier « Chercher une mise à jour ».
- Sur une installation neuve, l'assistant de première installation propose toujours blog, réseaux sociaux, codes promo et pages.

### Documentation
- Documentation des modules mise à jour : où vivent les modules, comment ils sont livrés, installation depuis un dossier d'un dépôt, nouvelle variable `CURIOSA_EXTRAS_DIR`.
- **« Pourquoi Curiosa, et quand ne pas le choisir »** dans le README : le public visé, ce qui distingue le projet (avec comment le vérifier) et les cas où un autre outil est meilleur.
- **docs/MESURES.md** : chiffres mesurés sur une release publiée (installation chronométrée, poids sur disque, ce que la page envoie, mémoire, cookies, services tiers) avec leur méthode, y compris les points faibles, et la liste de ce qui n'est pas mesuré. **`scripts/measure.mjs`** permet de refaire la mesure d'une page soi-même.
- Vocabulaire : le README ne parle plus d'« ouvert » à tort ; la licence est celle d'un code source **disponible**, pas d'un logiciel « open source » au sens strict.

## 0.1.3-rc.2

*Release candidate : changements depuis la 0.1.3-rc.1. À essayer avant la version stable, à vos risques.*

### Nouveautés
- **Les blocs de page sont maintenant dans le cœur** : « Blocs de page » n'est plus un module à activer puis à instancier, mais une fonction de la page d'accueil. **Page d'accueil → Ajouter un bloc** propose cinq blocs aux descriptions claires (Texte et images, Onglets, Chiffres clés, Appel à l'action, Texte sur une vidéo), qui se remplissent directement dans l'éditeur du bloc (textes par langue, images, onglets, chiffres, vidéo, fond) sans passer par « Fonctionnalités ».

### À savoir en mettant à jour
- Si vous aviez créé des blocs avec l'ancien module, ils sont **convertis automatiquement** au premier démarrage : même place sur l'accueil, même taille, mêmes textes, images, onglets et chiffres ; l'ancien module disparaît de « Fonctionnalités ».

### Documentation
- **« Développer son propre module » dans le README** : un module complet en deux fichiers (testé), comment l'essayer en local, les règles à connaître (licence du module, vie privée, sécurité), et l'ordre de lecture de la documentation ; ainsi qu'un index de toute la documentation.
- **Tutoriel des modules complété** : type de réglage `video`, nouvelle section « Vie privée, cookies et licence » (champ `privacy`, pas de cookie non essentiel, licence de son module), nouveaux hooks `news` et `adminBadge`, chemin d'installation locale mis à jour.
- **Wiki GitHub** : la documentation est reflétée automatiquement sur le wiki à chaque release stable (le dépôt reste la source de vérité ; le wiki n'est qu'un miroir).

### À essayer en priorité
- Page d'accueil → Ajouter un bloc : créez un bloc de chaque type (texte et images, onglets, chiffres, appel à l'action, texte sur une vidéo), enregistrez, regardez le site.
- Si votre site avait des blocs créés avec l'ancien module : vérifiez que l'accueil est identique après la mise à jour.
- Modifiez un réglage et enregistrez avec la barre flottante, sans défiler.

### Améliorations
- **Barre flottante « Enregistrer / Annuler »** : dès qu'une modification est enregistrable (réglages, menu, page d'accueil, réglages d'une fonctionnalité, entrées), une petite barre apparaît en bas à droite de l'écran, sans avoir à défiler jusqu'au bouton. « Annuler » abandonne les modifications (après confirmation), « Enregistrer » les enregistre et la barre affiche brièvement « Enregistré ». **Ctrl/Cmd+S** enregistre aussi, et le navigateur prévient si l'on quitte la page avec des modifications non enregistrées.

## 0.1.3-rc.1

*Release candidate : changements depuis la 0.1.2. À essayer avant la version stable, à vos risques.*

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
