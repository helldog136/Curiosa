// Lnk.Bio (lnk.bio/<nom>) : page rendue côté serveur ; nom en <h1>, présentation dans le paragraphe du profil, boutons-liens dans la liste, réseaux en icônes.
import { avatarByClass, textByClass } from "../domEngine.mjs";
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "lnkbio", name: "Lnk.Bio", hosts: ["lnk.bio"],
  detect: (page) => /lnk\.bio/i.test(`${page.meta["og:url"] ?? ""} ${page.meta.canonical ?? ""}`) || /<a[^>]+href="https?:\/\/lnk\.bio\/?"/i.test(page.html),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["name", "displayName", "title"], bio: ["bio", "description"], avatar: ["avatar", "image", "profile_image"] },
    dom: { bio: textByClass(/bio|description|about/i), avatar: avatarByClass(/avatar|profile/i) },
  }),
};

export default adapter;
