---
name: install-curiosa
description: Installe Curiosa (framework de site personnel) sur un serveur Linux à partir d'une release compilée, en vérifiant l'environnement, en configurant systemd et le proxy HTTPS. À utiliser quand quelqu'un veut installer, déployer ou mettre en route Curiosa, ou migrer un site Grav vers Curiosa.
---

# Installer Curiosa

Suis le runbook complet : `docs/AGENT-INSTALL.md` (lis-le en entier avant d'agir), puis les commandes du README (`README.md`, section « Installer »).

## Déroulé

1. **Constater l'environnement** (étape 0 du runbook) : architecture `x86_64`, Node ≥ 20.9, systemd, ports occupés, serveur web déjà présent, dossiers existants. Adapte le plan à ce que tu mesures ; ne devine rien.
2. **Poser les questions d'un seul coup** : nom de domaine, dossier et utilisateur système, serveur web, site vide ou sauvegarde/ancien site.
3. **Installer** : utilisateur dédié → téléchargement de la dernière release stable + vérification SHA-256 → `.env` + `npx prisma migrate deploy` → unité systemd → proxy HTTPS. Donne des commandes complètes à copier-coller, avec l'utilisateur qui doit les lancer.
4. **Vérifier** : service actif, `HTTP 200` sur `/admin/setup` en local puis via le domaine.
5. **Passer la main** : la personne ouvre `/admin/setup`, saisit le code d'installation et configure son site.

## Règles à ne pas enfreindre

- Ne jamais demander ni afficher un secret (`SETUP_TOKEN`, `.env`, mots de passe, jetons) ; le code d'installation se lit sur le serveur, par la personne.
- Ne pas écraser un dossier non vide, ni remplacer la configuration d'un serveur web qui sert d'autres sites : ajouter, sauvegarder avant, tester (`nginx -t`) avant de recharger.
- Port occupé : en prendre un autre, ne pas toucher au processus qui l'occupe.
- Si aucune release stable n'est publiée ou si l'architecture n'est pas `x86_64`, le dire et s'arrêter plutôt que d'improviser une compilation.
- Venant d'un site Grav : voir `docs/IMPORT-GRAV.md` pour le convertir en sauvegarde, restaurée ensuite via « J'ai déjà une sauvegarde ».
