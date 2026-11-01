// Garde-fou « gestionnaires de mots de passe » (1Password, Bitwarden, Chrome, Safari…). Règles : docs/FORMULAIRES-AUTHENTIFICATION.md.
// Le test lit le code source de src/ (aucun navigateur) et échoue si un champ mot de passe :
//   - n'a pas `autoComplete="new-password"` ou `autoComplete="current-password"` (jamais `off`, jamais absent) ;
//   - bloque le collage, la copie ou le glisser (un `onPaste`, `onCopy`, `onCut` ou `onDrop` qui appelle `preventDefault`) ;
//   - est en lecture seule (`readOnly`) ;
//   - n'a ni `aria-label`, ni `id` relié à un `<label htmlFor>` ;
// et si un attribut « ignorez ce champ » (`data-1p-ignore`, `data-lpignore`, `data-bwignore`) est posé hors des fichiers qui ont une raison écrite d'en poser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../../src");

/** Fichiers qui ont le droit de dire aux gestionnaires « ne proposez rien ici », avec la raison. */
const IGNORE_ALLOWED = {
  "components/admin/PasswordInput.tsx": "la constante MANAGER_IGNORE (mot de passe d'un autre compte, clé d'un service) : seuls les appels qui le demandent (`noManager`) l'utilisent",
  "components/admin/ChoicePicker.tsx": "champ de recherche d'une liste de choix : ce n'est pas un identifiant ni un mot de passe",
  "components/admin/TemporaryPasswordButton.tsx": "mot de passe provisoire donné à UNE AUTRE personne : jamais celui du compte connecté, un gestionnaire ne doit pas proposer de le mettre à jour",
};

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(tsx|jsx)$/.test(e.name)) yield p;
  }
}

/** Les balises `<input …>`, `<TextField …>` et `<PasswordInput …>` d'un fichier, avec leur texte complet (accolades et guillemets respectés). */
export function tags(source) {
  const out = [];
  const re = /<(input|TextField|PasswordInput)(?=[\s/>])/g;
  let m;
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length, depth = 0, quote = "";
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === quote && source[i - 1] !== "\\") quote = ""; continue; }
      if (depth === 0 && (c === '"' || c === "'")) { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ name: m[1], text: source.slice(m.index, i + 1), line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

const attr = (text, name) => new RegExp(`(?:^|\\s)${name}(?=[\\s=/>])`).test(text);
const value = (text, name) => text.match(new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|\\{([^}]*)\\})`))?.slice(1).find((v) => v !== undefined);

export function isPassword(tag) {
  if (tag.name === "PasswordInput") return true;
  const type = value(tag.text, "type");
  return type !== undefined && /password/.test(type);
}

/** Problèmes d'un fichier (liste de phrases) : le cœur du garde-fou, testé plus bas sur des exemples volontairement faux. */
export function problems(rel, source) {
  const out = [];
  for (const tag of tags(source)) {
    const where = `${rel}:${tag.line}`;
    for (const h of ["onPaste", "onCopy", "onCut", "onDrop"]) if (attr(tag.text, h) && (isPassword(tag) || /preventDefault/.test(tag.text))) out.push(`${where} : ${h} (le collage et la copie doivent rester possibles)`);
    if (!isPassword(tag)) continue;
    if ((attr(tag.text, "data-1p-ignore") || attr(tag.text, "data-lpignore") || attr(tag.text, "data-bwignore")) && !(rel in IGNORE_ALLOWED)) out.push(`${where} : data-1p-ignore / data-lpignore / data-bwignore sur un champ mot de passe hors des fichiers autorisés ; utilisez noManager`);
    const ac = value(tag.text, "autoComplete");
    // PasswordInput reçoit l'attribut de son appelant (typé « new-password | current-password » et vérifié à chaque appel) : il le transmet tel quel.
    const literals = ac === undefined ? [] : [...ac.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    if (rel === "components/admin/PasswordInput.tsx" && ac === "autoComplete") { /* transmis */ }
    else if (ac === undefined) out.push(`${where} : champ mot de passe sans autoComplete (écrivez "new-password" ou "current-password")`);
    else if (!(literals.length > 0 && literals.every((l) => /^(new-password|current-password)$/.test(l))) && !/^(new-password|current-password)$/.test(ac)) out.push(`${where} : autoComplete="${ac}" sur un champ mot de passe (seulement new-password ou current-password)`);
    if (attr(tag.text, "readOnly")) out.push(`${where} : champ mot de passe en lecture seule`);
    // Un libellé relié : un champ TextField se libelle lui-même ; un <input> / <PasswordInput> a un aria-label, ou un id repris par un <label htmlFor>.
    if (tag.name !== "TextField" && rel !== "components/admin/PasswordInput.tsx" && !attr(tag.text, "aria-label")) {
      const id = value(tag.text, "id");
      if (id === undefined) out.push(`${where} : champ mot de passe sans id ni aria-label (libellé non relié)`);
      else if (!/htmlFor=/.test(source)) out.push(`${where} : aucun <label htmlFor> dans le fichier pour le champ ${id}`);
    }
  }
  return out;
}

test("aucun champ mot de passe du code source ne trompe les gestionnaires de mots de passe", () => {
  const found = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    const source = fs.readFileSync(f, "utf8");
    found.push(...problems(rel, source));
    // Aussi hors des balises (un attribut posé par étalement `{...}` échappe à la lecture des balises : c'était le cas de `TextField`, qui rendait TOUS les champs `new-password` invisibles pour 1Password).
    if (/data-(1p|lp|bw)ignore/.test(source) && !(rel in IGNORE_ALLOWED)) found.push(`${rel} : data-1p-ignore / data-lpignore / data-bwignore hors des fichiers autorisés (${Object.keys(IGNORE_ALLOWED).join(", ")}) ; pour un mot de passe qui n'est pas celui du compte, utilisez noManager`);
  }
  assert.deepEqual(found, [], `\n${found.join("\n")}\n`);
});

