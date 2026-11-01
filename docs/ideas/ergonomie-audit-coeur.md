# Audit d'ergonomie du cœur de Curiosa contre `docs/ERGONOMIE-ADMIN.md` (R1 à R30)

Base : branche `dev` (cœur 0.5.1 plus docs), commit `ec98bbd`. Audit en lecture : aucun code applicatif n'a été modifié.
Méthode : lecture du code de toutes les pages de `src/app/admin/(panel)/` et `(auth)/`, de `src/components/admin/*`, de `src/locales/fr.json` (script de recherche des mots de R9), puis cœur monté sur une base de test avec 30 raccourcis, 12 personnes, 25 entrées de blog et 7 extensions installées (Blog, Contacts, Sondages, Liens, Bot Twitch, Chaîne Twitch, Connecteur Twitch). Captures à 1280 px et 390 px, regardées. Aucun défilement horizontal de page n'a été mesuré sur les pages capturées.

Légende de gravité : **B** = bloquant pour Emma, **G** = gênant, **m** = mineur. Effort : **S** < 1 h, **M** < 1 jour, **L** plus.

Captures : `/tmp/claude-0/-home-user/4e3492ee-8e17-57de-8380-ae93be24b42a/scratchpad/audit-core/` (`redirects`, `users`, `settings`, `appearance`, `assistants`, `navigation`, `ext-add`, `entries`, `inst-bot`, `inst-polls`, `inst-blog`, `dashboard`, `updates`, `audit`, `backup`, `account`, `home`, `social`, `health`, `setup`, chacune en `-1280.png` et `-390.png`).

Constat d'ensemble : le cœur est déjà bien meilleur que les modules cités dans la section 0 des règles (états vides, bulles « ? », erreurs sous le champ, replis « Plus d'options », confirmations). Les écarts viennent surtout de **quatre briques absentes** : une recherche en direct pour les listes, un interrupteur d'état, un tableau à colonne d'origine et des contrôles « période / durée / nombre borné ». Ils sont répartis dans le moteur de réglages partagé, qui touche tous les modules.

---

## 1. Tableau par page

Note = « praticable par Emma » (1 à 5).

