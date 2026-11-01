// Avis : 6 avis publiés (notes variées, un mis en avant), un en attente (admin), une note moyenne.
export default async function testimonials(h) {
  const R = [["Camille", "Un accueil formidable et des ateliers très clairs. Je recommande sans hésiter !", 5], ["Mehdi", "Très bonne expérience, j'ai appris énormément en une demi-journée.", 5], ["Sophie", "Du matériel de qualité et une équipe patiente.", 4], ["Anouk", "Parfait pour débuter. Peut-être un peu court.", 4], ["Thomas", "Bien, mais j'aurais aimé plus de temps pour pratiquer.", 3], ["Léonie", "Une belle découverte, merci à toute l'équipe pour sa bienveillance et ses conseils précieux tout au long de la journée.", 5]];
  for (const [name, text, rating] of R) await h.act("testimonials", "add", { name, text, rating: String(rating), consent: "on" });
  const { ctx } = await h.raw("testimonials");
  const rows = await ctx.api.store.list("reviews", { limit: 50 });
  for (const r of rows) await h.act("testimonials", "approve", { id: r.id });
  await h.act("testimonials", "feature", { id: rows[0].id });
  await h.act("testimonials", "add", { name: "En attente", text: "Un avis qui attend la modération.", rating: "4", consent: "on" });
}
