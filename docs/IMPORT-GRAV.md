# Importer un site Grav CMS

Grav stocke tout en fichiers : on rapatrie le dossier `user/` tel quel, et l'outil le convertit en **sauvegarde du framework**, que l'on restaure ensuite
comme n'importe quelle sauvegarde (assistant d'installation → « J'ai déjà une sauvegarde », voir [BACKUP.md](BACKUP.md)). Rien n'est écrit sur un site en service.

## 1. Rapatrier les fichiers

```bash
# depuis votre poste ; adaptez l'utilisateur, le serveur et le chemin de Grav
rsync -av --exclude 'cache' --exclude 'logs' --exclude 'themes' --exclude 'plugins' \
  utilisateur@serveur:/chemin/vers/grav/user/ ./grav-user/
```

Il faut au minimum `pages/`, `config/` et `accounts/`. Gardez ce dossier **hors de git** (il contient des empreintes de mots de passe) : par exemple dans `scratch/`.

## 2. Convertir

```bash
npm ci
npm run import:grav -- ./scratch/grav-user --out ./scratch/mon-site.tar.gz.enc
```

Options : `--password <mot de passe de la sauvegarde>` (sinon généré et affiché), `--blog route1,route2` (routes Grav à traiter comme des blogs ; par défaut les pages de modèle `blog`),
`--owner-email` / `--owner-name` (si aucun compte Grav n'existe), `--no-accounts`.

## Ce qui est converti

| Grav | Framework |
|---|---|
| `config/site.yaml` (titre, description) | nom et accroche du site |
| `config/system.yaml` (`languages.supported`) | langues (la première est la langue par défaut) |
| pages `NN.slug/<modèle>.md`, `<modèle>.<langue>.md` | entrées du module **Pages**, une traduction par langue |
| sous-pages d'une page de modèle `blog` | articles du module **Blog** (`/blog/<slug>`) |
| `published: false` | brouillon |
| `date` / `publish_date` | date de publication |
| `taxonomy` (tag, category) | étiquettes |
| `header_image` / `image` / première image du dossier (blog) | image de couverture |
| `===` (séparateur de résumé) | retiré ; résumé = `summary`, `metadata.description` ou premier paragraphe |
| images du dossier de la page | fichiers envoyés du framework (png, jpg, webp, gif ≤ 5 Mo) ; options Grav (`?cropZoom=…`) retirées |
| liens relatifs et absolus entre pages | réécrits vers les nouvelles adresses |
| ancienne adresse ≠ nouvelle | **redirection permanente** (les anciens liens continuent de marcher) |
| `accounts/*.yaml` | utilisateurs ; `access.admin.super` → propriétaire, `access.admin.login` → administrateur, sinon rédacteur. **Le mot de passe Grav (bcrypt) reste valable.** |

## Ce qui ne l'est pas — et qui est toujours signalé

Le rapport (`<fichier>.rapport.txt`, aussi affiché) liste : blocs modulaires (`_dossiers`), Twig/shortcodes laissés tels quels, fichiers PDF/vidéo/SVG non importés (le lien est conservé),
images trop lourdes ou illisibles, comptes sans mot de passe réutilisable (un mot de passe provisoire est généré). La page d'accueil Grav est importée comme une page ordinaire :
l'accueil du framework se compose de **sections** (admin → Accueil).
