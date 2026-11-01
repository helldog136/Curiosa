/**
 * RECONNAISSANCE DE L'ADRESSE D'UN PROFIL (cœur 0.7.0) : pur, sans réseau ni base, testé sans navigateur.
 *
 * Chaque réseau déclare dans son manifeste un bloc `social` (hôtes acceptés, modèle d'adresse, exemple, formes reconnues) que le catalogue recopie : le cœur sait donc
 * reconnaître « instagram.com/monpseudo » AVANT d'avoir installé le module. `recognizeOne` fait exactement ce que fait le `profile()` de chaque module (le dépôt des
 * modules le prouve par un test) ; `recognizeSocial` lit un texte collé (une ou plusieurs adresses) et dit, pour chaque morceau, quel réseau c'est.
 *
 * Les données viennent d'un manifeste ou d'un index lu sur le réseau : elles sont validées ici (tailles, expressions régulières refusées si elles ressemblent à
 * un risque d'explosion de calcul) et ne servent qu'à reconnaître : jamais à exécuter quoi que ce soit.
 */
import type { SocialSpec } from "./socialSpec";

export type { SocialSpec };

const DEFAULT_HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/;
// Suivi publicitaire retiré de l'adresse (doit rester identique à la liste du dépôt des modules).
const TRACKING = /^(?:utm_.*|igsh|igshid|si|s|t|fbclid|gclid|ref|ref_src|ref_url|mibextid|share_id|feature|_t|_r|sender_device|is_from_webapp|app)$/i;
const hostIs = (h: string, list: readonly string[]) => list.some((x) => h === x || h.endsWith(`.${x}`));

export type SocialMatch = { url: string; handle: string | null; tag: string | null };