test("autocomplete=\"off\" n'est jamais posé sur un champ mot de passe (Chrome l'ignore, 1Password s'y perd)", () => {
  assert.ok(problems("x.tsx", '<input id="a" type="password" autoComplete="off" aria-label="x" />').some((p) => /autoComplete="off"/.test(p)));
  assert.ok(problems("x.tsx", '<TextField name="a" type="password" autoComplete="off" />').some((p) => /autoComplete="off"/.test(p)));
});

test("le garde-fou échoue bien sur chaque défaut (il ne laisse rien passer en silence)", () => {
  assert.ok(problems("x.tsx", '<input id="a" aria-label="x" type="password" />').some((p) => /sans autoComplete/.test(p)));
  assert.ok(problems("x.tsx", '<TextField name="a" type="password" label="x" />').some((p) => /sans autoComplete/.test(p)));
  assert.ok(problems("x.tsx", '<PasswordInput id="a" />').some((p) => /sans autoComplete/.test(p)));
  assert.ok(problems("x.tsx", '<input aria-label="x" type="password" autoComplete="new-password" onPaste={(e) => e.preventDefault()} />').some((p) => /onPaste/.test(p)));
  assert.ok(problems("x.tsx", '<input aria-label="x" type="text" onCopy={(e) => e.preventDefault()} />').some((p) => /onCopy/.test(p)));
  assert.ok(problems("x.tsx", '<input aria-label="x" type="password" autoComplete="current-password" readOnly />').some((p) => /lecture seule/.test(p)));
  assert.ok(problems("x.tsx", '<input type="password" autoComplete="current-password" />').some((p) => /libellé non relié/.test(p)));
  assert.ok(problems("x.tsx", '<input id="a" type="password" autoComplete="current-password" />').some((p) => /htmlFor/.test(p)));
});

test("le garde-fou accepte les formes correctes (et lit les accolades, comme un `=>` dans un attribut)", () => {
  assert.deepEqual(problems("x.tsx", '<label htmlFor="a">x</label><input id="a" name="p" type="password" autoComplete="new-password" onChange={(e) => set(e.target.value)} />'), []);
  assert.deepEqual(problems("x.tsx", '<TextField name="a" type="password" label="x" autoComplete="current-password" />'), []);
  assert.deepEqual(problems("x.tsx", '<input id="e" type="email" autoComplete="off" />'), []);
});
