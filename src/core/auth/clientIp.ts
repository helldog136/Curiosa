/**
 * Adresse du visiteur derrière le reverse proxy. Le proxy (nginx, voir le README) AJOUTE l'adresse qu'il voit à la FIN de X-Forwarded-For : tout ce qui
 * précède vient du visiteur et peut être inventé. On prend donc l'entrée à la position « nombre de proxys » en partant de la fin
 * (CURIOSA_TRUSTED_PROXIES, 1 par défaut), jamais la première. Une adresse IPv6 est ramenée à son réseau /64 (un visiteur en a des milliards).
 */
export function clientIp(get: (name: string) => string | null | undefined, hops = Number(process.env.CURIOSA_TRUSTED_PROXIES ?? 1)): string {
  const chain = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number.isInteger(hops) && hops >= 1 ? hops : 1;
  const raw = chain.length ? chain[Math.max(0, chain.length - n)]! : (get("x-real-ip") ?? "").trim() || "local";
  return normalizeIp(raw);
}

export function normalizeIp(raw: string): string {
  const ip = raw.slice(0, 64).toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(":")) return /^[\d.]+$/.test(ip) || ip === "local" ? ip : "inconnue";
  // IPv6 : on développe « :: » puis on garde les 4 premiers groupes (/64)
  const [head = "", tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return "inconnue";
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
