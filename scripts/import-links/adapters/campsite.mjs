// Campsite.bio (campsite.bio/<nom>) : page rendue côté serveur avec des données structurées (JSON-LD « Person » : nom, description, image, `sameAs` = réseaux)
// et des boutons-liens. Les données structurées donnent l'identité et les réseaux ; les liens viennent du HTML visible.
import { avatarByClass, extractFromDom, extractIdentity } from "../domEngine.mjs";

const personOf = (page) => page.ld.find((o) => o && /person|profilepage|organization/i.test(String(o["@type"] ?? ""))) ?? null;

const adapter = {
  id: "campsite", name: "Campsite.bio", hosts: ["campsite.bio"],
  detect: (page) => /campsite\.bio/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""}`),
  extract(page) {
    const p = personOf(page);
    const person = p?.mainEntity ?? p ?? {};
    const r = extractFromDom(page, {});
    const id = extractIdentity(page, { name: () => String(person.name ?? ""), bio: () => String(person.description ?? ""), avatar: (pg) => (typeof person.image === "string" ? person.image : person.image?.url) ?? avatarByClass(/avatar|profile/i)(pg) });
    const sameAs = (Array.isArray(person.sameAs) ? person.sameAs : person.sameAs ? [person.sameAs] : []).map((url) => ({ url, type: "", label: "" }));
    return { ...id, links: r.links, socials: [...sameAs, ...r.socials], skipped: r.skipped, notes: p ? [] : ["pas de données structurées (JSON-LD) : identité lue dans le HTML"] };
  },
};

export default adapter;
