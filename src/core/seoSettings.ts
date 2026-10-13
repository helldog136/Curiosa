import { isSiteEntity, resolveAiBlocking, type AiBlocking, type SiteEntity } from "@/core/seo";
import { getSetting } from "@/core/settings";

/**
 * Réglages « visibilité dans les réponses des IA » (lecture). Les clés :
 *   seo.blockAiTraining  bloquer les robots d'entraînement   (absent : oui)
 *   seo.blockAiAnswers   bloquer les robots de réponse       (absent : non)
 *   seo.blockAiBots      ancien réglage unique, lu seulement quand les deux ci-dessus sont absents (voir `resolveAiBlocking`)
 *   seo.llmsTxt          publier /llms.txt                   (absent : oui)
 *   seo.entityType       « organization » | « person »       (absent : organisation)
 */
export type AiBlockingState = AiBlocking & {
  /** Vrai quand un réglage a été ENREGISTRÉ par l'administrateur (sinon : valeurs par défaut). */
  explicit: boolean;
  /** Vrai quand seul l'ANCIEN réglage unique est enregistré (les deux familles suivent alors sa valeur). */
  fromLegacy: boolean;
};

export async function getAiBlocking(): Promise<AiBlockingState> {
  const [training, answers, legacy] = await Promise.all(
    ["seo.blockAiTraining", "seo.blockAiAnswers", "seo.blockAiBots"].map((k) => getSetting<unknown>(k).catch(() => undefined)),
  );
  const explicit = [training, answers, legacy].some((v) => typeof v === "boolean");
  const fromLegacy = typeof legacy === "boolean" && typeof training !== "boolean" && typeof answers !== "boolean";
  return { ...resolveAiBlocking({ training, answers, legacy }), explicit, fromLegacy };
}

export async function isLlmsTxtEnabled(): Promise<boolean> {
  return (await getSetting<boolean>("seo.llmsTxt").catch(() => undefined)) !== false;
}

export async function getSiteEntity(): Promise<SiteEntity> {
  const v = await getSetting<unknown>("seo.entityType").catch(() => undefined);
  return isSiteEntity(v) ? v : "organization";
}
