// Réglages de démonstration : la configuration d'un site neutre (aucun nom réel). Tout le reste du module est le vrai (réexporté tel quel).
export * from "../../../../src/core/settings.ts";

/** Fabrique la configuration du site de démonstration ; `over` remplace des champs (le banc varie la mise en page de l'en-tête, la langue, le logo…). */
export function demoConfig(over = {}) {
  const locale = over.locale ?? "fr";
  const fr = locale === "fr";
  return {
    defaultLocale: "fr", locales: ["fr", "en"], autoDetect: false, adminLocale: null,
    name: fr ? "Mon site" : "My site", tagline: fr ? "Un site d'exemple" : "A sample site", about: "",
    logo: null, logos: { wide: null, square: null, wideDark: null, squareDark: null, favicon: null, share: null }, favicon: null,
    footerText: "", contactEmail: "contact@example.org",
    accent: "#e8a23b", background: "#121214", accent2: "", surface: "", textColor: "", font: "sans",
    glow: { level: "none", custom: {} }, bg: { preset: "none", custom: "", image: null, svg: { markup: "", fit: "cover", align: "center", tile: 200 } },
    statsEnabled: false, newsToggle: true, feedLink: true, nav: [],
    header: { layout: "classic", socials: true, secondary: { label: fr ? "Confidentialité" : "Privacy", href: "/privacy" }, button: { label: fr ? "Me suivre" : "Follow me", href: "/contact" } },
    homeSections: [], setupCompleted: true,
    ...over,
  };
}
export const getSiteConfig = async (locale) => demoConfig({ locale: locale ?? "fr" });
