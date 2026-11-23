import type { Translator } from "@/core/i18n/dictionary";
import { MyAccesses, type MyAccessesLabels } from "@/components/admin/MyAccesses";
import { Panel } from "@/components/admin/Page";
import { mayOwnAccess } from "@/core/personalAi/owners";
import { levelsFor, ownAccessStates } from "@/core/personalAi/service";
import { createMyAccessAction, pauseMyAccessAction, removeMyAccessAction, resumeMyAccessAction, setMyAccessLevelAction } from "./actions";
import type { MyAccessState } from "./actions";

const LABEL_KEYS = ["name", "example", "password", "level", "submit", "new", "pending", "createdTitle", "secret", "createdOnce", "copy", "copied", "connect", "active", "paused", "switchLabel", "resumeNeed", "resume", "resumeWith", "menu", "changeLevel", "saveLevel", "remove", "removeConfirm", "removeAction", "ceiling"] as const;

/**
 * "My AI accesses" on the account page: the accesses that belong to the signed-in person. Shown to a person who may own one, or who already owns one (an access they own keeps
 * showing even if the right was withdrawn, so that they can still pause or remove it); nothing at all to anyone else (R33). `initial`: tests and captures only.
 */
export async function MyAccessesCard({ t, userId, initial }: { t: Translator; userId: string; initial?: MyAccessState }) {
  const mayOwn = await mayOwnAccess(userId);
  const owned = await ownAccessStates(userId);
  if (!mayOwn && owned.length === 0) return null;
  const levels = (await levelsFor(userId)).map((l) => ({ value: l, label: t(`myai.level.${l}`) }));
  const rows = owned.map((o) => ({ id: o.id, name: o.name, level: o.level, levelLabel: t(`myai.level.${o.level}`), state: o.state, stateLabel: t(`myai.state.${o.state}`), stateWhy: o.state === "inert" ? t("myai.state.inertWhy") : undefined }));
  const labels = Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`myai.${k}`)])) as MyAccessesLabels;
  return (
    <Panel title={t("myai.title")} help={t("myai.help")} testid="my-accesses-card">
      <p className="text-sm">{t("myai.intro")}</p>
      <MyAccesses rows={rows} levels={levels} canCreate={mayOwn} create={createMyAccessAction} pause={pauseMyAccessAction} resume={resumeMyAccessAction} remove={removeMyAccessAction} setLevel={setMyAccessLevelAction} labels={labels} initial={initial} />
    </Panel>
  );
}
