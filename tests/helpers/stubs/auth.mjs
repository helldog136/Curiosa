// Double de src/auth.ts (next-auth) : les tests choisissent la session avec `globalThis.curiosaTestSession = { user: { id, sv, role? } }`
// (null = personne de connecté). Le cœur ne doit jamais décider d'un accès avec `role` de la session : voir tests/core/roles-security.test.mjs.
export const auth = async () => globalThis.curiosaTestSession ?? null;
export const signIn = async () => { throw new Error("signIn n'existe pas dans les tests"); };
export const signOut = async () => { throw new Error("signOut n'existe pas dans les tests"); };
export const handlers = { GET: () => new Response(null, { status: 404 }), POST: () => new Response(null, { status: 404 }) };
