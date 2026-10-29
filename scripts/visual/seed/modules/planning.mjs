// Planning : l'instance principale (/planning, affichage d'origine) et une instance par apparence (sept pages), pour couvrir toutes les mises en page.
export default async function planning(h) {
  const A = [["classic", "classique", "Liste classique", "Classic list"], ["alternating", "alternance", "Liste en alternance", "Alternating list"], ["week", "semaine", "Semaine en grille", "Week grid"], ["timeline", "timeline", "Timeline", "Timeline"], ["posters", "affiches", "Affiches", "Posters"], ["hero", "une", "À la une", "Up next"]];
  const { mod } = await h.raw("planning");
  const opts = (mod.manifest.settings.find((s) => s.key === "appearance").options ?? []).map((o) => o.value);
  for (const [value, path, fr, en] of A) {
    const v = opts.find((o) => o === value) ?? opts.find((o) => o.includes(value));
    if (!v) { console.error(`planning : apparence ${value} inconnue (${opts.join(",")})`); continue; }
    const row = await h.extra("planning", { nickname: `Planning ${path}`, fr, en, basePath: `planning-${path}` });
    await h.setOn(row, "appearance", v);
  }
  await h.set("planning", "days", 7);
}
