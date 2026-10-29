import { MODE_SCRIPT } from "@/core/skins/modeScript";

/**
 * `/skins/mode.js` : le petit script du cœur qui garde le choix clair / sombre du visiteur (docs/SKINS.md §3.8). Même origine, statique, sans cookie.
 * L'adresse porte une empreinte (`?v=…`) : le navigateur peut donc le garder à vie.
 */
export function GET(): Response {
  return new Response(MODE_SCRIPT, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