/** Ce que le module afficherait pour ce texte, ou `null` (vide, mal formé, d'un autre site). Même résultat que le `profile()` du module. */
export function recognizeOne(spec: SocialSpec, input: string): SocialMatch | null {
  const aliases = spec.aliases ?? [];
  let v = String(input ?? "").trim().replace(/^<(.*)>$/s, "$1").replace(/^["'“«‘]+|["'”»’]+$/g, "").trim();
  if (!v || /\s/.test(v) || v.length > 300) return null;
  if (spec.fediverse) { const m = /^@?([A-Za-z0-9_.-]{1,60})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/.exec(v); if (m) v = `https://${m[2]}/@${m[1]}`; }
  for (const [form, url] of spec.forms ?? []) { const m = new RegExp(form).exec(v); if (m) { v = url.replace("{1}", m[1] ?? ""); break; } }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    const first = (v.split(/[/?#]/)[0] ?? "").toLowerCase().replace(/^www\./, "");
    const known = spec.hosts ? [...spec.hosts, ...aliases.map((a) => a[0])] : null;
    if (first.includes(".") && (known ? hostIs(first, known) : /^[^/]+\/(?:@|users\/)/.test(v))) v = `https://${v}`;
  }
  if (/^https:\/\//i.test(v)) {
    let u: URL;
    try { u = new URL(v); } catch { return null; }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    let h = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const [short, real] of aliases) if (hostIs(h, [short])) { h = real.replace(/^www\./, ""); u.hostname = real; break; }
    if (spec.hosts && !hostIs(h, spec.hosts)) return null;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    for (const s of spec.shapes ?? []) {
      const hm = s.host ? new RegExp(s.host, "i").exec(h) : null;
      if (s.host && !hm) continue;
      if (s.handle && !s.fromHost && spec.hosts && !spec.hosts.includes(h)) continue;   // un sous-domaine (gist.github.com) garde son adresse
      const pm = new RegExp(s.re).exec(u.pathname);
      const name = pm && (s.fromHost ? hm?.[1] : pm[1]);
      if (!name) continue;
      const handle = s.handle ? name : null;
      const model = s.template ?? (handle ? spec.template : null);
      return { url: model ? model.replace("{h}", encodeURIComponent(name)) : u.href, handle, tag: `${s.handle ? spec.tag ?? "" : s.prefix ?? ""}${name}${s.withHost ? `@${h}` : ""}` };
    }
    return spec.hosts ? { url: u.href, handle: null, tag: null } : null;
  }
  const handleRe = spec.handle ? new RegExp(spec.handle) : DEFAULT_HANDLE;
  if (!spec.template || !handleRe.test(v)) return null;
  const handle = v.replace(/^@/, "");
  return { url: spec.template.replace("{h}", encodeURIComponent(handle)), handle, tag: (spec.tag ?? "") + handle };
}

/** Le texte du bouton, le même quelle que soit la façon dont l'adresse a été collée. */
export const buttonLabel = (spec: Pick<SocialSpec, "name">, m: SocialMatch): string => (m.tag ? `${spec.name} · ${m.tag}` : spec.name);

export type SocialSource = { id: string; spec: SocialSpec };
export type Recognized =
  /** Une adresse qui désigne un seul réseau. */
  | { kind: "match"; text: string; id: string; name: string; icon: string | null; url: string; label: string; handle: string | null }
  /** Un nom seul (« @monpseudo ») : plusieurs réseaux possibles, à choisir. */
  | { kind: "ambiguous"; text: string; choices: { id: string; name: string; icon: string | null; url: string; label: string }[] }
  /** Ni reconnu ni choisissable. */
  | { kind: "unknown"; text: string };

/** Les morceaux d'un texte collé : une adresse par ligne, ou séparées par des espaces, des virgules ou des points-virgules ; sans doublon, 30 au plus. */
export function splitAddresses(text: string): string[] {
  const out: string[] = [];
  for (const part of String(text ?? "").split(/[\s,;|]+/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

/**
 * Lit ce que la personne a collé. Pour chaque morceau : le réseau reconnu (une adresse), plusieurs choix (un nom seul, qui irait à plusieurs réseaux), ou « non reconnu ».
 * Une adresse complète (avec un site) ne désigne jamais qu'un réseau ; un nom seul propose tous les réseaux qui l'acceptent.
 */
export function recognizeSocial(text: string, sources: readonly SocialSource[]): Recognized[] {
  const out: Recognized[] = [];
  for (const piece of splitAddresses(text)) {
    const all = sources.flatMap((s) => { const m = recognizeOne(s.spec, piece); return m ? [{ s, m }] : []; });
    // Un réseau fédéré (n'importe quel serveur, comme Mastodon) reconnaît toute adresse en « /@nom » : s'il existe un réseau dont le site est CELUI de l'adresse, c'est lui.
    const hits = all.some((h) => h.s.spec.hosts) ? all.filter((h) => h.s.spec.hosts) : all;
    const view = ({ s, m }: { s: SocialSource; m: SocialMatch }) => ({ id: s.id, name: s.spec.name, icon: s.spec.icon ?? null, url: m.url, label: buttonLabel(s.spec, m) });
    if (hits.length === 0) out.push({ kind: "unknown", text: piece });
    else if (hits.length === 1) out.push({ kind: "match", text: piece, ...view(hits[0]!), handle: hits[0]!.m.handle });
    else {
      // Plusieurs réseaux l'acceptent : pour un nom seul, c'est à la personne de choisir ; une adresse (avec un site) ne devrait en désigner qu'un.
      const bare = !/[./]/.test(piece);
      out.push(bare ? { kind: "ambiguous", text: piece, choices: hits.map(view) } : { kind: "match", text: piece, ...view(hits[0]!), handle: hits[0]!.m.handle });
    }
  }
  return out;
}

/** Les réseaux que le catalogue sait reconnaître (ceux dont l'index porte un bloc `social`). */
export function socialSourcesOf(entries: readonly { id: string; social?: SocialSpec }[]): SocialSource[] {
  return entries.flatMap((e) => (e.social ? [{ id: e.id, spec: e.social }] : []));
}
