// Sondages : un sondage ouvert (avec votes), un clos (résultats), un à choix multiples ; l'un est affiché à l'accueil (« current »).
import { pathToFileURL } from "node:url";
export default async function polls(h) {
  const { ctx, dir } = await h.raw("polls");
  const P = await import(pathToFileURL(`${dir}/index.mjs`).href);
  const rid = (r) => decodeURIComponent(/poll=([^&]+)/.exec(r.redirect)[1]);
  const mk = async (question, choices, extra = {}) => rid(await h.act("polls", "create", { question, choices, ...extra }));
  const slugOf = async (id) => (await ctx.api.store.get(id)).data.slug;
  const vote = async (id, n, picks) => { const slug = await slugOf(id); for (let i = 0; i < n; i++) await P.castVote(ctx, { slug, token: `t${id}${i}`, ids: [picks[i % picks.length]] }); };
  const a = await mk("Quel sera le thème du prochain atelier ?", "Gravure\nReliure\nCéramique\nPhotographie", { endDate: h.day(10).toISOString().slice(0, 10), endTime: "20:00" });
  await vote(a, 23, ["c1", "c1", "c2", "c3", "c1", "c4", "c2"]);
  const b = await mk("Quel jour vous convient le mieux ?", "Samedi\nDimanche");
  await vote(b, 9, ["c1", "c1", "c2"]);
  await h.act("polls", "close", { id: b, confirm: "on" });
  const c = await mk("Quels matériaux aimeriez-vous essayer ?", "Bois\nPapier\nTissu\nMétal", { max: "2" });
  const slug = await slugOf(c);
  for (let i = 0; i < 6; i++) await P.castVote(ctx, { slug, token: `m${i}`, ids: i % 2 ? ["c1", "c3"] : ["c2", "c4"] });
}
