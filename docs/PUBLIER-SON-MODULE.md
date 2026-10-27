# Je publie mon propre module en 30 minutes

Ce guide s'adresse à **une personne ou une entreprise qui n'a jamais travaillé avec nous** et qui veut offrir un module à des sites Curiosa, dans **son propre dépôt GitHub**. Tout ce qu'il faut est public : vous n'avez rien à nous demander. Le détail de chaque point est dans [CREATE-A-MODULE.md](CREATE-A-MODULE.md) (tutoriel), [MODULES.md](MODULES.md) (référence) et [TESTSUPPORT.md](TESTSUPPORT.md) (kit de test). Ici, le chemin le plus court, de zéro à « mes utilisateurs l'installent ».

> *English summary at the end of this page.*

## Le principe, en quatre phrases

1. Un module est **un dépôt git** avec un fichier `module.json` **à la racine** et, en général, un fichier `index.mjs`. Pas de `npm install`, pas de build : Curiosa charge les fichiers tels quels.
2. Votre code ne reçoit que l'objet `ctx` (réglages, stockage, réseau borné, textes) : il n'importe **rien** du cœur.
3. Vous publiez une **étiquette** `vX.Y.Z` à chaque version. Les sites qui vous ont installé voient « mise à jour disponible » et l'appliquent en un clic, sans perdre leurs données.
4. L'utilisateur colle **l'adresse de votre dépôt** dans son administration. Aucune validation de notre part, aucune inscription : c'est un module « personnel, non vérifié » (voir plus bas ce qu'il voit).

## 1. Ce qu'il vous faut (5 minutes)

