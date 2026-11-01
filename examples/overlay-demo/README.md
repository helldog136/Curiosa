# Démonstration d'éléments d'overlay

Un petit module d'exemple pour les personnes qui écrivent des modules : il propose quatre éléments aux pages d'overlay de Curiosa (section « Overlays » de l'administration).

- **Horloge** : garde ses proportions (600 × 200), quatre options (format, secondes, légende, taille du texte).
- **Tableau** : s'adapte à la taille choisie, une option (nombre de lignes).
- **Scène** : s'adapte au ratio du cadre (hauteur de référence 1080), ne suit pas le style commun.
- **Fil en direct** : les derniers événements. Plusieurs pages d'overlay peuvent l'afficher en même temps : chaque lecteur a son propre repère dans le flux, aucun ne vole les événements des autres.

Le pas à pas se trouve dans `docs/OVERLAY-ELEMENTS.md`. Ce module n'a aucun réglage ; il sert à lire le code et à tester le cœur. Il ne collecte aucune donnée.
