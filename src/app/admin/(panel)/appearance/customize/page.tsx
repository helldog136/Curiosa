import Link from "next/link";
import { adminCtx } from "@/core/admin";
import { APPEARANCE_HREF } from "@/core/adminLinks";
import { getAuthSecret } from "@/core/secret";
import { previewUrl, signPreview } from "@/core/skins/previewToken";
import { floatingLabels } from "@/components/admin/floating";
import { ui } from "@/components/admin/ui";
import { SKIN_ID_RE } from "@/core/skins/allowlist";
import { BASIC_ID } from "@/core/skins/constants";
import { definitionOf, loadAppearanceView } from "@/core/skins/appearanceView";
import { composeDraft } from "@/core/skins/customizeDraft";
import { pictureUsage, readStored } from "@/core/skins/customizeStore";
import { AppearanceLabelsProvider } from "../AppearanceLabels";
import { appearanceLabels } from "../labels";
import { CustomizeForm } from "./CustomizeForm";
import { buildModel, optionControls } from "./model";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("appearance.cz.titleNone"));
}

/** Apparence > <skin> > Personnaliser: one generic page, drawn from what the skin declares (docs/SKINS.md "Customization"). */
export default async function CustomizePage({ searchParams }: { searchParams?: Promise<{ skin?: string }> }) {
  const sp = (await searchParams) ?? {};
  const { t, config, locale: rawLocale } = await adminCtx("admin");
  const lang: "fr" | "en" = rawLocale === "fr" ? "fr" : "en";
  const view = await loadAppearanceView();
  const wanted = typeof sp.skin === "string" && SKIN_ID_RE.test(sp.skin) ? sp.skin : view.activeId;
  const def = wanted === BASIC_ID ? null : await definitionOf(wanted);
  const isActive = def?.id === view.activeId;
  const back = <Link href={APPEARANCE_HREF} className="text-accent hover:underline">{t("appearance.cz.back")}</Link>;

  const hasOptions = !!def && isActive && def.options.length > 0;
  if (!def || (!def.customize && !hasOptions)) {
    return (
      <div className="space-y-4">
        <h1 className={ui.pageTitle}>{t("appearance.cz.titleNone")}</h1>
        <p className={ui.pageIntro}>{def ? t("appearance.cz.empty") : t("appearance.cz.unavailable")}</p>
        <p><Link href={APPEARANCE_HREF} className={ui.btnPrimary} data-testid="customize-open-appearance">{t("appearance.cz.openAppearance")}</Link></p>
      </div>
    );
  }

  const stored = await readStored(def.id);
  const chosen = isActive ? Object.fromEntries(view.options.map((o) => [o.id, o.chosen])) : {};
  const composition = def.customize ? await composeDraft(def.id, { values: stored?.values ?? {}, look: stored?.look ?? null }, chosen) : null;
  const usage = await pictureUsage(def.id);
  const model = buildModel({
    skin: { id: def.id, version: def.version, name: def.name }, decl: def.customize, resolved: composition?.resolved ?? null, storedLook: stored?.look ?? null,
    signals: composition?.signals ?? [], options: optionControls(hasOptions ? def.options : [], chosen, lang), pictureCount: usage.files, lang, variantsLabel: t("appearance.cz.variants"),
  });
  const pages = [{ label: t("appearance.preview.home"), path: "/" }];
  for (const n of config.nav) if (n.href.startsWith("/") && !n.href.startsWith("//") && pages.length < 6) pages.push({ label: n.label[lang] ?? n.label[config.defaultLocale] ?? n.href, path: n.href });
  const name = model.skin.name;
  // a new key each time what is saved changes: the form starts again from it (after a save or a reset)
  const formKey = JSON.stringify([def.id, stored, chosen]);

  return (
    <AppearanceLabelsProvider labels={appearanceLabels(t)}>
      <div className="space-y-6">
        <header>
          <p className={ui.help}>{back} <span aria-hidden="true">›</span> {name}</p>
          <h1 className={ui.pageTitle}>{t("appearance.cz.title", { name })}</h1>
          <p className={ui.pageIntro}>{t("appearance.cz.intro", { name })}</p>
        </header>
        <CustomizeForm key={formKey} model={model} pages={pages} initialSrc={previewUrl("/", signPreview(def.id, getAuthSecret()))} bothModes={def.modes.length === 2} floating={floatingLabels(t)} hasPictures={usage.files > 0} canReset={!!def.customize || hasOptions} />
      </div>
    </AppearanceLabelsProvider>
  );
}
