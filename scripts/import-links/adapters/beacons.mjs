// Beacons (beacons.ai/<nom>) : page Next.js ; le profil (nom, présentation, photo) et les blocs (liens, intertitres, réseaux) sont dans le JSON de la page.
// Les blocs « lien » portent un titre et une adresse ; les blocs sans adresse (texte, vidéo, boutique) ne sont pas repris. Repli sur le HTML visible.
import { jsonThenDom } from "./shared.mjs";

const adapter = {
  id: "beacons", name: "Beacons", hosts: ["beacons.ai", "beacons.page"],
  detect: (page) => /beacons\.(ai|page)/i.test(page.html.slice(0, 200_000)) && !!page.nextData(),
  extract: (page) => jsonThenDom(page, {
    json: { name: ["displayName", "display_name", "fullName", "name"], bio: ["bio", "description", "about"], avatar: ["profilePicture", "profilePictureUrl", "profile_picture", "avatarUrl", "avatar"] },
    scope: (d) => d?.props?.pageProps ?? d,
  }),
};

export default adapter;