- **Node 20 ou plus** (22 conseillé) et **git**.
- Un dépôt **public** sur GitHub, GitLab, Codeberg ou Bitbucket (les hôtes que les sites acceptent par défaut, voir [hôtes autorisés](#hôtes-autorisés)).
- Le **cœur de Curiosa cloné à côté** de votre dépôt : il ne sert qu'à **tester** (le kit de test en fait partie). Vous n'avez pas à faire tourner le site.

```bash
mkdir mon-module && cd mon-module && git init -b main
# le cœur, à côté (remplacez v0.3.0 par la dernière étiquette : https://github.com/helldog136/Curiosa/tags)
git clone --branch v0.3.0 --depth 1 https://github.com/helldog136/Curiosa ../Curiosa
cd ../Curiosa && npm ci --omit=dev --ignore-scripts && npx prisma generate && cd -   # une fois ; ne lance pas le site
export CURIOSA_DIR="$PWD/../Curiosa"                                                  # à remettre à chaque nouveau terminal
```

`npx prisma generate` est indispensable (le kit lit le code du cœur, qui s'appuie sur ce fichier généré) ; il n'a besoin d'aucune base de données. Comptez quelques minutes et quelques centaines de Mo : c'est la seule « installation » de tout ce guide.

## 2. La structure d'un dépôt (module à la racine)

Le plus simple : **copiez le dossier [`starter/`](https://github.com/helldog136/curiosa-extras/tree/master/starter) du dépôt `curiosa-extras`** dans votre dépôt (son `module.json` à la racine). Il contient déjà tout ce qui suit, et ses tests passent.

```
mon-module/
├── module.json          obligatoire : qui est le module, ses réglages, ce qu'il utilise
├── index.mjs            le code (facultatif pour un module « zéro code », voir CREATE-A-MODULE §16)
├── locales/en.json      les textes montrés aux humains, une clé = une phrase
├── locales/fr.json      mêmes clés que en.json (le kit le vérifie)
├── README.md            affiché à l'utilisateur AVANT l'installation : à quoi ça sert, réglages, permissions
├── LICENSE              votre licence (le champ "license" du manifeste dit laquelle)
├── test/module.test.mjs vos tests (kit de test du cœur)
├── package.json         seulement pour « npm test » (aucune dépendance)
└── .github/workflows/ci.yml   tests automatiques à chaque envoi (modèle plus bas)
```

Plusieurs modules dans un même dépôt : **un dossier chacun**, chacun avec son `module.json` (jusqu'à trois niveaux). L'utilisateur ajoute alors l'adresse du dépôt dans *Mes dépôts de modules* et installe ceux qu'il veut (voir [section 7](#7-comment-lutilisateur-linstalle)). Au-delà de **60 modules** dans un dépôt, la liste est coupée sans message : restez en dessous.

## 3. Le `module.json` minimal, commenté

JSON n'accepte pas les commentaires : voici le sens de chaque ligne, puis le fichier.

| Champ | Sens |
|---|---|
| `apiVersion` | Toujours `2` : le contrat avec le cœur. |
| `id` | Votre identifiant : minuscules, chiffres, tirets. **Stable pour toujours** (c'est lui qui relie un site à son module). Choisissez-le unique : `votre-marque-nom`. |
| `name`, `description` | Texte `{ "en": …, "fr": … }`, **les deux langues**. La description dit ce que fait **votre** module à la personne qui l'installe, sans jargon. |
| `version` | `x.y.z`, égale à l'étiquette git `vX.Y.Z` que vous publierez. |
| `minCore` | La plus petite version de Curiosa dont vous avez besoin (`0.2.14` convient pour tout ce que décrit ce guide). Un site plus ancien refuse proprement. |
| `main` | Le fichier de code. |
| `instances` | `"multiple"` : l'administrateur peut créer plusieurs exemplaires (deux collections…). `"single"` sinon. |
| `permissions` | Ce que le code utilise : `sections`, `pages`, `routes`, `storage`, `admin`, `mail`, `mcp`… **Déclarez exactement ce que vous utilisez**, ni plus ni moins (le kit vérifie). |
| `settings` | Les réglages que l'administrateur remplit : un libellé en mots simples, une aide d'une phrase, une valeur par défaut. Un réglage de technicien porte `"advanced": true`. |
| `sections`, `page`, `routes`… | Ce que le module ajoute au site, **déclaré ici et implémenté dans `index.mjs`** (et inversement). |
| `privacy` | Si vous récoltez ou transmettez quoi que ce soit au sujet des visiteurs : une phrase en `en` et en `fr` (voir [vie privée](#vie-privée)). |
| `license`, `author` | À vous. Le Catalogue officiel n'accepte que des licences ouvertes ; un dépôt personnel peut avoir la sienne. |

```json
{
  "apiVersion": 2,
  "id": "mon-module",
  "name": { "en": "My module", "fr": "Mon module" },
  "version": "1.0.0",
  "minCore": "0.2.14",
  "description": { "en": "What it does, in plain words.", "fr": "Ce qu'il fait, en mots simples." },
  "author": "Votre nom",
  "license": "MIT",
  "main": "index.mjs",
  "instances": "multiple",
  "permissions": ["sections"],
  "settings": [
    { "key": "message", "type": "text", "default": "Welcome!", "translatable": true,
      "label": { "en": "Welcome message", "fr": "Message d'accueil" },
      "help": { "en": "The sentence shown on the home page.", "fr": "La phrase affichée sur la page d'accueil." } }
  ],
  "sections": [{ "id": "welcome", "size": "small", "label": { "en": "Welcome message", "fr": "Message d'accueil" } }]
}
```

## 4. Tester en local (5 minutes)

```bash
export CURIOSA_DIR="$PWD/../Curiosa"
npm test            # la conformité du cœur (une exigence = un test) + vos tests
npm run check       # le même contrôle en rapport lisible : tout ce qui est ❌ est à corriger
```

Sans `package.json`, les deux commandes sont :

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.mjs
node "$CURIOSA_DIR/testsupport/check.mjs" .          # ajoutez --json pour qu'une IA lise le rapport
```

Vos tests importent le kit **par le chemin du cœur** (`<CURIOSA_DIR>/testsupport/index.mjs`) : `fakeCtx` (faux contexte), `fakeFetch` / `withFakeFetch` (faux service externe, sans réseau), `netReplies` (pannes toutes prêtes : 429, panne, lenteur), `loadModuleDir`. Voir le fichier `starter/test/module.test.mjs`. Deux pièges rencontrés : `fakeCtx` ne lit pas vos fichiers `locales/` tout seul (passez `messages: loaded.locales.en`), et si votre module garde un cache **en mémoire** par instance, donnez à chaque test une `key` d'instance différente (`fakeCtx({ key: "t1" })`), sinon un test voit le cache du précédent.

Pour **l'essayer dans un vrai site** (facultatif) : lancez Curiosa chez vous ([INSTALL.md](INSTALL.md)) avec `CURIOSA_ALLOW_LOCAL_MODULES=1`, puis installez `file:///chemin/absolu/vers/votre-depot` (le dépôt doit avoir un commit). Voir [CREATE-A-MODULE.md §17](CREATE-A-MODULE.md#17-tester-son-module).

## 5. Publier : dépôt, README, étiquette (5 minutes)

1. `README.md` en mots simples (modèle : [celui du `starter/`](https://github.com/helldog136/curiosa-extras/tree/master/starter/README.md)) : à quoi ça sert, ce qu'il faut remplir, **ce que le module demande** (permissions, **adresses de sites externes contactées**, données de visiteurs), limites, licence. C'est **le seul texte de présentation** que l'utilisateur lit avant d'installer (voir [ce qu'il voit](#ce-que-voit-lutilisateur-à-linstallation)).
2. Poussez sur votre dépôt public, puis étiquetez : `git tag v1.0.0 && git push origin v1.0.0` (ou une *release* GitHub). **Ne supprimez jamais une étiquette** : un site qui saute des versions les rejoue une à une (migrations de données).
3. Vérifiez comme un utilisateur : installez `https://github.com/<vous>/<depot>#v1.0.0` sur un site d'essai (voir la section 7).

### Versions et mises à jour

- Une étiquette `vX.Y.Z` par version, `version` du manifeste identique. Un site installé avec `#v1.0.0` (ce que recommande le texte ci-dessous) voit passer **la plus haute étiquette stable** : publier `v1.1.0` suffit pour qu'il propose « Mettre à jour ».
- Un changement **majeur** (`v2.0.0`) est signalé à l'utilisateur (« lisez les notes de version avant ») : écrivez ces notes (page *Releases* de votre dépôt) et dites ce qui change pour lui. Données, réglages et instances sont conservés dans tous les cas.
- Une version **invalide** (manifeste illisible, autre `id`, fichier `main` absent, code qui ne se charge pas, plus de 10 Mo) est **refusée** : l'ancienne reste en service. L'utilisateur voit « Aucun module.json valide à la racine du dépôt » ou « Cette version du module ne se charge pas sur ce site » : **lancez `npm test` avant chaque étiquette.**
- Si vous changez la **forme de vos données**, augmentez `dataVersion` et écrivez la migration ([CREATE-A-MODULE.md §12 bis](CREATE-A-MODULE.md#12-bis-faire-évoluer-ses-données-migrations)).
- Une installation épinglée sur un **commit** ne bouge jamais ; sans `#`, elle suit le dernier commit de la branche par défaut (déconseillé : la mise à jour part à chaque commit).

## 6. Tests automatiques : un workflow GitHub Actions à copier

Fichier `.github/workflows/ci.yml` (le même que celui de `starter/`) : il teste votre module contre **la dernière version publiée** de Curiosa, celle que les sites ont.

```yaml
name: Tests
on:
  push:
    branches: [main, master]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Trouver la dernière version publiée de Curiosa
        id: core
        run: |
          ref=$(git ls-remote --tags --refs https://github.com/helldog136/Curiosa 'refs/tags/v*' | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
          test -n "$ref" || { echo "Aucune version publiée de Curiosa trouvée"; exit 1; }
          echo "ref=$ref" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v4
        with: { repository: helldog136/Curiosa, ref: "${{ steps.core.outputs.ref }}", path: curiosa-core }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci --omit=dev --ignore-scripts && npx prisma generate
        working-directory: curiosa-core
      - run: node curiosa-core/testsupport/check.mjs .
      - run: npm test
        env: { CURIOSA_DIR: curiosa-core }
```

Quand une nouvelle version de Curiosa sort, le prochain envoi re-teste tout : une cassure de compatibilité se voit chez vous avant de se voir chez vos utilisateurs.

## Hôtes autorisés

L'administrateur d'un site n'accepte que les dépôts `https://` des hôtes de `MODULES_ALLOWED_HOSTS` : **par défaut `github.com`, `gitlab.com`, `codeberg.org`, `bitbucket.org`** (`*` = tous). Pas d'identifiant dans l'adresse, pas de `www.`, pas de `?paramètres`. Un dépôt privé ne s'installe pas (le serveur n'a aucun identifiant). Si vous hébergez ailleurs, vos utilisateurs doivent ajouter votre hôte à `MODULES_ALLOWED_HOSTS` sur leur serveur : préférez un des quatre hôtes. **Cela ne concerne que le dépôt, pas les services que votre code appelle** : `ctx.api.net` accepte n'importe quelle adresse `https://` (aucune liste à déclarer côté cœur ; dites dans votre README quels services vous contactez).

## Ce que voit l'utilisateur à l'installation

Avant d'installer, l'admin affiche, **sans rien exécuter** : le nom, l'icône, la version, l'auteur et la licence ; le bandeau « ⚠ dépôt personnel non vérifié » ; la liste, en mots simples, de ce que le module fera (déduite de vos `permissions`) ; **votre `README.md`** (Markdown sans HTML brut, **aucune image distante chargée**, liens relatifs inertes) ; l'avertissement « Un module est du code qui s'exécute sur votre serveur avec les mêmes droits que le site… » ; et la case à cocher **« Je comprends que ce code n'est pas vérifié et qu'il s'exécutera sur mon serveur. »** Sans la case, le bouton « Installer sur mon site » ne part pas. Le module s'installe **actif**, puis on crée une instance (« Mettre en place »).

À savoir pour écrire votre README : ni votre déclaration `privacy`, ni les adresses de services que vous contactez, ni la `description` du manifeste (pour un dépôt personnel) ne sont montrées à ce moment-là. **Écrivez-les dans le README.**

### Texte prêt à coller dans votre README (pour vos utilisateurs)

```markdown
## Installer sur votre site Curiosa

1. Dans l'administration de votre site, passez en **mode avancé** (menu de gauche, « Afficher les réglages avancés »), puis ouvrez **Extensions → Catalogue**.
2. Ouvrez **Installer un dépôt personnel (non vérifié)**, collez cette adresse et cliquez sur **Voir le README avant d'installer** :
   `https://github.com/<vous>/<depot>#v1.0.0`
3. Lisez ce que le module demande, cochez la case « Je comprends… », cliquez sur **Installer sur mon site**, puis sur **Mettre en place** et remplissez les réglages.

Pour le mettre à jour plus tard : **Extensions → Vitrine → Chercher une mise à jour**.
```

## 7. Comment l'utilisateur l'installe

- **Un seul module à la racine** (le cas courant) : **Extensions → Catalogue → Installer un dépôt personnel (non vérifié)**, adresse `https://github.com/<vous>/<depot>#v1.0.0`. **Ces deux options n'existent qu'en mode avancé** : en mode simple, elles sont cachées.
- **Plusieurs modules dans un dépôt** : **Mes dépôts de modules** (mode avancé aussi) avec `https://github.com/<vous>/<depot>` : Curiosa lit les manifestes, liste les modules (3 niveaux de dossiers, 60 modules au plus, 10 dépôts au plus par site) et chacun s'installe avec la même confirmation. Pour un seul d'entre eux : `https://github.com/<vous>/<depot>#v1.0.0:dossier/du-module`.
- **Avec un assistant IA** : l'assistant (jeton MCP) **ne peut pas** installer un dépôt personnel : `maintenance_module_install` ne connaît que le catalogue officiel, jamais une adresse donnée par l'IA. L'installation reste un geste de la personne propriétaire dans l'admin ; l'assistant peut ensuite lire et régler ses réglages et, selon ce que la propriétaire a autorisé pour son jeton, demander sa mise à jour ([MAINTENANCE-IA.md](MAINTENANCE-IA.md)).
- Formes d'adresse acceptées : avec ou sans `.git` ou `/` final, majuscules dans le nom du compte ou du dépôt, `#v1.2.0`, `#branche`, `#commit`, `#v1.2.0:dossier`, `#:dossier`. Refusées : `http://`, `www.`, identifiants dans l'adresse, `?paramètres`, l'adresse d'une page du dépôt (`…/tree/master/…`), `git@…`, un hôte hors liste.

## Vie privée

Le site de vos utilisateurs ne demande aucun consentement parce qu'il ne dépose rien d'inutile : **ne rompez pas cela**.

- Ne chargez **aucune ressource d'un autre domaine chez le visiteur** (image, script, police, iframe, pixel) sans son action volontaire : son navigateur révélerait sa visite (adresse IP, page, navigateur) à ce tiers. Le cœur n'envoie aucune politique de sécurité de contenu : un `<img src="https://autre-site/…">` s'affiche, donc **rien ne vous en empêche : c'est à vous**.
- **Images venant d'un service externe** : faites-les passer par une route de votre module (`/m/<clé>/img?c=<numéro>`) : le **site** (pas le navigateur) télécharge l'image avec `fetch` et un délai (`AbortSignal.timeout`), la valide (type PNG, JPEG ou WebP ; jamais SVG ; taille bornée), la garde en mémoire (nombre et durée bornés) et la sert depuis **sa propre adresse**. Le visiteur ne contacte jamais le tiers. Ne laissez jamais le visiteur donner l'adresse : il donne un **numéro**, vous retrouvez l'adresse dans vos données. Attention : `ctx.api.net.request` rend du **texte** (`json` ou `text`), pas des octets : il convient aux API JSON, pas aux images. L'affichage direct (adresse du tiers dans la page) n'est acceptable que si l'administrateur le choisit en connaissance de cause (réglage avancé) et si votre `privacy` le dit.
- Déclarez dans `privacy` (une ou deux phrases, `en` et `fr`) ce que vos visiteurs partagent, avec qui et comment le faire effacer ; sinon n'écrivez rien. Le cœur reprend ce texte dans la page « Politique de confidentialité » du site.
- Aucun cookie, aucun stockage dans le navigateur, aucune adresse IP en clair (`ctx.api.visitor.fingerprint` pour limiter les abus).
- **Appels à un service externe** : `ctx.api.net.request` (délai, pause sur 429, disjoncteur, cache), jamais de `fetch` sans `AbortSignal.timeout` ; des **bornes dures** (pages, nombre d'éléments, taille) ; affichez les dernières données connues avec leur date quand le service tombe. Ne mettez jamais un réglage de l'administrateur dans une adresse sans le valider (https seulement, même hôte).

## Licence

Votre module est **à vous** : le champ `license` est votre choix (MIT, propriétaire, payant…). La licence du cœur ne s'applique pas à un module qui n'utilise que l'interface publique (`module.json` et `ctx`) sans copier de code du cœur. Mettez un fichier `LICENSE` dans le dépôt. Le Catalogue officiel exige une licence ouverte et reste gratuit.

## Demander l'inscription au catalogue officiel (facultatif)

Votre module fonctionne **sans** être au catalogue. Le catalogue officiel (le dépôt [`curiosa-extras`](https://github.com/helldog136/curiosa-extras)) le fait apparaître avec la mention « ✔ vérifié » dans la liste de tous les sites. Il est généré à partir des dossiers de ce dépôt (`modules/`, `examples/`) : l'inscription passe donc par une **demande** (issue ou demande de fusion) qui donne l'adresse de votre dépôt, l'étiquette à relire et le résultat de `npm test`. Critères de relecture, détaillés dans [`catalogue/README.md`](../catalogue/README.md) : dépôt public sur un hôte autorisé ; **licence ouverte** ; code relu (rien d'obscurci, **pas de réseau inattendu**, pas de secret journalisé) ; checklist de [CREATE-A-MODULE.md](CREATE-A-MODULE.md#checklist-avant-de-publier) remplie ; `npm run check` sans ❌ ; aucune donnée personnelle ou métier dans le dépôt ; `privacy` à jour. Ce qui est « vérifié » est **l'étiquette relue** : une nouvelle version demande une nouvelle relecture.

## Votre liste de contrôle avant chaque étiquette

- [ ] `npm test` et `npm run check` sans ❌ (contre la dernière étiquette du cœur).
- [ ] `version` du manifeste = l'étiquette que vous allez poser ; `README.md` à jour (réglages, permissions, services contactés, vie privée).
- [ ] Aucun service tiers chargé chez le visiteur sans son action ; `privacy` à jour.
- [ ] Changement majeur ? Notes de version écrites. Forme des données changée ? `dataVersion` et migration.
- [ ] Essayé sur un site d'essai : installer, mettre en place, voir la page, mettre à jour depuis l'étiquette précédente.

## English summary

A Curiosa module is a public git repository with a `module.json` at its root (plus `index.mjs`, `locales/en.json` and `locales/fr.json`, a `README.md`). No build step, no dependency. To test it, clone the Curiosa core next to your repo (`git clone --branch vX.Y.Z --depth 1 https://github.com/helldog136/Curiosa`, then `npm ci --omit=dev --ignore-scripts && npx prisma generate` inside it), set `CURIOSA_DIR` and run `npm test` (conformance suite and your own tests with `fakeCtx`/`fakeFetch`) and `node $CURIOSA_DIR/testsupport/check.mjs .` (readable report, `--json` for machines). Publish with git tags `vX.Y.Z`. A site owner installs it in advanced mode: Extensions → Catalogue → "Install a personal repository (not verified)", pasting `https://github.com/<you>/<repo>#v1.0.0`, reading the README and permissions, ticking the trust box. Sites update by tag (major versions are flagged; an invalid version is rolled back). Allowed hosts by default: github.com, gitlab.com, codeberg.org, bitbucket.org. Never load third-party resources in the visitor's browser without consent: proxy remote images through a route of your module and declare what you collect in `privacy`. An AI assistant cannot install a personal repository; the owner does it in the admin. The official catalogue is optional (open an issue or pull request on `curiosa-extras`; open licence, code review). The interface texts of the admin and of the docs are in French; module manifests must carry both `en` and `fr`.
