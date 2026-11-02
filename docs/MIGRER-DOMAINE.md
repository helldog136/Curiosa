# Changer de nom de domaine

Cette page décrit comment faire passer votre site de `ancien.be` à `nouveau.be` sans rien perdre d'important. **English summary at the end.**

C'est un réglage **avancé** : dans l'administration, activez d'abord les réglages avancés (bouton en bas du menu, ou page *Mode*), puis ouvrez **Réglages du site → Adresse du site** (`/admin/settings/address`, rôle administration). En mode simple, la page n'existe pas. Elle prépare **la liste de ce qui dépend de l'ancienne adresse** et **les commandes à copier** ; elle ne modifie rien elle-même : le site ne peut pas changer son fichier `.env`, la configuration du serveur web ni le DNS.

## Ce que le changement fait, en bref

| Chose | Après le changement |
|---|---|
| Le site, les pages, les liens partagés, les QR codes déjà imprimés | **Continuent de marcher** si l'ancien domaine reste redirigé (`LEGACY_HOSTS`, ci-dessous). |
| Le référencement | Transmis par la redirection permanente (301). Déclarez aussi la nouvelle adresse dans les outils des moteurs de recherche. |
| Les clés d'accès (passkeys) | **Perdues** : une clé est liée au domaine. Le mot de passe continue de marcher ; chaque personne recrée ses clés dans *Mon compte*. |
| Les connexions (sessions) | **Perdues** : tout le monde se reconnecte une fois. |
| Les adresses de retour chez Twitch, YouTube, Discord… | **À remplacer à la main** chez le service tiers (la page donne l'ancienne et la nouvelle adresse, à copier). |
| Les assistants IA connectés par adresse secrète | Le début de l'adresse change, la fin secrète non. À corriger dans chaque assistant. |
| Les sources navigateur d'OBS (pages d'overlay) | L'ancienne adresse redirige, mais mettez-les à jour. |
| Home Assistant et autres applications hors du site | L'adresse du site y est à changer à la main (si l'extension le déclare, la page le rappelle). |
| Les contenus qui écrivent l'ancien domaine | Listés (lecture seule) avec un lien vers chacun ; à corriger à la main. |
| Les données, les comptes, les mots de passe, les sauvegardes | Inchangés. |

## Avant

1. Choisissez le nouveau domaine, achetez-le et gardez l'ancien actif.
2. Faites une **sauvegarde** (*Sauvegarde*).
3. Dans *Adresse du site* : saisissez la nouvelle adresse (étape 1), lisez la liste de contrôle (étape 2). Elle compte vos clés d'accès, liens courts, accès d'assistants, adresses d'overlay et liste les adresses de retour de vos extensions. Aucun secret n'y est affiché.
4. Prévenez votre équipe : tout le monde se reconnectera.

## Pendant

Suivez l'étape 3 de la page, dans l'ordre. Vous pouvez aussi tout faire à la main :

1. **DNS** : faites pointer le nouveau domaine vers le serveur, comme l'ancien.
2. **`.env`** : `SITE_URL="https://nouveau.be"` et `LEGACY_HOSTS="ancien.be"` (voir plus bas).
3. **Redémarrez le site** (systemd, pm2, Docker… la page propose la bonne commande quand elle la reconnaît).
4. **Serveur web** : faites répondre nginx, Caddy ou Apache aux deux noms. Un seul bloc suffit : le site redirige lui-même l'ancien nom vers le nouveau.
5. **Certificat https** : nginx et Apache : `certbot` pour les deux noms ; Caddy le fait seul.

### Avec `install.sh`

Si le site a été installé par `scripts/install.sh` :

```
sudo bash install.sh --site monsite --change-domain nouveau.be            # plan, rien n'est modifié
sudo bash install.sh --site monsite --change-domain nouveau.be --apply    # le fait
```

