import type { Translator } from "@/core/i18n/dictionary";
import type { JsonSchemaLite } from "@/core/modules/types";
import type { Level3Action } from "@/core/services/mcp/coreTools";
import type { Outcome, RunContext } from "./background";
import type { Plan } from "./requests";
import type { SlotClass } from "./slots";

/**
 * A LEVEL 3 ACTION IS DEFINED ONCE (the registry is `level3Registry.ts`; the rights of its tool are one row of `services/mcp/coreTools.ts`).
 *
 * Level 3 is what an AI asks and a person approves (or what runs at once when the owner chose "act without asking"): `prepare` (read only, checks everything and freezes a
 * plan), then, when the plan RUNS, the plan is checked again (`recheck`) and only then `execute` does anything. The registry derives every table that used to be written by hand:
 * the names, the rate-limit class, the background set, the tool input, the red "destructive" chip, "always asks the owner", the journal text and the sentence the owner reads.
 *
 * The invariant "prepare, check again at approval, then execute" is carried by the runner (`executeLevel3` in the registry): `execute` is not exported by any module, it is
 * only reachable through the runner, which always runs `recheck` first. A definition must declare HOW its plan is checked again (it does not compile without), in one of three ways:
 *   again     the runner prepares the action again with `args` and refuses on a refusal of that preparation; `same` may also refuse when the new plan is not the one
 *             that was approved. `execute` receives the fresh plan.
 *   inside    the plan froze a fingerprint of what it will change; `execute` starts by reading the current state and compares it (menu, home page, site settings, skin).
 *   stepwise  the plan holds several steps; each step is prepared again and compared just before it runs (a bundle of installations: the steps depend on each other).
 */
export type Params = { module?: string; instance?: string; /** Skins : l'identifiant du skin. */ skin?: string; /** Polices (`font_set`) : choix des titres et du texte. */ titles?: unknown; text?: unknown; /** Installation : clé facultative de la première instance. */ instanceKey?: string; /** Contrôle du contenu : reprendre la vérification commencée au lieu d'en commencer une. */ continue?: boolean; /** Désinstallation : garder (défaut) ou effacer les données. */ keepData?: boolean;
  /** Installation de plusieurs modules en une demande (`module_install`) : la liste d'identifiants. */ modules?: unknown;
  /** `instance_add`: the nickname of the new instance. */ nickname?: unknown;
  /** `entry_publish` / `entry_unpublish`: the entry (or entries) of the instance named by `instance`, and the language to insist on. */ id?: unknown; ids?: unknown; locale?: unknown;
  /** `skin_set_options`: colours and fonts, as given to the tool. */ options?: Record<string, unknown>;
  /** `skin_customize`: values, look and reset, as given to the tool. */ customize?: Record<string, unknown>;
  /** `navigation_set`: the whole menu; `home_sections_set`: the whole home page, as given to the tool. */ entries?: unknown; sections?: unknown;
  /** `site_settings_set`: the arguments, as given to the tool. */ site?: Record<string, unknown> };

export type Actor = { name: string; tokenId?: string };

/** How a plan is checked again when it runs (see the comment above). */
export type Recheck =
  | { kind: "again"; args: Params; /** Also refused while a core update runs, like the first preparation (not for an uninstall). */ gated: boolean; /** A reason to refuse when the fresh plan is not the approved one. */ same?: (fresh: Plan) => string | null }
  | { kind: "inside" }
  | { kind: "stepwise" };

export type RunOf = { plan: Plan; /** The plan prepared again (kind `again`), else undefined. */ fresh: Plan | undefined; /** `mcp:<access name>`. */ by: string; ctx?: RunContext };

export type Level3Def = {
  readonly name: Level3Action;
  /** The arguments the tool accepts (the same object the tool publishes). For an action asked through another tool (publishing, site settings) the schema that tool uses, or a placeholder when it is built per instance. */
  readonly input: JsonSchemaLite;
  /** Which rate-limit counter it uses (slots.ts): what brings code or changes the whole site is "risky"; the day-to-day setup and content work is "content". */
  readonly slot: SlotClass;
  /** A long action (downloads, one pass over every repository): started in the background and answered "started" when it is not over in a few seconds (background.ts). */
  readonly background?: true;
  /** What makes the tool a deletion (red chip, confirmation when granted). */
  readonly destructive?: true;
  /** Waits for the owner even when the access is set to "act without asking" (it brings code or a public page onto the site). */
  readonly alwaysHuman?: true;
  /** Can still be prepared (and checked again) while a core update runs. */
  readonly duringCoreUpdate?: true;
  /** From the arguments the tool received to what `prepare` takes (default: the arguments checked against `input`). */
  readonly fromTool?: (raw: Record<string, unknown>) => Params;
  /** Read only: checks everything and freezes the plan the owner is asked to approve. Throws `McpToolError` to refuse. */
  prepare(args: Params, opts: { patient?: boolean }): Promise<Plan>;
  /** How the plan is checked again when it runs. */
  recheck(plan: Plan): Recheck;
  /** Does the work (only ever called by `executeLevel3`, after `recheck`). */
  execute(run: RunOf): Promise<Outcome>;
  /** What the journal and the owner's notice keep: short, no secret. */
  audit(plan: Plan): string;
  /** What the owner reads in the list of requests, in the language of the page. `name` gives the readable name of a module. */
  summarize(plan: Plan, t: Translator, name: (id: string) => string): string;
};

export const defineLevel3 = (def: Level3Def): Level3Def => def;

/** The sentence of a request that replaces a whole list (the menu, the home page): how many entries before and after, then what was added, removed, changed, reordered. */
export const summarizeListChange = (action: "navigation_set" | "home_sections_set"): Level3Def["summarize"] => (p, t) => {
  const c = p.change?.summary;
  if (!c) return t(`aim.req.${action}`, { before: 0, after: 0, detail: "" });
  const detail = [
    c.added.length ? t("aim.req.change.added", { list: c.added.join(", ") }) : "", c.removed.length ? t("aim.req.change.removed", { list: c.removed.join(", ") }) : "",
    c.changed?.length ? t("aim.req.change.changed", { list: c.changed.join(", ") }) : "", c.reordered ? t("aim.req.change.reordered") : "", c.same ? t("aim.req.change.same") : "",
  ].filter(Boolean).join(" ");
  return t(`aim.req.${action}`, { before: c.beforeCount, after: c.afterCount, detail });
};

/** The journal text of a request that replaces a whole list: `<target>: <entries before> > <entries after>`. */
export const auditListChange = (plan: Plan): string => `${plan.change!.target}: ${plan.change!.summary.beforeCount} > ${plan.change!.summary.afterCount}`;

/** The arguments of a tool that takes ONE list under `key` (the whole menu, the whole home page): nothing else is accepted. */
export const wholeListArgs = (key: "entries" | "sections", fail: (message: string) => Error) => (args: Record<string, unknown>): Params => {
  const extra = Object.keys(args ?? {}).find((k) => k !== key);
  if (extra) throw fail(`unexpected argument "${extra}"`);
  return { [key]: (args as Record<string, unknown>)[key] };
};
