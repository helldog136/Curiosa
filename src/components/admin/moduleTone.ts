import type { BadgeTone } from "@/core/blocks";

const TONES: BadgeTone[] = ["accent", "info", "ok", "warn", "danger"];

/** Une couleur stable par extension (la même sur le tableau de bord et dans la liste des brouillons) ; le nom écrit reste toujours à côté. */
export function moduleTone(key: string): BadgeTone {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length] ?? "accent";
}
