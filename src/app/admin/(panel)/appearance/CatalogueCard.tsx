"use client";

import { useState, useTransition } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { PendingButton } from "@/components/admin/PendingButton";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { InspectPanel } from "./InspectPanel";
import { catalogueAddress, inspectSkinAction, installFromCatalogueAction, type InspectView } from "./actions";

export type CatalogueCardModel = {
  id: string; name: string; description: string; author?: string; modes: ("light" | "dark")[]; version?: string;
  installed: boolean; installedVersion?: string; updateAvailable: boolean; compatible: boolean; needsNewerCore?: string; origin: "official" | "extra";
};

/** Une carte du catalogue : « Installer et utiliser » (un clic), « Installer », « Voir les détails » (lit le dépôt sans rien installer). */
export function CatalogueCard({ item, locale, canInstall }: { item: CatalogueCardModel; locale: "fr" | "en"; canInstall: boolean }) {
  const al = useAL();
  const [detail, setDetail] = useState<InspectView | null>(null);
  const [busy, start] = useTransition();
  const look = () => start(async () => {
    const url = await catalogueAddress(item.id);
    setDetail(url ? await inspectSkinAction(url) : { ok: false, error: al("skins.error.notfound") });
  });
  return (
    <li className={`${ui.card} space-y-3 !p-4`} data-catalogue-skin={item.id}>
      <div className="space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
          {item.name}
          {item.version && <span className="text-sm font-normal text-muted">{item.version}</span>}
          {item.installed && <span className={ui.chipOk}>{al("appearance.installedTag")}</span>}
          {item.updateAvailable && <span className={ui.chipWarn}>{al("appearance.updateTag")}</span>}
          {item.origin === "extra" && <span className={ui.chipWarn}>{al("appearance.personalTag")}</span>}
        </h3>
        <p className="text-sm text-muted">{item.description}</p>
        <p className="text-[13px] text-muted">
          {item.author ? al("appearance.by", { author: item.author }) : ""}
          {item.modes.length ? ` · ${item.modes.map((m) => al(`appearance.mode.${m}`)).join(" · ")}` : ""}
        </p>
        {!item.compatible && <p role="alert" className="text-[13px] text-red-700">{al("skins.error.contract")}</p>}
        {item.needsNewerCore && <p role="alert" className="text-[13px] text-red-700">{al("skins.error.core", { version: item.needsNewerCore })}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PendingButton type="button" variant="btn" pending={busy} pendingLabel={al("appearance.reading")} onClick={look}>{al("appearance.details")}<span className="sr-only"> — {item.name}</span></PendingButton>
        {canInstall && !item.installed && item.compatible && !item.needsNewerCore && item.origin === "official" && (
          <>
            <ActionForm action={installFromCatalogueAction} submitLabel={al("appearance.installAndUse")} pendingLabel={al("appearance.installing")} className="contents">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="activate" value="1" />
            </ActionForm>
            <ActionForm action={installFromCatalogueAction} submitLabel={al("appearance.install")} secondary pendingLabel={al("appearance.installing")} className="contents">
              <input type="hidden" name="id" value={item.id} />
            </ActionForm>
          </>
        )}
      </div>
      {detail && (detail.ok ? <InspectPanel data={detail} locale={locale} /> : <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{detail.error}</p>)}
    </li>
  );
}
