// Génère docs/TESTSUPPORT.md depuis la liste des exigences (une seule source : requirements/). Un test vérifie que le fichier est à jour.
//   node testsupport/docs.mjs          affiche le texte
//   node testsupport/docs.mjs --write  écrit docs/TESTSUPPORT.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS, LEVELS, REQUIREMENTS } from "./requirements/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export function renderDocs() {
  const mand = REQUIREMENTS.filter((r) => r.level === "mandatory").length;
  const out = [];
  out.push(`# Le kit de test des modules (testsupport)

Vous écrivez un module pour Curiosa et vous voulez savoir : **« suis-je conforme ? »** Le cœur vous répond avec une suite de vérifications prête à l'emploi, versionnée avec le cœur (elle décrit son contrat de module). Elle ne demande ni serveur, ni réseau, ni base de données.

## En une commande

Depuis le dossier du cœur (le dépôt Curiosa) :

\`\`\`
npm run module:check -- /chemin/vers/votre-module
\`\`\`

(équivalent : \`node testsupport/check.mjs /chemin/vers/votre-module\`)

### Depuis votre propre dépôt (sans cloner le dépôt de travail du cœur)

Le kit se lance **depuis n'importe où** : clonez le cœur à côté de votre dépôt, à une étiquette publiée (\`git clone --branch vX.Y.Z --depth 1 https://github.com/helldog136/Curiosa ../Curiosa\`), préparez-le une seule fois (\`cd ../Curiosa && npm ci --omit=dev --ignore-scripts && npx prisma generate\` : cela ne lance pas le site et ne demande aucune base, mais **\`prisma generate\` est indispensable**, sans lui l'import échoue sur \`PrismaClient\`), puis depuis votre dépôt :

\`\`\`
node ../Curiosa/testsupport/check.mjs .                       # le rapport
CURIOSA_DIR=../Curiosa node --test test/*.test.mjs             # vos tests (ils importent le kit par CURIOSA_DIR)
\`\`\`

Un dépôt prêt à copier, avec son workflow GitHub Actions : le dossier \`starter/\` de \`curiosa-extras\`. Le pas à pas complet : [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md).

Le rapport liste chaque exigence avec ✅ réussi ou ❌ échec. Pour chaque ❌ il dit **ce qui ne va pas**, **pourquoi c'est exigé** et **comment corriger**, avec un lien vers la fiche de l'exigence (ci-dessous). **Tout ce qui est ❌ est à corriger ; lancez la même commande jusqu'à ce qu'il n'y en ait plus.**

- **Obligatoire** : condition pour être proposé dans le catalogue. Un échec donne un code de sortie différent de 0.
- **Conseil** (⚠️) : un avertissement. Il n'empêche rien, mais votre module sera meilleur en le suivant.
- **Sans objet** (➖) : l'exigence ne concerne pas votre module (par exemple « tâches planifiées » si vous n'en avez pas).
- **Non vérifié** : la vérification n'a pas pu se faire (par exemple parce que module.json est invalide) ; corrigez d'abord le reste.

Options : \`--json\` (rapport lisible par une machine), \`--voisins <dossier>\` (comparer à d'autres modules, voir « srp.single »), \`--strict\` (les conseils font aussi échouer), \`--seulement id1,id2\`, \`--liste\` (affiche les exigences), \`--tableau\` (plusieurs modules : tableau module × exigence).

## Laisser Claude (ou une autre IA) corriger

Demandez-lui de lancer \`npm run module:check -- <dossier> --json\`, de lire le rapport et de corriger jusqu'à ce que \`summary.ok\` soit \`true\`. Le JSON a cette forme :

\`\`\`json
{
  "module": { "dir": "…", "folder": "guestbook", "id": "guestbook", "version": "1.0.0" },
  "core": { "version": "0.1.22", "apiVersion": 2 },
  "summary": { "ok": false, "mandatory": { "passed": 29, "failed": 3, "na": 4, "skipped": 0 }, "advice": { "passed": 7, "failed": 2, "na": 4, "skipped": 0 } },
  "results": [
    { "id": "settings.optional", "level": "mandatory", "group": "settings", "title": "…", "status": "fail",
      "problems": ["réglage « banner » dit « facultatif » mais ne déclare pas \\"optional\\": true"],
      "what": "…", "why": "…", "fix": "…", "doc": "docs/TESTSUPPORT.md#settingsoptional", "note": "" }
  ]
}
\`\`\`

\`status\` vaut \`pass\`, \`fail\`, \`na\` (sans objet) ou \`skip\` (non vérifié). Les champs \`problems\` et \`fix\` sont faits pour être lus par une IA comme par une personne.

## Dans vos tests (node:test)

\`\`\`js
import test from "node:test";
import { registerConformanceTests, fakeCtx, loadModuleDir } from "<dossier du cœur>/testsupport/index.mjs";

registerConformanceTests(new URL(".", import.meta.url).pathname, { test }); // une exigence = un test nommé
// … puis vos propres tests, avec fakeCtx
\`\`\`

Une exigence obligatoire en échec fait échouer son test (avec le message complet) ; un conseil s'affiche en remarque. Un exemple complet à copier : [\`testsupport/template/\`](../testsupport/template) (un module minimal et son \`my-module.test.mjs\`).

**Dossiers temporaires** : utilisez l'aide \`makeTempDir(prefix)\` du kit (\`testsupport/index.mjs\`), ne créez jamais de dossier dans \`/tmp\` sans l'enregistrer.
Elle supprime le dossier à la fin du test (\`makeTempDir(prefix, { t })\`), avec \`cleanupAll()\` dans un \`after\`, et en filet de sécurité à la sortie du processus.
Dans le cœur, \`npm test\` donne à chaque exécution son propre \`TMPDIR\`, le supprime à la fin et liste en clair (échec) tout ce que les tests y ont laissé ; \`KEEP_TEST_TMP=1\` garde tout pour déboguer.

Le kit se retrouve tout seul : il peut être importé depuis un autre dépôt (par exemple \`curiosa-extras\`) par le chemin du cœur, sans dépendre de la position relative des dossiers. Lancez alors vos tests avec le chargeur de test du cœur : \`node --import <cœur>/tests/helpers/register.mjs --test …\`.

## L'API publique du kit

Tout s'importe depuis \`testsupport/index.mjs\` (stable) :

| Export | Rôle |
|---|---|
| \`checkModule(dir, opts)\` | Lance toutes les exigences sur un dossier et renvoie le rapport (celui de \`--json\`). \`opts.siblings\` : dossiers des autres modules ; \`opts.only\` : identifiants à lancer. Ne lève jamais pour un module fautif. |
| \`registerConformanceTests(dir, { test, siblings, only, prefix })\` | Adaptateur node:test : une exigence = un test nommé. |
| \`fakeCtx(options)\` | Faux contexte de module (réglages, stockage en mémoire, e-mail enregistré, sujets, services…). Option \`permissions\` : le contexte refuse ce qui n'est pas déclaré. \`ctx.api.files\` (cœur 0.2.13) : mêmes règles et mêmes refus que le cœur, options \`uploads\`, \`person\`, \`filesQuota\`, appels dans \`ctx.calls.files\`, \`ctx.dumpFiles()\` pour constater qu'un fichier a disparu. \`ctx.api.rawg\` : \`cover\` et \`candidates\` (options \`rawgCover\`, \`rawgCandidates\` ; appels dans \`ctx.calls.rawg\` et \`ctx.calls.rawgCandidates\`). \`ctx.api.net\` est le vrai client réseau du cœur (état neuf par contexte ; options \`netLimits\`, \`netBudgetMs\`), branché sur \`globalThis.fetch\`. \`ctx.api.log.write\` (cœur après 0.5.1) : option \`logEvents\` (celle de votre \`module.json\`), mêmes règles que le cœur (liste blanche, 200 caractères, secrets écartés, clé invalide : \`false\`), option \`actor\`, lignes dans \`ctx.calls.log\` et \`ctx.dumpLog()\`. \`ctx.params\` (cœur 0.2.14) : option \`params\` (par exemple \`{ slug: "abc" }\` pour une route \`"go/:slug"\`). \`ctx.timezone\` (cœur après 0.6.3) : option \`timezone\` (nom IANA, \`UTC\` par défaut ; un nom inconnu donne le fuseau de la machine, comme le cœur ; \`null\` simule un cœur plus ancien, sans cette clé). \`ctx.calls\` garde les appels, \`ctx.dumpStore()\` le contenu du stockage ; le stockage gère aussi les clés d'index (\`add(collection, data, { key })\`, \`getByKey\`, \`listByKey\`, \`page({ key })\`, \`addMany\`). Voir l'en-tête de \`testsupport/fakeCtx.mjs\`. |
| \`loadModuleDir(dir)\` | Charge un dossier de module comme le cœur (manifeste, code, textes), sans jamais lever. |
| \`fakeFetch(routes)\`, \`withFakeFetch(routes, fn)\`, \`blockNetwork(fn)\` | Faux \`fetch\` pour tester un module qui appelle un service, sans réseau. La clé \`"*"\` répond à toutes les adresses ; le \`signal\` d'annulation est respecté. |
| \`netReplies\`, \`makeNetClient(options)\` | Pannes prêtes à l'emploi pour \`fakeFetch\` : \`rateLimited(120)\` (429 + Retry-After), \`rateLimitedBody(s)\`, \`rateLimitedReset(époque)\`, \`quotaExceeded()\` (403), \`silence()\` (jamais de réponse), \`truncatedJson()\`, \`slow(ms, réponse)\`, \`down()\`, \`status(code)\`. \`makeNetClient\` : le vrai client \`ctx.api.net\`, état neuf. |
| \`makeTempDir(prefix, { t, in })\`, \`cleanupAll()\`, \`removeTempDir(dir)\` | Dossiers temporaires de test, enregistrés puis supprimés (fin du test, \`cleanupAll\`, sortie du processus). \`KEEP_TEST_TMP=1\` : rien n'est supprimé. |
| \`startLocalServer(handler)\` | Petit serveur HTTP local (127.0.0.1) pour tester un module qui parle à une adresse ; rien ne sort de la machine. |
| \`settingsDefaults\`, \`assertValidManifest\`, \`assertLocalesParity\`, \`findSrpViolations\`… | Les vérifications unitaires que la suite réutilise (source unique). |
| \`REQUIREMENTS\`, \`GROUPS\`, \`formatText\`, \`formatMatrix\` | La liste des exigences et la mise en forme du rapport. |

## Comment la suite essaie votre module

Le code de votre module est exécuté avec un faux contexte, **sans réseau** (tout accès est refusé et noté), dans plusieurs situations : réglages par défaut, réglages remplis (français et anglais), puis **données piégées** (textes contenant des balises et des scripts dans les réglages, le stockage, les formulaires, l'adresse de la page, le nom du site, les entrées et les sujets reçus). Rien n'est installé et rien n'est écrit en dehors de la mémoire du test. C'est une **sonde**, pas une preuve : elle atteint ce qu'elle peut atteindre. Un ✅ veut dire « rien trouvé », pas « parfait ».

## L'ergonomie des pages d'administration (\`admin.ergonomics\`)

Les règles de [\`docs/ERGONOMIE-ADMIN.md\`](ERGONOMIE-ADMIN.md) marquées **[auto]** sont mesurées par le kit. Deux façons de les contrôler, selon que le texte vient du manifeste ou du code.

**1. Le manifeste et les textes (exigences \`admin.ergonomics\` et \`admin.ergonomics.known\`).** Le kit lit \`module.json\` et \`locales/*.json\`, jamais le code :

| Règle | Ce qui est mesuré |
|---|---|
| R5 | au plus 7 réglages simples par onglet (les réglages \`advanced\`, les réglages \`rare\` rangés sous « Plus d'options » et ceux d'un groupe facultatif replié ne comptent pas) |
| R9 | aucun mot du code (clé, slug, instance, topic, sujet, token, jeton, webhook, EventSub, route, service, identifiant, payload, API, JSON, cache, hash, SSE, OAuth, key, identifier) dans les libellés, aides, options et messages FR et EN, hors réglages \`advanced\` ; \`{accolades}\` visibles dans un libellé. La liste est modifiable en tête de \`testsupport/ergonomics.mjs\` (\`FORBIDDEN_WORDS\`), avec une liste blanche **justifiée** (\`JARGON_WHITELIST\`) |
| R10 | libellé de 60 caractères au plus, sans « : » final, sans parenthèse de précision à rallonge |
| R11 | tout champ libre (texte, texte long, adresse, nombre) a une aide avec un exemple concret (« Par exemple… », « ex. », une valeur entre guillemets, une adresse, un @pseudo ; un nombre suffit pour un champ numérique) ou une valeur par défaut visible, ou une clé \`example\` (cœur 0.6.0 : le cœur écrit « Par exemple : … » sous le champ) ; l'aide ne répète pas le libellé. Une aide de plus de 60 caractères n'est **pas** un écart : le cœur 0.5.x la passe dans la bulle « ? » (elle est comptée à part par \`--report\`) |
| R13 | pas de « ! », pas de « Veuillez », pas de MAJUSCULES criardes (sigles de \`ALLOWED_CAPS\` permis), vouvoiement, phrases de 20 mots au plus, pas de point médian ni de « (e) » |
| R17 | aucun texte « Activer / désactiver » |
| R19 | pas de liste oui/non pour un booléen, pas de case négative (« Ne pas… ») |
| R29 | FR et EN à parité exacte : mêmes clés, mêmes \`{variables}\`, aucune langue manquante dans un texte du manifeste |

**Le cliquet.** Les modules qui existent déjà ont des écarts. Le dépôt des modules garde donc une base \`tests/ergonomics-baseline.json\` : pour chaque module, la liste de ses écarts connus (une règle, un endroit, un condensé du texte fautif). Le kit la trouve tout seul (\`<dépôt>/tests/ergonomics-baseline.json\`, pour un module dans \`<dépôt>/modules/<id>\`), ou par l'option \`ergonomicsBaseline\` de \`checkModule\` / \`registerConformanceTests\` (un objet, un chemin, ou \`false\`).

- un écart **de la base** : avertissement (\`admin.ergonomics.known\`, conseil) ;
- un **nouvel** écart (nouveau réglage, nouveau texte, texte modifié qui reste fautif) : **échec** (\`admin.ergonomics\`, obligatoire) ;
- un écart de la base **qui a disparu** : échec aussi, « retirez cette ligne de la base » : la base ne peut que **rétrécir** ;
- un module absent d'une base existante n'a droit à aucun écart ; **sans base**, rien n'échoue (tous les écarts sont des avertissements).

Dans le dépôt des modules : \`node scripts/ergonomics-baseline.mjs --write\` (crée la base, ou la fait rétrécir ; il refuse d'ajouter un écart), \`--report\` (le tableau « module → nombre d'écarts par règle »), \`--check\`.

**2. Les pages produites par du code.** Un panneau d'administration (\`adminPanel\`) est du code, pas un manifeste : le kit ne peut pas le lire. Dans les tests de votre module, appelez l'aide avec le faux contexte :

\`\`\`js
import { fakeCtx, assertAdminPageErgonomics } from "<dossier du cœur>/testsupport/index.mjs";

const blocks = await def.adminPanel(fakeCtx({ settings: {} }), { query: {} });
assertAdminPageErgonomics(blocks, { errors: ["Écrivez un nombre entier, par exemple 500."] });
\`\`\`

| Règle | Ce qui est mesuré sur les blocs |
|---|---|
| R3 | un bouton d'envoi qui s'appelle « OK », « Valider », « Soumettre », « Envoyer »… (un verbe précis est attendu) |
| R4 | au plus 5 champs visibles par formulaire (\`adminForm\`), 7 par section (entre deux \`heading\`) ; les champs \`hidden\` et ceux marqués \`advanced\` / \`folded\` ne comptent pas |
| R9, R10 | mots du code et libellés trop longs dans les champs des formulaires |
| R14 | une colonne dont toutes les cellules sont identiques dans un tableau de plus de 5 lignes (une colonne d'interrupteurs, cellule \`switch\`, n'en est jamais une) ; une pastille \`badge\` identique sur toutes les lignes est un titre, pas une étiquette |
| R15 | un tableau de plus de 10 lignes sans champ de recherche (un \`<input type="search">\` dans un bloc \`html\`, un champ \`q\` / \`search\` / « Rechercher » dans un \`adminForm\`, ou \`searchable: true\` sur le tableau) |
| R17 | un bouton de ligne, un lien ou un bouton nommé « Activer / désactiver » (la réponse : une cellule \`switch\`, voir \`docs/MODULES.md\` › Tableau enrichi) |
| R22 | les messages d'erreur donnés dans \`errors\` : un exemple (« par exemple 500 »), jamais de code, de trace ni d'« erreur 500 » |

**Briques du cœur 0.6.0.** Les cellules de tableau peuvent être des objets (\`{ text, badge, switch }\`) et les champs d'un formulaire des champs \`switch\`, \`segmented\`, \`period\`, \`datetime\`, \`duration\` : l'aide les comprend (texte de la cellule, champs \`folded\` non comptés). L'exigence \`compat.minCore\` demande \`"minCore": "0.6.0"\` à un module qui en utilise une.

L'option \`skip: ["R15"]\` écarte une règle (écrivez la raison dans votre test). \`adminPageErgonomicsProblems(blocks, opts)\` rend la liste au lieu de lever.

**Ce que le kit ne peut PAS vérifier : revue humaine et captures.** R1 (une page, une tâche), R2 (chemin court), R3 (le choix du verbe : seuls « OK », « Valider »… sont repérés), R6 (une notion = un champ), R7, R8, R12 (même mot partout), R14 (seule l'étiquette uniforme est mesurée), R16 à R18 (régularité des lignes, interrupteur d'état, état vide), R20, R21, R23 à R28 (retours d'action, liens entre modules, premier usage, téléphone, clavier et lecteur d'écran), R30. La PR les justifie dans sa section « Ergonomie », avec des captures regardées (1280 et 390 px, clair et sombre).

## Les exigences, une par une

Chaque fiche : ce qui est vérifié, pourquoi, comment corriger. L'identifiant est stable (utilisable dans \`--seulement\`).
`);
  out.push("| Identifiant | Niveau | Exigence |\n|---|---|---|");
  for (const r of REQUIREMENTS) out.push(`| [\`${r.id}\`](#${r.id.replace(/[^a-z0-9]/gi, "").toLowerCase()}) | ${LEVELS[r.level]} | ${r.title} |`);
  out.push("");
  out.push(`${mand} exigences obligatoires et ${REQUIREMENTS.length - mand} conseils.`);
  for (const [g, title] of Object.entries(GROUPS)) {
    const rows = REQUIREMENTS.filter((r) => r.group === g);
    if (!rows.length) continue;
    out.push(`\n### ${title}`);
    for (const r of rows) {
      out.push(`\n#### \`${r.id}\`\n`);
      out.push(`**${r.title}** — niveau : **${LEVELS[r.level]}**\n`);
      out.push(`- **Ce qui est vérifié.** ${r.what}`);
      out.push(`- **Pourquoi.** ${r.why}`);
      out.push(`- **Comment corriger.** ${r.fix}`);
    }
  }
  out.push(`
## Limites connues

- La suite lit votre code avec des motifs simples (permissions, imports, appels de \`ctx.t\`) : un code très dynamique peut lui échapper. Les sondes d'exécution comblent une partie de ce manque.
- Les sondes de sécurité n'ont pas de service tiers à interroger : un module qui n'affiche des données qu'après un appel réseau réussi n'est essayé qu'avec ses données locales. Testez ces cas avec \`fakeFetch\` dans vos propres tests.
- « Un propriétaire par donnée » (\`srp.single\`) demande à voir les autres modules : sans \`--voisins\` ou voisins de dossier, il est « sans objet ».
- La neutralité (\`neutrality.clean\`) utilise votre liste de termes : fichier \`.neutrality-terms\` (un terme par ligne) ou variable \`NEUTRALITY_TERMS\`.
- Le fichier que vous lisez est généré par \`node testsupport/docs.mjs --write\` à partir des exigences : ne le modifiez pas à la main.
`);
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = renderDocs();
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(here, "../docs/TESTSUPPORT.md"), text);
  else console.log(text);
}
