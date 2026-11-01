// Doubles des paquets Next que les composants importent (le banc n'a pas de serveur Next).
export const headers = async () => ({ get: (k) => (String(k).toLowerCase() === "x-curiosa-path" ? (globalThis.__benchPath ?? "/") : null) });
export const cookies = async () => ({ get: () => undefined });
export const usePathname = () => globalThis.__benchPath ?? "/";
export const useRouter = () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} });
export const notFound = () => { throw new Error("NEXT_NOT_FOUND"); };
export const redirect = (u) => { throw new Error(`NEXT_REDIRECT ${u}`); };
export default function localFont() { return { className: "bench-font", variable: "", style: { fontFamily: "serif" } }; }
