// Contacts : 5 catégories et 24 fiches fictives (noms inventés), réparties pour alimenter le mur de remerciements, l'annuaire, les soutiens et les raids.
import { pathToFileURL } from "node:url";
export const PEOPLE = {
  mods: ["Aurélie Marchand", "Basile Noël", "Cléa Dufour", "Damien Roux", "Eloïse Vidal", "Farid Benali"],
  patrons: ["Gaëlle Perrin", "Hugo Lambert", "Inès Moreau", "Jules Garnier", "Karine Fabre"],
  team: ["Léa Charpentier", "Mathis Colin", "Noémie Faure"],
  members: ["Océane Bailly", "Paul Renard", "Quentin Maillard", "Rosalie Giraud", "Samir Haddad", "Tessa Lemaire", "Ulysse Poirier", "Valentine Klein", "Wilfried Adam", "Yasmine Orsini"],
};
export default async function contacts(h) {
  const { ctx, dir } = await h.raw("contacts");
  const B = await import(pathToFileURL(`${dir}/book.mjs`).href);
  const cats = {};
  for (const [k, label] of [["mods", "Modération"], ["patrons", "Mécènes"], ["team", "Équipe"], ["members", "Membres"], ["hidden", "Ne pas montrer"]]) {
    const r = await B.createCategory(ctx, { label }, { allowed: true });
    if (!r.ok) throw new Error(`contacts.createCategory ${label} : ${r.error}`);
    cats[k] = r.id;
  }
  const slug = (n) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_");
  const people = {};
  for (const [group, names] of Object.entries(PEOPLE)) {
    people[group] = [];
    for (const [i, name] of names.entries()) {
      const r = await B.upsertByAccount(ctx, { source: "agent", network: "twitch", handle: slug(name), name, categoryId: cats[group] });
      if (!r.ok) throw new Error(`contacts.upsert ${name} : ${r.error}`);
      people[group].push(r.id);
      if (i % 2 === 0) await B.setAccountProfile(ctx, { source: "agent", network: "twitch", handle: slug(name), at: h.NOW.toISOString(), avatar: `https://static.example.org/avatars/${slug(name)}.png`, displayName: name.split(" ")[0], followers: 100 + i * 37 });
      if (i % 3 === 0) await B.addAccount(ctx, { id: r.id, network: "bluesky", handle: `${slug(name)}.example.org` });
    }
  }
  h.shared.cats = cats;
  h.shared.people = people;
}
