// Double de la base : le banc n'en a pas. Tout accès est une erreur claire (un composant qui lit la base doit passer par une source de données remplacée, voir ../hooks.mjs).
const fail = (path) => { throw new Error(`Le banc d'essai n'a pas de base de données (accès à prisma.${path}).`); };
const deep = (path) => new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : deep(`${path}.${String(k)}`)), apply: () => fail(path) });
export const prisma = deep("");
