// Solo.to (solo.to/<nom>) : page rendue côté serveur ; nom en <h1>, présentation en dessous, liens en boutons, réseaux en rangée d'icônes.
import { avatarByClass, textByClass } from "../domEngine.mjs";
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "soloto", name: "Solo.to", hosts: ["solo.to"],
  detect: (page) => /solo\.to/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""}`),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["displayName", "name"], bio: ["bio", "description"], avatar: ["avatar", "image"] },
    dom: { bio: textByClass(/bio|description|about/i), avatar: avatarByClass(/avatar|profile/i) },
  }),
};

export default adapter;
