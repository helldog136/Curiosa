# Pages d'overlay : décisions de conception (0.5.0)

Résultat de l'entretien avec la personne propriétaire (30 octobre 2026). Tout ce qui est écrit ici est DÉCIDÉ, sauf la section « Choix par défaut à relire » en fin de document. Ne pas rouvrir sans elle.

## But
Beaucoup de modules créent des overlays pour OBS (une adresse, une source navigateur chacun). Une nouvelle section d'administration, « Overlays », permet de **composer ses propres pages d'overlay** : choisir une résolution, puis placer où l'on veut des **éléments** fournis par les modules. Une seule adresse à coller dans OBS par page d'overlay.

## Vocabulaire (pour la personne qui s'en sert)
- Section : **Overlays** (sous-titre « Composez vos pages pour OBS »).
- Une composition : **page d'overlay** (« Principale », « Pause »…). Bouton « Nouvelle page d'overlay ».
- Un fragment : **élément** (« Ajouter un élément », « Retirer l'élément »). Libellé : « Compte à rebours · Événement à la une ».
- **Résolution** (liste de formats courants : 1280×720, 1920×1080, 2560×1440, 3440×1440, 3840×2160, + « autre » avec deux champs).
- Les comportements ne s'affichent jamais sous leurs noms techniques : « garde ses proportions », « s'adapte à la taille choisie ».
- Mots de travail internes (code, docs développeurs) : canevas = page d'overlay, fragment = élément, `scale` / `ratio` / `fluid`.

## Principes
1. **Le cœur possède les pages d'overlay** (stockage du cœur, une seule source de vérité). Les modules ne voient jamais la composition, seulement la taille de leur cadre. Elles font partie de la sauvegarde/restauration. Un élément dont le module a été retiré reste en place, vide, avec « Cet élément n'est plus disponible », sans casser la page.
2. **Rien ne change pour les overlays existants** : aucune migration, aucune adresse qui change. Chaque module continue de servir son overlay comme aujourd'hui ; la personne choisit entre l'overlay du module et sa propre page d'overlay. Une seconde phase pourra migrer les overlays des modules vers cette mécanique.
3. **Un module déclare une série d'éléments** (clé de manifeste, minCore 0.5.0) : identifiant, libellé FR/EN, description, comportement, taille naturelle ou hauteur de référence, plage de ratios acceptée, taille minimale, options (ci-dessous). **Sans déclaration, pas d'élément** : l'adoption est volontaire.
4. Un élément n'est PAS forcément un overlay existant : Planning (pas d'overlay propre) peut offrir un « planning de la semaine » qui n'existe que dans les pages d'overlay.
5. **Une seule adresse secrète par page d'overlay**. À l'ouverture, le cœur demande à chaque module, côté serveur, l'adresse de son élément (avec le secret propre du module) et construit les cadres (iframes isolés). Aucun secret de module n'apparaît dans l'administration. « Changer l'adresse secrète » coupe l'ancienne.
6. **Plusieurs pages d'overlay**, chacune avec son nom, sa résolution, ses éléments, son interrupteur actif/inactif, son adresse, son mode test. Page inactive : « Cet overlay est désactivé » (pas de page blanche). Dupliquer une page. Limites dures : **20 pages, 10 actives, 30 éléments par page**.
7. **Un même élément peut figurer dans plusieurs pages** : tous affichent la même information au même instant. Conséquence imposée aux modules : **un élément supporte plusieurs lecteurs simultanés** (chaque lecteur a son propre repère dans le flux d'événements, jamais de file partagée vidée par le premier lecteur). Test fourni dans le kit des modules.
8. Le **même élément deux fois dans une même page** est permis (utile pour plusieurs instances, ex. deux compteurs).

## Comportements (déclarés par chaque élément, un seul par élément)
- **`scale`** (garde ses proportions) : taille naturelle déclarée (ex. 600×200), mise à l'échelle comme une image, ratio verrouillé. Ex. : alertes, bandeau sponsors, compte à rebours.
- **`ratio`** (s'adapte au ratio) : hauteur de référence déclarée (ex. 1080) ; le module reçoit une fenêtre virtuelle dont la largeur suit le ratio du cadre, puis le tout est mis à l'échelle (même échelle visuelle, scène plus large). Ex. : Labyrinthe 3D en 21:9 / 3440×1440.
- **`fluid`** (s'adapte à la taille choisie) : fenêtre aux dimensions réelles du cadre, le module se réorganise comme un site responsive. Ex. : Sondages, planning, statistiques.
- Pour `ratio` et `fluid` : plage de ratios supportée + taille minimale déclarées ; l'éditeur empêche ou signale un cadre hors plage.
- Défaut d'un élément : `scale`.

## Propriété des réglages
- **Le module garde le contenu et l'apparence interne** (quoi afficher, durées, couleurs propres, file d'alertes), réglés dans sa propre page. Ses réglages de place/taille propres à l'overlay sont **ignorés** dans une page d'overlay : l'élément remplit le cadre donné.
- **La page d'overlay ne possède que la mise en page** : résolution, position, taille, ordre de superposition (devant/derrière), visible/masqué, mode test.
- **Options par élément** (réglées dans le panneau de placement) : au plus 5, types limités (choix dans une liste, oui/non, nombre, texte court). Le cœur dessine le formulaire d'après la déclaration (libellés FR/EN, aide, exemple, erreur sous le champ) ; le module reste propriétaire du sens et valide la valeur (une valeur inconnue, ex. un événement supprimé, est ignorée sans casser). Permet par exemple deux compteurs sur deux événements différents.

## Éditeur (navigateur de PC ; le téléphone n'est pas un objectif)
1. Choisir la résolution. 2. « Ajouter un élément » : liste groupée par module avec nom et description. 3. Placer par **glisser-déposer** et poignées (aimant léger sur bords et centre ; ratio verrouillé pour `scale`/`ratio`, libre pour `fluid`). 4. Toujours aussi : **champs précis** (X, Y, largeur, hauteur) et **boutons d'ancrage** (haut gauche… bas droite, centre, avec marge) pour la précision et l'accessibilité. 5. Ordre de superposition, visible/masqué par élément.
- Dans l'éditeur, les cadres montrent **leur nom** (module · élément · taille), pas le vrai contenu ; un bouton **« Aperçu en direct »** charge le vrai rendu à la demande (éditeur fluide pendant le glisser).

## Mode test
- Interrupteur par page d'overlay. Dans OBS : autour de chaque élément, **un cadre coloré dessiné par le cœur** avec « module · élément · taille en pixels » ; le vrai contenu reste visible dessous (avec un contenu d'exemple `demo` si le module en fournit un).
- La page vérifie périodiquement si le mode a changé (bascule sans recoller l'adresse dans OBS ; aucune tâche de fond côté serveur).
- **S'arrête tout seul au bout de 30 minutes** (constaté à la lecture, pas de minuteur). Bandeau d'administration : « Mode test actif, s'arrête à 21 h 40 » + « Arrêter maintenant » + « Prolonger de 30 minutes ».

## Apparence : style commun et skins d'overlay futurs
- Chaque page d'overlay porte un **style commun** (texte clair/sombre, fond transparent ou semi-transparent, arrondis ou angles droits) transmis aux éléments sous forme de **jetons `--ov-*`**. Un élément le suit par défaut ; une option de l'élément peut le surcharger ; un élément qui ne sait pas suivre (Labyrinthe 3D) le déclare et reste tel quel.
- Ce style commun est l'embryon de **futurs « skins d'overlay »** : même principe que les skins de site (jetons avec valeur de repli, feuille de style assainie, contrôle de lisibilité), **vocabulaire distinct** : jetons `--ov-*`, attributs `data-ov-part` / `data-ov-region`. Les skins d'overlay vivront **dans le même dépôt que les skins de site** (`curiosa-skins`) et se déclareront « skin d'overlay » dans leur `skin.json`.
- **Étanchéité** : la page d'un élément ne charge JAMAIS le skin de site, et un skin d'overlay ne touche jamais le site public. Règle pour les modules dès la V1 : styler les éléments par les jetons `--ov-*` et les attributs, pas par des classes en dur.
- Le style commun ne reprend PAS le skin du site.

## V1 (cœur 0.5.0 + modules)
- **Cœur** : mécanisme complet (pages d'overlay, éléments, trois comportements, options, mode test, multi-pages, une adresse par page, glisser-déposer, sauvegarde/restauration, assistant IA en lecture si pertinent, docs et kit pour auteurs de modules incluant le test multi-lecteurs).
- **Modules** (tous ceux utiles à helldog136.be + la liste demandée) : **Labyrinthe 3D** (`ratio`), **Overlay alertes** (`scale`, preuve du multi-lecteurs), **Compte à rebours** (`scale`, plusieurs instances), **Sondages** (`fluid`), **Overlay sponsors** (`scale`), **Planning** (élément « planning de la semaine » / prochain stream), **Statistiques de la communauté** (compteurs, respecte « rien n'est montré sans accord »), **Ma Chaîne Twitch** (followers, abonnements, pastille « en direct »).
- **Hors V1** : Raid Twitch (c'est un dock OBS, pas un overlay), Suggestions de jeux, Overlay défilant, Témoignages, Mascotte, Actions du live YouTube (seconde vague) ; migration des overlays existants vers cette mécanique (seconde phase) ; skins d'overlay (plus tard, prévus par les jetons `--ov-*`).
- Version : cœur **0.5.0** ; chaque module qui adopte les éléments monte d'une version mineure avec `minCore` 0.5.0.
- En parallèle, indépendant : **dock OBS de la télécommande Participation** (toutes les fonctions) — PR dédiée.

## Choix par défaut à relire (non tranchés explicitement)
- Un élément qui ne répond pas ou plante dans OBS : cadre vide silencieux en direct (jamais de message d'erreur visible par le public) ; le message complet n'apparaît qu'en mode test et dans l'administration.
- Propagation d'une modification de la page d'overlay vers OBS : la page vérifie une version légère toutes les ~5 s (ralentit quand rien ne change, s'arrête page fermée) ; aucune tâche de fond côté serveur.
- Un même élément dans plusieurs pages actives : autorisé pour tous (décision multi-lecteurs) ; la charge est bornée par les 10 pages actives.
- Son : les éléments qui jouent un son le font dans leur iframe ; le contrôle audio reste celui d'OBS (« Contrôler l'audio via OBS »).
- Accessibilité de l'éditeur : tout est faisable au clavier (champs, ancres, flèches) ; le glisser-déposer est un confort en plus.
- Cadre de test du cœur : ne remplace pas un éventuel mode d'aperçu propre au module.
