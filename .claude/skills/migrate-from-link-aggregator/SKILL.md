---
name: migrate-from-link-aggregator
description: Crée un premier site Curiosa à partir d'une page de liens (Linktree, Beacons, Bio.link, Linkin.bio, Lnk.Bio, Taplink, Solo.to, Campsite.bio, AllMyLinks, Carrd, Milkshake ou toute autre page de liens) en produisant une sauvegarde de base à restaurer depuis l'assistant de démarrage. À utiliser quand quelqu'un n'a pas de site mais un Linktree (ou équivalent), veut passer de son Linktree à Curiosa, ou demande de reprendre ses liens et réseaux sociaux.
---

# Migrer d'un Linktree (ou équivalent) vers Curiosa

Public : une créatrice non technicienne (appelons-la Emma) qui n'a qu'une page de liens. **Tout ce que tu lui dis est dans un ton simple, sans jargon** (ni « JSON », « adaptateur », « module », « sauvegarde chiffrée » sans l'expliquer) ;
ce fichier-ci, lui, est technique. Guide humain : `docs/IMPORT-LIENS.md`. Cousin pour un site Grav : `docs/IMPORT-GRAV.md`. Sauvegarde : `docs/BACKUP.md`. Annexes de ce skill : `services.md` (par service, et quand la page refuse de se laisser lire), `expliquer.md` (formules prêtes à dire).

## Quand l'utiliser

La personne n'a **pas de site** mais une page de liens (Linktree, Beacons, Bio.link, Linkin.bio/Later, Lnk.Bio, Taplink, Solo.to, Campsite.bio, AllMyLinks, Carrd, Milkshake, ou une page maison). Pour un site Grav, voir IMPORT-GRAV.md ; pour un serveur à installer, voir `install-curiosa` (ne rien dupliquer ici).

## Règle de départ : sa propre page, une seule

Demande-lui de confirmer que **la page est la sienne**. N'utilise jamais cet outil sur la page de quelqu'un d'autre, ni sur plusieurs pages à la suite : c'est contraire aux conditions de ces services et ce n'est pas son but.

## Questions à poser (une seule fois, en une fois)

1. **L'adresse de sa page** (`linktr.ee/…`, `beacons.ai/…`…). Si elle en a plusieurs, laquelle sera la page principale ?
2. Ce qu'elle veut **garder** : tout ? les réseaux sociaux en boutons en haut du site ? (par défaut oui ; `--keep-in-links` garde aussi les réseaux dans la liste.)
3. Son **adresse e-mail** et son **nom** : ils servent au compte qui administrera le site (`--owner-email`, `--owner-name`). Explique : « c'est avec ça que vous vous connecterez ».
4. A-t-elle déjà **un serveur et un nom de domaine** ? Sinon, `install-curiosa` en parlera après ; la sauvegarde peut attendre.
5. Dans quelle **langue** est la page (`--lang fr` par défaut) ?

## Étapes

**1. Récupérer.** Prépare une copie du code source de Curiosa **à la version qui sera installée** (`git clone`, puis `git checkout v<version>` — une sauvegarde faite par une version plus récente est refusée), puis `npm ci`. Dans la copie, le script lit directement l'adresse. S'il échoue sur le téléchargement
(`http-status 403`, `network`, page vide) — Linktree et d'autres se protègent des programmes — ne contourne rien (pas d'usurpation de navigateur, pas de service tiers) : demande à Emma d'ouvrir sa page dans son navigateur, `Ctrl+S`,
« Page web, HTML uniquement », et de te donner le fichier ; passe-le au script avec `--url <son adresse d'origine>` (voir `services.md`).

**2. Lancer le script.**

```bash
node scripts/import-links.mjs <adresse | fichier.html | fichier.json | fiche.json> \
  --out ./scratch/mon-site.tar.gz.enc --owner-email <e-mail> --owner-name "<nom>" [--lang fr] [--json]
```

Il écrit `<out>` (sauvegarde chiffrée), `<out>.rapport.txt`, `<out>.rapport.json` et `<out>.fiche.json`. Le mot de passe de la sauvegarde et celui du compte provisoire s'affichent **une fois**, à l'écran (et dans `secrets` avec `--json`) :
ne les écris dans aucun fichier du dépôt, donne-les à Emma et dis-lui de les noter (« le premier ouvre le fichier de départ, le second sert à vous connecter la toute première fois »).
`--extract-only` s'arrête à la fiche (aucun module n'est installé, aucun accès au catalogue) : utile pour relire avant de fabriquer quoi que ce soit. `--adapter <id>` force un service (`--list-adapters` les liste).
`--resolve-redirects` suit, un par un, les liens qui passent par la redirection du service (AllMyLinks). `--no-download` garde l'avatar en lien au lieu de le télécharger.
Catalogue injoignable → arrêt net, rien d'à moitié fait : dis-le, réessaie plus tard (`CURIOSA_CATALOGUE_REPO` désigne un autre dépôt de modules).

