"use server";

import { adminCtx } from "@/core/admin";
import { siteUrl } from "@/core/config";
import { buildChecklist } from "@/core/domainChecklist";
import { afterTasks, setAfterTick } from "@/core/domainChecks";
import { hostOfUrl, parseLegacyHosts } from "@/core/siteAddress";

/** Coche ou décoche une tâche de « Après le changement ». Seule une tâche de la liste actuelle est retenue (jamais un texte quelconque venu du navigateur). */
export async function setAfterTask(id: string, done: boolean): Promise<{ ok: boolean }> {
  const { locale, config, advanced } = await adminCtx("admin");
  if (!advanced) return { ok: false };
  const legacy = parseLegacyHosts(process.env.LEGACY_HOSTS, hostOfUrl(siteUrl)).hosts;
  const checklist = await buildChecklist({ oldBase: legacy[0] ? `https://${legacy[0]}` : siteUrl, newBase: siteUrl, oldHost: legacy[0] ?? "", locale, defaultLocale: config.defaultLocale });
  const known = new Set(afterTasks(checklist).map((t) => t.id));
  return { ok: await setAfterTick(String(id).slice(0, 160), done === true, known) };
}
