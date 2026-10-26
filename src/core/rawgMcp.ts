import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { auditFix, candidatesFor, checkTitle, chooseGame, chooseImage, chooseNone, fixSummary, forget, type FixError } from "./rawgAdmin";
import { readToCheck } from "./services/rawgFixes";
import { titleKey } from "./services/rawgMatch";
import { bridgedTool, delegate } from "./services/rawgBridge";

/**
 * OUTILS MCP DES JAQUETTES DE JEUX : lister les titres douteux (lecture) et corriger la jaquette d'un titre (écriture, jamais accordée d'office).
 * Mêmes règles que l'écran d'administration (rawgAdmin.ts) : le jeu se choisit par son numéro RAWG parmi les propositions de RAWG, une image donnée à la main doit être
 * une adresse `https://media.rawg.io/media/…`, 1000 corrections au plus, cadence limitée par jeton. Aucune clé RAWG, jamais, dans une réponse.
 * Les noms d'outils font moins de 64 caractères ; les messages sont en anglais, courts et lisibles par l'agent.
 *
 * CALE DE COMPATIBILITÉ (à retirer en 0.3.0, voir services/rawgBridge.ts) : ces deux outils appartiennent maintenant au module « Jaquettes de jeux » (mêmes noms, mêmes réponses, sous
 * le nom `<clé de l'instance>__<outil>`). Tant que le module est là, les noms historiques ci-dessous (ceux que les jetons ont déjà reçus) relaient vers lui ; sinon l'ancien code répond.
 */
const WHY: Record<FixError, string> = {
  title: "title: give the game title as asked by the module (1 to 120 characters).",
  full: "There are already 1000 saved corrections: ask the owner to forget some in Admin > Settings > External services.",
  candidate: "rawgId: that game is not among the games RAWG proposes for this title. Call rawg_covers_to_check with this title to list them (or pass \"search\" with the real name).",
  image: "imageUrl: only https://media.rawg.io/media/... pictures (png, jpg or webp) are allowed, with no parameter.",
  rate: "Too many requests: wait a minute and try again.",
  nothing: "There is no cover to keep for this title right now.",
  "no-key": "No RAWG key is set: the owner types it in Admin > Settings > External services.",
  refused: "RAWG refuses the site's key: the owner checks it in Admin > Settings > External services.",
  unreachable: "RAWG cannot be reached right now: try again later.",
};

const str = (max: number, description?: string) => ({ type: "string" as const, maxLength: max, ...(description ? { description } : {}) });

