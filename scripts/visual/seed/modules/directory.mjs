// Annuaire : deux catégories publiques reliées à des catégories de Contacts, une équipe avec rôles, des présentations courtes.
import { pathToFileURL } from "node:url";
export default async function directory(h) {
  const { ctx, dir } = await h.raw("directory");
  const D = await import(pathToFileURL(`${dir}/data.mjs`).href);
  const { cats, people } = h.shared;
  await h.setBoth("directory", "title", "Annuaire des membres", "Members directory");
  await h.set("directory", "hide", cats.hidden);
  const r = await D.addCategories(ctx, [{ catId: cats.members, label: "Membres" }, { catId: cats.mods, label: "Modération" }]);
  if (!r.ok && r.ok !== undefined) throw new Error("directory.addCategories");
  for (const [i, id] of people.team.entries()) await h.act("directory", "teamSave", { contactId: id, role_fr: ["Coordination", "Atelier", "Communication"][i], role_en: ["Coordination", "Workshop", "Communication"][i] });
  for (const [i, id] of [...people.members.slice(0, 6), ...people.mods.slice(0, 2)].entries()) await h.act("directory", "personSave", { contactId: id, bio_fr: `Présentation courte n°${i + 1} : la création est une passion, ici depuis quelques années.`, bio_en: `Short introduction #${i + 1}: a creative person, here for a few years.`, city: "" });
}
