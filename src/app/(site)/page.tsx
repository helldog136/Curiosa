import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_HEADER, getVisitorLocale } from "@/core/i18n/request";
import { homeLayout } from "@/core/home";
import { getActiveInstances } from "@/core/modules/registry";
import { runSection } from "@/core/modules/runtime";
import { getSiteConfig } from "@/core/settings";
import { Blocks } from "@/components/site/Blocks";

export const dynamic = "force-dynamic";

/** Langue préférée d'un visiteur qui arrive sur "/" sans préférence mémorisée. */
function detect(acceptLanguage: string | null, enabled: string[]): string | null {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().split(/[;-]/)[0]?.toLowerCase();
    if (code && enabled.includes(code)) return code;
  }
  return null;
}

/**
 * La page d'accueil n'a pas de contenu propre : c'est un assemblage de sections
 * proposées par les instances de modules, dans l'ordre choisi dans l'admin.
 */
export default async function HomePage() {
  const config = await getSiteConfig();
  const h = await headers();

  if (!h.get(LOCALE_HEADER)) {
    const remembered = (await cookies()).get("vitrine_locale")?.value;
    const target =
      remembered && remembered !== "default"
        ? config.locales.includes(remembered) ? remembered : null
        : !remembered && config.autoDetect
          ? detect(h.get("accept-language"), config.locales)
          : null;
    if (target && target !== config.defaultLocale) redirect(`/${target}`);
  }

  const locale = await getVisitorLocale();
  const layout = homeLayout(config.homeSections, await getActiveInstances());
  const rendered = await Promise.all(
    layout.map(async ({ section: s, size, isolated }) => ({ id: s.id, size, isolated, blocks: await runSection(s.instance, s.section, s.options, locale) })),
  );
  // Un morceau vide (module sans rien à montrer) ne prend pas de place : les autres s'écoulent à sa place.
  const shown = rendered.filter((s) => s.blocks.length > 0);

  return (
    <div className="vh-flow">
      {shown.map((s) => (
        <div key={s.id} className={`vh-cell vh-${s.size}${s.isolated ? " vh-isolated" : ""}`}>
          {s.isolated ? (
            <div className="vh-solo">
              <Blocks blocks={s.blocks} locale={locale} />
            </div>
          ) : (
            <Blocks blocks={s.blocks} locale={locale} />
          )}
        </div>
      ))}
    </div>
  );
}
