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

Le kit se retrouve tout seul : il peut être importé depuis un autre dépôt (par exemple \`curiosa-extras\`) par le chemin du cœur, sans dépendre de la position relative des dossiers. Lancez alors vos tests avec le chargeur de test du cœur : \`node --import <cœur>/tests/helpers/register.mjs --test …\`.

## L'API publique du kit

Tout s'importe depuis \`testsupport/index.mjs\` (stable) :

| Export | Rôle |
|---|---|
| \`checkModule(dir, opts)\` | Lance toutes les exigences sur un dossier et renvoie le rapport (celui de \`--json\`). \`opts.siblings\` : dossiers des autres modules ; \`opts.only\` : identifiants à lancer. Ne lève jamais pour un module fautif. |
| \`registerConformanceTests(dir, { test, siblings, only, prefix })\` | Adaptateur node:test : une exigence = un test nommé. |
| \`fakeCtx(options)\` | Faux contexte de module (réglages, stockage en mémoire, e-mail enregistré, sujets, services…). Option \`permissions\` : le contexte refuse ce qui n'est pas déclaré. \`ctx.api.files\` (cœur 0.2.13) : mêmes règles et mêmes refus que le cœur, options \`uploads\`, \`person\`, \`filesQuota\`, appels dans \`ctx.calls.files\`, \`ctx.dumpFiles()\` pour constater qu'un fichier a disparu. \`ctx.api.rawg\` : \`cover\` et \`candidates\` (options \`rawgCover\`, \`rawgCandidates\` ; appels dans \`ctx.calls.rawg\` et \`ctx.calls.rawgCandidates\`). \`ctx.api.net\` est le vrai client réseau du cœur (état neuf par contexte ; options \`netLimits\`, \`netBudgetMs\`), branché sur \`globalThis.fetch\`. \`ctx.params\` (cœur 0.3.0) : option \`params\` (par exemple \`{ slug: "abc" }\` pour une route \`"go/:slug"\`). \`ctx.calls\` garde les appels, \`ctx.dumpStore()\` le contenu du stockage ; le stockage gère aussi les clés d'index (\`add(collection, data, { key })\`, \`getByKey\`, \`listByKey\`, \`page({ key })\`, \`addMany\`). Voir l'en-tête de \`testsupport/fakeCtx.mjs\`. |
| \`loadModuleDir(dir)\` | Charge un dossier de module comme le cœur (manifeste, code, textes), sans jamais lever. |
| \`fakeFetch(routes)\`, \`withFakeFetch(routes, fn)\`, \`blockNetwork(fn)\` | Faux \`fetch\` pour tester un module qui appelle un service, sans réseau. La clé \`"*"\` répond à toutes les adresses ; le \`signal\` d'annulation est respecté. |
| \`netReplies\`, \`makeNetClient(options)\` | Pannes prêtes à l'emploi pour \`fakeFetch\` : \`rateLimited(120)\` (429 + Retry-After), \`rateLimitedBody(s)\`, \`rateLimitedReset(époque)\`, \`quotaExceeded()\` (403), \`silence()\` (jamais de réponse), \`truncatedJson()\`, \`slow(ms, réponse)\`, \`down()\`, \`status(code)\`. \`makeNetClient\` : le vrai client \`ctx.api.net\`, état neuf. |
| \`startLocalServer(handler)\` | Petit serveur HTTP local (127.0.0.1) pour tester un module qui parle à une adresse ; rien ne sort de la machine. |
| \`settingsDefaults\`, \`assertValidManifest\`, \`assertLocalesParity\`, \`findSrpViolations\`… | Les vérifications unitaires que la suite réutilise (source unique). |
| \`REQUIREMENTS\`, \`GROUPS\`, \`formatText\`, \`formatMatrix\` | La liste des exigences et la mise en forme du rapport. |

## Comment la suite essaie votre module

Le code de votre module est exécuté avec un faux contexte, **sans réseau** (tout accès est refusé et noté), dans plusieurs situations : réglages par défaut, réglages remplis (français et anglais), puis **données piégées** (textes contenant des balises et des scripts dans les réglages, le stockage, les formulaires, l'adresse de la page, le nom du site, les entrées et les sujets reçus). Rien n'est installé et rien n'est écrit en dehors de la mémoire du test. C'est une **sonde**, pas une preuve : elle atteint ce qu'elle peut atteindre. Un ✅ veut dire « rien trouvé », pas « parfait ».

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
