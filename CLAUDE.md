@AGENTS.md

# Données personnelles et noms dans les tests

- Jamais de données des Contacts de la personne propriétaire (noms, pseudos, courriels, téléphones, notes) dans un test, un document, un commit ou une PR.
- Par défaut, des noms inventés : « etoile_nord », « lune_douce », « Camille ».
- Une vraie personnalité publique n'est permise que si un test a vraiment besoin d'une vraie chaîne, et le moins possible.
- Aucun nom ni pseudo de personne réelle dans les messages de commit ni dans les PR : écrire « un nom d'exemple ».
- La personne propriétaire autorise son propre pseudo là où il existe déjà.

# Ergonomie des pages de configuration : règles obligatoires

@docs/ERGONOMIE-ADMIN.md

# Language of the repository

- Everything in the repository is English: docs, comments, identifiers, tests, commit messages, PR descriptions.
- User-visible texts live in the EN+FR language files (`src/locales/`) with exact parity.
- Exception: existing French files stay as they are until they are touched; translate them when you edit them.
