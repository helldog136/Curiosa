// Profils de réglages de l'apparence. Le site choisit clair/sombre d'après les couleurs réglées : un profil = un jeu de réglages `theme.*` / `header.*` appliqué
// à une COPIE de l'instantané avant de démarrer le serveur. Aucun profil ne touche au contenu.
//  scope "all"      : toutes les pages découvertes ;  "sample" : accueil + quelques pages types (pour les variantes de mise en page).
export const PROFILES = {
  // Réglages d'origine du site (sombre « night ») : rien n'est écrit, ce sont les défauts du cœur.
  night: { scope: "all", settings: {} },
  // Clair « daylight » : fond crème, accent bleu, second accent, cartes blanches, texte foncé.
  daylight: { scope: "all", settings: { "theme.background": "#f7f4ee", "theme.accent": "#2f6fed", "theme.accent2": "#d6336c", "theme.surface": "#ffffff", "theme.text": "#1d1d22" } },
  // Thème personnalisé : sombre vert, police à empattement, halo fort, fond « grille », en-tête sur deux rangées avec lien secondaire et bouton.
  custom: {
    scope: "all",
    settings: {
      "theme.background": "#0f2a1f", "theme.accent": "#7bdc9a", "theme.accent2": "#f2b8ff", "theme.surface": "#16392b", "theme.text": "#eaf7ef", "theme.font": "serif",
      "theme.glow": "strong", "theme.bgPreset": "grid", "header.layout": "twoRows", "header.socials": true,
      "header.secondaryHref": "/privacy", "header.buttonHref": "/", "@fr:header.secondaryLabel": "Confidentialité", "@en:header.secondaryLabel": "Privacy",
      "@fr:header.buttonLabel": "Accueil", "@en:header.buttonLabel": "Home",
    },
  },
  // Variantes de mise en page de l'en-tête, en sombre d'origine, sur un échantillon de pages.
  "layout-centered": { scope: "sample", settings: { "header.layout": "centered", "theme.glow": "soft", "theme.bgPreset": "dusk" } },
  "layout-minimal": { scope: "sample", settings: { "header.layout": "minimal" } },
  "layout-tworows": { scope: "sample", settings: { "header.layout": "twoRows", "header.secondaryHref": "/privacy", "header.buttonHref": "/", "@fr:header.secondaryLabel": "Confidentialité", "@en:header.secondaryLabel": "Privacy", "@fr:header.buttonLabel": "Accueil", "@en:header.buttonLabel": "Home" } },
};
export const PROFILE_ORDER = Object.keys(PROFILES);
