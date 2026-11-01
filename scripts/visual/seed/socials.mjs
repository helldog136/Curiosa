// Réseaux sociaux : un identifiant fictif par module « social » (icônes de l'en-tête et des pieds de page).
export default async function socials(h) {
  const P = { bluesky: "demo.example.social", discord: "demo", github: "demo-atelier", instagram: "demo_atelier", mastodon: "demo@example.social", tiktok: "demo_atelier", "x-twitter": "demo_atelier", kofi: "demoatelier", patreon: "demoatelier", reddit: "demo_atelier", telegram: "demoatelier", threads: "demo_atelier", spotify: "demo", steam: "demo", soundcloud: "demo", snapchat: "demo", pinterest: "demo", kick: "demo", facebook: "demo", bandcamp: "demo" };
  for (const [id, v] of Object.entries(P)) if (h.inst[id]) await h.set(id, "profile", v);
  if (h.inst["twitch-channel"]) await h.set("twitch-channel", "channel", "demo_atelier");
  if (h.inst["youtube-channel"]) await h.set("youtube-channel", "channelId", "UCdemodemodemodemodemo1");
}