| Page | Note | Top 3 des défauts | Règles |
|---|---|---|---|
| Tableau de bord `/admin` | 4 | 1) Cartes d'accueil toutes de même poids, sans action principale. 2) « Bravo ! » avec point d'exclamation et emoji. 3) Cartes de chiffres (mode avancé) qui parlent d'« Instances de modules ». | R3, R9, R13 |
| Entrées, liste `/admin/entries` | 3 | 1) Recherche avec bouton « Filtrer » et rechargement : pas en direct. 2) Filtre d'état dans une liste déroulante avec bouton. 3) Recherche absente de la liste quand elle est vide, mais l'état vide est bon. | R15, R19 |
| Entrées, édition | 4 | 1) La programmation de publication n'existe qu'en mode avancé (`publishedAt`) alors que « Publié le » est une demande courante. 2) Date de fin dans « Options » : bon, mais sans phrase d'aperçu. 3) Icône en champ libre avec liste de 20 marques. | R2, R21 |
| Page d'accueil `/admin/home` | 3 | Éditeur lourd (`HomeBuilder`), non relu en détail : voir section 5. 1) Aucune recherche dans la liste des sections proposables (une par extension et section). 2) Options par bloc rendues par le moteur de réglages. 3) PC d'abord : à confirmer sur 390 px. | R15, R27 |
| Menu du site | 4 | 1) Trois gros boutons « Ajouter… » de même poids. 2) Texte d'introduction long (3 lignes) avant la tâche. 3) Limites (40 éléments, 8 par sous-menu) annoncées avant d'être utiles. | R1, R3 |
| Apparence | 2 | 1) Page à onze sections et six tâches (skin actuel, choix, catalogue, dépôt personnel, retouches, visiteurs, gestion, crédits) : 6 100 px de haut à 390 px. 2) Liste de skins et catalogue sans recherche, sans onglets. 3) Réglages à listes déroulantes de 3 à 5 choix, interrupteur « visiteurs » factice (`aria-hidden`). | R1, R2, R15, R19 |
| Apparence et réglages `/admin/settings` | 3 | 1) Oui/non rendus par des listes « Autorisé / Bloqué » (IA) et un select à 2 options. 2) Langues : 40 cases à cocher et un select de toutes les langues sans recherche. 3) Fuseau horaire en saisie libre, quatre logos visibles d'emblée. | R4, R19, R21 |
| Réseaux sociaux | 3 | 1) Pas de recherche dans les réseaux disponibles (une carte par réseau du catalogue). 2) Une liste « actifs » et une liste « à ajouter » de même schéma. 3) Champ surnom obligatoire sans exemple. | R11, R15, R30 |
| Visibilité dans les IA | 4 | 1) Liste de contrôles avec « ! / ✓ / i » : bon. 2) Termes « robots », « llms.txt » restent dans les textes visibles. 3) Carte RSS longue en bas de page. | R1, R9 |
| Raccourcis de liens | 2 | 1) Trois boutons par ligne (Ouvrir, Désactiver, Supprimer) : « Désactiver / Activer » est un verbe, la suppression est aussi visible que l'ouverture. 2) Recherche absente tant qu'il y a 8 lignes ou moins, puis avec bouton et rechargement. 3) Date de fin et heure de fin en deux champs, sur trois rubriques (création, fiche, mode avancé). | R3, R6, R15, R16, R17, R21 |
| Extensions, installées | 4 | 1) Recherche en direct présente et filtre par famille : bon. 2) Aucun moyen de mettre une extension en pause (choix assumé dans le code), seulement la retirer. 3) Carte à plusieurs instances repliée sous un compteur. | R17 |
| Extensions, ajouter (catalogue) | 3 | 1) 70 cartes sur 8 800 px (16 500 px à 390 px). 2) Recherche en direct oui, mais ni famille, ni « déjà installée » en filtre. 3) Bouton « Découvrir » identique partout. | R14, R15 |
| Extensions, fiche et installation par adresse | 3 | 1) Adresse à coller en mode avancé seulement : bon. 2) Détails non relus à fond (voir section 5). 3) Avertissement long avant le champ. | R11 |
| Réglages d'un module (moteur partagé) | 3 | 1) Aucune application du budget R4/R5 : tous les champs non avancés s'affichent à plat. 2) Types manquants : date, durée, période, nombre borné avec unité, interrupteur, liste avec recherche. 3) Réglages traduisibles : une ligne par langue, champs ×N. | R4, R5, R6, R17, R19, R20, R21 |
| Overlays, liste | 3 | 1) « Activer / Désactiver » en bouton par ligne. 2) Plusieurs boutons par ligne (Modifier, copier l'adresse, activer, dupliquer). 3) Pas de recherche (20 pages au plus : seuil limite). | R15, R16, R17 |
| Overlays, éditeur | 3 | Non relu à fond (`OverlayEditor`), voir section 5. 1) Réglage de position en quatre champs x / y / l / h. 2) Mode test placé hors du formulaire principal. 3) PC d'abord : légitime. | R6, R27 |
| Assistants IA, accès | 3 | 1) Liste de jetons sans recherche. 2) Deux boutons visibles par ligne dont « Révoquer ». 3) Formulaire de création de quatre blocs sous la liste, plus un encadré de 3 étapes. | R3, R15, R16 |
| Assistants IA, un accès | 2 | 1) « Connexion par adresse » : bouton verbe « Activer / Désactiver ». 2) Une ligne par action et par module, sans recherche (centaines de lignes en avancé). 3) Mots « jeton », « clé », « MCP » dans les textes visibles. | R9, R15, R17 |
| Assistants IA, demandes et historique | 3 | 1) Choix « validation humaine / directe » en deux formulaires-boutons au lieu d'un choix segmenté. 2) Historique plafonné à 10, sans recherche. 3) Mails et textes parlent de « jeton ». | R9, R15, R19 |
| Équipe | 2 | 1) Liste de personnes sans recherche, chaque ligne ouverte avec son formulaire de rôles et un gros bouton « Changer le rôle ». 2) Phrase de niveau (« Écrit et publie le contenu. ») répétée sur chaque ligne. 3) Formulaire « Ajouter une personne » : quatre champs, mot de passe imposé, rôle préselectionné « Coordination technique ». | R3, R4, R8, R14, R15, R16 |
| Rôles | 2 | 1) Une case par droit et par module, sans repli ni recherche (plusieurs dizaines). 2) Modification de chaque rôle dans un `<details>`, suppression dans le même formulaire. 3) Nom, phrase, droits : jamais d'exemple sur le nom. | R4, R11, R15 |
| Santé du site | 4 | 1) Cinq blocs avant le contenu utile (verdict, pastilles, lancement, remarques, historique). 2) Réglages enregistrés par un bouton séparé pour une seule case. 3) Remarques sans recherche (listes plafonnées par groupe, « et n autres »). | R2, R15 |
| Sauvegarde et restauration | 4 | 1) Pas de liste des sauvegardes (téléchargement seulement) : choix de conception. 2) Avertissement avant le formulaire. 3) Restauration en zone « danger » colorée mais page non scindée en onglets. | R1, R24 |
| Mises à jour | 4 | 1) Beaucoup de blocs conditionnels : parcours clair mais dense. 2) Une case « mises à jour automatiques » avec un bouton « Enregistrer ». 3) Mots « RC » et « canal » en avancé seulement. | R2, R17 |
| Journal d'audit | 2 | 1) Recherche avec bouton « Rechercher » et rechargement. 2) Tableau à défilement horizontal sur téléphone, 100 lignes par page. 3) Colonne « Qui » en adresse brute (`mcp:...`), pas de filtre par personne ou par type. | R15, R27 |
| Mon compte et double vérification | 4 | 1) Langue en liste déroulante de 2 ou 3 choix. 2) « Clé d'accès », « clé » dans les textes. 3) Quatre blocs sur une page (profil, mot de passe, sécurité, appareils). | R1, R9, R19 |
| Mode simple / avancé | 4 | 1) Deux cartes très verbeuses. 2) Bouton déjà en pied de menu. 3) Liste à puces de 3 lignes par carte. | R11 |
| Assistant d'installation `/admin/setup` | 4 | 1) Erreur affichée en bas du formulaire, pas sous le champ. 2) Pas d'exemple sur « Nom du site » ni « Accroche ». 3) Choix de la langue sans recherche (liste des langues). | R11, R19, R22 |
| Connexion | 5 | Rien de bloquant. Erreur en bandeau (voulu pour la sécurité). | |

---

## 2. Liste complète des écarts

Chemins relatifs à `src/`. Les numéros de ligne sont ceux du commit `ec98bbd`.

