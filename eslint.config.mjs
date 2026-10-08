import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Règle pensée pour le routeur pages : avec la route racine dynamique
    // /[platform] (raccourcis réseaux), elle prend tout lien interne pour
    // une page Next et signale à tort des <a> voulus (téléchargement, etc.).
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    ignores: [".next/**", "node_modules/**", "public/**", "extras/**"],
  },
];

export default eslintConfig;
