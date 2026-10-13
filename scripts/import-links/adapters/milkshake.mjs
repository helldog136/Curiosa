// Milkshake (msha.ke/<nom>) : mini-site pensé pour les stories Instagram, fait de cartes (lien, texte, image). Les données de la page (Next.js) contiennent le profil
// et la liste des cartes ; seules celles qui portent une adresse sont reprises comme liens. Repli sur le HTML visible.
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "milkshake", name: "Milkshake", hosts: ["msha.ke", "milkshake.app"],
  detect: (page) => /milkshake\.app|msha\.ke/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""} ${page.meta["og:site_name"] ?? ""}`),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["displayName", "name", "title"], bio: ["bio", "description", "subtitle"], avatar: ["profileImage", "avatar", "profilePicture", "image"] },
    scope: (d) => d?.props?.pageProps ?? d,
  }),
};

export default adapter;
