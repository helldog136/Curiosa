import type { AuditRow } from "@/core/audit";
import { auditLabelKey } from "@/core/auditLabels";
import type { Translator } from "@/core/i18n/dictionary";
import { getModule } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { actorKindOf, eventsOf, isActorKind, isLevel, parseData, renderEvent, type ActorKind, type JournalLevel, type LogEventDecl } from "./events";

/** Une ligne du journal, écrite en langage courant : prête à afficher (jamais de JSON, jamais d'identifiant technique hors mode avancé). */
export type JournalLine = {
  id: string;
  when: Date;
  kind: ActorKind;
  /** Qui, en clair : l'adresse de la personne, le nom du jeton de l'assistant, le nom de l'extension, « Système ». */
  who: string;
  level: JournalLevel;
  sentence: string;
  /** Ce sur quoi porte l'action (vide si rien). */
  target: string;
  moduleId: string;
  moduleName: string;
  /** Le code de l'action, pour le mode avancé seulement. */
  code: string;
};

export type DescribeOpts = { t: Translator; locale: string; defaultLocale: string };

/** Les événements déclarés et le nom de chaque module cité par ces lignes (un chargement par module, jamais d'erreur). */
async function modulesOf(rows: readonly AuditRow[], opts: DescribeOpts): Promise<Map<string, { name: string; events: LogEventDecl[] }>> {
  const out = new Map<string, { name: string; events: LogEventDecl[] }>();
  for (const id of new Set(rows.map((r) => r.module).filter(Boolean))) {
    const mod = await getModule(id).catch(() => null);
    out.set(id, { name: mod ? localized(mod.manifest.name, opts.locale, opts.defaultLocale) || id : id, events: eventsOf(mod?.manifest) });
  }
  return out;
}

/** Met des lignes du journal en phrases. Ordre conservé. */
export async function describeRows(rows: readonly AuditRow[], opts: DescribeOpts): Promise<JournalLine[]> {
  const { t, locale, defaultLocale } = opts;
  const modules = await modulesOf(rows, opts);
  const render = { locale, defaultLocale, yes: t("journal.yes"), no: t("journal.no") };
  return rows.map((r) => {
    // Une ligne écrite par un ancien cœur (après la migration) garde « system » par défaut : la forme de l'acteur dit alors qui c'était.
    const kind: ActorKind = r.actorKind === "system" || !isActorKind(r.actorKind) ? actorKindOf(r.actor) : r.actorKind;
    const info = r.module ? modules.get(r.module) : undefined;
    const decl = info?.events.find((e) => e.key === r.action);
    const labelKey = r.module && !decl && !/^(module|mcp|instance)\./.test(r.action) ? null : auditLabelKey(r.action);
    const sentence = decl ? renderEvent(decl, parseData(r.data), render) : labelKey ? t(labelKey) : r.module ? t("journal.line.generic") : r.action;
    const moduleName = info?.name ?? "";
    const who = kind === "assistant" ? r.actor.replace(/^mcp:/, "") : kind === "module" ? (moduleName || r.actor.replace(/^module:/, "")) : kind === "system" ? t("journal.kind.system") : r.actor;
    return { id: r.id, when: r.createdAt, kind, who, level: isLevel(r.level) ? r.level : "info", sentence, target: r.target, moduleId: r.module, moduleName, code: r.action };
  });
}
