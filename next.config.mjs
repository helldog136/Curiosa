// Fichier JavaScript volontairement : Next le lit tel quel au démarrage. Un next.config.ts obligerait le serveur de production à embarquer le compilateur
// (SWC, ≈ 180 Mo) ou TypeScript rien que pour lire sa configuration.
/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Aucune image n'est optimisée par Next (le site n'utilise pas next/image) : pas besoin de `sharp` (≈ 46 Mo) dans l'installation.
  images: { unoptimized: true },
  // Les modules installés vivent dans data/modules et sont chargés à l'exécution :
  // ils ne doivent jamais être analysés ni embarqués par le bundler.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
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
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
