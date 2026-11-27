import type { Translator } from "./i18n/dictionary";
import type { Need } from "./auth/access";

// The words of a refusal (rule R35): the notice on the dashboard names what the page needed and who can give it, in plain words, and nothing else.
// It never shows a person's name or e-mail (who holds a right is team data), a value, or anything that came from the address.

/** Core rights with a plain name of the page area they open (locale key `denied.area.<id>`); the others fall back to a generic sentence. */
const AREA_RIGHTS = ["core:backup", "core:updates", "core:security", "core:mcp.tokens", "core:modules.install", "core:team", "core:roles"] as const;
/** The delegable core rights already have a plain name in the role editor (`right.core.*`). */
const DELEGABLE_RIGHTS = ["core:entries.edit", "core:entries.publish", "core:ai.personal"] as const;

/** The sentence for a refused page: who it is reserved to and whom to ask. `need` is what the page asked (`adminCtx(need)`); null: the generic sentence. */
export function denialText(t: Translator, need: Need | null): string {
  if (need === null || need === "member") return t("error.denied");
  if (need === "owner") return t("denied.owner");
  if (need === "admin") return t("denied.admin");
  if (need === "editor") return t("denied.editor");
  const right = need.right;
  if ((AREA_RIGHTS as readonly string[]).includes(right)) return t("denied.reserved", { area: t(`denied.area.${right.slice("core:".length)}`) });
  if ((DELEGABLE_RIGHTS as readonly string[]).includes(right)) return t("denied.right", { right: t(`right.${right.replace(":", ".")}`) });
  if (/^[a-z][a-z0-9-]*:open$/.test(right)) return t("denied.module");
  return t("denied.other");
}
