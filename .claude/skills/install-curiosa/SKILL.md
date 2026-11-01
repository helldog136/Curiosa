---
name: install-curiosa
description: Aide quelqu'un à mettre Curiosa (framework de site personnel) en ligne, du choix du serveur et du domaine jusqu'à /admin/setup, en pilotant le script scripts/install.sh. À utiliser quand quelqu'un veut installer, déployer ou mettre en route Curiosa, choisir un serveur ou régler son nom de domaine pour Curiosa, ou migrer un site Grav vers Curiosa.
---

# Installer Curiosa

Le chemin est : **trois questions, une commande, un navigateur**. Lis d'abord `docs/AGENT-INSTALL.md` en entier (arbre de décision, choix du serveur, DNS, erreurs fréquentes), puis pilote `scripts/install.sh` au lieu de reconstruire les commandes à la main. Parle simplement : la personne n'a pas de bagage technique, un mot technique = une phrase d'explication, une erreur = ce qui s'est passé + une seule chose à faire. Ne fais jamais peur.

## Déroulé

1. **Où en est la personne ?** A-t-elle un serveur Linux ? un nom de domaine ? Sinon, aide-la (étape suivante). Si elle a un serveur : `uname -m` doit répondre `x86_64`.
2. **Aider à choisir le serveur et le DNS** (avant tout le reste, sans rien imposer) : profil Ubuntu LTS ou Debian, **x86_64 / amd64** (jamais ARM : la release n'existe pas), 1 vCPU, 1 à 2 Go de RAM, environ 20 Go de disque ; comment reconnaître x86_64 et ARM sur la page d'un hébergeur ; se connecter en SSH depuis PowerShell ou Terminal ; créer l'enregistrement DNS **A** (et **AAAA** seulement si l'hébergeur donne une IPv6) chez le registraire et vérifier la propagation (`getent hosts <domaine>`) ; ports 80 et 443 ouverts chez l'hébergeur. Les fournisseurs se citent à titre indicatif, **sans prix** (« vérifiez les offres actuelles ») et sans en imposer un.
3. **Poser les trois questions d'un coup** : le **nom du site** (court, minuscules), le **nom de domaine** (ou `--no-domain` pour un simple essai), l'**utilisateur Linux dédié** (propose `<site>-web`, ne le choisis pas à sa place). **Explique l'utilisateur dédié avant de poser la question** : le site est un programme exposé sur Internet ; si une faille est un jour exploitée, une personne malveillante agit avec les droits de l'utilisateur qui le fait tourner. Avec `root` ou un compte administrateur, elle récupère tout le serveur ; avec un utilisateur dédié sans droits d'administration, les dégâts restent cantonnés à ce seul site (la clé d'une pièce plutôt que celle de toute la maison). Cela facilite aussi le nettoyage et les mises à jour depuis l'admin. Le script refuse `root`.
4. **Télécharger puis relire, jamais `curl | bash`** :
   ```bash
   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
   less install.sh      # ou affiche-le / résume-le à la personne
   ```
5. **Essai à blanc d'abord** : `sudo bash install.sh --site <site> --domain <domaine> --user <utilisateur> --dry-run`. Il ne modifie rien ; il dit ce qu'il a trouvé (processeur, système, Node, serveur web existant, port choisi, DNS, release) et ce qu'il ferait. Lis-le avec la personne, explique chaque confirmation qu'il demandera (installer Node.js, installer Caddy, ouvrir les ports 80/443 dans ufw).
6. **Installation réelle** : même commande sans `--dry-run`, avec `--yes` **seulement après l'accord de la personne** sur ces confirmations. Le script est reprenable : s'il s'arrête, lis le message (un remède par erreur), corrige, puis relance **la même commande**.
7. **Passer la main** : le script affiche l'adresse `/admin/setup` et la **commande pour lire le code d'installation sur le serveur**. La personne ouvre l'adresse et tape cette commande **elle-même**. Propose ensuite une sauvegarde depuis l'admin et rappelle de retirer `SETUP_TOKEN` du `.env` une fois le site configuré.

Code de sortie `10` : installé, mais l'adresse publique ne répond pas encore (DNS, ports 80/443 chez l'hébergeur, certificat en cours) : suis la liste « À régler » de la page finale.

## Règles à ne pas enfreindre

- Ne jamais demander, lire ni afficher un secret (`SETUP_TOKEN`, `.env`, mots de passe, clés SSH) ; le script ne l'affiche pas, la personne le lit sur le serveur.
- Ne jamais contourner un refus du script : dossier non vide (ne pas l'écraser), utilisateur ou service existants, serveur web qui sert d'autres sites (le script AJOUTE un site, sauvegarde et teste avant de recharger).
- Port occupé : le script en prend un autre sans toucher au processus qui l'occupe ; ne le tue pas.
- Processeur ARM, système non pris en charge ou aucune release stable publiée : le dire et s'arrêter (rien n'a été modifié), proposer un serveur x86_64. Ne jamais compiler sur le serveur, ne jamais inventer une release ARM.
- Pas de `curl | bash`. Pas de prix inventé, pas d'offre commerciale imposée.
- Docker n'est pas le chemin pour mettre un site en ligne (image construite sur place, pas de HTTPS) : seulement pour l'essayer chez soi.
- Pour défaire : `sudo bash install.sh --uninstall --site <site>` (garde dossier et données) ; `--purge` ne s'exécute que dans un terminal, avec sauvegarde et confirmation tapée par la personne.
- Venant d'un site Grav : voir `docs/IMPORT-GRAV.md` (conversion en sauvegarde, restaurée ensuite via « J'ai déjà une sauvegarde »).
- Installation sur un système sans systemd ou hors Ubuntu/Debian : voir « Installation manuelle (avancé) » dans `docs/AGENT-INSTALL.md`.
