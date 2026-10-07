import { headers } from "next/headers";
import { localeName } from "@/core/i18n/locales";

/**
 * Change de langue en conservant la page courante. Pour une entrée dont le
 * slug diffère selon la langue, la page de destination redirige vers la bonne
 * traduction (voir findEntryBySlug).
 */
export async function LanguageSwitcher({ locales, current, defaultLocale }: { locales: string[]; current: string; defaultLocale: string }) {
  if (locales.length < 2) return null;
  const path = (await headers()).get("x-vitrine-path") || "/";
  return (
    <nav aria-label="Language" className="flex items-center gap-1 text-sm">
      {locales.map((code) => {
        const href =
          code === defaultLocale
            ? `${path}${path.includes("?") ? "&" : "?"}vl=default`
            : `/${code}${path === "/" ? "" : path}`;
        return (
          <a
            key={code}
            href={href}
            hrefLang={code}
            lang={code}
            title={localeName(code)}
            aria-current={code === current ? "true" : undefined}
            className={`rounded px-2 py-1 uppercase ${code === current ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"}`}
          >
            {code}
          </a>
        );
      })}
    </nav>
  );
}
