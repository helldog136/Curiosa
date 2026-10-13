// Texte tiré d'une page : une DONNÉE non fiable. On n'en garde que du texte brut — pas de balise, pas de caractère de contrôle, longueur bornée.
import { decodeEntities } from "./html.mjs";

export function cleanText(value, max = 200) {
  if (value === null || value === undefined || typeof value === "object") return "";
  let s = decodeEntities(String(value));
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
