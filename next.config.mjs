// Fichier JavaScript volontairement : Next le lit tel quel au démarrage. Un next.config.ts obligerait le serveur de production à embarquer le compilateur
// (SWC, ≈ 180 Mo) ou TypeScript rien que pour lire sa configuration.
import fs from "node:fs";
import { hashVersion } from "./scripts/update-lib.mjs";

// Empreinte de la version, lue UNE fois (au build, puis figée dans le manifeste du serveur) : la mise à jour demande /api/health pour savoir si le site
// qui répond est bien le nouveau. Un ancien serveur, resté en mémoire sur ses anciens fichiers, répond toujours l'ancienne empreinte.
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version; } catch { return "0.0.0"; } })();

// Language codes of src/locales/languages.json (the same list as core/i18n/locales.ts): the only URL prefixes that are rewritten, see rewrites() below.
const LANGUAGE_CODES = Object.keys(JSON.parse(fs.readFileSync(new URL("./src/locales/languages.json", import.meta.url), "utf8"))).filter((code) => /^[a-z]{2}$/.test(code));

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Next n'optimise aucune image (le site n'utilise pas next/image). `sharp` est pourtant présent : c'est le recadrage des images (core/imageDerive.ts) qui l'emploie.
  images: { unoptimized: true },
  // Les modules installés vivent dans data/modules et sont chargés à l'exécution :
  // ils ne doivent jamais être analysés ni embarqués par le bundler.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
  /**
   * Language prefix (/fr/blog -> /blog) and the "link ended" page (410), as CONFIG rewrites with a path-only destination. They used to be
   * `NextResponse.rewrite(absoluteUrl)` in src/proxy.ts, and the server only treats an absolute rewrite as internal when its origin equals the one it
   * computes for itself. Behind nginx (`next start -H 127.0.0.1`, `X-Forwarded-Proto: https`) it never does, so Next fetched `https://localhost:<port>`
   * and every prefixed page answered a bare 500 "Internal Server Error". The proxy only DECIDES (it sets x-curiosa-locale / x-curiosa-gone, which it
   * strips from visitors' requests first, and only for the addresses it handles); these rules apply the decision.
   */
  async rewrites() {
    return {
      beforeFiles: [
        // Never for the addresses the proxy leaves alone (admin, API, modules, overlays, uploads, files with a dot): a header forged there changes nothing.
        { source: "/:path((?!(?:api|admin|_next|m|overlays|uploads)(?:/|$))[^.]*)", has: [{ type: "header", key: "x-curiosa-gone" }], destination: "/api/redirect-gone" },
        { source: `/:locale(${LANGUAGE_CODES.join("|")})/:path*`, has: [{ type: "header", key: "x-curiosa-locale" }], destination: "/:path*" },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // FERMÉ par défaut, partout (admin, API, fichiers). Le proxy (src/proxy.ts, core/permissionsPolicy.ts) ne passe `geolocation` à `(self)` que sur les pages
          // publiques et seulement si un module installé déclare la permission « visitor.geolocation ». Caméra et micro : fermés sans condition.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      // Contrôle de la mise à jour (aucune donnée : l'empreinte d'une version, pas son numéro).
      { source: "/api/health", headers: [{ key: "X-Curiosa-Version", value: hashVersion(VERSION) }, { key: "Cache-Control", value: "no-store" }] },
      // Serveur MCP : l'adresse secrète `/api/mcp/<jeton>` ne doit jamais fuir par un en-tête « Referer », ni être mise en cache.
      { source: "/api/mcp/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/mcp", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // Pages d'overlay (0.5.0) : l'adresse secrète `/overlays/page/<secret>` ne fuit jamais par « Referer » et rien n'est gardé en cache ; la politique de sécurité et le reste viennent de la page elle-même (core/overlays/render.ts).
      { source: "/overlays/page/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store, max-age=0" }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // Recherche dans le site (core/search/) : la page de résultats ne s'indexe pas, quelle que soit la langue (la balise de la page dit la même chose). Aucun cache partagé : Next répond « private, no-store » à une page dynamique.
      { source: "/search", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] },
      { source: "/:locale([a-z]{2})/search", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] },
    ];
  },
};

export default nextConfig;
