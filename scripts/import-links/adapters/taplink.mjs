// Taplink (taplink.cc/<nom>) : application dont l'état initial est écrit dans la page (window.INITIAL_STATE ou un bloc JSON) ; les blocs « lien », « bouton »
// et « réseaux » y portent titre et adresse. Les pages d'un même compte peuvent avoir plusieurs onglets : seul celui qui est affiché est lu.
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "taplink", name: "Taplink", hosts: ["taplink.cc", "taplink.at"],
  detect: (page) => /taplink\.(cc|at)/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""}`) || page.blocks.some((b) => /initial.?state/i.test(b.id ?? "") && JSON.stringify(b.data).includes("taplink")),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["title", "name", "profileName", "nickname"], bio: ["description", "bio", "about"], avatar: ["avatar", "avatarUrl", "photo", "image"] },
  }),
};

export default adapter;
