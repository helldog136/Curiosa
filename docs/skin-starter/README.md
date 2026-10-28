# Mon dépôt de skin pour Curiosa

Point de départ pour créer un skin (l'apparence d'un site Curiosa) dans **votre propre dépôt**. Guide complet, en français : [docs/CREER-UN-SKIN.md](https://github.com/helldog136/Curiosa/blob/master/docs/CREER-UN-SKIN.md) dans le dépôt de Curiosa.

```
.
├── skins/mon-skin/          LE SKIN (renommez le dossier ET l'id dans skin.json : ils doivent être identiques)
│   ├── skin.json            qui est le skin (nom, version, licence, modes, polices, aperçus…)
│   ├── tokens.json          les valeurs : couleurs, polices, arrondis, largeurs…
│   ├── skin.css             la mise en page et les formes (régions et pièces seulement)
│   ├── previews/            deux captures 1280 × 800 (le banc d'essai les fabrique)
│   ├── README.md  LICENSE
├── docs/skin.commente.jsonc le skin.json expliqué ligne par ligne
├── .github/workflows/ci.yml le contrôle automatique à chaque envoi
└── LICENSE
```

## Essayer en 3 commandes

Il faut Node 22, git et le cœur de Curiosa à côté de ce dépôt (il ne sert qu'à tester, vous ne lancez pas de site) :

```bash
git clone --depth 1 https://github.com/helldog136/Curiosa ../Curiosa
(cd ../Curiosa && npm ci --ignore-scripts && npx prisma generate)
cd ../Curiosa
npm run skin:bench -- ../mon-depot/skins/mon-skin      # la page de démonstration : http://127.0.0.1:3560/__bench/
npm run skin:check -- ../mon-depot --visual            # le contrôle complet, navigateur compris
```

Le contrôle dans un navigateur demande Chromium et le module `playwright` (`npm install --global playwright && npx playwright install chromium`).

## Publier

1. Renommez `mon-skin` (dossier et `id`), changez le nom, l'auteur, la licence, les couleurs.
2. `npm run skin:bench -- <skin> --previews <skin>/previews` fabrique les deux aperçus.
3. Poussez, puis étiquetez : `git tag v1.0.0 && git push origin v1.0.0`.
4. Vos utilisateurs collent `https://github.com/<vous>/<depot>#v1.0.0:skins/mon-skin` dans **Apparence → Ajouter depuis une adresse**.
