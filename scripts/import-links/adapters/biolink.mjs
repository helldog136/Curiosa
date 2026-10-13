// Bio.link (bio.link/<nom>) : page rendue côté serveur. Le nom est le titre <h1>, la présentation le paragraphe qui suit, l'avatar l'image du profil
// (sinon og:image), les liens les boutons de la liste, les réseaux la rangée d'icônes sous le nom.
import { avatarByClass, textByClass } from "../domEngine.mjs";
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "biolink", name: "Bio.link", hosts: ["bio.link"],
  detect: (page) => /bio\.link/i.test(page.meta["og:url"] ?? page.meta.canonical ?? "") || /<link[^>]+bio\.link/i.test(page.html.slice(0, 50_000)),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["displayName", "name"], bio: ["bio", "description"], avatar: ["avatar", "profilePicture", "image"] },
    dom: { bio: textByClass(/bio|description|about/i), avatar: avatarByClass(/avatar|profile/i) },
  }),
};

export default adapter;
