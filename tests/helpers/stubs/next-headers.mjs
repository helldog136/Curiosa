// Double de next/headers : pas de requête HTTP dans un test. Les tests peuvent poser des en-têtes/cookies.
export const state = { headers: new Map(), cookies: new Map() };
export async function headers() {
  return { get: (k) => state.headers.get(String(k).toLowerCase()) ?? null };
}
export async function cookies() {
  return { get: (k) => (state.cookies.has(k) ? { name: k, value: state.cookies.get(k) } : undefined) };
}
