// Sponsors : trois partenaires avec code et mention.
export default async function sponsors(h, row) {
  await h.set("sponsors", "disclosure", "Certains liens sont sponsorisés.").catch(() => {});
  const S = [["Marque Alpha", "Alpha Brand", "ALPHA10"], ["Studio Bêta", "Beta Studio", "BETA15"], ["Atelier Gamma", "Gamma Shop", "GAMMA5"]];
  for (let i = 0; i < S.length; i++) await h.entry(row, { fr: { title: S[i][0], summary: "Un partenaire de confiance.", body: "Pourquoi nous travaillons avec eux.\n\nCode : à utiliser au paiement." }, en: { title: S[i][1], summary: "A trusted partner.", body: "Why we work with them." }, code: S[i][2], url: "https://example.org/partenaire", cover: await h.img(i + 5, 600, 400), at: h.day(-60 - i), position: i });
}
