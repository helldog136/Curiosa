import { AUDIT_PERIODS, listAudit } from "@/core/audit";
import { makeTranslator } from "@/core/i18n/dictionary";
import { ACTOR_KINDS, LEVELS } from "@/core/journal/events";
import { describeRows } from "@/core/journal/describe";
import type { JsonSchemaLite } from "@/core/modules/types";
import type { McpToolProvider } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";

/**
 * OUTIL MCP DU JOURNAL CENTRAL : `log_list`, en LECTURE SEULE. Un assistant lit les derniers événements du site (les siens, ceux des personnes de l'équipe, des extensions
 * et du système), avec les mêmes filtres que la page « Journal d'audit ». Les phrases sont en anglais ; chaque ligne dit son origine (person, module, assistant, system).
 * Ce que l'outil ne renvoie JAMAIS : les champs que le module n'a pas déclarés (ils n'ont jamais été enregistrés), un secret, le contenu d'un message.
 * Il n'est PAS accordé d'office à un jeton : le journal cite les adresses e-mail de l'équipe, c'est à la personne propriétaire de le décider (page des jetons).
 * Aucune écriture : un assistant ne peut ni ajouter, ni modifier, ni effacer une ligne du journal.
 */
const en = makeTranslator("en");
const str = (max: number, values?: readonly string[]) => ({ type: "string" as const, maxLength: max, ...(values ? { enum: [...values] } : {}) });
const MAX_LIMIT = 100;

const schema: JsonSchemaLite = {
  type: "object",
  properties: {
    q: str(100),
    module: str(60),
    level: str(5, LEVELS),
    origin: str(9, ACTOR_KINDS),
    period: str(5, Object.keys(AUDIT_PERIODS)),
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    page: { type: "integer", minimum: 1, maximum: 100000 },
  },
};

export const journalToolProvider: McpToolProvider = {
  id: "journal",
  async list() {
    return [{
      name: "log_list", title: "Log: latest site events", source: "core", destructive: false, readOnly: true, default: false, input: schema,
      description: "Read the site's central log (read only), newest first. Each item: when (ISO date), origin (person, module, assistant or system), who, level (info, warn or error), text (what happened, in plain English), target (what it concerned, may be empty), module (the extension's id, empty for the site itself) and instance (its key). Optional filters: \"q\" (search), \"module\" (an extension id, or _core for the site itself), \"level\", \"origin\", \"period\" (day, week or month), \"limit\" (default 30, 100 at most) and \"page\". Answer: { items, total, page, pages }. Lines are kept 90 days and 500 per extension at most. Only fields an extension declared are ever recorded: no secret and no message content.",
      call: async (raw) => {
        const a = validateArgs(schema, raw);
        const limit = (a.limit as number | undefined) ?? 30;
        const { rows, total, page, pages } = await listAudit({ q: a.q as string | undefined, module: a.module as string | undefined, level: a.level as string | undefined, kind: a.origin as string | undefined, period: a.period as string | undefined, page: a.page as number | undefined, pageSize: limit });
        const lines = await describeRows(rows, { t: en, locale: "en", defaultLocale: "en" });
        return {
          items: lines.map((l, i) => ({ when: l.when.toISOString(), origin: l.kind, who: l.who, level: l.level, text: l.sentence, target: l.target, module: l.moduleId, instance: rows[i]!.instance })),
          total, page, pages,
        };
      },
    }];
  },
};
