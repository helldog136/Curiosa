# Formulaires d'authentification et gestionnaires de mots de passe

Règles pour tout formulaire qui demande, crée ou change un mot de passe, ou un code à usage unique : connexion, installation, changement de mot de passe, choix du premier mot de passe, double vérification, clés d'accès, sauvegarde. Elles complètent [ERGONOMIE-ADMIN.md](ERGONOMIE-ADMIN.md) (R22 : erreur sous le champ ; R28 : libellés reliés, clavier). Un test les garde : `tests/core/password-managers.test.mjs`.

Pourquoi : un gestionnaire (1Password, Bitwarden, Dashlane, Chrome, Safari) ne « lit » pas la page comme une personne. Il cherche, dans **un même `<form>`**, un identifiant et un mot de passe, repérés par `autocomplete`, puis il écoute l'envoi du formulaire. Tout ce qui brouille ce repérage le fait renoncer, en silence.

## Les règles

1. **Un vrai `<form method="post">`**, avec un bouton d'envoi (`type="submit"`). L'envoi par script (`onSubmit` + action serveur) est bon ; un formulaire sans `method` part en GET et mettrait le mot de passe dans l'adresse si le script n'est pas chargé.
2. **L'identifiant est dans le même formulaire, avant le mot de passe** : `<input type="email" autocomplete="username">` quand la personne le saisit. Quand le formulaire ne demande que le mot de passe (changer le sien, en choisir un, confirmer qui l'on est), ajoutez `<UsernameHint value={email} />` : un champ `autocomplete="username"` prérempli, invisible à l'écran, hors de la tabulation. Sans lui, le gestionnaire ne sait pas quelle fiche mettre à jour. Pas de `display:none` ni de `type="hidden"` : certains gestionnaires les ignorent.
3. **`autocomplete` partout, jamais `off` sur un mot de passe.**

   | Champ | `autocomplete` |
   |---|---|
   | e-mail ou nom de connexion | `username` |
   | mot de passe de connexion, ou pour confirmer qui l'on est | `current-password` |
   | créer ou changer un mot de passe, et sa confirmation | `new-password` (les deux champs) |
   | code de l'application d'authentification ou de secours | `one-time-code` |
   | code d'installation (un code qu'on recopie, pas un mot de passe) | `one-time-code`, en `type="text"` |

   `autocomplete="off"` est ignoré par Chrome sur un mot de passe et fait perdre 1Password. Un second champ `type="password"` sans `new-password` passe pour une confirmation.
4. **Un seul composant pour le mot de passe : `PasswordInput`** (ou `TextField type="password"`, qui l'emploie). Le bouton « Afficher » est un vrai `<button type="button">` qui change l'attribut `type` du **même** `<input>` : le nœud n'est jamais remplacé. `clearSecrets` vide aussi le champ affiché après une erreur.
5. **Ne rien bloquer** : ni `onPaste`, ni `onCopy`, ni `onDrop`, ni `readOnly` sur un mot de passe.
6. **Les champs ne se recréent pas** pendant la saisie : pas de `key` qui change à chaque frappe. L'assistant d'installation monte la section « accès » (e-mail, mot de passe, confirmation) d'un coup à la dernière étape, dans le même formulaire que le reste ; l'e-mail se retient quand on revient en arrière, le mot de passe jamais.
7. **Règles de complexité dites deux fois** : en une phrase sous le champ (« 10 caractères minimum »), et à la machine par `passwordMin` (attribut `passwordrules`, lu par Safari). Pas de `minlength` natif : sa bulle du navigateur contredit R22 ; l'erreur s'écrit sous le champ, avec un exemple.
8. **Libellés reliés** : `<label for>` + `id` (ou `aria-label` pour un champ sans libellé visible). Le bouton « Afficher » reste hors du `<label>` (sinon il entre dans le nom du champ).
9. **Erreur sous le champ**, focus sur le premier champ en erreur (`errors: { champ: message }` dans l'action, voir `core/fieldErrors.ts`). Après une erreur, l'e-mail reste et les mots de passe sont vidés.

## Ne pas proposer un mot de passe qui n'est pas celui du compte

`noManager` (sur `PasswordInput` ou `TextField`) pose `data-1p-ignore`, `data-lpignore`, `data-bwignore`. À réserver à :
- un mot de passe donné à **une autre personne** (le mot de passe provisoire, `TemporaryPasswordButton`) : sinon le gestionnaire propose de remplacer le mien ;
- un **secret technique** (clé d'un service : réglage `secret` d'un module, mot de passe du serveur d'envoi d'e-mails).

Partout ailleurs ces attributs sont **interdits** (le test le vérifie). `TextField` les posait sur tous les champs `new-password` : 1Password ne proposait donc rien au choix du premier mot de passe ni au changement de mot de passe.

## Ce que le test garde

`tests/core/password-managers.test.mjs` lit `src/` et échoue si un champ mot de passe n'a pas `autoComplete="new-password"` ou `"current-password"` (donc jamais `off`), bloque le collage, la copie ou le glisser, est en lecture seule, n'a pas de libellé relié, ou porte un attribut « ignorez-moi » hors des fichiers autorisés (avec leur raison, dans le test). Un test ne remplace pas l'extension réelle : voir la note de la PR sur ce qui reste à essayer avec 1Password.
