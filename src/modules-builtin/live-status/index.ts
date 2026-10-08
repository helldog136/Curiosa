import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

export const manifest: ParsedManifest = {
  apiVersion: 2,
  id: "live-status",
  name: { en: "Twitch live status", fr: "Statut live Twitch" },
  version: "1.0.0",
  description: {
    en: "Shows your Twitch player on the home page and a banner when you are live.",
    fr: "Affiche votre lecteur Twitch sur l'accueil et une bannière quand vous êtes en direct.",
  },
  author: "Helldog136",
  license: "MIT",
  icon: "🔴",
  consumes: [],
  provides: [],
  instances: "single",
  sections: [{ id: "player", label: { en: "Twitch player", fr: "Lecteur Twitch" } }],
  permissions: ["slots", "sections"],
  settings: [
    { key: "channel", type: "text", label: { en: "Twitch channel", fr: "Chaîne Twitch" }, help: { en: "Login name, e.g. mychannel", fr: "Identifiant, ex. machaine" } },
    { key: "clientId", type: "text", label: { en: "Twitch client id (optional, enables the live banner)", fr: "Client id Twitch (optionnel, active la bannière live)" } },
    { key: "clientSecret", type: "secret", label: { en: "Twitch client secret", fr: "Client secret Twitch" } },
  ],
};

export const locales: BuiltinModule["locales"] = {
  en: { live: "{channel} is live now — come say hi!" },
  fr: { live: "{channel} est en direct — viens dire bonjour !" },
};

let token: { value: string; expires: number } | null = null;
let liveCache: { channel: string; live: boolean; at: number } | null = null;

async function isLive(channel: string, clientId: string, secret: string): Promise<boolean> {
  if (liveCache && liveCache.channel === channel && Date.now() - liveCache.at < 60_000) return liveCache.live;
  try {
    if (!token || token.expires < Date.now()) {
      const res = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
        { method: "POST", signal: AbortSignal.timeout(5000) },
      );
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) return false;
      token = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
    }
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token.value}` },
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { data?: unknown[] };
    const live = (json.data?.length ?? 0) > 0;
    liveCache = { channel, live, at: Date.now() };
    return live;
  } catch {
    return false;
  }
}

const CHANNEL_RE = /^[a-zA-Z0-9_]{3,25}$/;

export const definition = defineModule({
  slots: {
    async "layout.banner"(ctx) {
      const channel = ctx.setting("channel") ?? "";
      const clientId = ctx.setting("clientId");
      const secret = ctx.setting("clientSecret");
      if (!CHANNEL_RE.test(channel) || !clientId || !secret) return null;
      if (!(await isLive(channel, clientId, secret))) return null;
      return [{ type: "banner", tone: "success", text: ctx.t("live", { channel }), href: `https://twitch.tv/${channel}` }];
    },
  },
  sections: {
    player(ctx) {
      const channel = ctx.setting("channel") ?? "";
      if (!CHANNEL_RE.test(channel)) return null;
      const parent = new URL(ctx.api.siteUrl).hostname;
      return [
        {
          type: "embed",
          title: `Twitch — ${channel}`,
          src: `https://player.twitch.tv/?channel=${channel}&parent=${parent}&muted=true`,
        },
      ];
    },
  },
});
