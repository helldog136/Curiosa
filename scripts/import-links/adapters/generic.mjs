// Adaptateur GÉNÉRIQUE : n'importe quelle page de liens. Les données structurées de la page (JSON-LD, Open Graph) donnent le nom, la présentation et l'avatar ;
// les liens sont les <a> de la page hors navigation et pied de page, dans l'ordre, un intertitre ouvrant une section. C'est aussi le repli de tous les autres
// adaptateurs quand la structure d'un service a changé.
import { readDom } from "./shared.mjs";

const adapter = {
  id: "generic", name: "Page de liens quelconque", hosts: [],
  detect: () => true,
  extract(page) {
    const person = page.ld.find((o) => o && /person|profilepage|organization/i.test(String(o["@type"] ?? "")));
    const p = person?.mainEntity ?? person ?? {};
    const r = readDom(page, {
      name: () => (typeof p.name === "string" ? p.name : ""),
      bio: () => (typeof p.description === "string" ? p.description : ""),
      avatar: () => (typeof p.image === "string" ? p.image : p.image?.url ?? ""),
    });
    const sameAs = (Array.isArray(p.sameAs) ? p.sameAs : p.sameAs ? [p.sameAs] : []).filter((u) => typeof u === "string").map((url) => ({ url, type: "", label: "" }));
    return { ...r, socials: [...sameAs, ...r.socials], notes: [] };
  },
};

export default adapter;
