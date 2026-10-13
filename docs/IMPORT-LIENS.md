# J'ai un Linktree : et maintenant ?

Vous n'avez pas de site, mais une page de liens (un **Linktree**, par exemple) ? Bonne nouvelle : vous n'avez pas à tout retaper.
Votre assistant IA lit votre page, en tire vos liens, votre présentation et votre photo, et prépare **un premier site Curiosa prêt à l'emploi**.
Vous n'avez plus qu'à le vérifier et à le mettre en ligne.

*(Vous venez d'un site sous Grav CMS ? C'est le même principe, voir [IMPORT-GRAV.md](IMPORT-GRAV.md).)*

## Quelles pages de liens ?

| Service | Adresse habituelle |
|---|---|
| **Linktree** | `linktr.ee/votre-nom` |
| **Beacons** | `beacons.ai/votre-nom` |
| **Bio.link** | `bio.link/votre-nom` |
| **Linkin.bio** (Later) | `linkin.bio/votre-nom` |
| **Lnk.Bio** | `lnk.bio/votre-nom` |
| **Taplink** | `taplink.cc/votre-nom` |
| **Solo.to** | `solo.to/votre-nom` |
| **Campsite.bio** | `campsite.bio/votre-nom` |
| **AllMyLinks** | `allmylinks.com/votre-nom` |
| **Carrd** | `votre-nom.carrd.co` |
| **Milkshake** | `msha.ke/votre-nom` |
| **Autre** | n'importe quelle page qui présente une liste de liens : l'assistant sait la lire « au mieux » |

Ces services changent souvent leur présentation. Si l'assistant ne reconnaît plus la forme exacte de votre page, il le dit et utilise sa lecture « de secours » :
vous voyez alors dans le rapport qu'il faut vérifier l'ordre et les titres de vos liens.

## Ce qui est repris

- le **nom** de votre page et sa **présentation** (ce sera le nom et l'accroche de votre site) ;
- votre **photo** (elle devient le logo du site) ;
- vos **liens**, dans le même ordre, avec leurs titres et leurs **rubriques** s'il y en a ;
- vos **réseaux sociaux** (Twitch, YouTube, Instagram, TikTok, X, Facebook, Discord, GitHub, Bluesky, Mastodon, Threads, Kick, Spotify, Reddit, Patreon, Ko-fi, Snapchat, Pinterest, Telegram, Steam, SoundCloud, Bandcamp) :
  chacun devient un bouton en haut de votre site. Si vous avez deux chaînes Twitch, vous avez deux boutons.

Rien d'autre n'est ajouté : pas de blog vide, pas de page d'exemple. Vous partez d'un site simple, à vous de le faire grandir.

Deux détails : votre présentation est bien enregistrée, mais elle ne s'affiche en grand en haut de l'accueil que si vous ajoutez la fonctionnalité « Bandeau d'accueil » (elle reprend toute seule le nom et l'accroche de votre site) ;
et vos rubriques sont gardées comme étiquettes sur chaque lien, sans titre de rubrique visible pour l'instant.

## Ce qui n'est pas repris

C'est normal : ces choses appartiennent au service, pas à vous.

- les **statistiques** de clics et de visites ;
- vos **abonnés** et les **adresses e-mail** que le service a collectées (ils restent chez lui : exportez-les depuis votre compte si vous le pouvez) ;
- les **commandes** et paiements passés par le service ;
- le **thème graphique** (couleurs, polices, fond, animations) : Curiosa a les siens, que vous réglez ensuite ;
- les lecteurs de vidéo ou de musique intégrés (le lien, lui, est repris) ;
- les liens **protégés** (mot de passe, âge) : repris, mais à vérifier.

Après l'import, l'assistant vous donne la liste exacte de ce qui n'a pas été repris, avec la raison (par exemple « 3 liens non repris : … »).

## Comment ça se passe

1. Vous donnez à votre assistant l'**adresse de votre page** de liens (c'est votre page : l'outil n'est pas fait pour lire celles des autres, ni beaucoup de pages d'un coup).
2. Il lit la page. Si le service refuse de se laisser lire par un programme, il vous demandera d'**enregistrer la page** depuis votre navigateur (Ctrl+S) et de lui donner le fichier.
3. Il vous montre **le rapport** : ce qui a été repris, ce qui ne l'a pas été, ce qui est à vérifier. Vous corrigez ensemble ce qui doit l'être.
4. Il installe Curiosa avec vous ([AGENT-INSTALL.md](AGENT-INSTALL.md)) et restaure le fichier produit à l'écran de démarrage, sur « **J'ai déjà une sauvegarde** » ([BACKUP.md](BACKUP.md)).
5. Vous vous connectez avec le compte provisoire, vous **changez le mot de passe**, et vous regardez votre site.

## Pour l'assistant (et les curieux)

Le travail est fait par `scripts/import-links.mjs`, à lancer depuis une copie du code source de Curiosa (`git clone`, puis `npm ci`), **à la même version que celle que l'on va installer** :

```bash
node scripts/import-links.mjs https://linktr.ee/votre-nom --out ./scratch/mon-site.tar.gz.enc --owner-email vous@exemple.org --owner-name "Votre nom"
```

Il écrit la sauvegarde chiffrée, un rapport lisible (`.rapport.txt`) et un rapport pour machine (`.rapport.json`), plus la **fiche** (`.fiche.json`) : le contenu extrait, que l'on peut corriger à la main puis redonner au script
à la place de l'adresse. `--json` produit la même chose sur la sortie standard ; `--extract-only` s'arrête à la fiche, sans rien installer. Le détail des options est en tête du script ; la marche à suivre pour un assistant
est dans le skill `.claude/skills/migrate-from-link-aggregator/` (Claude Code).

Le script ne lit que des adresses `http(s)` **publiques** (jamais le réseau local), sans cookie ni identifiant, avec une taille et une durée limitées. Ce qu'il lit est traité comme du texte, jamais exécuté.
Les modules (la liste de liens, un module par réseau) sont installés depuis le catalogue pendant la préparation : il faut donc un accès au catalogue (ou `CURIOSA_CATALOGUE_REPO`).
