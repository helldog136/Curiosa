// Double de next/font/local : une police « chargée » qui ne fait que porter un nom de classe (les tests ne lisent pas de fichier de police).
export default function localFont() { return { className: "font-test", variable: "--font-test", style: { fontFamily: "test" } }; }