### 2.1 Moteur de réglages des extensions (touche TOUS les modules)

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| M1 | R4, R5 | `components/admin/ModuleSettings.tsx:198-213` | Aucune limite : tous les champs sans `advanced` s'affichent à plat dans « options ». Un module qui déclare 15 réglages montre 15 champs. Pas d'avertissement ni de repli automatique au-delà de 7. | B | M |
| M2 | R6, R21 | `core/modules/types.ts:42` | Types disponibles : text, textarea, url, link, number, boolean, select, color, secret, image, video, choice, multichoice. Aucun type date, heure, période, durée ni plage : les modules les assemblent à la main (la liste de Bot Twitch en montre sept champs, capture `inst-bot-1280.png`). | B | M |
| M3 | R20 | `components/admin/ModuleSettings.tsx:78-79` ; `core/modules/types.ts:39-70` | Le type `number` n'a ni minimum, maximum, pas, unité ni valeur par défaut visible (`SettingField` n'a pas ces propriétés). Le champ accepte « -5 » ou « 1e9 ». | G | S |
| M4 | R11 | `core/modules/types.ts:39-70` | `SettingField` n'a pas de propriété `example` : un champ libre ne peut pas afficher « Par exemple : insta, ig » sous forme normalisée. Le placeholder n'est utilisé que pour `link` (`/contact`, ligne 99). | G | S |
| M5 | R17, R19 | `components/admin/Field.tsx:52-65` | `Checkbox` est une case 16 px. Il n'existe aucun composant « interrupteur » partagé (`GrantToggle.tsx` est un cas particulier à enregistrement immédiat, réservé aux jetons). Les modules et les pages du cœur retombent sur « bouton Activer / Désactiver ». | B | M |
| M6 | R19 | `components/admin/Field.tsx:67-79` ; `ModuleSettings.tsx:68-69` | `Select` sans recherche au-delà de 10 options, et pas de boutons segmentés pour 2 à 4 choix. Un `select` de 2 options (« Autorisé / Bloqué ») est rendu en liste déroulante. | G | M |
| M7 | R19 | `components/admin/Field.tsx:100-114` | `CheckboxGroup` (multichoice) sans recherche ni « tout / rien » : 20 options font une liste de 20 lignes. | m | S |
| M8 | R4, R6 | `components/admin/ModuleSettings.tsx:169-178` | Réglage traduisible sur un site multilingue : une ligne par langue, donc N champs pour un réglage. Rien ne replie les langues autres que la principale. | G | M |
| M9 | R7, R8 | `components/admin/ModuleSettings.tsx:185` | `OptionalGroup` est bon (bouton « Ajouter… »), mais n'existe que si le module le déclare. Aucun moyen simple de déclarer « réglage rare » sans groupe ni mode avancé. | m | S |
| M10 | R22 | `core/modules/types.ts:56-58` (multichoice) | Messages d'erreur du cœur (`minChoices`) sans exemple : ils disent combien, pas quoi faire. Vérifier les clés `instances.error.*`. | m | S |
| M11 | R10, R14 | `components/admin/ModuleSettings.tsx:105` | Obligatoire marqué par « * » dans le libellé : le libellé change (« Nom * ») et le lecteur d'écran le lit. Préférer l'attribut `required` et une mention globale. | m | S |
| M12 | R9 | `components/admin/ModuleSettings.tsx:99`, `core/modules/types.ts:42` | Le type `secret` s'appelle « clé » dans les aides générées (`instances.linkHelp`, `settings.mailPassHelp`) ; le module décide du libellé, le cœur n'impose rien (pas de contrôle de R9 sur le manifeste). | m | M |

