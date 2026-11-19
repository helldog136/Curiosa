# Sauvegarde et restauration

Une sauvegarde est **un seul fichier**, en un clic depuis l'admin (*Sauvegarde*, propriétaire ou coordination technique : droit `core:backup`). Elle contient toutes vos
données — pas le code du framework :

| Inclus | Pas inclus |
|---|---|
| comptes (mots de passe **hachés**), réglages (secrets compris : mot de passe e-mail, adresses privées…) ; la clé RAWG et vos corrections de jaquettes sont dans les données du module « Jaquettes de jeux ». Une sauvegarde d'avant la 0.3.0 les a encore dans les réglages du cœur : la restauration les confie au module (voir « Anciennes sauvegardes ») | jetons d'API (à recréer) |
| instances de modules, entrées (toutes langues, brouillons compris), redirections | journal d'audit, liste « Jaquettes à vérifier » (elle se remplit seule) |
| données de **chaque module installé** (leur stockage, leurs réglages) | le code du framework et des modules (réinstallé depuis le catalogue) |
| images et fichiers envoyés | |
| la liste des modules installés (identifiant, version, dépôt, activé ou non) | |
| les **polices envoyées** (fichiers `.woff2`, dossier `fonts/` de l'archive) et le choix des polices (réglages) | la bibliothèque de polices livrée avec le cœur (elle est dans l'installation, pas dans vos données) |
| la liste des **skins** installés (dépôt, étiquette, version) et le skin choisi, avec vos retouches d'apparence (ce sont des réglages) | les fichiers des skins (réinstallés depuis leur dépôt, comme les modules) |

Le **cœur** fait la sauvegarde ; il sait aussi aller chercher ce que les modules ont stocké, sans que ceux-ci aient à coder quoi que ce soit.
Un module peut en plus ajouter ses propres fichiers lisibles (un CSV de ses données, par exemple) avec `backup.readable`
(voir [MODULES.md](MODULES.md)).

## Lisible sans le framework — et chiffrée