export const rawgToolProvider: McpToolProvider = {
  id: "rawg",
  async list() {
    const base = { source: "core", destructive: false } as const;
    const listSchema: JsonSchemaLite = {
      type: "object",
      properties: {
        title: str(120, "Optional. A title from the list (or any title): also returns up to 6 candidate games from RAWG with their rawgId, year and main platforms."),
        search: str(100, "Optional, with title: other words to look for at RAWG (for example the game's real name)."),
      },
    };
    const setSchema: JsonSchemaLite = {
      type: "object", required: ["title"],
      properties: {
        title: str(120, "The title as modules ask for it (as shown by rawg_covers_to_check)."),
        rawgId: { type: "integer", minimum: 1, maximum: 2_000_000_000, description: "The RAWG id of the right game, taken from the candidates of rawg_covers_to_check." },
        search: str(100, "Optional, with rawgId: the words used to find the candidates (when you listed them with a different search)."),
        none: { type: "boolean", description: "true: this title gets no cover at all." },
        imageUrl: str(400, "An https://media.rawg.io/media/... picture chosen by the owner. No other address is accepted."),
        forget: { type: "boolean", description: "true: forget the saved correction of this title (the automatic choice comes back)." },
      },
    };
    const moved = (await delegate()) !== null;
    const where = moved ? "in the Game covers module (Admin > Extensions)" : "in Admin > Settings > External services";
    const relay = (name: string, schema: JsonSchemaLite, legacy: McpTool["call"]): McpTool["call"] => async (raw, actor) => {
      const out = await bridgedTool(name, validateArgs(schema, raw), actor);
      return out.done ? out.value : legacy(raw, actor);
    };
    const tools: McpTool[] = [
      {
        ...base, name: "rawg_covers_to_check", title: "Game covers to check", readOnly: true, default: true, input: listSchema,
        description: `Lists the game titles whose cover is doubtful (the game RAWG gave is not an almost identical title, or two games looked as good), the 100 most recent first. Each has: title (as asked by a module), foundGame, rawgId, coverUrl, candidates (how many games RAWG proposed) and checkedAt. Pass "title" to also get up to 6 candidate games to choose from (rawgId, name, year, platforms, coverUrl); it asks RAWG once. The owner fixes titles ${where}; with the right to, you can use rawg_cover_set. No key is ever shown.`,
        call: relay("rawg_covers_to_check", listSchema, async (raw, actor) => {
          const a = validateArgs(listSchema, raw);
          const items = (await readToCheck()).map((d) => ({ title: d.title, foundGame: d.name, rawgId: d.rawgId ?? null, coverUrl: `https://media.rawg.io${d.img}`, candidates: d.candidates, checkedAt: d.at }));
          if (a.title === undefined) return { items, total: items.length };
          const title = checkTitle(a.title);
          if (!title) throw new McpToolError(WHY.title);
          const found = await candidatesFor(`mcp:${actor.tokenId ?? actor.name}`, title, a.search as string | undefined);
          if (found.status === "rate") throw new McpToolError(WHY.rate);
          return { items, total: items.length, title, status: found.status, candidates: found.candidates.map((c) => ({ rawgId: c.id, name: c.name, year: c.year, platforms: c.platforms, coverUrl: c.url })) };
        }),
      },
      {
        ...base, name: "rawg_cover_set", title: "Fix the cover of a game", readOnly: false, default: false, audited: true, input: setSchema,
        description: "Saves the right cover for one game title, for the whole site (modules get it at once). Pass \"title\" and exactly ONE of: rawgId (the right game, chosen among the candidates of rawg_covers_to_check), none=true (no cover for this title), imageUrl (an https://media.rawg.io/media/... picture), forget=true (remove the saved correction). The cover comes from RAWG's own answer; no other address is ever used. At most 1000 corrections are kept. Changes the pictures visitors see: ask the owner before using it.",
        call: relay("rawg_cover_set", setSchema, async (raw, actor) => {
          const a = validateArgs(setSchema, raw);
          const who = `mcp:${actor.tokenId ?? actor.name}`;
          const modes = [a.rawgId !== undefined, a.none === true, a.imageUrl !== undefined, a.forget === true].filter(Boolean).length;
          if (modes !== 1) throw new McpToolError("pass exactly one of rawgId, none, imageUrl or forget");
          const title = checkTitle(a.title);
          if (!title) throw new McpToolError(WHY.title);
          if (a.forget === true) {
            const done = await forget(who, titleKey(title));
            if (done) await auditFix(`mcp:${actor.name}`, "rawg.fix.forget", title);
            return { forgotten: done, title };
          }
          const out = a.rawgId !== undefined ? await chooseGame(who, title, a.rawgId as number, a.search as string | undefined)
            : a.none === true ? await chooseNone(who, title)
            : await chooseImage(who, title, a.imageUrl as string);
          if (!out.ok) throw new McpToolError(WHY[out.error]);
          await auditFix(`mcp:${actor.name}`, "rawg.fix", fixSummary(out.fix));
          return { saved: true, title: out.fix.title, choice: out.fix.kind, game: out.fix.name ?? null, coverUrl: out.fix.img ? `https://media.rawg.io${out.fix.img}` : null };
        }),
      },
    ];
    return tools;
  },
};
