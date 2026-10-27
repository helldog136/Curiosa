// Accueil et menu de démonstration (provisoire).
export default async function home(h) {
  const { prisma, S, inst } = h;
  const mod = await import("@/core/menuStore");
  const items = ["blog", "planning", "events"].filter((id) => inst[id]).map((id) => ({ kind: "instance", ref: inst[id].id }));
  await mod.saveMenu([{ kind: "system", ref: "home" }, ...items, { kind: "group", label: { fr: "Communauté", en: "Community" }, children: ["faq", "polls"].filter((id) => inst[id]).map((id) => ({ kind: "instance", ref: inst[id].id })) }]);
}