### 2.2 Blocs d'administration rendus par le cœur pour les modules

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| B1 | R15 | `core/blocks.ts:68-76` ; `components/site/Blocks.tsx:222-248` | Le bloc `table` n'a ni recherche, ni filtre rapide, ni pagination. Les listes de commandes, partenaires, sondages des modules sont des tableaux de lignes non filtrables. | B | M |
| B2 | R17 | `core/blocks.ts:73` | `rowActions` ne propose que des boutons-verbes (`label`, `action`, `href`). Pas de colonne « interrupteur » qui montre l'état : cause directe du « Activer / désactiver » de Bot Twitch (`inst-bot-1280.png`, colonne « État » en texte + deux boutons). | B | M |
| B3 | R30 | `core/blocks.ts:68-76` | Pas de colonne « origine » à pastille colorée et écrite, pas de filtres rapides. Chaque module fait trois listes l'une sous l'autre. | B | M |
| B4 | R16 | `components/site/Blocks.tsx:236-243` | Les actions de ligne sont toutes visibles (`flex gap-2`), sans menu « ⋯ » : dès trois actions, deux lignes de boutons. `RowMenu.tsx` existe mais n'est pas utilisé par ce bloc. | G | S |
| B5 | R6, R21 | `core/blocks.ts:12-26` | `AdminField.kind` : text, textarea, email, url, number, date, select, hidden, image, checkbox, file. Pas de `time`, `period`, `duration`, `switch`, `range` ; pas de `min` / `max` / `unit` / `example` / `placeholder`. | B | M |
| B6 | R27 | `components/site/Blocks.tsx:223` | `overflow-x-auto` sur le tableau : sur téléphone, défilement horizontal. Aucune bascule en « cartes ». | G | M |
| B7 | R3, R24 | `inst-bot-1280.png` (bloc d'un module) | L'arrêt d'urgence est rendu avec le style de bouton principal (violet), comme « Vérifier maintenant ». Le style `danger` n'est pas proposé comme type de bouton de formulaire (`adminForm` n'a que `submitLabel`). | G | S |
| B8 | R3 | `core/blocks.ts:54-62` | `adminForm` : un seul bouton, pas de variante destructive ni secondaire. | m | S |

### 2.3 Raccourcis de liens (redirections)

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| L1 | R15 | `app/admin/(panel)/redirects/page.tsx:103-108` | Recherche seulement si plus de 8 lignes ou une recherche en cours, avec bouton « Chercher » et rechargement. Doit être présente dès le départ et en direct. | B | S |
| L2 | R17 | `redirects/page.tsx:139` ; `redirects/[id]/page.tsx:117` | `PendingButton` « Désactiver / Activer » : verbe. À remplacer par un interrupteur. Sur la fiche, il est même rangé dans une section intitulée « danger ». | B | S |
| L3 | R3, R16 | `redirects/page.tsx:137-141` | Trois boutons de même poids par ligne dont « Supprimer » en rouge, toujours visible. La capture montre des lignes à trois gros boutons. | G | S |
| L4 | R6, R21 | `redirects/page.tsx:84-85` ; `redirects/[id]/page.tsx:101-102` | Date de fin et heure de fin en deux champs (l'heure en avancé). Un seul champ date-heure suffirait. | G | S |
| L5 | R14 | `redirects/page.tsx:129` | Étiquette « suit l'entrée » : légitime car rare. Mais « Actif » est affiché sur chaque ligne active (valeur par défaut). | m | S |
| L6 | R9 | `redirects/page.tsx:42` ; `fr.json` `redirects.measure.advanced` | « QR code », « slug » ; la phrase longue d'explication n'est pas dans une bulle. | m | S |
| L7 | R16 | `redirects/page.tsx:131` | URL cible coupée par `break-all` (rendu sur 2 lignes) : hauteurs inégales de lignes. À couper avec « … » et info-bulle. | G | S |
| L8 | R1 | `redirects/page.tsx:159-173` | Le réglage « Compter les clics » est en bas de la liste, avec son propre bouton Enregistrer : deuxième tâche sur la page. | m | S |
| L9 | R11 | `redirects/page.tsx:78-79` | Aide longue sous le champ d'adresse (« Collez l'adresse… Exemple : https://twitch.tv/monpseudo ») et sous le nom (trois lignes, voir capture). Plus de 60 caractères sans bulle (`RedirectAddressFields.tsx:37,46` n'utilise pas `HelpTip`). | G | S |

### 2.4 Équipe et rôles

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| U1 | R15 | `users/page.tsx:52-132` | Aucune recherche sur la liste des personnes (12 lignes seed = 5 500 px de haut). | B | S |
| U2 | R14 | `users/page.tsx:88` | `roles.system.<niveau>` (« Écrit et publie le contenu. ») répété sur chaque ligne : étiquette identique, voir `users-1280.png`. | G | S |
| U3 | R16, R3 | `users/page.tsx:89-106` | Chaque ligne porte son formulaire de rôles complet (cases + gros bouton « Changer le rôle »). Les lignes ont des hauteurs différentes. Le bouton est toujours violet (principal) pour chaque personne. | B | M |
| U4 | R2, R4, R8 | `users/page.tsx:136-154` | « Ajouter une personne » : quatre champs (nom, e-mail, mot de passe de départ, rôle) alors que la tâche utile est « un e-mail + un rôle ». Le mot de passe est choisi par l'administrateur et à transmettre à la main. | B | M |
| U5 | R8, R19 | `users/page.tsx:141` | Le rôle présélectionné est le premier de `grantableLevels` : « Coordination technique » (le plus puissant) dans la capture. Le défaut doit être le moins puissant (Rédaction). | B | S |
| U6 | R3, R24 | `users/page.tsx:119-128` | Quatre actions sensibles dans un `DangerZone` replié : bon. Mais « Changer mot de passe temporaire » et « Retirer la double vérification » sont au même niveau que « Supprimer le compte ». | m | S |
| U7 | R17 | `users/page.tsx:157-163` | Case « Exiger la double vérification » avec bouton « Enregistrer » séparé : un interrupteur à effet immédiat serait attendu. | G | S |
| U8 | R9 | `fr.json` `users.twofaReset`, `account.passkeys.*`, `login.passkey` | « clé d'accès » (la « clé » interdite par R9, mais c'est le nom officiel du produit : à noter dans le glossaire). | m | S |
| U9 | R4, R15 | `users/RolesPanel.tsx:220-238` | Une case par droit par module, sans repli par module, sans recherche, sans « tout cocher ». Le nombre de droits croît avec chaque extension. | B | M |
| U10 | R2, R3 | `users/RolesPanel.tsx:243-271` | Modifier et supprimer un rôle dans le même `<details>` ; le bouton de suppression arrive après le formulaire d'enregistrement, avec un select de remplacement. | G | M |
| U11 | R11 | `users/RolesPanel.tsx:213-216` | Nom du rôle : aucun exemple (« Par exemple : Modération »). Le placeholder n'existe que sur le formulaire de création. | m | S |
| U12 | R14 | `users/RolesPanel.tsx:247` | Pastille « Prédéfini » sur chaque rôle prédéfini : étiquette répétée. Un seul titre de groupe suffirait. | m | S |

### 2.5 Page d'accueil, apparence, réglages, menu, réseaux sociaux

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| A1 | R1 | `appearance/page.tsx:103-313` | Onze sections sur une seule page : skin actuel, choix, catalogue, dépôt personnel, retouches (en-tête, couleurs, police, quatre couches d'arrière-plan), options, visiteurs, gestion, crédits. 6 149 px à 390 px. À scinder en onglets « Skin », « Couleurs », « Fond », « Gestion ». | B | M |
| A2 | R15 | `appearance/page.tsx:51,153` ; `SkinCards.tsx` | Liste de skins installés et catalogue (jusqu'à 60) sans recherche ni filtre clair/sombre. | G | S |
| A3 | R19 | `appearance/page.tsx:200,231,186` | Glow (aucun / doux / fort), motif et police : `select` de 3 à 5 choix, à passer en boutons segmentés. | G | S |
| A4 | R20 | `appearance/page.tsx:216-221` | Six champs `number` (nombre, taille, variance, teinte, intensité, graine) sans unité ni bornes (mode avancé). | m | S |
| A5 | R19 | `appearance/page.tsx:287-289` | Faux interrupteur « Clair / Sombre / Auto » décoratif (`aria-hidden`), non actionnable : donne l'impression d'un contrôle. | m | S |
| A6 | R4, R6 | `appearance/page.tsx:196-258` | Quatre couches numérotées chacune avec titre, note, contrôle : 4 sous-blocs pour une seule tâche (« fond »). | G | M |
| ST1 | R19 | `settings/page.tsx:57,143,145` | `aiTraining` et `aiAnswers` (autoriser ou bloquer) sont des listes déroulantes à 2 options : oui/non doit être un interrupteur. `entityType` : 2 choix, boutons segmentés. | G | S |
| ST2 | R19 | `settings/page.tsx:103,112` | `defaultLocale` : select de toutes les langues connues sans recherche. Langues activées : 40 cases dans une grille. | G | M |
| ST3 | R21 | `settings/page.tsx:92` | Fuseau horaire en saisie libre `Europe/Brussels` (mode avancé). Une liste avec recherche ou une détection serait attendue. | m | S |
| ST4 | R4 | `settings/page.tsx:73-78` | Quatre logos visibles d'emblée (deux seulement indispensables), plus « Versions pour fond sombre ». | G | S |
| ST5 | R9 | `components/admin/ImageField.tsx` (champ affiché `https://... ou /uploads/...`) | Le champ image montre une adresse en saisie libre (voir capture `settings-1280.png`) : « adresse » et « /uploads/ » sont du vocabulaire technique. | G | M |
| ST6 | R6 | `settings/page.tsx:171-182` | Lien et bouton d'en-tête : deux libellés ×langues + deux adresses. | m | M |
| ST7 | R20 | `settings/page.tsx:198` | `mailPort` : `number` sans bornes ni unité. | m | S |
| ST8 | R17 | `settings/page.tsx:133-134,147` | Cases à cocher enregistrées par le bouton flottant : acceptable, mais les décisions de confidentialité (stats, IA) sont mélangées avec des textes. | m | S |
| N1 | R3 | `navigation/page.tsx` (rendu `NavEditor`) | Trois boutons « Ajouter » de même poids (`inst-1280`) plus une grille de pages « Ajouter ». | m | S |
| N2 | R1 | `navigation/page.tsx:109` ; `fr.json` `navigation.intro` | Introduction de trois lignes avant la tâche. | m | S |
| SO1 | R15, R30 | `social/page.tsx:158-217` | Deux listes de même schéma (actifs, à ajouter) ; pas de recherche dans les réseaux du catalogue (une trentaine). | G | M |
| SO2 | R11 | `social/page.tsx:202` | Surnom obligatoire sans exemple. | m | S |
| SO3 | R25 | `social/page.tsx:177` | Bouton « Réglages » renvoie à l'extension, mais l'état de l'autre côté (« lien renseigné ou non ») n'est qu'un texte gris. | m | S |
| H1 | R15, R27 | `home/page.tsx` + `HomeBuilder.tsx` | Sections proposables en liste plate sans recherche ; à vérifier à 390 px. | G | M |

### 2.6 Entrées

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| E1 | R15 | `entries/page.tsx:63-74` | Formulaire GET avec bouton « Filtrer » et rechargement : recherche pas en direct. | B | S |
| E2 | R19 | `entries/page.tsx:68-72` | État dans un `select` de 4 valeurs : boutons segmentés ou pastilles à compteurs (Tous 25 · Brouillons 7 · Publiées 18). | G | S |
| E3 | R14 | `entries/page.tsx:96-98` | Pastille « Publiée » sur la plupart des lignes (valeur courante) ; seul « Brouillon » ou « Programmée » devrait se voir. | G | S |
| E4 | R16, R17 | `entries/page.tsx:80-110` | Pas d'interrupteur Publié / Brouillon dans la ligne : il faut ouvrir la fiche. | G | M |
| E5 | R21 | `entries/EntryForm.tsx:143-145` | « Publié le » en avancé seulement ; date de fin sans aperçu de phrase (« Visible jusqu'au 12 novembre »). | m | S |
| E6 | R2 | `entries/EntryForm.tsx:126-141` | Bloc « Publication » à deux grandes cartes radio : ok, mais prend la place du titre sur téléphone. | m | S |

### 2.7 Assistants IA, extensions, overlays

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| AI1 | R17 | `assistants/[id]/page.tsx:100-105` | « Connexion par adresse » : bouton « Activer / Désactiver » selon l'état : verbe, pas état. | B | S |
| AI2 | R15 | `assistants/AccessTab.tsx:123-150` | Liste des accès sans recherche (les accès arrêtés sont dans un repli, ce qui est bien). | G | S |
| AI3 | R16, R3 | `assistants/AccessTab.tsx:138-141` | Deux boutons par ligne dont « Révoquer » en vue directe. | G | S |
| AI4 | R19 | `assistants/RequestsTab.tsx:313-324` | « Validation humaine / directe » : deux petits formulaires-cartes avec un bouton chacun. Un choix segmenté unique serait attendu. | G | M |
| AI5 | R9 | `fr.json` `assistants.new.how.key`, `assistants.created.key`, `aim.*` (« jeton ») | « clé de connexion », « jeton » visibles hors avancé (31 occurrences recensées dans `mcp.*` et `aim.*`, dont une partie seulement en avancé). | G | S |
| AI6 | R15 | `assistants/[id]/page.tsx:127-170` | Liste des actions par module, sans recherche, avec une ligne par action (réservé à l'avancé en détail, mais l'entretien reste visible). | m | M |
| AI7 | R26 | `assistants/AccessTab.tsx:178-185` | Trois étapes expliquées sous la liste : conforme (3 prérequis). Mais deux listes déroulantes dans le formulaire de création (type, comment). | m | S |
| X1 | R15 | `extensions/add/page.tsx:64-98` | Catalogue : 70 cartes, recherche en direct oui, mais pas de groupes par famille ni de filtre « pas encore installées ». | G | S |
| X2 | R14 | `extensions/add/page.tsx:83` | Pastille d'origine (« ✔ reconnue ») répétée sur chaque carte du catalogue officiel. | G | S |
| X3 | R3 | `extensions/add/page.tsx:91` | Bouton principal violet sur 70 cartes : plus rien n'est « le » bouton principal. | m | S |
| X4 | R17 | `components/admin/ExtensionCard.tsx:56-60` | Choix assumé : pas d'interrupteur ; une extension installée tourne. Pour mettre en pause il faut la retirer. | m | M |
| X5 | R9 | `fr.json` `modules.error.exists`, `modules.error.nomanifest`, `modules.error.loadCheck` | « identifiant », « module.json », « se charge » dans des messages visibles par Emma. | G | S |
| OV1 | R17 | `overlay-pages/page.tsx:69` | « Activer / Désactiver » en bouton. | B | S |
| OV2 | R16 | `overlay-pages/page.tsx:65-70` | Quatre boutons par ligne (Modifier, copier, activer, dupliquer) dans une carte haute. | G | S |
| OV3 | R15 | `overlay-pages/page.tsx:49` | Pas de recherche (20 pages au plus : seuil limite, mais le règlement dit « dès le départ »). | m | S |
| OV4 | R19 | `overlay-pages/page.tsx:40` | Résolution : select de 4 à 6 choix ; ok. | m | S |

### 2.8 Maintenance, comptes, installation

| # | Règle | Endroit | Écart | Grav. | Effort |
|---|---|---|---|---|---|
| AU1 | R15 | `audit/page.tsx:213-217` | Recherche avec bouton « Rechercher » et rechargement. | G | S |
| AU2 | R15 | `core/audit.ts:5` | 100 lignes par page (règle : 50 au plus). | m | S |
| AU3 | R27 | `audit/page.tsx:225-244` | `overflow-x-auto` : tableau à défilement horizontal sur téléphone. | G | M |
| AU4 | R14 | `audit/page.tsx:234` | « Qui » en adresse brute (`mcp:xxx`) ; aucune colonne d'origine colorée. | m | S |
| AU5 | R9 | `fr.json` (`audit.action.*`) | « Jeton d'accès créé », « Clé RAWG modifiée », « Instance créée par une migration » : 18 libellés techniques (page en mode avancé). | m | S |
| BK1 | R1 | `backup/page.tsx` | Création et restauration sur la même page ; acceptable mais deux tâches : deux onglets. | m | S |
| UP1 | R17 | `updates/page.tsx:195` | Mises à jour automatiques : case + bouton « Enregistrer ». | G | S |
| UP2 | R9 | `fr.json` `updates.diag.*`, `updates.hosting.npx` | « port », « gestionnaire », « npx » dans les messages d'échec visibles. | m | S |
| HE1 | R17 | `maintenance/content/page.tsx:319` | Une seule case avec un bouton « Enregistrer ». | m | S |
| HE2 | R2 | `maintenance/content/page.tsx:221-246` | Verdict, pastilles, bouton, texte d'aide : quatre éléments avant le contenu utile. | m | S |
| AC1 | R19 | `account/page.tsx:261` | Langue de l'interface : select de 2 ou 3 choix. | m | S |
| AC2 | R9 | `fr.json` `account.twofa.key`, `account.twofa.scan` | « Clé : » avec deux-points final (aussi R10), « clé ci-dessous ». | m | S |
| SE1 | R22 | `(auth)/setup/SetupWizard.tsx:189` | Erreur d'installation dans un bandeau en bas, pas sous le champ fautif. | G | S |
| SE2 | R11 | `SetupWizard.tsx:119-125` | « Nom du site » et « Accroche » sans exemple ni aide. | m | S |
| SE3 | R19 | `SetupWizard.tsx:93,102-109` | Langue par défaut et langues en plus : select et grille de cases de toutes les langues. | m | M |
| SE4 | R9 | `fr.json` `setup.error.token`, `backup.error.invalid-token` | « Jeton d'installation » : mot interdit, sans explication à l'écran. | G | S |
| TB1 | R13 | `fr.json:1032` `dashboard.welcome` | Point d'exclamation et emoji de fête (rendu dans `(panel)/page.tsx:57`), phrase de 28 mots. | m | S |
| TB2 | R9 | `fr.json` `dashboard.instances`, `modules.instancesTitle` | « Instances de modules » (mode avancé seulement). | m | S |
| NAV1 | R12 | menu latéral (`components/admin/NavGroup.tsx`, `adminMenu.ts`) | Deux entrées voisines « Apparence » et « Apparence et réglages » (voir toutes les captures) : même mot pour deux choses. | G | S |
| NAV2 | R12 | menu | « Overlays » (anglicisme) et « Santé de mon site » / « Sauvegarde » : OK mais « Overlays » n'est pas un mot d'Emma. | m | S |

### 2.9 Vérification transversale de `fr.json`

- **R29** : FR et EN ont exactement les mêmes 2 946 clés ; aucun `{variable}` ne diffère. Conforme.
- **R9** : 157 valeurs contiennent un des mots interdits. Hors `mcp.*` et `audit.*` (pages avancées), les clés visibles hors avancé les plus gênantes : `setup.error.token`, `backup.error.invalid-token`, `users.twofaReset`, `account.passkeys.title|help|none|add|failed|max`, `login.passkey`, `login.passkeyInvalid`, `account.twofa.key|scan`, `assistants.new.how.key`, `assistants.new.how.keyHelp`, `assistants.created.key`, `assistants.guide.keyText`, `assistants.step.2d`, `assistants.new.after`, `assistants.url.enableConfirm`, `aim.approval.directConfirm`, `aim.from`, `aim.req.module_install`, `aim.cfg.secret`, `aim.cfg.choice`, `modules.error.exists|nomanifest|loadCheck|serviceMismatch|sourceEmpty|requires|migration`, `modules.blockedNotice`, `net.health.title`, `net.health.summary`, `settings.servicesHelp`, `settings.rawgMoved`, `settings.rawgPending`, `settings.mailUser`, `settings.statsHelp`, `sources.none`, `migration.failed|newer|floor|timeout`, `legacy.row.behind|failed|newer|seedsMissing.help`, `maintenance.help|confirm|hash|result.migration`, `remove.introInstance`, `updates.diag.*`, `updates.hosting.npx`, `users.temp.warning`, `home.core.stats` (« Chiffres clés » : ok), `privacy.cookies.none`, `cookies.promise`, `rss.options.topics`, `rss.options.catalogue`, `transfer.file.type`, `redirects.measure.advanced`, `field.slug`, `instances.*` (mode avancé). Beaucoup contiennent « instance », « service », « clé » ou « identifiant » sans explication. Un contrôle `[auto]` n'existe pas dans ce dépôt (voir section 5).
- **R10** : aucun libellé de clé `*label` de plus de 60 caractères ni à deux-points final dans `fr.json`. Mais `account.twofa.key` (« Clé : ») et `mcp.lastUsed` (« Dernière utilisation ») sont utilisés avec « : » ajouté en code (`assistants/AccessTab.tsx:145`). Des libellés longs naissent dans le code : « Attente entre deux réponses, pour tout le monde (secondes) » (module), « Année du début (seulement si la période ne revient pas) » (module), « À propos (présentation longue) » (cœur, `settings.about`).
- **R11** : 211 clés d'aide sur 256 dépassent 60 caractères. Le mécanisme de `Field.tsx` les passe en bulle, ce qui est conforme. Mais plusieurs aides sont des `<p className={ui.help}>` posés à la main, qui n'utilisent pas ce mécanisme : `redirects/page.tsx:68`, `RedirectAddressFields.tsx:37,46`, `settings/page.tsx:54,101,129`, `appearance/page.tsx:152,168,174`, `social/page.tsx:182`.
- **R13** : un point d'exclamation (`dashboard.welcome`). Aucun « Veuillez ». Aucune majuscule criante repérée.

---

## 3. Composants du cœur à créer ou corriger une seule fois

Coût en jours d'agent ; « pages » = pages ou modules qui en profiteraient directement.

| # | Composant | Corrige | Coût | Pages concernées |
|---|---|---|---|---|
| C1 | **`LiveSearch` + `useLiveFilter`** : champ « Rechercher » en direct, insensible à la casse et aux accents, sur des lignes rendues par le serveur (attribut `data-search`) ; variante « interroge le serveur avec délai » pour les listes paginées ; état « Aucun résultat, Effacer la recherche ». Il existe déjà `CatalogueSearch.tsx` (47 lignes) : le généraliser est la voie la plus courte. | R15 | 1 j | Raccourcis, Entrées (variante serveur), Équipe, Rôles, Jetons, Journal d'audit, Réseaux, Catalogue, Skins, Overlays, Sections d'accueil, tableaux des modules : **12 pages et tous les modules** |
| C2 | **`Switch`** : interrupteur à état affiché, effet immédiat (action serveur), libellé relié, retour « enregistré » proche, annulation en cas d'échec ; variante dans un formulaire (case sur toute la ligne). `GrantToggle.tsx` est une base mais n'est ni générique ni accessible comme interrupteur de liste. | R17, R19 | 1 j | Raccourcis (2 pages), Overlays, Équipe (2FA), Mises à jour (auto), Santé (liens), Assistants (adresse), Entrées (publié), tous les `Checkbox` de réglages de module, `rowActions` des tableaux : **9 pages et tous les modules** |
| C3 | **Tableau du cœur `DataTable`** (nouveau type de bloc `table` v2, rétrocompatible) : colonne d'origine à pastille colorée et écrite, filtres rapides (« Toutes · Les vôtres · Partenaires · Réseaux »), recherche C1 intégrée, colonne `switch`, au plus deux actions visibles puis menu `RowMenu`, bouton de renvoi vers la page source, bascule en cartes sous 640 px, pagination à 50, texte long coupé avec « … » et info-bulle. | R14, R15, R16, R17, R27, R30 | 3 j | Journal d'audit, Équipe, tous les modules qui listent des éléments (commandes, partenaires, sondages, contacts…) : **3 pages du cœur et la plupart des modules** |
| C4 | **`PeriodField` / `DateTimeField` / `DurationField`** : un seul contrôle compact par notion (« Du 1er novembre au 30 novembre, chaque année » avec phrase d'aperçu ; durée « 30 secondes » avec unité ; date + heure en un champ). Disponible comme types de réglage (`period`, `duration`, `datetime`) et comme `kind` d'`adminForm`. | R6, R20, R21 | 3 j | Raccourcis (3 rubriques), Overlays (test), Entrées, Sondages, Bot Twitch, tout module qui assemble des champs de date : **4 pages du cœur et plusieurs modules** |
| C5 | **`NumberField` borné** : `min`, `max`, `step`, `unit`, valeur par défaut visible (« Vide : 30 s »), message d'erreur avec exemple. Nouvelles clés dans `SettingField` et `AdminField`. | R20, R22 | 0,5 j | Apparence (six champs), Réglages (port), tout module : **2 pages et tous les modules** |
| C6 | **`MoreOptions`** (panneau « Plus d'options » replié, ouvert d'office si une valeur y est déjà, avec compteur) utilisable par le moteur de réglages, avec la propriété `rare: true` sur un champ ; remplace le `<details>` recopié à la main dans 8 pages. `OptionalGroup` et `EntryForm` en sont déjà des cas particuliers. | R2, R4, R7 | 1 j | Raccourcis, Réglages, Équipe, Overlays, Entrées, Apparence, Assistants, Moteur de réglages : **8 pages et tous les modules** |
| C7 | **Budget de champs appliqué par le moteur de réglages** : au-delà de 7 réglages simples par onglet, repli automatique du surplus sous C6 et avertissement dans le kit `admin.ergonomics` ; regroupement des champs traduisibles (langue principale visible, autres langues repliées). | R4, R5 | 1,5 j | **tous les modules** |
| C8 | **`Segmented`** (boutons segmentés pour 2 à 4 choix) et **`SearchSelect`** (liste avec recherche au-delà de 10, libellés jamais tronqués) ; branchés sur `Select` : le composant choisit tout seul selon le nombre d'options. | R19 | 1 j | Réglages (4), Apparence (4), Entrées, Assistants, Compte, Installation, Moteur de réglages : **7 pages et tous les modules** |
| C9 | **`Field` : exemple et erreur** : propriété `example` (« Par exemple : … » sous le champ), champ obligatoire par attribut plutôt que « * », messages d'erreur normalisés « Écrivez …, par exemple … ». | R11, R22 | 1 j | **toutes les pages** |
| C10 | **`PageSection` / onglets de page** : généraliser `Tabs` / `PageTabs` à toute page de plus de trois sections (Apparence, Équipe, Sauvegarde, Réglages) avec l'en-tête « une phrase + action principale ». | R1, R2 | 1 j | Apparence, Sauvegarde, Assistants, Santé, Comptes : **5 pages** |
| C11 | **`Pastille` d'origine** (colorée et écrite, jamais seule) à utiliser dans C3 et dans les cartes du catalogue ; retire l'étiquette répétée « ✔ reconnue ». | R14, R28, R30 | 0,5 j | Catalogue, Entrées, Équipe, Extensions : **4 pages** |
| C12 | **Contrôle `admin.ergonomics` dans le dépôt** (aujourd'hui absent) : budgets R4/R5, mots R9, R10, R11, R29, appliqués aux pages du cœur sur un jeu d'exemples, et aux manifestes de module. | R4, R5, R9, R10, R11, R13, R29 | 2 j | **toutes les pages, tous les modules** |

---

## 4. Plan de correction ordonné (impact pour Emma ÷ effort)

Chaque lot est indépendant et tient en 1 à 3 jours d'agent.

**Lot 1 : liste vivante et interrupteur (2 j).** C1 + C2, appliqués à la page Raccourcis de liens : recherche en direct dès le départ, interrupteur à la place de « Désactiver / Activer », « Supprimer » rangé dans `⋯`, date de fin en un champ (version simple de C4). Corrige L1 à L4, L7. C'est la page la plus utilisée et la plus mal notée, et elle fournit les deux composants aux lots suivants.

**Lot 2 : équipe lisible (2 j).** U1 à U5 : recherche C1 ; une ligne par personne (nom, rôle, interrupteur de double vérification) et une fiche « Modifier » ; formulaire d'ajout en deux champs (e-mail, rôle) avec invitation par lien ; rôle par défaut le plus bas ; droits des rôles repliés par module avec recherche (U9). Dépend du lot 1.

**Lot 3 : tableau du cœur (3 j).** C3 + C11 : nouveau bloc `table` v2 (origine colorée, filtres, recherche, interrupteur, menu `⋯`, cartes sur téléphone). Application à Journal d'audit (AU1, AU3, AU4), Assistants (AI2, AI3) et aux tableaux des modules (B1 à B4, B6). Rétrocompatible : les anciens modules continuent de s'afficher. Dépend du lot 1.

**Lot 4 : réglages de module (3 j).** C5 + C7 + C9 + C6 : nombre borné avec unité, exemple et erreur normalisés, budget R4/R5 avec repli automatique, langues repliées. Corrige M1 à M4, M8 à M11. Touche tous les modules : à livrer avec le lot 8.

**Lot 5 : dates, périodes, durées (3 j).** C4, branchés sur les réglages de module (M2) et sur `adminForm` (B5) ; remplace, dans Raccourcis, Entrées (E5) et Overlays, les champs séparés. Sans lui, Bot Twitch garde ses sept champs de période.

**Lot 6 : apparence en onglets (2 j).** C10 + C8 : A1 à A6 ; skin actuel et choix en premier onglet, couleurs et fond en second, gestion en troisième ; couches d'arrière-plan en un seul bloc.

**Lot 7 : réglages et assistants (2 j).** ST1, ST2, ST4 à ST7, AI1, AI4, UP1, HE1, U7 : interrupteurs (C2) et boutons segmentés (C8) sur les pages de réglages, d'assistants et de mises à jour ; langues avec recherche ; deux logos visibles, les autres repliés.

**Lot 8 : mots et ton (1,5 j).** Passage sur les clés de la section 2.9 : « jeton » et « clé » deviennent « accès » ou « code », « instance » devient « élément » ou « extension », suppression de l'exclamation (TB1) ; NAV1 : renommer « Apparence » (skin) et « Apparence et réglages » en deux mots différents ; X5 et SE4. Ajouter les mots au glossaire (R12).

**Lot 9 : entrées et catalogue (1,5 j).** E1 à E4 (recherche C1 côté serveur, état en pastilles à compteurs, interrupteur Publié), X1 à X3 (groupes, filtre « pas encore installées », une seule pastille d'origine), SO1 (réseaux : un tableau, une recherche), H1.

**Lot 10 : mise en place du kit `admin.ergonomics` (2 j).** C12 : sans ce contrôle, les écarts reviennent à chaque module.

Ordre recommandé : 1, 2, 3, 8, 4, 5, 7, 6, 9, 10. Les lots 1 et 3 profitent le plus aux modules (les captures des Bot Twitch et Sondages montrent les mêmes défauts).

---

## 5. Ce qui n'a pas pu être vérifié

- Le contrôle automatique `admin.ergonomics` cité dans `docs/ERGONOMIE-ADMIN.md` **n'existe pas** dans le dépôt (aucune occurrence hors du document) : les règles [auto] ont été vérifiées par script ad hoc sur `fr.json` seulement (R9 sur les valeurs, R10 sur les clés `*label`, R11 sur les clés `*help`, R13, R29). Les libellés et aides écrits en dur dans le code n'ont pas été comptés de façon exhaustive.
- Les captures couvrent le cœur seul plus sept extensions installées depuis le catalogue (Blog, Contacts, Sondages, Liens, Bot Twitch et ses deux connecteurs). Les pages de réglages de modules à 15 champs ou plus n'ont donc pas été vues : le constat M1 est établi par le code, pas par une capture.
- Non relus à fond : `HomeBuilder.tsx`, `NavEditor.tsx`, `OverlayEditor.tsx`, `GridEditor.tsx`, `ImageCropper.tsx`, `DestinationList.tsx`, `ModuleMaintenance.tsx`, `ModulesUpdates.tsx`, `maintenance/legacy/page.tsx`, `catalogue/details`, `extensions/add/details/DetailsView.tsx`, `integrations/page.tsx`, `modules/page.tsx`, le détail de `TwoFactorPanel.tsx` et `PasskeysPanel.tsx`. Leur note repose sur la structure de la page, pas sur un essai.
- Le mode avancé n'a pas été capturé (toutes les captures sont en mode simple). Les pages Journal d'audit et le détail d'un accès sont notés sur le code.
- Thème sombre non vérifié. Clavier et lecteur d'écran (R28) non testés (seulement lecture du code : libellés reliés présents dans `Field.tsx`).
- Les captures à 390 px confirment l'absence de défilement horizontal de la page, mais le défilement interne du tableau d'audit (R27) n'a pas été mesuré faute de lignes dans le journal de test.
- Les actions (suppression, envoi de mail, installation de mise à jour, restauration) n'ont pas été exécutées. Les messages d'erreur sous les champs (R22) ont été lus dans le code (`FieldErrors.tsx`) et non provoqués.
- La mesure des « clics » du chemin court (R2) est estimée par lecture, pas chronométrée.
