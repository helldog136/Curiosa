# Index des modules reconnus

**L'index lui-même vit dans le dépôt `curiosa-extras`** (`catalogue/index.json`) : le cœur ne contient ni module ni index. Ce document décrit son format.

`index.json` liste les **dépôts git reconnus** que le Catalogue du framework propose en confiance (en plus des modules livrés avec
le framework dans `extras/`).

## Comment il est utilisé

- Chaque installation **relit ce fichier à l'exécution** depuis le dépôt d'origine du framework (celui d'où elle a été clonée), au plus
  toutes les 15 minutes : **ajouter un module ici ne demande aucune nouvelle version du framework**.
- Si le dépôt est injoignable, l'installation garde la dernière copie reçue, à défaut la copie livrée avec sa version (ce fichier tel qu'il était à la
  publication) : le Catalogue fonctionne hors ligne.
- Une installation peut changer de source avec `CURIOSA_CATALOGUE_REPO` (dépôt git) et en ajouter une avec `MODULES_INDEX_URL` (JSON https) ;
  les deux voir `docs/INSTALL.md`. Les entrées d'un index supplémentaire ne peuvent qu'**ajouter** des modules, jamais remplacer ceux de celui-ci.

## Format

```json
{
  "version": 1,
  "modules": [
    {
      "id": "mon-module",
      "name": "Mon module",
      "description": "Une phrase qui dit ce qu'il fait.",
      "repo": "https://github.com/auteur/curiosa-mon-module",
      "ref": "v1.2.0",
      "version": "1.2.0",
      "apiVersion": 2,
      "author": "Auteur",
      "icon": "🧩"
    }
  ]
}
```

`id` doit être **celui du `module.json`** du dépôt (sinon l'installation est refusée). `ref` : **épinglez une étiquette ou un commit relus** —
c'est ce qui rend la mention « vérifié » vraie ; une branche mouvante ne l'est pas. `apiVersion` : la version de l'API des modules visée
(autre que celle du framework = listé comme incompatible).

## Gratuit, avec dons volontaires

Le Catalogue **ne vend rien** : tout module qui y figure est gratuit et sous licence ouverte. Un auteur qui accepte des dons volontaires le dit dans le **README.md** de son dépôt :
l'admin affiche ce README (et les permissions demandées) **avant toute installation**. Un don n'est jamais une condition pour installer ni pour recevoir des mises à jour ; le framework
ne gère aucun paiement et ne touche à aucun argent.

## Proposer un module

Ouvrez une demande de fusion qui ajoute une entrée. Critères : dépôt public sur un hôte autorisé, licence ouverte, code relu (rien d'obscurci,
pas de réseau inattendu, pas de secret journalisé), checklist de `docs/CREATE-A-MODULE.md` remplie, aucune donnée personnelle ou métier dans le dépôt.
Protégez la branche principale (revue obligatoire) : c'est elle qui fait foi pour toutes les installations.
