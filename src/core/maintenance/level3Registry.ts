import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import type { Level3Action } from "@/core/services/mcp/coreTools";
import type { JsonSchemaLite } from "@/core/modules/types";
import type { Outcome, RunContext } from "./background";
import { coreUpdate, moduleUninstall, moduleUpdate, modulesUpdateAll } from "./coreUpdates";
import { fontSet } from "./fonts";
import { updateRunning } from "./inspect";
import { moduleInstall } from "./install";
import { instanceAdd } from "./instances";
import type { Level3Def, Params } from "./level3";
import { entryPublish, entryUnpublish } from "./publish";
import type { Plan } from "./requests";
import { homeSectionsSet } from "./siteHome";
import { navigationSet } from "./siteNavigation";
import { siteSettingsSet } from "./siteSettings";
import { skinActivate, skinCustomize, skinInstall, skinRemove, skinSetOptions } from "./skins";
import type { SlotClass } from "./slots";

/**
 * THE LEVEL 3 ACTIONS: the one list, and everything that used to be written by hand next to it.
 *
 * `REGISTRY` does not compile when an action of `coreTools.ts` has no definition (and the other way round: a name that is not an action); each definition is written once, in
 * the file of the code it runs (see level3.ts for what a definition holds). The tables other code reads are DERIVED here: the rate-limit class, the background set, the
 * tool input, the "destructive" chip, the actions that always wait for the owner. `prepareLevel3` and `executeLevel3` are the only way in: the second one always checks the plan
 * again before it executes anything.
 */
const REGISTRY: { readonly [K in Level3Action]: Level3Def } = {
  module_update: moduleUpdate, modules_update_all: modulesUpdateAll, core_update: coreUpdate, module_uninstall: moduleUninstall,
  module_install: moduleInstall, skin_install: skinInstall, skin_activate: skinActivate, skin_remove: skinRemove,
  font_set: fontSet, skin_set_options: skinSetOptions, skin_customize: skinCustomize, instance_add: instanceAdd,
  entry_publish: entryPublish, entry_unpublish: entryUnpublish, site_settings_set: siteSettingsSet, navigation_set: navigationSet, home_sections_set: homeSectionsSet,
};
for (const [key, def] of Object.entries(REGISTRY)) if (def.name !== key) throw new Error(`level 3 registry: "${key}" is defined as "${def.name}"`);

export const LEVEL3: readonly Level3Def[] = Object.values(REGISTRY);

export function level3Def(action: string): Level3Def {
  const def = (REGISTRY as Record<string, Level3Def | undefined>)[action];
  if (!Object.hasOwn(REGISTRY, action) || !def) throw new Error(`unknown level 3 action "${action}"`);
  return def;
}

const where = (pick: (d: Level3Def) => boolean): Level3Action[] => LEVEL3.filter(pick).map((d) => d.name);

/** Which counter an action uses (slots.ts). */
export const LEVEL3_CLASS = Object.fromEntries(LEVEL3.map((d) => [d.name, d.slot])) as Record<Level3Action, SlotClass>;
/** Actions started in the background when they are not over in a few seconds (background.ts). */
export const BACKGROUND_LEVEL3: ReadonlySet<Level3Action> = new Set(where((d) => d.background === true));
/** Requests that wait for the owner even when the access is set to "act without asking": they bring code or a public page onto the site. */
export const ALWAYS_HUMAN: readonly Level3Action[] = where((d) => d.alwaysHuman === true);
/** What makes a level 3 tool a deletion (red chip, confirmation when granted). Everything else at level 3 is a request, not a deletion. */
export const DESTRUCTIVE_LEVEL3: ReadonlySet<string> = new Set(where((d) => d.destructive === true));
/** The arguments each request accepts. */
export const LEVEL3_INPUT = Object.fromEntries(LEVEL3.map((d) => [d.name, d.input])) as Record<Level3Action, JsonSchemaLite>;

/** What `prepare` takes, from the arguments a tool received (checked against the tool's input unless the definition says otherwise). */
export function paramsOfTool(action: Level3Action, raw: Record<string, unknown>): Params {
  const def = level3Def(action);
  return def.fromTool ? def.fromTool(raw) : (validateArgs(def.input, raw) as Params);
}

/** While a core update runs nothing else is prepared (an uninstall excepted: it does not depend on the code being replaced). */
function guardCoreUpdate(def: Level3Def): void {
  if (!def.duringCoreUpdate && updateRunning()) throw new McpToolError("A core update is running. Wait for it to finish (maintenance_status).");
}

/** Read only: checks everything and returns the plan to ask the owner to approve. Throws `McpToolError` to refuse. `patient`: the work runs in the background, nobody is waiting. */
export async function prepareLevel3(action: Level3Action, args: Params, opts: { patient?: boolean } = {}): Promise<Plan> {
  const def = level3Def(action);
  guardCoreUpdate(def);
  return def.prepare(args, opts);
}

/**
 * THE ONLY WAY A LEVEL 3 ACTION RUNS: prepare again, compare, then execute. The plan was made when the request was asked, hours may have passed (an approval can wait 24 hours):
 * what it targets is checked again NOW, and an action whose target changed is not executed (`Not done: ...`, asking again is the answer). How depends on the plan
 * (`recheck` of the definition); `execute` is called after it, never before, by this function alone.
 */
export async function executeLevel3(action: Level3Action, plan: Plan, by: string, ctx?: RunContext): Promise<Outcome> {
  const def = level3Def(action);
  const re = def.recheck(plan);
  let fresh: Plan | undefined;
  if (re.kind === "again") {
    try {
      if (re.gated) guardCoreUpdate(def);
      fresh = await def.prepare(re.args, { patient: true });
    } catch (error) {
      if (error instanceof McpToolError) return { ok: false, message: `Not done: ${error.message}` };
      throw error;
    }
    const why = re.same?.(fresh);
    if (why) return { ok: false, message: why };
  }
  return def.execute({ plan, fresh, by, ctx });
}
