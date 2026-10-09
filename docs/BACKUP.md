# Sauvegarde et restauration

Une sauvegarde est **un seul fichier**, en un clic depuis l'admin (*Sauvegarde*, propriétaire uniquement). Elle contient toutes vos
données — pas le code du framework :

| Inclus | Pas inclus |
|---|---|
| utilisateurs (mots de passe **hachés**), réglages (secrets compris : mot de passe e-mail, adresses privées…) | jetons d'API (à recréer) |
| instances de modules, entrées (toutes langues, brouillons compris), redirections | journal d'audit |
| données de **chaque module installé** (leur stockage, leurs réglages) | le code du framework et des modules (réinstallé depuis le catalogue) |
| images et fichiers envoyés | |
| la liste des modules installés (identifiant, version, dépôt, activé ou non) | |

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
backup.json         inventaire : version, date, modules, empreinte SHA-256 de chaque fichier
readable/           VOS DONNÉES MISES EN FORME POUR UN HUMAIN — commencez ici
  site.txt            résumé : nom du site, langues, modules, compteurs, réglages (secrets masqués)
  <instance>/*.md     une entrée par fichier Markdown et par langue, avec un en-tête (titre, statut, dates, étiquettes, lien, code…)
  modules/<instance>/ les données de chaque module (JSON ; CSV et autres fichiers que le module fournit)
data/               les mêmes données, brutes, en JSON : c'est ce que la restauration relit
uploads/            images et fichiers envoyés
```

Tout est du **texte** (JSON, Markdown, CSV), sauf les images. Pour vérifier l'intégrité :
`sha256sum uploads/* data/*.json …` et comparer avec `backup.json`.

### Format technique (pour qui veut écrire son propre lecteur)

1. Fichier = `Salted__` (8 octets) + sel (8 octets) + chiffré AES-256-CBC (bourrage PKCS#7).
2. Clé (32 octets) et vecteur (16 octets) = `PBKDF2-HMAC-SHA256(mot de passe UTF-8, sel, 600000 itérations)` → 48 octets, découpés dans cet ordre
   (c'est exactement ce que fait `openssl enc -pbkdf2`).
3. Contenu déchiffré = archive `tar.gz` (ustar), chemins relatifs UTF-8, sans `..`.
4. `backup.json` : `{ format: "curiosa-backup", formatVersion: 1, createdAt, frameworkVersion, site, counts, modules[], files[{path, sha256, bytes}] }`.

## Restaurer

*Sauvegarde › Restaurer une sauvegarde* (encadré rouge : la restauration **remplace** les données actuelles) : choisissez le fichier, saisissez le mot de passe, puis **vérifiez l'aperçu** avant de confirmer.

- Le fichier est **vérifié avant tout** : mot de passe, format, version, empreinte de chaque fichier (une sauvegarde modifiée ou incomplète
  est refusée), présence d'un propriétaire (une restauration ne doit jamais vous enfermer dehors).
- Les **modules sont réinstallés depuis le catalogue** (modules livrés avec le framework, dépôts reconnus). Un module **personnel**
  (dépôt non vérifié) n'est réinstallé que si vous le **confirmez, module par module** ; sinon ses données sont gardées mais le module reste à réinstaller.
- La restauration **remplace** les données actuelles, en une seule transaction : tout ou rien. Une copie de la base actuelle est gardée dans
  `data/backups/pre-restore-*.db` (les 5 dernières).
- Les identifiants sont conservés : les sessions, les liens entre entrées, redirections et données de modules restent valides.
- Les modules installés ici mais absents de la sauvegarde restent installés (sans leurs instances).

**Sur un serveur neuf** : installez le framework ([INSTALL.md](INSTALL.md)) et ouvrez le site. Le **premier écran de l'assistant propose
« J'ai déjà une sauvegarde : la restaurer »** : même procédure (fichier, mot de passe, aperçu, confirmation des modules personnels), sans créer
de compte provisoire. Si `SETUP_TOKEN` est défini, le même jeton est demandé. Ce chemin n'existe que **tant qu'aucun compte n'existe** :
un site en service ne peut se restaurer que depuis l'admin, par son propriétaire. Reconnectez-vous ensuite avec un compte de la sauvegarde.

## Bon à savoir

- La sauvegarde contient des **secrets** et les empreintes des mots de passe : gardez le fichier **et** son mot de passe en lieu sûr, séparément.
- Faites-en régulièrement et **essayez** de relire une sauvegarde de temps en temps : c'est la seule façon d'être sûr qu'elle sert.
- Pas de sauvegarde automatique pour l'instant ; la restauration d'une sauvegarde créée par une version **plus récente** du framework est refusée (mettez-le à jour d'abord).
