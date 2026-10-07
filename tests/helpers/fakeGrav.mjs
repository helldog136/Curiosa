// Mini site Grav (dossier user/) pour tester l'import : structure fidèle, contenu inventé.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import bcrypt from "bcryptjs";

/** PNG 1×1 valide (la détection d'image du framework lit la signature). */
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex")]);

export function makeGrav(root) {
  const w = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  w("config/site.yaml", "title: Site de démonstration\nmetadata:\n  description: Une accroche de test\n");
  w("config/system.yaml", "languages:\n  supported:\n    - fr\n    - en\nhome:\n  alias: '/home'\n");
  w("accounts/boss.yaml", `email: boss@example.org\nfullname: La Cheffe\naccess:\n  admin:\n    super: true\n    login: true\nhashed_password: '${bcrypt.hashSync("mot-de-passe-grav", 10).replace("$2b$", "$2y$")}'\n`);
  w("accounts/redac.yaml", "email: redac@example.org\nfullname: Un Rédacteur\naccess:\n  admin:\n    login: true\n");
  w("pages/02.blog/blog.md", "---\ntitle: Blog\ncontent:\n  items: '@self.children'\n---\n");
  w("pages/02.blog/premier-article/item.md", "---\ntitle: Premier article\ndate: '2025-03-04 10:00'\nheader_image: couverture.png\ntaxonomy:\n  tag: [annonce, projet]\n---\nIntro de l'article, assez longue pour servir de résumé.\n\n===\n\n![Une image](photo.png?cropZoom=300,200)\n\nVoir la [page équipe](../../a-propos/equipe) et le [contact](/contact).\n\nUn [PDF](dossier.pdf) et un [site externe](https://example.org/x).\n");
  fs.writeFileSync(path.join(root, "pages/02.blog/premier-article/couverture.png"), PNG);
  fs.writeFileSync(path.join(root, "pages/02.blog/premier-article/photo.png"), PNG);
  w("pages/02.blog/premier-article/dossier.pdf", "%PDF-1.4 faux");
  w("pages/02.blog/premier-article/item.en.md", "---\ntitle: First post\n---\nEnglish intro for the first post.\n");
  w("pages/02.blog/brouillon/item.md", "---\ntitle: Un brouillon\npublished: false\n---\nPas encore publié, assez long pour un résumé.\n");
  w("pages/03.a-propos/default.md", "---\ntitle: À propos\n---\nTexte à propos, suffisamment long pour être un résumé correct.\n");
  w("pages/03.a-propos/equipe/default.md", "---\ntitle: L'équipe\n---\nPage imbriquée : l'ancienne adresse était /a-propos/equipe.\n");
  w("pages/04.contact/default.md", "---\ntitle: Contact\n---\nÉcrivez-nous, avec un texte assez long pour le résumé.\n");
  w("pages/05.partenaires/blog.md", "---\ntitle: Partenaires\n---\nNos partenaires.\n");
  w("pages/05.partenaires/dupont/item.md", "---\ntitle: Chez Dupont\nsubtitle: Le sous-titre sert de résumé\nfeatured_image: couverture.png\n---\nTexte du partenaire.\n");
  fs.writeFileSync(path.join(root, "pages/05.partenaires/dupont/couverture.png"), PNG);
  w("pages/06.boutique/external.md", "---\ntitle: Boutique\nexternal_url: 'https://shop.example.org/'\n---\n");
  w("pages/01.home/modular.md", "---\ntitle: Merci\n---\n");
  w("pages/01.home/01._bandeau/banner.md", "---\ntitle: Bandeau\nbutton_text: Nous sponsoriser\nbutton_url: https://monsite.be/fr/partenaires\nfeatured_image: couverture.png\n---\nTexte du bandeau, assez long.\n");
  fs.writeFileSync(path.join(root, "pages/01.home/01._bandeau/couverture.png"), PNG);
  w("pages/01.home/02._video/banner.md", "---\ntitle: Vidéo\n---\n<div class=\"x\"><iframe src=\"https://www.youtube.com/embed/abcDEF12345?autoplay=1\" allowfullscreen></iframe></div>\n");
  w("pages/01.home/03._derniers/recent-posts.md", "---\ntitle: Derniers\n---\nNon repris.\n");
  w("pages/_footer/modular.md", "---\ntitle: Pied de page\n---\nBloc modulaire.\n");
  w("pages/zz-cachee/default.md", "---\ntitle: Page non listée\n---\nUne page sans numéro (invisible dans le menu Grav).\n");
}