Le fichier téléchargé se nomme `backup-<site>-<date>.tar.gz.enc`. Il est **chiffré par le mot de passe choisi au moment de la sauvegarde**
(il n'est enregistré nulle part ; sans lui, rien n'est récupérable). Le chiffrement est le **format standard d'OpenSSL** : aucun
logiciel du framework n'est nécessaire pour l'ouvrir, même s'il a disparu.
(La commande ci-dessous est aussi affichée dans la page *Sauvegarde*, en mode avancé.)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in backup-mon-site-2026-10-07.tar.gz.enc -out backup.tar.gz
tar xzf backup.tar.gz
```

(OpenSSL est installé sur Linux et macOS ; sous Windows : Git for Windows ou WSL le fournissent.) Une fois extrait :

```
README.txt          mode d'emploi (français et anglais) — il est dans l'archive, avec vos données
backup.json         inventaire : version, date, modules, skins (facultatif), empreinte SHA-256 de chaque fichier
readable/           VOS DONNÉES MISES EN FORME POUR UN HUMAIN — commencez ici
  site.txt            résumé : nom du site, langues, modules, compteurs, réglages (secrets masqués)
  <instance>/*.md     une entrée par fichier Markdown et par langue, avec un en-tête (titre, statut, dates, étiquettes, lien, code…)
  modules/<instance>/ les données de chaque module (JSON ; CSV et autres fichiers que le module fournit)
data/               les mêmes données, brutes, en JSON : c'est ce que la restauration relit
                    (dont retired-instances.json : les données GARDÉES de modules ou d'instances retirés, inertes ; absent des sauvegardes d'avant la 0.1.20)
                    (dont upload-files.json : qui possède quel fichier envoyé, pour les modules qui peuvent les supprimer, 0.2.13 ; absent avant : aucun fichier n'a de propriétaire ;
                     overlay-pages.json : les pages d'overlay avec leurs éléments, leur style et leur adresse secrète, 0.5.0 ; absent avant : aucune page. Le mode test, volatil, n'y est pas.
                     La sauvegarde étant chiffrée, l'adresse secrète y est écrite pour que les adresses collées dans OBS fonctionnent encore après une restauration)
                    (dont roles.json et user-roles.json : les rôles et qui les a ; absents avant la 0.2.0 : la restauration recrée alors les rôles
                     prédéfinis et donne à chacun celui de son niveau `role` dans users.json)
uploads/            images et fichiers envoyés
fonts/              polices envoyées (.woff2) ; absent s'il n'y en a pas (docs/POLICES.md)
```

Tout est du **texte** (JSON, Markdown, CSV), sauf les images. Pour vérifier l'intégrité :
`sha256sum uploads/* data/*.json …` et comparer avec `backup.json`.

### Format technique (pour qui veut écrire son propre lecteur)

1. Fichier = `Salted__` (8 octets) + sel (8 octets) + chiffré AES-256-CBC (bourrage PKCS#7).
2. Clé (32 octets) et vecteur (16 octets) = `PBKDF2-HMAC-SHA256(mot de passe UTF-8, sel, 600000 itérations)` → 48 octets, découpés dans cet ordre
   (c'est exactement ce que fait `openssl enc -pbkdf2`).
3. Contenu déchiffré = archive `tar.gz` (ustar), chemins relatifs UTF-8, sans `..`.
   (Le serveur écrit et lit cette archive sans bloquer ses autres requêtes ; le format, lui, n'a pas changé : une sauvegarde faite avant se restaure, et celle d'aujourd'hui se lit avec `openssl`.)
4. `backup.json` : `{ format: "curiosa-backup", formatVersion: 1, createdAt, frameworkVersion, site, counts, modules[], files[{path, sha256, bytes}] }`.

## Restaurer

*Sauvegarde › Restaurer une sauvegarde* (encadré rouge : la restauration **remplace** les données actuelles) : choisissez le fichier, saisissez le mot de passe, puis **vérifiez l'aperçu** avant de confirmer.

- Le fichier est **vérifié avant tout** : mot de passe, format, version, empreinte de chaque fichier (une sauvegarde modifiée ou incomplète
  est refusée), présence d'une personne propriétaire (une restauration ne doit jamais vous enfermer dehors).
- Les **modules sont réinstallés depuis le catalogue** (dépôts du catalogue). Un module **personnel**
  (dépôt non vérifié) n'est réinstallé que si vous le **confirmez, module par module** ; sinon ses données sont gardées mais le module reste à réinstaller.
- La restauration **remplace** les données actuelles, en une seule transaction : tout ou rien. Un cliché complet (base, images, polices, extensions) est gardé avant dans
  `data/backups/pre-restore-<heure>/` (les 3 derniers).
- Les enregistrements de modules portent leur **clé** (`key`, facultative). Une sauvegarde plus ancienne, sans clé, se restaure telle quelle (clé vide). Le compteur de génération du stockage de chaque instance augmente (les modules reconstruisent leurs index en mémoire).
- Avant une **mise à jour groupée de modules**, une copie unique `data/backups/pre-bulk-update-<date>-<ts>.db` est prise (une seule gardée, jamais effacée par la rotation des autres copies).
- Les identifiants sont conservés : les sessions, les liens entre entrées, redirections et données de modules restent valides.
- Les modules installés ici mais absents de la sauvegarde restent installés (sans leurs instances).
- **Dépendances entre modules** ([MODULES.md › Dépendances](MODULES.md)) : les modules sont réinstallés **dans l'ordre des dépendances** (fournisseurs d'abord), puis les besoins de chaque module **actif** restauré sont vérifiés. Un fournisseur absent de la sauvegarde mais disponible (livré, catalogue) est installé avec son instance par défaut ; le bilan le mentionne. Si aucun n'est disponible, le module est restauré **avec ses données**, dans l'état « activé » de la sauvegarde, et l'**aperçu comme le bilan** disent « il manque : … » : la restauration n'est jamais interrompue et aucune donnée n'est perdue.

**Sur un serveur neuf** : installez le framework ([INSTALL.md](INSTALL.md)) et ouvrez le site. Le **premier écran de l'assistant propose
« J'ai déjà une sauvegarde : la restaurer »** : même procédure (fichier, mot de passe, aperçu, confirmation des modules personnels), sans créer
de compte provisoire. Si `SETUP_TOKEN` est défini, le même jeton est demandé. Ce chemin n'existe que **tant qu'aucun compte n'existe** :
un site en service ne peut se restaurer que depuis l'admin, par la personne propriétaire ou la coordination technique (droit `core:backup`). Reconnectez-vous ensuite avec un compte de la sauvegarde.

- **Fichiers supprimés par un module** (permission `files`, 0.2.13) : une sauvegarde est une photographie. Restaurer remet les fichiers qu'elle contient (supprimés depuis ou non) avec leur propriétaire et les données des modules de la même date : tout reste cohérent, la suppression ne casse jamais une restauration. Un fichier supprimé après la sauvegarde n'est plus dans les sauvegardes suivantes ; les anciennes sauvegardes le gardent tant que vous les gardez.

## Anciennes sauvegardes

Un fichier de sauvegarde n'a pas de date de péremption : **toute** sauvegarde d'une version plus ancienne se restaure (une version plus récente que le site est refusée, avant que quoi que ce soit soit installé). Le réseau sert à retrouver les extensions.
Le principe est « au mieux » : ce qui marche est restauré, ce qui ne peut pas être converti est **mis de côté**, et le bilan dit en clair quoi, avec le **chemin exact** du fichier lisible (voir plus haut) où se trouvent les données. Vous finissez à la main ; rien d'autre n'est bloqué.

1. **Le plan** (aperçu, avant d'écrire quoi que ce soit) : version de la sauvegarde, conversions du cœur qui vont tourner, chemin de chaque extension dont les données sont trop anciennes.
2. **Conversions du cœur**, fonctions pures sur les données lues (`src/core/backup/conversion/coreConversions.ts`) : éléments « éteints » d'avant la 0.1.20 (mis de côté avec leurs données, comme la migration `20261118090000_drop_enabled_columns`), menu d'avant la 0.2.6 figé dans `nav.menu`, place des overlays d'avant la 0.2.6, reprise RAWG d'avant la 0.3.0 (code, corrections et liste confiés au module « Jaquettes de jeux », installé s'il manque, une fois ses données en place ; l'ancien réglage reste où il est).
3. **Extensions** : si les données sont au niveau du plancher (`dataFloor`) de la version du catalogue ou au-dessus, la version du catalogue les convertit. Sinon, la restauration installe la version qui les convertit encore (le « pont » : la **dernière** version du dépôt dont le plancher accepte ces données, voir [MIGRATIONS.md](MIGRATIONS.md)), laisse convertir, recommence depuis la version de données obtenue, puis passe à la version du catalogue. Une étape impossible est signalée avec le dossier `readable/modules/<instance>/`.
4. **Copie de travail** : les données converties sont écrites dans une copie de la base et vérifiées (compte propriétaire, nombres de lignes, fichiers revendiqués présents, éléments stockés lisibles). Un problème arrête tout ici : le site n'a pas été touché.
5. **Échange** : un cliché complet est déjà pris. Les dossiers d'images et de polices sont posés d'un coup (renommage ; remplacement fichier par fichier sur un volume monté), puis la base est remplacée en **une** transaction qui revérifie les nombres avant de valider. Si elle échoue, les dossiers reviennent du cliché et les extensions installées pour l'occasion sont retirées.
6. **Après** : chaque extension convertit ses données avec le code de sa version ; aucune erreur n'est avalée, toutes sont dans le bilan (« Converti », « Mis de côté », « Non fait »).

Les fixtures de test par époque (0.1, 0.2, 0.6, 0.31, 0.38) sont de vraies sauvegardes écrites par le code de chaque étiquette publiée, avec des données de démonstration : `tests/fixtures/backup-eras/generate.mjs`. Un test (`tests/core/backup-conversion-coverage.test.mjs`) échoue si une conversion du registre de migrations ou une migration qui déplace des données n'a ni fonction de conversion ni refus explicite.

## Bon à savoir

- La sauvegarde contient des **secrets** et les empreintes des mots de passe : gardez le fichier **et** son mot de passe en lieu sûr, séparément.
- Faites-en régulièrement et **essayez** de relire une sauvegarde de temps en temps : c'est la seule façon d'être sûr qu'elle sert.
- Pas de sauvegarde automatique pour l'instant ; la restauration d'une sauvegarde créée par une version **plus récente** du framework est refusée (mettez-le à jour d'abord) ; celle d'une version plus ancienne est convertie (voir ci-dessus).

## Skins (apparence)

Les réglages d'apparence (`theme.*`, `header.layout`) et ceux des skins (`skin.active`, `skin.installed`, `skin.options`) sont des réglages comme les autres : ils sont dans la sauvegarde et restaurés tels quels. Une sauvegarde faite avant les skins n'en contient aucun : le site s'affiche avec le skin de base, à l'identique. Les **fichiers** d'un skin installé ne sont pas dans la sauvegarde : ils sont réinstallés depuis leur dépôt. Tant qu'ils manquent, le skin de base s'applique, rien n'est perdu et `skin.active` est gardé : le skin se réactive dès qu'il est de nouveau installé.

## Private repositories (core 0.42.0)

The access code of a private repository (a skin or a module installed from a private GitHub repository) is a setting named `git.secret.access`. It is kept **sealed** with the site secret (`AUTH_SECRET`, or `data/auth-secret`), so the backup holds only ciphertext, and the readable summary (`site.txt`) shows it masked. The site secret is **not** in the backup: after a restore on another server the ciphertext cannot be opened, the page says "Access code to enter again" next to the repository, and the owner pastes a new code (Appearance or Extensions, "Edit"). Skins and modules of that repository are reinstalled as usual once the code is entered again.
