import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildTheme, themeCss } from "@/core/color";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances } from "@/core/modules/registry";
import { getSiteConfig, themeExtraOf } from "@/core/settings";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> };

async function render(key: string, query: Record<string, string | undefined>) {
  const active = (await getActiveInstances()).find((a) => a.instance.key === key);
  if (!active?.mod.def.overlay) return null;
  const config = await getSiteConfig();
  const lang = query.lang && config.locales.includes(query.lang) ? query.lang : config.defaultLocale;
  const params = new URLSearchParams(Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])));
  try {
    return await active.mod.def.overlay(await buildContext(active.mod, active.instance, lang), { query: params });
  } catch (error) {
    console.error(`[modules] overlay ${key} failed:`, error);
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const result = await render((await params).key, await searchParams);
  return { title: result?.title ?? "Overlay" };
}

/**
 * Rend l'overlay d'une instance de module de type "overlay". Le module est un code de
 * confiance : son HTML/CSS/JS est servi tel quel dans une page nue.
 */
export default async function OverlayPage({ params, searchParams }: Props) {
  const result = await render((await params).key, await searchParams);
  if (!result) notFound();
  const config = await getSiteConfig();
  const theme = buildTheme(config.background, config.accent, config.font, themeExtraOf(config));
  return (
    <>
      {/* Le thème du site, en variables CSS : l'overlay peut s'y accorder (var(--v-accent)…) sans rien demander. */}
      <style dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      {result.css && <style dangerouslySetInnerHTML={{ __html: result.css }} />}
      <div dangerouslySetInnerHTML={{ __html: result.html }} />
      {result.script && <script dangerouslySetInnerHTML={{ __html: result.script }} />}
    </>
  );
}
