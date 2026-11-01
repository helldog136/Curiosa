// Plateforme d'un module (champ facultatif `platform` du manifeste) : sert à REGROUPER à l'écran les instances qui parlent de la même plateforme
// (Twitch : chaîne + statut live ; Discord : lien + annonces…). Purement visuel : aucune dépendance entre modules. Logique pure, testée telle quelle.

/** Forme d'un identifiant de plateforme : minuscules, chiffres et tirets, 31 caractères au plus (« twitch », « x », « ko-fi »). */
export const PLATFORM_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;

/** Libellé affiché des plateformes connues du cœur. Une autre (module tiers) s'affiche avec son identifiant, majuscule initiale. */
export const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  bandcamp: "Bandcamp",
  bluesky: "Bluesky",
  discord: "Discord",
  facebook: "Facebook",
  github: "GitHub",
  instagram: "Instagram",
  kick: "Kick",
  kofi: "Ko-fi",
  "ko-fi": "Ko-fi",
  linkedin: "LinkedIn",
  mastodon: "Mastodon",
  patreon: "Patreon",
  pinterest: "Pinterest",
  reddit: "Reddit",
  snapchat: "Snapchat",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  steam: "Steam",
  telegram: "Telegram",
  threads: "Threads",
  tiktok: "TikTok",
  twitch: "Twitch",
  vimeo: "Vimeo",
  whatsapp: "WhatsApp",
  x: "X",
  youtube: "YouTube",
};

/** Libellé d'une plateforme : la table du cœur, sinon l'identifiant avec une majuscule initiale. */
export function platformLabel(id: string): string {
  return Object.hasOwn(PLATFORM_LABELS, id) ? PLATFORM_LABELS[id]! : id.charAt(0).toUpperCase() + id.slice(1);
}

/** Plateforme lisible d'un manifeste, ou null (absente ou mal formée : on ne plante jamais pour un affichage). */
export const platformOf = (m: { platform?: unknown }): string | null => (typeof m.platform === "string" && PLATFORM_PATTERN.test(m.platform) ? m.platform : null);

export type PlatformSplit<T> = { platforms: { platform: string; items: T[] }[]; rest: T[] };

/**
 * Sépare les cartes en sections par plateforme : une plateforme n'a sa section que si AU MOINS 2 instances la partagent ;
 * une instance seule de sa plateforme (ou sans plateforme) reste dans `rest`, rangée ensuite par son type. Sections par ordre alphabétique des libellés ; l'ordre des cartes est conservé.
 */
export function splitByPlatform<T extends { platform: string | null }>(items: readonly T[]): PlatformSplit<T> {
  const count = new Map<string, number>();
  for (const i of items) if (i.platform) count.set(i.platform, (count.get(i.platform) ?? 0) + 1);
  const shared = [...count].filter(([, n]) => n >= 2).map(([p]) => p).sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)));
  return {
    platforms: shared.map((platform) => ({ platform, items: items.filter((i) => i.platform === platform) })),
    rest: items.filter((i) => !i.platform || !shared.includes(i.platform)),
  };
}
