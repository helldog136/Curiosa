// Jaquettes : une clé factice et une correction par jeu de démonstration (jamais d'appel réseau : l'image est une adresse media.rawg.io que le navigateur de capture remplace par une illustration locale).
export const GAMES = ["Stellar Drift", "Pixel Harbor", "Moss and Lantern", "Tiny Rails", "Cave Chronicles", "Echo Garden"];
export default async function gameCovers(h) {
  const { ctx, dir } = await h.raw("game-covers");
  const fx = await import(`${dir}/fixes.mjs`);
  const match = await import(`${dir}/match.mjs`);
  await fx.writeOne(ctx, fx.COL.key, { key: "demo-key-0123456789", at: h.NOW.toISOString() });
  for (const [i, title] of GAMES.entries()) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await ctx.api.store.add(fx.COL.fixes, { title, kind: "game", rawgId: 1000 + i, name: title, img: `/media/games/d${i}/${slug}.jpg`, at: h.NOW.toISOString() }, { key: match.titleKey(title) });
  }
}
