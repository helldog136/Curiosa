// Menu de démonstration (le vrai code compose le menu de la personne, voir core/menuResolve.ts) : des liens simples, un sous-menu, une pastille de nouveauté.
export async function resolvePublicMenu(locale) {
  const en = locale === "en";
  const p = (path) => (en ? `/en${path}` : path);
  return [
    { label: en ? "Home" : "Accueil", href: en ? "/en" : "/", news: false },
    { label: "Blog", href: p("/blog"), news: true },
    { label: en ? "About" : "À propos", href: p("/a-propos"), news: false, children: [
      { label: en ? "Team" : "L'équipe", href: p("/a-propos/equipe"), news: false },
      { label: en ? "Press" : "Presse", href: p("/a-propos/presse"), news: false },
    ] },
    { label: "Contact", href: p("/contact"), news: false },
  ];
}
export const buildPublicItems = () => [];
export const pickLabel = (o, s, l) => o?.[l] || s?.[l] || "";
