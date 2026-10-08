# Mesures : ce qui est vérifié, et comment le refaire

Ces chiffres ont été **mesurés**, pas estimés, sur la release publiée `v0.1.3-rc.2`, le 8 octobre 2026, dans un conteneur Linux (4 cœurs, 16 Go de mémoire, Node 22). Chaque chiffre dit comment il a été obtenu. **Ce qui n'a pas été mesuré est listé en bas** : ne tirez pas de ce document plus que ce qu'il dit.

## Installation, depuis l'archive publiée

On télécharge l'archive de la release, on vérifie son empreinte, on l'extrait, on crée la base et on démarre.

| Étape | Durée mesurée |
|---|---|
| Téléchargement (254 Mo) | 5,6 s (dépend de votre connexion) |
| Vérification de l'empreinte `sha256` | 0,7 s |
| Extraction | 11,8 s |
| Création de la base de données (migrations) | 3,1 s |
| Démarrage jusqu'à la première page servie | 2,1 s |
| **Travail de la machine, au total** | **≈ 23 s** |

Le reste de l'installation (créer l'utilisateur système, le service, le HTTPS) est du travail humain, **non chronométré** : le guide du README l'estime à une quinzaine de minutes, ce chiffre est une estimation, pas une mesure.

## Place occupée sur le disque

| | Taille |
|---|---|
| Installé, sans l'archive | **868 Mo** |
| dont `node_modules` (dépendances et moteurs de base de données) | 816 Mo |
| dont le site compilé (`.next`) | 52 Mo |
| Base de données d'un site neuf | 188 Ko |

**C'est lourd** pour ce que fait le logiciel : les dépendances (dont les deux moteurs Prisma, pour être compatible avec plusieurs systèmes) pèsent beaucoup plus que le code. Si l'espace disque est votre contrainte, c'est un vrai point faible.

## Ce que la page envoie au visiteur (site neuf créé par l'assistant, page d'accueil)

Mesuré avec `scripts/measure.mjs` (voir plus bas), puis recoupé dans un vrai navigateur.

| Type | Requêtes | Poids | ≈ gzip |
|---|---|---|---|
| HTML | 1 | 17 Ko | 4 Ko |
| JavaScript | 9 | 575 Ko | 177 Ko |
| CSS | 1 | 43 Ko | 8 Ko |
| Images (icône du site) | 1 | < 1 Ko | < 1 Ko |
| **Code envoyé (HTML + JavaScript + CSS)** | **11** | **636 Ko** | **≈ 189 Ko** |

- **Services tiers contactés : aucun.** Le navigateur ne parle qu'au site lui-même (12 requêtes au total, toutes vers le même serveur).
- **Cookies déposés à la première visite : aucun.**
- Temps d'affichage **en local, sans réseau** : premier affichage à 136 ms, chargement complet à 187 ms. Ce chiffre ne dit **rien** de ce que verra un visiteur réel sur un vrai réseau.

**Le JavaScript est un point faible** : une page d'accueil sans interaction envoie ≈ 177 Ko de JavaScript compressé, parce que le site est une application Next.js/React. Un site statique (Hugo, Astro…) en envoie presque zéro.

## Mémoire du serveur

**223 Mo** (mémoire résidente du processus `next-server`) après avoir servi quelques pages d'un site neuf. Ce chiffre est un ordre de grandeur pour un trafic nul : il n'est pas mesuré sous charge.

## Qualité du code

- **850 tests automatiques** (`npm test`), exécutés à chaque publication ; une release n'existe que si les tests, la vérification des types, le build et l'audit des dépendances passent.
- **200 paquets de production**, vérifiés à chaque publication contre les failles connues (`npm run audit`) ; leurs licences sont listées dans `THIRD-PARTY-NOTICES.md`.

## Ce qui n'est PAS mesuré

- **La tenue en charge** : combien de visiteurs simultanés avant que le serveur ne ralentisse.
- **Un score Lighthouse ou des mesures sur un réseau réel** (mobile, lent, lointain).
- **Toute comparaison avec un autre outil** (WordPress, Ghost, Hugo, Wix…) : aucun chiffre de concurrent n'est cité ici parce qu'aucun n'a été mesuré dans les mêmes conditions.
- **La durée humaine de l'installation complète**, et la facilité réelle pour quelqu'un qui ne connaît pas le projet : c'est justement ce qu'il faut faire tester à des personnes extérieures.
- **Le comportement après des mois d'usage** : un seul site de production à ce jour.

## Refaire ces mesures

```bash
node scripts/measure.mjs https://votre-site.example/            # requêtes, poids, services tiers, cookies
node scripts/measure.mjs http://localhost:3000/ --pid 1234      # + mémoire (Linux) du serveur dont le numéro de processus est 1234
node scripts/measure.mjs https://votre-site.example/ --json     # même chose, lisible par un programme
```

Le script charge la page comme un premier visiteur (sans cookie), télécharge chaque fichier qu'elle référence et additionne. Limite : il ne voit pas les fichiers demandés par le JavaScript *après* le chargement (la page de ce projet n'en demande que vers son propre serveur, ce que le recoupement dans un navigateur a confirmé). Pour l'installation, rejouez les étapes du README en chronométrant chacune.
