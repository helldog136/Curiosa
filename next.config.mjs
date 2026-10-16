// Fichier JavaScript volontairement : Next le lit tel quel au démarrage. Un next.config.ts obligerait le serveur de production à embarquer le compilateur
// (SWC, ≈ 180 Mo) ou TypeScript rien que pour lire sa configuration.
/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Next n'optimise aucune image (le site n'utilise pas next/image). `sharp` est pourtant présent : c'est le recadrage des images (core/imageDerive.ts) qui l'emploie.
  images: { unoptimized: true },
  // Les modules installés vivent dans data/modules et sont chargés à l'exécution :
  // ils ne doivent jamais être analysés ni embarqués par le bundler.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "sharp"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      // Serveur MCP : l'adresse secrète `/api/mcp/<jeton>` ne doit jamais fuir par un en-tête « Referer », ni être mise en cache.
      { source: "/api/mcp/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/api/mcp", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