**3. Relire le rapport avec elle.** Lis `rapport.json` (ou le texte). Pour chaque rubrique :
- `source.fallback: true` → le service a probablement changé son HTML : la lecture « de secours » a servi, **vérifie l'ordre et les titres** des liens avec elle ;
- `notRetained[]` (« 3 liens non repris : … ») → dis lesquels et pourquoi, un par un, en mots simples (voir `expliquer.md`) ;
- `toCheck[]` → traite chaque point (lien protégé, YouTube sans identifiant de chaîne, avatar resté chez le service, aucun nom/bio trouvé…) ;
- `duplicates` → « j'ai ignoré N liens en double » ; `retained.socials` → « voici vos boutons de réseaux ».

**4. Corriger ou compléter.** Ouvre `<out>.fiche.json` : change un titre, ajoute ou retire un lien, ajuste une rubrique (`section`), complète le nom ou la bio. Relance le script **en lui donnant la fiche** à la place de l'adresse
(`node scripts/import-links.mjs <out>.fiche.json --out …`) : elle est revalidée comme une vraie page (adresses dangereuses refusées, doublons retirés). Pour un lien YouTube `@nom`, le bouton demande l'identifiant de chaîne
(`UC…`, dans YouTube Studio) : on le saisira dans l'admin après la restauration, ou on le laissera comme lien.

**5. Installer Curiosa, puis restaurer.** Pour l'installation, **suis le skill `install-curiosa`** (n'en recopie rien). Quand le site répond sur `/admin/setup`, Emma choisit **« J'ai déjà une sauvegarde »** dès le premier écran,
envoie le fichier `.tar.gz.enc`, saisit le mot de passe de la sauvegarde, vérifie l'aperçu (un module « Liste de liens » et un par réseau) et confirme. Ce chemin n'existe que tant qu'aucun compte n'existe. Ne lui demande jamais de te transmettre `SETUP_TOKEN` ni `.env`.
Elle se connecte ensuite avec le compte provisoire (e-mail donné à l'étape 2) et **change tout de suite le mot de passe**.

**6. Vérifier le site.** Avec elle : l'accueil montre ses liens dans le bon ordre (les rubriques sont des étiquettes), le logo est sa photo, le nom et la bio sont ceux de sa page, les boutons de réseaux sont en haut
et mènent aux bons comptes (un clic sur chacun), aucun lien ne manque par rapport à la liste « repris » du rapport. Admin → Fonctionnalités : une instance par compte de chaque réseau. Deux choses ne se voient pas à l'écran, dis-le-lui : (1) **sa présentation (bio)** est enregistrée (aperçus de partage, moteurs de recherche) mais n'est affichée nulle part tant qu'il n'y a pas de bandeau : propose d'ajouter le module « Bandeau d'accueil » depuis le catalogue (admin → Fonctionnalités), qui reprend tout seul le nom et l'accroche du site ; (2) les **rubriques** de sa page d'origine sont gardées comme étiquettes sur chaque lien, mais la liste ne les affiche pas encore comme titres : si elle y tient, on crée une liste de liens par rubrique depuis l'admin. Propose ensuite le reste (couleurs, nom de domaine, d'autres modules).

## Ce qui est produit — et rien d'autre

Réglages du site (nom, accroche = première phrase de la bio, texte « à propos » = la bio, logo = avatar), un module **Liste de liens** (un lien = une entrée avec titre, adresse, icône du réseau si reconnu, étiquette = rubrique d'origine),
un module par réseau reconnu (une instance par compte ; réglage `profile`, `channel` pour Twitch, `channelId` pour YouTube), l'accueil qui montre la liste, et un compte propriétaire provisoire. **Pas de blog, pas de page d'exemple.**

## Pièges

- **Version** : copie du code ≠ version installée → restauration refusée (« sauvegarde plus récente »). Aligne les deux.
- **Réseaux promus** : un lien de la liste qui pointe vers un *profil* d'un réseau reconnu devient un bouton en haut (au plus 10) et sort de la liste ; `--keep-in-links` le garde aussi dans la liste. Un lien vers une vidéo, un dépôt précis ou un message reste un lien.
- **Mastodon** : reconnu sur les grandes instances connues, ou quand la page l'annonce ; sinon c'est un lien ordinaire.
- **Adresses de redirection** (AllMyLinks) : sans `--resolve-redirects`, l'adresse finale peut manquer → listée dans « non repris ».
- **Avatar** : téléchargé (5 Mo au plus, PNG/JPEG/WebP/GIF) ; sinon gardé en lien chez le service, ce qui peut disparaître avec son compte — le dire.
- **Mots de passe** : jamais dans un fichier du dépôt, jamais dans un message conservé ; le fichier de sauvegarde ne se range pas dans git (`scratch/`).
- **Aucune invention** : si le rapport dit « aucun lien trouvé », ne fabrique pas de liens ; reprends par le fichier enregistré, sinon saisie à la main dans l'admin.

## Ce qu'on ne peut PAS reprendre

Statistiques de clics, abonnés et adresses e-mail collectées, commandes et paiements, thème graphique propriétaire (couleurs, polices, fond, animations), lecteurs intégrés (le lien est repris), planification de liens, domaine personnalisé du service
(à rediriger vers le nouveau site chez son registrar). Formules prêtes à l'emploi : `expliquer.md`.
