import { FORMAT_VERSION } from "./format";

/** Le mode d'emploi placé EN TÊTE de chaque sauvegarde : il suffit de le lire pour retrouver ses données, même sans le framework. */
export function readmeText(p: { siteName: string; createdAt: string; frameworkVersion: string }): string {
  return `SAUVEGARDE / BACKUP
====================
Site / Site : ${p.siteName}
Créée le / Created : ${p.createdAt}
Framework : version ${p.frameworkVersion} — format de sauvegarde n°${FORMAT_VERSION}

FRANÇAIS
--------
Cette sauvegarde contient TOUTES vos données (contenus, réglages, utilisateurs, données des modules, images envoyées).
Tout est du texte lisible (JSON, Markdown, CSV), sauf les images. Vous n'avez besoin d'AUCUN logiciel particulier :
si le framework disparaît, vos données restent lisibles.

Ce que vous lisez est l'intérieur du fichier. Le fichier que vous avez reçu (extension .tar.gz.enc) est chiffré avec le
mot de passe choisi lors de la sauvegarde. Pour l'ouvrir, avec OpenSSL (installé sur Linux, macOS, et disponible sur Windows) :

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in sauvegarde.tar.gz.enc -out sauvegarde.tar.gz
    tar xzf sauvegarde.tar.gz

Que trouve-t-on dedans ?
  readable/                 VOS DONNÉES MISES EN FORME pour un humain. Commencez ici.
    site.txt                  résumé : nom du site, langues, modules, nombre d'éléments
    <instance>/*.md           chaque article / lien / code promo, un fichier Markdown par entrée et par langue
    modules/<instance>/...    les données propres à chaque module (JSON, CSV…)
  data/                     les mêmes données, brutes (JSON) : c'est ce que le framework relit pour restaurer
  uploads/                  images et fichiers envoyés
  backup.json               inventaire et empreintes SHA-256 des fichiers (pour vérifier que rien n'est altéré)

ATTENTION : data/users.json contient les empreintes (hachées, pas en clair) des mots de passe des utilisateurs, et
data/settings.json peut contenir des secrets (mot de passe du serveur e-mail, clé RAWG, adresses privées de calendrier…).
Gardez ce fichier et son mot de passe à l'abri. Sans le mot de passe, le contenu est irrécupérable : il n'existe aucun
moyen de le réinitialiser. Les jetons d'API et le journal d'audit ne sont pas sauvegardés.

ENGLISH
-------
This backup holds ALL your data (content, settings, users, module data, uploaded images). Everything is readable text
(JSON, Markdown, CSV) except images; you need no special software, even if the framework is gone.

The file you received (.tar.gz.enc) is encrypted with the password chosen when the backup was made. To open it with OpenSSL:

    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in backup.tar.gz.enc -out backup.tar.gz
    tar xzf backup.tar.gz

Start with the readable/ folder. data/ holds the same data in raw JSON; backup.json lists SHA-256 checksums of every file.
Keep the file and its password safe: without the password the content cannot be recovered. data/users.json holds password
hashes and data/settings.json may hold secrets. API tokens and the audit log are not included.
`;
}
