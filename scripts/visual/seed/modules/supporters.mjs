// Soutiens : fournisseur « fichier », page publique allumée, 9 soutiens importés, 6 avec pseudo accepté et approuvé sous 3 libellés de palier.
export default async function supporters(h) {
  await h.set("supporters", "provider", "csv");
  await h.set("supporters", "publicPage", true);
  await h.set("supporters", "review", false);
  await h.setBoth("supporters", "title", "Nos soutiens", "Our supporters");
  const rows = ["nom;palier"]; const names = ["Ada", "Bob", "Cléo", "Dora", "Eli", "Fanny", "Gus", "Hana", "Ivo"]; const tiers = ["Or", "Or", "Argent", "Argent", "Argent", "Bronze", "Bronze", "Bronze", "Bronze"];
  names.forEach((n, i) => rows.push(`${n};${tiers[i]}`));
  await h.act("supporters", "importFile", { file: "", paste: rows.join("\n") });
  const { ctx } = await h.raw("supporters");
  const list = await ctx.api.store.list("people", { limit: 50 });
  for (const [i, r] of list.entries()) if (i < 6) await ctx.api.store.update(r.id, { ...r.data, consent: { pseudo: `Pseudo${i + 1}`, at: "2026-05-01" }, approved: true });
}