Il sauvegarde le `.env` et les configurations (`….avant-DATE`), change `SITE_URL`, ajoute l'ancien domaine à `LEGACY_HOSTS`, met à jour **uniquement** les configurations portant la marque `# Géré par install-curiosa` (nginx, Apache, Caddy ; `nginx -t` avant rechargement, retour arrière au moindre refus), redémarre le service, demande votre accord pour lancer `certbot`, puis vérifie la réponse. Une configuration qui n'est pas la sienne n'est jamais modifiée : il dit quoi y changer. Codes de sortie : `0` terminé (ou plan affiché), `1` arrêté sur une erreur, `2` option incorrecte, `10` domaine changé mais une étape reste à la main (certificat, configuration étrangère, DNS) ou le site ne répond pas encore.

## L'ancien domaine : `LEGACY_HOSTS`

`LEGACY_HOSTS` est une liste de noms de domaine (séparés par des virgules ou des espaces, **10 au plus**) dans le `.env`. Quand une requête **GET ou HEAD** arrive avec un `Host` de cette liste, le site répond **301** vers `SITE_URL`, en gardant le chemin et les paramètres. Garanties :

- la cible est **toujours** `SITE_URL` : aucune redirection ouverte, quoi que contienne l'adresse demandée ;
- seul l'en-tête `Host` posé par votre serveur web compte (pas `X-Forwarded-Host`, ni `Origin`, ni `Referer`) : votre serveur web doit donc transmettre `Host` (c'est le cas des modèles de [INSTALL.md](INSTALL.md)) ;
- jamais pour `/api/*` (jetons, connexions), jamais pour les retours de connexion d'un service tiers (`…/oauth/…`, `…/callback`), jamais pour une autre méthode que GET et HEAD ;
- un nom invalide, ou le domaine du site lui-même, est ignoré (pas de boucle) ; la page *Adresse du site* le signale ;
- réponse `Cache-Control: private` et `Vary: Host` (un cache partagé ne la garde pas).

Gardez l'ancien domaine **le plus longtemps possible** (au moins un an) : il porte les QR codes imprimés et les liens déjà partagés.

## Après

Page **Après le changement** (`/admin/settings/address/after`, aussi en réglages avancés), à la demande, en lecture seule : l'adresse visitée est-elle `SITE_URL` ? `/api/health` répond-il à l'adresse publique ? le certificat est-il accepté ? `http` renvoie-t-il vers `https` ? chaque ancien domaine redirige-t-il bien ? Les appels sortants sont bornés (5 secondes, un seul essai, dix anciens domaines au plus), n'atteignent que `SITE_URL` et `LEGACY_HOSTS`, refusent toute adresse privée ou locale, et ne suivent aucune redirection. La page rappelle ensuite ce qui reste à refaire, avec des cases à cocher **mémorisées**.

## Ce qui est préservé, ce qui est perdu

Préservé : contenus, comptes, mots de passe, doubles vérifications, sauvegardes, liens courts (leur nom ne change jamais), statistiques. Perdu : clés d'accès, sessions. À refaire à la main : adresses de retour des services tiers, accès d'assistants par adresse, OBS, applications hors du site.

## Pour une extension : déclarer ses adresses

Une extension déclare dans son `module.json` ses adresses de retour (`returnAddresses`) et les endroits hors du site où l'adresse est tapée (`siteAddressUses`) ; voir [MODULES.md](MODULES.md), « Adresses données à un service tiers ». Sans déclaration, elle n'apparaît pas dans la liste.

## English summary

Changing domain is an **advanced** setting: turn on advanced settings, then open *Site settings → Site address*. The page lists what depends on the old address (passkeys to recreate, short links and QR codes, return addresses to re-register at third parties, secret AI-assistant and overlay addresses, content that still mentions the old domain) and gives commands to copy: edit `.env` (`SITE_URL`, `LEGACY_HOSTS`), restart, web server block for both names, certificate. It changes nothing itself. Setting `LEGACY_HOSTS` (up to 10 domains) makes the site answer GET/HEAD requests for those hosts with a 301 to `SITE_URL`, keeping path and query, never for `/api/*` or OAuth callbacks, never open-ended. If the site was installed with `install.sh`, `--change-domain NEW` prints a plan and `--apply` does it (only for files marked "Géré par install-curiosa"). Passkeys and sessions are lost; content, accounts and short links are kept. The *After the change* page runs read-only checks on demand.
