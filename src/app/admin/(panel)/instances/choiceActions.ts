"use server";

import { adminCtx } from "@/core/admin";
import { getInstanceById } from "@/core/instances";
import { createChoiceItem, isChoiceField, listChoiceOptions } from "@/core/modules/choice";
import { getModule } from "@/core/modules/registry";

// Sélecteur « choix parmi » (réglage `choice`, voir core/modules/choice.ts) : recherche paginée et création à la volée. Même garde que l'enregistrement
// des réglages (`saveInstanceSettings`) ; tout est relu côté serveur (instance, réglage, source) : le navigateur ne donne qu'un id d'instance et une clé.

export type ChoiceSearchResult = { ok: true; items: { id: string; label: string; hint?: string }[]; next: string | null } | { ok: false; error: string };
export type ChoiceCreateOutcome = { ok: true; id: string; label: string; existing: boolean } | { ok: false; error: string };

async function load(instanceId: unknown, key: unknown) {
  if (typeof instanceId !== "string" || typeof key !== "string" || instanceId.length > 100 || key.length > 60) return null;
  const instance = await getInstanceById(instanceId);
  const mod = instance ? await getModule(instance.moduleId) : null;
  const field = mod?.manifest.settings.find((f) => f.key === key);
  if (!instance || !mod || !field || !isChoiceField(field)) return null;
  return { consumer: { mod, instance }, field };
}

/** Une page de résultats : `q` ≤ 100 caractères, `cursor` ≤ 500 (sinon ignoré), 20 par page. */
export async function searchChoice(instanceId: string, key: string, q: string, cursor: string | null): Promise<ChoiceSearchResult> {
  const { t, locale } = await adminCtx("admin");
  const target = await load(instanceId, key);
  if (!target) return { ok: false, error: t("error.generic") };
  const got = await listChoiceOptions(target.consumer, target.field, { q, cursor, limit: 20 }, { locale });
  if (!got.ok) return { ok: false, error: t("choice.error.unreachable") };
  return { ok: true, items: got.items.map((i) => (i.hint ? { id: i.id, label: i.label, hint: i.hint } : { id: i.id, label: i.label })), next: got.next };
}

/** « Créer « X » » : le module propriétaire de la donnée crée l'élément, avec les droits de la personne connectée (il les vérifie lui-même). */
export async function createChoice(instanceId: string, key: string, label: string): Promise<ChoiceCreateOutcome> {
  const { t, locale, user } = await adminCtx("admin");
  const target = await load(instanceId, key);
  if (!target) return { ok: false, error: t("error.generic") };
  const r = await createChoiceItem(target.consumer, target.field, label, user, { locale });
  if (r.ok) return r;
  const message = { notAllowed: "choice.create.notAllowed", denied: "choice.create.denied", invalid: "choice.create.invalid", duplicate: "choice.create.duplicate", timeout: "choice.error.unreachable", unavailable: "choice.error.unreachable" }[r.error];
  return { ok: false, error: t(message) };
}
